-- Vinifera Phase 5: scale, integrations, multi-brand tenancy, white label,
-- and mobile delivery infrastructure.
--
-- Integration credentials are deliberately excluded from browser-readable
-- connection rows. The service role may store either an encrypted envelope or
-- an external secret-manager reference, allowing production wiring to be
-- completed before a provider credential is available.

begin;

create type public.brand_billing_mode as enum ('shared', 'independent');
create type public.staff_brand_scope as enum ('brand_restricted', 'all_brands');
create type public.brand_access_level as enum ('viewer', 'operator', 'admin');
create type public.integration_type as enum (
  'klaviyo',
  'quickbooks',
  'avalara',
  'meta',
  'shipcompliant'
);
create type public.integration_connection_status as enum (
  'activation_required',
  'configured',
  'active',
  'degraded',
  'disconnected'
);
create type public.secret_storage_mode as enum (
  'encrypted_envelope',
  'external_reference'
);
create type public.integration_job_status as enum (
  'queued',
  'leased',
  'completed',
  'retry',
  'dead_letter'
);
create type public.integration_job_direction as enum ('inbound', 'outbound');
create type public.integration_job_outcome as enum (
  'synced',
  'partial',
  'retry',
  'dead_letter'
);
create type public.custom_domain_status as enum (
  'pending_dns',
  'verifying',
  'active',
  'failed',
  'disabled'
);
create type public.custom_hostname_status as enum (
  'pending',
  'active',
  'blocked',
  'failed'
);
create type public.custom_ssl_status as enum (
  'pending',
  'initializing',
  'active',
  'expired',
  'failed'
);
create type public.sender_identity_status as enum (
  'pending',
  'verified',
  'failed',
  'disabled'
);
create type public.mobile_platform as enum ('ios', 'android');
create type public.push_outbox_status as enum (
  'queued',
  'leased',
  'sent',
  'retry',
  'dead_letter',
  'cancelled'
);
create type public.offline_mutation_status as enum (
  'pending',
  'applied',
  'conflict',
  'rejected'
);

create or replace function private.jsonb_has_secret_keys(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if lower(v_key) ~
        '(^|_)(secret|token|password|credential|private_key|access_key|api_key|ciphertext|nonce)($|_)'
        or private.jsonb_has_secret_keys(v_child)
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if private.jsonb_has_secret_keys(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;


create or replace function private.jsonb_has_raw_pii_keys(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if lower(v_key) ~
        '(^|_)(email|phone|first_name|last_name|name|address|postal_code|zip|birthdate)($|_)'
        or private.jsonb_has_raw_pii_keys(v_child)
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if private.jsonb_has_raw_pii_keys(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function private.jsonb_is_meta_hash_map(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value text;
  v_count integer := 0;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return false;
  end if;

  for v_key, v_value in select key, value from jsonb_each_text(p_value)
  loop
    v_count := v_count + 1;
    if v_key not in ('em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'db', 'external_id')
      or v_value !~ '^[0-9a-f]{64}$'
    then
      return false;
    end if;
  end loop;

  return v_count > 0;
end;
$$;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade
    deferrable initially deferred,
  name text not null,
  slug text not null,
  portal_title text not null default '',
  description text not null default '',
  logo_url text,
  primary_color text not null default '#6F263D',
  secondary_color text not null default '#F5EFE8',
  accent_color text not null default '#C9A66B',
  font_family text not null default 'system-ui',
  billing_mode public.brand_billing_mode not null default 'shared',
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status public.subscription_status not null default 'not_started',
  access_status public.organization_access_status not null default 'active',
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_name_length
    check (char_length(btrim(name)) between 1 and 200),
  constraint brands_portal_title_length
    check (char_length(portal_title) <= 200),
  constraint brands_slug_format
    check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint brands_description_length
    check (char_length(description) <= 2000),
  constraint brands_logo_url_https
    check (logo_url is null or logo_url ~ '^https://'),
  constraint brands_color_format
    check (
      primary_color ~ '^#[0-9A-Fa-f]{6}$'
      and secondary_color ~ '^#[0-9A-Fa-f]{6}$'
      and accent_color ~ '^#[0-9A-Fa-f]{6}$'
    ),
  constraint brands_stripe_customer_id_format
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  constraint brands_stripe_subscription_id_format
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  constraint brands_independent_billing_consistent
    check (
      billing_mode = 'shared'
      or stripe_customer_id is not null
      or subscription_status = 'not_started'
    ),
  constraint brands_organization_id_id_key unique (organization_id, id),
  constraint brands_organization_slug_key unique (organization_id, slug)
);

create unique index brands_one_default_per_org_uidx
  on public.brands (organization_id)
  where is_default;
create unique index brands_stripe_customer_id_uidx
  on public.brands (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index brands_stripe_subscription_id_uidx
  on public.brands (stripe_subscription_id)
  where stripe_subscription_id is not null;
create index brands_org_active_idx
  on public.brands (organization_id, active, name);

alter table public.brands
  add column plan_tier public.plan_tier not null default 'vine',
  add column stripe_state_updated_at timestamptz,
  add column payment_failed_at timestamptz;

alter table public.organizations
  add column default_brand_id uuid;

create or replace function private.slugify_brand_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'brand'
  );
$$;

create or replace function private.seed_default_brand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_slug text;
begin
  if new.default_brand_id is not null then
    return new;
  end if;

  v_slug := private.slugify_brand_name(new.name);

  insert into public.brands (
    organization_id,
    name,
    slug,
    billing_mode,
    is_default,
    active
  )
  values (
    new.id,
    new.name,
    v_slug,
    'shared',
    true,
    true
  )
  returning id into v_brand_id;

  new.default_brand_id := v_brand_id;
  return new;
end;
$$;

create trigger organizations_seed_default_brand
before insert on public.organizations
for each row execute function private.seed_default_brand();

insert into public.brands (
  organization_id,
  name,
  slug,
  billing_mode,
  is_default,
  active
)
select
  o.id,
  o.name,
  private.slugify_brand_name(o.name),
  'shared',
  true,
  true
from public.organizations as o
where o.default_brand_id is null
on conflict (organization_id, slug) do nothing;

update public.organizations as o
set default_brand_id = b.id
from public.brands as b
where b.organization_id = o.id
  and b.is_default
  and o.default_brand_id is null;

alter table public.organizations
  alter column default_brand_id set not null,
  add constraint organizations_default_brand_same_org_fkey
    foreign key (id, default_brand_id)
    references public.brands (organization_id, id)
    deferrable initially deferred;

create table public.organization_staff_access (
  organization_id uuid not null,
  staff_user_id uuid not null,
  scope public.staff_brand_scope not null default 'brand_restricted',
  granted_by uuid,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, staff_user_id),
  constraint organization_staff_access_staff_same_org_fkey
    foreign key (organization_id, staff_user_id)
    references public.staff_users (organization_id, id)
    on delete cascade,
  constraint organization_staff_access_granter_same_org_fkey
    foreign key (organization_id, granted_by)
    references public.staff_users (organization_id, id)
    on delete set null (granted_by)
);

create table public.staff_brand_access (
  organization_id uuid not null,
  staff_user_id uuid not null,
  brand_id uuid not null,
  access_level public.brand_access_level not null default 'viewer',
  granted_by uuid,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, staff_user_id, brand_id),
  constraint staff_brand_access_staff_same_org_fkey
    foreign key (organization_id, staff_user_id)
    references public.staff_users (organization_id, id)
    on delete cascade,
  constraint staff_brand_access_brand_same_org_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint staff_brand_access_granter_same_org_fkey
    foreign key (organization_id, granted_by)
    references public.staff_users (organization_id, id)
    on delete set null (granted_by)
);

insert into public.organization_staff_access (
  organization_id,
  staff_user_id,
  scope
)
select
  s.organization_id,
  s.id,
  case
    when s.role in ('owner', 'admin') then 'all_brands'::public.staff_brand_scope
    else 'brand_restricted'::public.staff_brand_scope
  end
from public.staff_users as s
on conflict (organization_id, staff_user_id) do nothing;

insert into public.staff_brand_access (
  organization_id,
  staff_user_id,
  brand_id,
  access_level
)
select
  s.organization_id,
  s.id,
  o.default_brand_id,
  case
    when s.role in ('owner', 'admin') then 'admin'::public.brand_access_level
    else 'operator'::public.brand_access_level
  end
from public.staff_users as s
join public.organizations as o on o.id = s.organization_id
on conflict (organization_id, staff_user_id, brand_id) do nothing;

create or replace function private.seed_staff_brand_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default_brand_id uuid;
begin
  select o.default_brand_id
  into v_default_brand_id
  from public.organizations as o
  where o.id = new.organization_id;

  insert into public.organization_staff_access (
    organization_id,
    staff_user_id,
    scope
  )
  values (
    new.organization_id,
    new.id,
    case
      when new.role in ('owner', 'admin') then 'all_brands'::public.staff_brand_scope
      else 'brand_restricted'::public.staff_brand_scope
    end
  )
  on conflict (organization_id, staff_user_id) do nothing;

  insert into public.staff_brand_access (
    organization_id,
    staff_user_id,
    brand_id,
    access_level
  )
  values (
    new.organization_id,
    new.id,
    v_default_brand_id,
    case
      when new.role in ('owner', 'admin') then 'admin'::public.brand_access_level
      else 'operator'::public.brand_access_level
    end
  )
  on conflict (organization_id, staff_user_id, brand_id) do nothing;

  return new;
end;
$$;

create trigger staff_users_seed_brand_access
after insert on public.staff_users
for each row execute function private.seed_staff_brand_access();

create or replace function private.default_brand_for_org(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.default_brand_id
  from public.organizations as o
  where o.id = p_organization_id;
$$;

create or replace function private.can_access_brand(
  p_organization_id uuid,
  p_brand_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_service_role()
    or private.is_super_admin()
    or (
      auth.auth_surface() = 'staff'
      and auth.org_id() = p_organization_id
      and exists (
        select 1
        from public.staff_users as s
        join public.organization_staff_access as osa
          on osa.organization_id = s.organization_id
         and osa.staff_user_id = s.id
        where s.id = auth.uid()
          and s.organization_id = p_organization_id
          and s.status = 'active'
          and s.role::text = auth.user_role()
          and (
            osa.scope = 'all_brands'
            or (
              p_brand_id is not null
              and exists (
                select 1
                from public.staff_brand_access as sba
                where sba.organization_id = p_organization_id
                  and sba.staff_user_id = s.id
                  and sba.brand_id = p_brand_id
              )
            )
          )
      )
    )
    or (
      p_brand_id is not null
      and auth.auth_surface() = 'member'
      and auth.org_id() = p_organization_id
      and exists (
        select 1
        from public.members as m
        join public.brands as b
          on b.organization_id = m.organization_id
         and b.id = nullif(to_jsonb(m) ->> 'brand_id', '')::uuid
        join public.organizations as o
          on o.id = m.organization_id
        where m.auth_user_id = auth.uid()
          and m.organization_id = p_organization_id
          and nullif(to_jsonb(m) ->> 'brand_id', '')::uuid = p_brand_id
          and b.active
          and (
            (b.billing_mode = 'independent' and b.access_status <> 'suspended')
            or (b.billing_mode = 'shared' and o.access_status <> 'suspended')
          )
      )
    );
$$;

create or replace function private.current_brand_access_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_brand_ids uuid[];
begin
  if private.is_service_role() or private.is_super_admin() then
    select coalesce(array_agg(brand.id), '{}'::uuid[])
    into v_brand_ids
    from public.brands as brand;
    return v_brand_ids;
  end if;

  if auth.auth_surface() = 'staff' then
    select coalesce(array_agg(brand.id), '{}'::uuid[])
    into v_brand_ids
    from public.staff_users as staff
    join public.organization_staff_access as organization_access
      on organization_access.organization_id = staff.organization_id
     and organization_access.staff_user_id = staff.id
    join public.brands as brand
      on brand.organization_id = staff.organization_id
    left join public.staff_brand_access as brand_access
      on brand_access.organization_id = staff.organization_id
     and brand_access.staff_user_id = staff.id
     and brand_access.brand_id = brand.id
    where staff.id = auth.uid()
      and staff.organization_id = auth.org_id()
      and staff.status = 'active'
      and staff.role::text = auth.user_role()
      and (
        organization_access.scope = 'all_brands'
        or brand_access.brand_id is not null
      );
    return v_brand_ids;
  end if;

  if auth.auth_surface() = 'member' then
    select coalesce(array_agg(member.brand_id), '{}'::uuid[])
    into v_brand_ids
    from public.members as member
    join public.brands as brand
      on brand.organization_id = member.organization_id
     and brand.id = member.brand_id
    join public.organizations as organization
      on organization.id = member.organization_id
    where member.auth_user_id = auth.uid()
      and member.organization_id = auth.org_id()
      and brand.active
      and (
        (
          brand.billing_mode = 'independent'
          and brand.access_status <> 'suspended'
        )
        or (
          brand.billing_mode = 'shared'
          and organization.access_status <> 'suspended'
        )
      );
    return v_brand_ids;
  end if;

  return '{}'::uuid[];
end;
$$;

create or replace function private.brand_accepts_operational_charges(
  p_organization_id uuid,
  p_brand_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.brands as b
    join public.organizations as o on o.id = b.organization_id
    where b.organization_id = p_organization_id
      and b.id = p_brand_id
      and b.active
      and (
        (b.billing_mode = 'independent' and b.access_status <> 'suspended')
        or (b.billing_mode = 'shared' and o.access_status <> 'suspended')
      )
  );
$$;

create or replace function private.can_manage_brand(
  p_organization_id uuid,
  p_brand_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_service_role()
    or private.is_super_admin()
    or (
      private.is_staff_for_org(
        p_organization_id,
        array['owner', 'admin']::public.staff_role[]
      )
      and (
        exists (
          select 1
          from public.organization_staff_access as osa
          where osa.organization_id = p_organization_id
            and osa.staff_user_id = auth.uid()
            and osa.scope = 'all_brands'
        )
        or exists (
          select 1
          from public.staff_brand_access as sba
          where sba.organization_id = p_organization_id
            and sba.staff_user_id = auth.uid()
            and sba.brand_id = p_brand_id
            and sba.access_level = 'admin'
        )
      )
    );
$$;

-- Every member-, tier-, release-, shipment-, retention-, analytics-, and
-- compliance-scoped row carries a concrete brand. Organization-wide benchmark
-- and model artifacts remain intentionally organization scoped.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'members',
    'club_tiers',
    'releases',
    'release_tiers',
    'release_wines',
    'release_tier_items',
    'shipments',
    'shipment_items',
    'billing_attempts',
    'member_imports',
    'member_import_rows',
    'audit_log',
    'email_templates',
    'member_email_preferences',
    'email_log',
    'email_outbox',
    'email_delivery_events',
    'email_unsubscribe_tokens',
    'churn_scores',
    'cancel_flow_steps',
    'cancel_flow_attempts',
    'cancel_flow_events',
    'member_activity_events',
    'loyalty_tier_multipliers',
    'loyalty_redemptions',
    'loyalty_ledger',
    'loyalty_point_lots',
    'loyalty_reservation_allocations',
    'analytics_events',
    'dashboard_layout_preferences',
    'analytics_report_schedules',
    'ml_feature_snapshots',
    'ml_training_rows',
    'ml_churn_predictions',
    'ml_high_risk_alerts',
    'compliance_checks',
    'shipping_label_attempts'
  ]
  loop
    execute format(
      'alter table public.%I add column brand_id uuid',
      v_table
    );
    execute format(
      'update public.%I as row_to_brand
       set brand_id = o.default_brand_id
       from public.organizations as o
       where o.id = row_to_brand.organization_id
         and row_to_brand.brand_id is null',
      v_table
    );
    execute format(
      'alter table public.%I alter column brand_id set not null',
      v_table
    );
    execute format(
      'alter table public.%I
       add constraint %I
       foreign key (organization_id, brand_id)
       references public.brands (organization_id, id)',
      v_table,
      v_table || '_brand_same_org_fkey'
    );
    execute format(
      'create index %I on public.%I (organization_id, brand_id)',
      v_table || '_org_brand_idx',
      v_table
    );
  end loop;
end;
$$;

alter table public.brands enable row level security;
alter table public.brands force row level security;

create policy brands_member_read_policy
  on public.brands
  for select to authenticated
  using (
    exists (
      select 1
      from public.members as m
      join public.organizations as o on o.id = m.organization_id
      where m.organization_id = brands.organization_id
        and m.brand_id = brands.id
        and m.auth_user_id = auth.uid()
        and brands.active
        and (
          (brands.billing_mode = 'independent' and brands.access_status <> 'suspended')
          or (brands.billing_mode = 'shared' and o.access_status <> 'suspended')
        )
    )
  );

create policy brands_staff_brand_access
  on public.brands
  for all to authenticated
  using (
    private.is_staff_for_org(organization_id)
    and private.can_access_brand(organization_id, id)
  )
  with check (
    private.is_staff_for_org(organization_id)
    and private.can_access_brand(organization_id, id)
  );

create or replace function public.create_brand(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_billing_mode public.brand_billing_mode default 'shared'
)
returns public.brands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand public.brands;
begin
  if not (
    private.is_service_role()
    or (
      private.is_staff_for_org(
        p_organization_id,
        array['owner', 'admin']::public.staff_role[]
      )
      and exists (
        select 1
        from public.organization_staff_access as access
        where access.organization_id = p_organization_id
          and access.staff_user_id = auth.uid()
          and access.scope = 'all_brands'
      )
    )
  ) then
    raise exception using errcode = '42501', message = 'All-brand admin authorization is required.';
  end if;

  insert into public.brands (
    organization_id,
    name,
    slug,
    billing_mode,
    is_default
  )
  values (
    p_organization_id,
    btrim(p_name),
    lower(btrim(p_slug)),
    p_billing_mode,
    false
  )
  returning * into v_brand;

  if auth.auth_surface() = 'staff' then
    insert into public.staff_brand_access (
      organization_id,
      staff_user_id,
      brand_id,
      access_level,
      granted_by
    )
    values (
      p_organization_id,
      auth.uid(),
      v_brand.id,
      'admin',
      auth.uid()
    )
    on conflict (organization_id, staff_user_id, brand_id)
    do update set access_level = 'admin', updated_at = now();
  end if;

  return v_brand;
end;
$$;

create or replace function public.grant_staff_brand_access(
  p_organization_id uuid,
  p_staff_user_id uuid,
  p_brand_id uuid,
  p_access_level public.brand_access_level
)
returns public.staff_brand_access
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.staff_brand_access;
begin
  if not private.can_manage_brand(p_organization_id, p_brand_id) then
    raise exception using errcode = '42501', message = 'Brand admin authorization is required.';
  end if;

  insert into public.staff_brand_access (
    organization_id,
    staff_user_id,
    brand_id,
    access_level,
    granted_by
  )
  values (
    p_organization_id,
    p_staff_user_id,
    p_brand_id,
    p_access_level,
    auth.uid()
  )
  on conflict (organization_id, staff_user_id, brand_id)
  do update set
    access_level = excluded.access_level,
    granted_by = excluded.granted_by,
    granted_at = now(),
    updated_at = now()
  returning * into v_access;

  return v_access;
end;
$$;

create or replace function private.assign_and_validate_brand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_parent_id uuid;
begin
  v_brand_id := nullif(to_jsonb(new) ->> 'brand_id', '')::uuid;

  if v_brand_id is null and tg_nargs = 2 then
    v_parent_id := nullif(to_jsonb(new) ->> tg_argv[1], '')::uuid;
    if v_parent_id is not null then
      execute format(
        'select brand_id from public.%I where id = $1 and organization_id = $2',
        tg_argv[0]
      )
      into v_brand_id
      using v_parent_id, new.organization_id;
    end if;
  end if;

  if v_brand_id is null then
    v_brand_id := nullif(
      current_setting('vinifera.brand_id', true),
      ''
    )::uuid;
  end if;

  if v_brand_id is null then
    v_brand_id := private.default_brand_for_org(new.organization_id);
  end if;

  if not exists (
    select 1
    from public.brands as b
    where b.organization_id = new.organization_id
      and b.id = v_brand_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Brand does not belong to the organization.';
  end if;

  new := jsonb_populate_record(new, jsonb_build_object('brand_id', v_brand_id));
  return new;
end;
$$;

alter table public.subscription_events
  add column brand_id uuid;
update public.subscription_events as event
set brand_id = organization.default_brand_id
from public.organizations as organization
where organization.id = event.organization_id;
alter table public.subscription_events
  alter column brand_id set not null,
  drop constraint subscription_events_test_mode_only,
  add constraint subscription_events_brand_same_org_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id);
create index subscription_events_org_brand_created_idx
  on public.subscription_events (
    organization_id,
    brand_id,
    stripe_created_at desc
  );
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'members',
    'subscription_events',
    'club_tiers',
    'releases',
    'member_imports',
    'email_templates',
    'cancel_flow_steps',
    'dashboard_layout_preferences',
    'analytics_report_schedules',
    'audit_log'
  ]
  loop
    execute format(
      'create trigger %I before insert or update of organization_id, brand_id
       on public.%I for each row
       execute function private.assign_and_validate_brand()',
      v_table || '_assign_brand',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_item record;
begin
  for v_item in
    select *
    from (
      values
        ('release_tiers', 'releases', 'release_id'),
        ('release_wines', 'releases', 'release_id'),
        ('release_tier_items', 'release_tiers', 'release_tier_id'),
        ('shipments', 'members', 'member_id'),
        ('shipment_items', 'shipments', 'shipment_id'),
        ('billing_attempts', 'shipments', 'shipment_id'),
        ('member_import_rows', 'member_imports', 'import_id'),
        ('member_email_preferences', 'members', 'member_id'),
        ('email_log', 'members', 'member_id'),
        ('email_outbox', 'email_log', 'email_log_id'),
        ('email_delivery_events', 'email_log', 'email_log_id'),
        ('email_unsubscribe_tokens', 'members', 'member_id'),
        ('churn_scores', 'members', 'member_id'),
        ('cancel_flow_attempts', 'members', 'member_id'),
        ('cancel_flow_events', 'cancel_flow_attempts', 'attempt_id'),
        ('member_activity_events', 'members', 'member_id'),
        ('loyalty_tier_multipliers', 'club_tiers', 'club_tier_id'),
        ('loyalty_redemptions', 'members', 'member_id'),
        ('loyalty_ledger', 'members', 'member_id'),
        ('loyalty_point_lots', 'members', 'member_id'),
        ('loyalty_reservation_allocations', 'loyalty_redemptions', 'redemption_id'),
        ('analytics_events', 'members', 'member_id'),
        ('ml_feature_snapshots', 'members', 'member_id'),
        ('ml_training_rows', 'members', 'member_id'),
        ('ml_churn_predictions', 'members', 'member_id'),
        ('ml_high_risk_alerts', 'members', 'member_id'),
        ('compliance_checks', 'shipments', 'shipment_id'),
        ('shipping_label_attempts', 'shipments', 'shipment_id')
    ) as mappings(table_name, parent_table, parent_column)
  loop
    execute format(
      'create trigger %I before insert or update of organization_id, brand_id, %I
       on public.%I for each row
       execute function private.assign_and_validate_brand(%L, %L)',
      v_item.table_name || '_assign_brand',
      v_item.parent_column,
      v_item.table_name,
      v_item.parent_table,
      v_item.parent_column
    );
  end loop;
end;
$$;

drop index if exists public.members_email_uidx;
drop index if exists public.members_organization_email_uidx;
alter table public.members
  drop constraint if exists members_auth_user_id_key;
create unique index members_brand_email_uidx
  on public.members (organization_id, brand_id, lower(email))
  where deleted_at is null;
create index members_auth_user_id_idx
  on public.members (auth_user_id)
  where auth_user_id is not null;

drop index if exists public.club_tiers_organization_name_uidx;
create unique index club_tiers_brand_name_uidx
  on public.club_tiers (organization_id, brand_id, lower(name));

alter table public.email_templates
  drop constraint email_templates_organization_trigger_key,
  add constraint email_templates_organization_trigger_key
    unique (organization_id, brand_id, trigger_type);

alter table public.cancel_flow_steps
  drop constraint cancel_flow_steps_org_type_key,
  drop constraint cancel_flow_steps_org_position_key,
  add constraint cancel_flow_steps_org_type_key
    unique (organization_id, brand_id, step_type),
  add constraint cancel_flow_steps_org_position_key
    unique (organization_id, brand_id, position);

alter table public.email_log
  drop constraint email_log_org_idempotency_key,
  add constraint email_log_org_idempotency_key
    unique (organization_id, brand_id, idempotency_key);

create or replace function public.enqueue_email_trigger(
  p_organization_id uuid,
  p_member_id uuid,
  p_trigger_type public.email_trigger_type,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_scheduled_for timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_log_id uuid;
  v_member public.members%rowtype;
  v_template public.email_templates%rowtype;
  v_organization_name text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Email payload must be an object.';
  end if;

  select m.*
  into v_member
  from public.members as m
  where m.id = p_member_id
    and m.organization_id = p_organization_id
    and m.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Member not found.';
  end if;

  select l.id
  into v_existing_id
  from public.email_log as l
  where l.organization_id = p_organization_id
    and l.brand_id = v_member.brand_id
    and l.idempotency_key = p_idempotency_key;

  if found then
    return v_existing_id;
  end if;

  select organization.name
  into v_organization_name
  from public.organizations as organization
  where organization.id = p_organization_id;

  if not v_member.transactional_email_enabled then
    return null;
  end if;

  if exists (
    select 1
    from public.member_email_preferences as preference
    where preference.organization_id = p_organization_id
      and preference.brand_id = v_member.brand_id
      and preference.member_id = p_member_id
      and preference.trigger_type = p_trigger_type
      and not preference.enabled
  ) then
    return null;
  end if;

  select template.*
  into v_template
  from public.email_templates as template
  where template.organization_id = p_organization_id
    and template.brand_id = v_member.brand_id
    and template.trigger_type = p_trigger_type
    and template.enabled;

  if not found then
    return null;
  end if;

  insert into public.email_log (
    organization_id,
    brand_id,
    member_id,
    template_id,
    trigger_type,
    idempotency_key,
    to_email,
    subject,
    body,
    payload,
    scheduled_for
  )
  values (
    p_organization_id,
    v_member.brand_id,
    p_member_id,
    v_template.id,
    p_trigger_type,
    p_idempotency_key,
    v_member.email,
    v_template.subject,
    v_template.body,
    p_payload || jsonb_build_object(
      'organization_name', v_organization_name,
      'member_first_name', v_member.first_name,
      'member_last_name', v_member.last_name,
      'member_email', v_member.email
    ),
    p_scheduled_for
  )
  on conflict on constraint email_log_org_idempotency_key
  do update set idempotency_key = excluded.idempotency_key
  returning id into v_log_id;

  insert into public.email_outbox (
    organization_id,
    brand_id,
    email_log_id,
    available_at
  )
  values (p_organization_id, v_member.brand_id, v_log_id, p_scheduled_for)
  on conflict (organization_id, email_log_id) do nothing;

  return v_log_id;
end;
$$;

create or replace function public.enqueue_test_email(
  p_organization_id uuid,
  p_template_id uuid,
  p_to_email text,
  p_subject text,
  p_body text,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.email_templates%rowtype;
  v_log_id uuid;
begin
  if lower(btrim(p_to_email)) <> p_to_email
    or char_length(p_to_email) not between 3 and 320
    or position('@' in p_to_email) <= 1
  then
    raise exception using errcode = '22023', message = 'Test recipient email is invalid.';
  end if;
  if char_length(btrim(p_subject)) not between 1 and 200
    or p_subject ~ E'[\\r\\n]'
  then
    raise exception using errcode = '22023', message = 'Test subject is invalid.';
  end if;
  if char_length(p_body) not between 1 and 100000
    or lower(p_body) ~ '<[[:space:]]*script'
    or lower(p_body) ~ 'javascript[[:space:]]*:'
  then
    raise exception using errcode = '22023', message = 'Test email body is unsafe.';
  end if;

  select template.*
  into v_template
  from public.email_templates as template
  where template.id = p_template_id
    and template.organization_id = p_organization_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Email template not found.';
  end if;
  if not private.can_manage_brand(p_organization_id, v_template.brand_id) then
    raise exception using errcode = '42501', message = 'Brand admin authorization is required.';
  end if;

  insert into public.email_log (
    organization_id,
    brand_id,
    member_id,
    template_id,
    trigger_type,
    is_test,
    requested_by,
    idempotency_key,
    to_email,
    subject,
    body,
    payload
  )
  values (
    p_organization_id,
    v_template.brand_id,
    null,
    v_template.id,
    v_template.trigger_type,
    true,
    p_actor_user_id,
    p_idempotency_key,
    p_to_email,
    p_subject,
    p_body,
    jsonb_build_object('test', true)
  )
  on conflict on constraint email_log_org_idempotency_key
  do update set idempotency_key = excluded.idempotency_key
  returning id into v_log_id;

  insert into public.email_outbox (
    organization_id,
    brand_id,
    email_log_id,
    available_at
  )
  values (p_organization_id, v_template.brand_id, v_log_id, now())
  on conflict (organization_id, email_log_id) do nothing;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    'email.test_queued',
    'email_log',
    v_log_id,
    jsonb_build_object(
      'brand_id', v_template.brand_id,
      'template_id', p_template_id,
      'recipient_domain', split_part(p_to_email, '@', 2)
    )
  );

  return v_log_id;
end;
$$;

alter table public.dashboard_layout_preferences
  drop constraint dashboard_layout_preferences_org_staff_key,
  add constraint dashboard_layout_preferences_org_staff_key
    unique (organization_id, brand_id, staff_user_id);

alter table public.analytics_report_schedules
  drop constraint analytics_report_schedules_org_staff_type_key,
  add constraint analytics_report_schedules_org_staff_type_key
    unique (organization_id, brand_id, staff_user_id, report_type);

create or replace function private.seed_phase3_organization_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_templates (
    organization_id,
    trigger_type,
    subject,
    body,
    days_before
  )
  values
    (
      new.id,
      'welcome',
      'Welcome to {{organization_name}}',
      '<p>Welcome, {{member_first_name}}. We are delighted to have you in the club.</p>',
      null
    ),
    (
      new.id,
      'pre_shipment',
      'Your next wine club shipment is coming',
      '<p>Your {{release_name}} shipment is scheduled for {{processing_date}}.</p>',
      3
    ),
    (
      new.id,
      'payment_decline',
      'Action needed for your wine club shipment',
      '<p>We could not process your payment. Please update your payment method.</p>',
      null
    ),
    (
      new.id,
      'shipped',
      'Your wine club shipment is on its way',
      '<p>Your shipment has shipped. Tracking: {{tracking_number}}</p>',
      null
    ),
    (
      new.id,
      'birthday',
      'Happy birthday from {{organization_name}}',
      '<p>Happy birthday, {{member_first_name}}!</p>',
      null
    ),
    (
      new.id,
      're_engagement',
      'We miss you at {{organization_name}}',
      '<p>It has been a while. Visit your member portal to see what is new.</p>',
      null
    )
  on conflict on constraint email_templates_organization_trigger_key do nothing;

  insert into public.cancel_flow_steps (
    organization_id,
    step_type,
    position,
    headline,
    body,
    configuration
  )
  values
    (
      new.id,
      'pause',
      1,
      'Would you like to pause instead?',
      'Keep your benefits and pause for one or three months.',
      '{"pause_months":[1,3]}'::jsonb
    ),
    (
      new.id,
      'downgrade',
      2,
      'Would a lower tier work better?',
      'Switch to a lower-priced active club tier.',
      '{}'::jsonb
    ),
    (
      new.id,
      'swap',
      3,
      'Customize your next shipment',
      'Choose a wine swap instead of cancelling.',
      '{}'::jsonb
    ),
    (
      new.id,
      'confirm',
      4,
      'Are you sure you want to cancel?',
      'Cancelling ends club benefits and future loyalty earning.',
      '{}'::jsonb
    )
  on conflict on constraint cancel_flow_steps_org_type_key do nothing;

  return new;
end;
$$;

create or replace function private.seed_phase4_organization_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_templates (
    organization_id,
    trigger_type,
    subject,
    body,
    days_before
  )
  values
    (
      new.id,
      'analytics_report',
      '{{organization_name}} analytics report',
      '<p>Your Vinifera analytics report is attached.</p>',
      null
    ),
    (
      new.id,
      'compliance_hold',
      'Action needed before your wine shipment',
      '<p>Your shipment is on hold while we resolve a compliance requirement: {{compliance_reason}}</p>',
      null
    ),
    (
      new.id,
      'high_risk_alert',
      'High churn-risk member needs attention',
      '<p>A member crossed your configured high-risk threshold. Review the churn dashboard and acknowledge the alert.</p>',
      null
    )
  on conflict on constraint email_templates_organization_trigger_key do nothing;

  insert into public.benchmark_preferences (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

-- Brand-level dashboard aggregates avoid changing the Phase 4 organization
-- aggregate contract.
create table public.brand_analytics_daily_metrics (
  organization_id uuid not null,
  brand_id uuid not null,
  metric_date date not null,
  active_members integer not null default 0,
  revenue_cents bigint not null default 0,
  shipment_count integer not null default 0,
  churn_count integer not null default 0,
  calculated_at timestamptz not null default now(),
  primary key (organization_id, brand_id, metric_date),
  constraint brand_analytics_daily_metrics_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint brand_analytics_daily_metrics_nonnegative
    check (
      active_members >= 0
      and revenue_cents >= 0
      and shipment_count >= 0
      and churn_count >= 0
    )
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid,
  integration_type public.integration_type not null,
  status public.integration_connection_status not null default 'activation_required',
  opted_in boolean not null default false,
  consented_at timestamptz,
  consented_by uuid,
  external_account_id text,
  display_name text,
  sync_config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint integration_connections_consenter_fkey
    foreign key (organization_id, consented_by)
    references public.staff_users (organization_id, id)
    on delete set null (consented_by),
  constraint integration_connections_brand_required
    check (
      integration_type = 'shipcompliant'
      or brand_id is not null
    ),
  constraint integration_connections_consent_consistent
    check (
      (opted_in and consented_at is not null)
      or (not opted_in and consented_at is null)
    ),
  constraint integration_connections_safe_config
    check (
      jsonb_typeof(sync_config) = 'object'
      and not private.jsonb_has_secret_keys(sync_config)
    ),
  constraint integration_connections_external_account_length
    check (char_length(coalesce(external_account_id, '')) <= 255),
  constraint integration_connections_display_name_length
    check (char_length(coalesce(display_name, '')) <= 200),
  constraint integration_connections_error_code_safe
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 1 and 100
        and last_error_code ~ '^[A-Z0-9_:-]+$'
      )
    )
);

alter table public.integration_connections
  add constraint integration_connections_id_org_key unique (id, organization_id);

create unique index integration_connections_brand_type_uidx
  on public.integration_connections (
    organization_id,
    coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    integration_type
  );
create index integration_connections_active_idx
  on public.integration_connections (organization_id, brand_id, integration_type)
  where status = 'active' and opted_in;

create table public.integration_secrets (
  connection_id uuid primary key
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  storage_mode public.secret_storage_mode not null,
  envelope_version integer,
  algorithm text,
  credential_ciphertext text,
  credential_iv text,
  key_version text,
  external_secret_ref text,
  rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_secrets_connection_org_fkey
    foreign key (connection_id, organization_id)
    references public.integration_connections (id, organization_id)
    on delete cascade,
  constraint integration_secrets_envelope_consistent
    check (
      (
        storage_mode = 'encrypted_envelope'
        and envelope_version = 1
        and algorithm = 'A256GCM'
        and credential_ciphertext ~ '^[A-Za-z0-9+/=_-]{24,}$'
        and credential_iv ~ '^[A-Za-z0-9+/=_-]{12,}$'
        and key_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
        and external_secret_ref is null
      )
      or (
        storage_mode = 'external_reference'
        and external_secret_ref ~ '^(vault|aws-secrets|gcp-secrets|doppler|infisical)://[A-Za-z0-9_./:@-]+$'
        and envelope_version is null
        and algorithm is null
        and credential_ciphertext is null
        and credential_iv is null
        and key_version is null
      )
    )
);

create table public.integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid,
  integration_type public.integration_type not null,
  direction public.integration_job_direction not null,
  sync_type text not null,
  entity_type text not null,
  entity_id text,
  cursor_data jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  status public.integration_job_status not null default 'queued',
  idempotency_key text not null,
  lease_token_hash text,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint integration_sync_jobs_connection_org_fkey
    foreign key (connection_id, organization_id)
    references public.integration_connections (id, organization_id)
    on delete cascade,
  constraint integration_sync_jobs_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint integration_sync_jobs_names_safe
    check (
      sync_type ~ '^[a-z][a-z0-9_.-]{0,99}$'
      and entity_type ~ '^[a-z][a-z0-9_.-]{0,99}$'
      and char_length(coalesce(entity_id, '')) <= 255
    ),
  constraint integration_sync_jobs_payload_safe
    check (
      jsonb_typeof(cursor_data) = 'object'
      and jsonb_typeof(payload) = 'object'
      and not private.jsonb_has_secret_keys(cursor_data)
      and not private.jsonb_has_secret_keys(payload)
      and not private.jsonb_has_raw_pii_keys(cursor_data)
      and not private.jsonb_has_raw_pii_keys(payload)
    ),
  constraint integration_sync_jobs_idempotency_format
    check (char_length(idempotency_key) between 8 and 255),
  constraint integration_sync_jobs_attempts_valid
    check (attempt_count between 0 and max_attempts and max_attempts between 1 and 20),
  constraint integration_sync_jobs_lease_consistent
    check (
      (
        status = 'leased'
        and lease_token_hash ~ '^[0-9a-f]{64}$'
        and char_length(lease_owner) between 1 and 120
        and lease_expires_at is not null
      )
      or (
        status <> 'leased'
        and lease_token_hash is null
        and lease_owner is null
        and lease_expires_at is null
      )
    ),
  constraint integration_sync_jobs_completion_consistent
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    )
);

create unique index integration_sync_jobs_idempotency_uidx
  on public.integration_sync_jobs (connection_id, idempotency_key);
create index integration_sync_jobs_claim_idx
  on public.integration_sync_jobs (status, next_attempt_at, created_at)
  where status in ('queued', 'retry', 'leased');
create index integration_sync_jobs_brand_idx
  on public.integration_sync_jobs (organization_id, brand_id, integration_type, created_at desc);

create table public.integration_sync_logs (
  id bigint generated always as identity primary key,
  job_id uuid not null
    references public.integration_sync_jobs (id) on delete cascade,
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid,
  integration_type public.integration_type not null,
  outcome public.integration_job_outcome not null,
  records_read integer not null default 0,
  records_written integer not null default 0,
  records_failed integer not null default 0,
  cursor_data jsonb not null default '{}'::jsonb,
  error_code text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  constraint integration_sync_logs_counts_nonnegative
    check (
      records_read >= 0
      and records_written >= 0
      and records_failed >= 0
      and (duration_ms is null or duration_ms >= 0)
    ),
  constraint integration_sync_logs_safe
    check (
      jsonb_typeof(cursor_data) = 'object'
      and not private.jsonb_has_secret_keys(cursor_data)
      and (
        error_code is null
        or (
          char_length(error_code) between 1 and 100
          and error_code ~ '^[A-Z0-9_:-]+$'
        )
      )
    )
);

create index integration_sync_logs_connection_created_idx
  on public.integration_sync_logs (connection_id, created_at desc);
create index integration_sync_logs_org_brand_created_idx
  on public.integration_sync_logs (organization_id, brand_id, created_at desc);

create table public.klaviyo_field_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  vinifera_field text not null,
  klaviyo_property text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, vinifera_field),
  constraint klaviyo_field_mappings_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint klaviyo_field_mappings_fields_safe
    check (
      vinifera_field ~ '^[a-z][a-z0-9_.]{0,99}$'
      and klaviyo_property ~ '^[A-Za-z_][A-Za-z0-9_.]{0,99}$'
    )
);

create table public.klaviyo_profile_mappings (
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  external_profile_id text not null,
  last_payload_hash text not null,
  last_synced_at timestamptz not null default now(),
  primary key (connection_id, member_id),
  unique (connection_id, external_profile_id),
  constraint klaviyo_profile_mappings_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint klaviyo_profile_mappings_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint klaviyo_profile_mappings_hash_format
    check (last_payload_hash ~ '^[0-9a-f]{64}$')
);

create table public.klaviyo_engagement_events (
  id bigint generated always as identity primary key,
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  provider_event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (connection_id, provider_event_id),
  constraint klaviyo_engagement_events_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint klaviyo_engagement_events_safe
    check (
      char_length(provider_event_id) between 1 and 255
      and event_type ~ '^[a-z][a-z0-9_.-]{0,99}$'
      and jsonb_typeof(metrics) = 'object'
      and not private.jsonb_has_secret_keys(metrics)
      and not private.jsonb_has_raw_pii_keys(metrics)
    )
);

create table public.quickbooks_account_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  club_tier_id uuid,
  mapping_kind text not null,
  quickbooks_account_id text not null,
  quickbooks_item_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, brand_id, club_tier_id, mapping_kind),
  constraint quickbooks_account_mappings_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint quickbooks_account_mappings_tier_fkey
    foreign key (organization_id, club_tier_id)
    references public.club_tiers (organization_id, id)
    on delete cascade,
  constraint quickbooks_account_mappings_kind_safe
    check (mapping_kind ~ '^(membership|shipment|tax|shipping|discount|refund)$')
);

create table public.quickbooks_transaction_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  shipment_id uuid,
  transaction_type text not null,
  quickbooks_transaction_id text not null,
  amount_cents bigint not null,
  tax_cents bigint not null default 0,
  source_cumulative_amount_cents bigint not null default 0,
  currency_code text not null default 'USD',
  exchange_rate numeric(18, 8) not null default 1,
  transaction_date date not null,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, transaction_type, quickbooks_transaction_id),
  unique (
    connection_id,
    shipment_id,
    transaction_type,
    source_cumulative_amount_cents
  ),
  constraint quickbooks_transaction_mappings_shipment_fkey
    foreign key (organization_id, shipment_id)
    references public.shipments (organization_id, id)
    on delete cascade,
  constraint quickbooks_transaction_mappings_amounts_valid
    check (
      amount_cents >= 0
      and tax_cents >= 0
      and source_cumulative_amount_cents >= 0
      and currency_code ~ '^[A-Z]{3}$'
      and exchange_rate > 0
      and transaction_type ~ '^(sales_receipt|invoice|payment|refund|credit_memo)$'
    )
);

create table public.quickbooks_reconciliations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  period_start date not null,
  period_end date not null,
  vinifera_total_cents bigint not null,
  quickbooks_total_cents bigint not null,
  variance_cents bigint generated always as
    (quickbooks_total_cents - vinifera_total_cents) stored,
  reconciled boolean not null default false,
  reconciled_by uuid,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, brand_id, period_start, period_end),
  constraint quickbooks_reconciliations_period_valid
    check (period_end >= period_start),
  constraint quickbooks_reconciliations_state_valid
    check (
      (reconciled and reconciled_at is not null)
      or (not reconciled and reconciled_at is null)
    )
);

create table public.avalara_exemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  exemption_number_hash text not null,
  region_code text not null,
  valid_from date not null,
  valid_until date,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, brand_id, member_id, exemption_number_hash),
  constraint avalara_exemptions_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint avalara_exemptions_hash_format
    check (
      exemption_number_hash ~ '^[0-9a-f]{64}$'
      and region_code ~ '^[A-Z0-9-]{2,12}$'
      and (valid_until is null or valid_until >= valid_from)
    )
);

create table public.avalara_tax_calculations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  shipment_id uuid not null,
  provider_transaction_code text not null,
  document_code text not null,
  document_type text not null default 'SalesInvoice',
  document_status text not null,
  currency_code text not null default 'USD',
  taxable_basis_cents bigint not null,
  exempt_amount_cents bigint not null default 0,
  tax_amount_cents bigint not null,
  shipping_tax_cents bigint not null default 0,
  jurisdiction_summary jsonb not null,
  request_hash text not null,
  response_hash text not null,
  committed_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, provider_transaction_code),
  unique (connection_id, shipment_id, request_hash),
  constraint avalara_tax_calculations_shipment_fkey
    foreign key (organization_id, shipment_id)
    references public.shipments (organization_id, id)
    on delete cascade,
  constraint avalara_tax_calculations_values_valid
    check (
      currency_code ~ '^[A-Z]{3}$'
      and taxable_basis_cents >= 0
      and exempt_amount_cents >= 0
      and tax_amount_cents >= 0
      and shipping_tax_cents >= 0
      and request_hash ~ '^[0-9a-f]{64}$'
      and response_hash ~ '^[0-9a-f]{64}$'
      and document_type in ('SalesInvoice', 'ReturnInvoice')
      and document_status in ('temporary', 'committed', 'voided')
      and jsonb_typeof(jurisdiction_summary) = 'array'
      and not private.jsonb_has_secret_keys(jurisdiction_summary)
      and not private.jsonb_has_raw_pii_keys(jurisdiction_summary)
      and (
        (document_status = 'temporary' and committed_at is null and voided_at is null)
        or (document_status = 'committed' and committed_at is not null and voided_at is null)
        or (document_status = 'voided' and voided_at is not null)
      )
    )
);

create index avalara_tax_calculations_liability_idx
  on public.avalara_tax_calculations (
    organization_id,
    brand_id,
    created_at,
    document_status
  );

alter table public.shipments
  add column tax_amount_cents bigint not null default 0,
  add column avalara_tax_calculation_id uuid,
  add constraint shipments_tax_nonnegative check (tax_amount_cents >= 0),
  add constraint shipments_avalara_tax_calculation_fkey
    foreign key (avalara_tax_calculation_id)
    references public.avalara_tax_calculations (id)
    on delete restrict;

alter table public.shipments
  drop constraint shipments_refund_amount_range,
  add constraint shipments_refund_amount_range
    check (
      refund_amount_cents between 0 and greatest(
        0,
        charge_amount_cents - loyalty_discount_cents + tax_amount_cents
      )
    );

create table public.member_integration_consents (
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  integration_type public.integration_type not null,
  consented boolean not null default false,
  consented_at timestamptz,
  revoked_at timestamptz,
  consent_source text,
  policy_version text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, brand_id, member_id, integration_type),
  constraint member_integration_consents_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint member_integration_consents_meta_only
    check (integration_type = 'meta'),
  constraint member_integration_consents_state_valid
    check (
      (
        consented
        and consented_at is not null
        and revoked_at is null
      )
      or (
        not consented
        and (
          consented_at is null
          or revoked_at is not null
        )
      )
    )
);

create table public.meta_conversion_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.integration_connections (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  event_id text not null,
  event_name text not null,
  event_time timestamptz not null,
  action_source text not null default 'website',
  user_data_hashes jsonb not null,
  custom_data jsonb not null default '{}'::jsonb,
  status public.integration_job_status not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_trace_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (connection_id, event_id),
  constraint meta_conversion_events_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint meta_conversion_events_names_safe
    check (
      char_length(event_id) between 8 and 255
      and event_name ~ '^[A-Za-z][A-Za-z0-9_]{0,99}$'
      and action_source in ('website', 'app', 'phone_call', 'physical_store')
    ),
  constraint meta_conversion_events_hashes_only
    check (
      private.jsonb_is_meta_hash_map(user_data_hashes)
      and jsonb_typeof(custom_data) = 'object'
      and not private.jsonb_has_secret_keys(custom_data)
      and not private.jsonb_has_raw_pii_keys(custom_data)
    ),
  constraint meta_conversion_events_state_valid
    check (
      attempt_count between 0 and 20
      and (
        (status = 'completed' and sent_at is not null)
        or (status <> 'completed' and sent_at is null)
      )
    )
);

create index meta_conversion_events_claim_idx
  on public.meta_conversion_events (status, next_attempt_at, event_time)
  where status in ('queued', 'retry');

create table public.brand_custom_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  hostname text not null,
  status public.custom_domain_status not null default 'pending_dns',
  provider_hostname_id text,
  hostname_status public.custom_hostname_status not null default 'pending',
  ssl_status public.custom_ssl_status not null default 'pending',
  dns_record_type text,
  dns_record_name text,
  dns_record_value text,
  dns_challenge_hash text not null,
  verified_at timestamptz,
  certificate_expires_at timestamptz,
  last_checked_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hostname),
  constraint brand_custom_domains_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint brand_custom_domains_hostname_valid
    check (
      hostname = lower(hostname)
      and hostname ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$'
      and hostname not like '%.edstratumlabs.ai'
      and dns_challenge_hash ~ '^[0-9a-f]{64}$'
      and (provider_hostname_id is null or provider_hostname_id ~ '^[A-Za-z0-9_-]{6,255}$')
      and (dns_record_type is null or dns_record_type in ('TXT', 'CNAME', 'HTTP'))
      and char_length(coalesce(dns_record_name, '')) <= 253
      and char_length(coalesce(dns_record_value, '')) <= 2048
    ),
  constraint brand_custom_domains_status_valid
    check (
      (
        status = 'active'
        and hostname_status = 'active'
        and ssl_status = 'active'
        and verified_at is not null
        and provider_hostname_id is not null
      )
      or status <> 'active'
    )
);

create index brand_custom_domains_lookup_idx
  on public.brand_custom_domains (hostname)
  where status = 'active';

create table public.brand_sender_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  from_name text not null,
  from_email text not null,
  reply_to_email text,
  status public.sender_identity_status not null default 'pending',
  provider_identity_id text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, brand_id),
  constraint brand_sender_identities_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint brand_sender_identities_email_normalized
    check (
      from_email = lower(btrim(from_email))
      and position('@' in from_email) > 1
      and char_length(from_email) between 3 and 320
      and (
        reply_to_email is null
        or (
          reply_to_email = lower(btrim(reply_to_email))
          and position('@' in reply_to_email) > 1
          and char_length(reply_to_email) between 3 and 320
        )
      )
    ),
  constraint brand_sender_identities_status_valid
    check (
      (status = 'verified' and verified_at is not null)
      or status <> 'verified'
    )
);

create table public.mobile_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  platform public.mobile_platform not null,
  device_fingerprint_hash text not null,
  app_version text not null,
  os_version text,
  locale text,
  timezone text,
  notifications_enabled boolean not null default false,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, device_fingerprint_hash),
  constraint mobile_devices_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint mobile_devices_fingerprint_format
    check (
      device_fingerprint_hash ~ '^[0-9a-f]{64}$'
      and app_version ~ '^[0-9]+(?:[.][0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$'
      and char_length(coalesce(os_version, '')) <= 50
      and char_length(coalesce(locale, '')) <= 20
      and char_length(coalesce(timezone, '')) <= 100
    )
);

create index mobile_devices_member_active_idx
  on public.mobile_devices (organization_id, brand_id, member_id, active);

create table public.mobile_device_secrets (
  device_id uuid primary key
    references public.mobile_devices (id) on delete cascade,
  organization_id uuid not null,
  storage_mode public.secret_storage_mode not null,
  envelope_version integer,
  algorithm text,
  push_token_ciphertext text,
  push_token_iv text,
  key_version text,
  external_secret_ref text,
  rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mobile_device_secrets_envelope_consistent
    check (
      (
        storage_mode = 'encrypted_envelope'
        and envelope_version = 1
        and algorithm = 'A256GCM'
        and push_token_ciphertext ~ '^[A-Za-z0-9+/=_-]{24,}$'
        and push_token_iv ~ '^[A-Za-z0-9+/=_-]{12,}$'
        and key_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
        and external_secret_ref is null
      )
      or (
        storage_mode = 'external_reference'
        and external_secret_ref ~ '^(vault|aws-secrets|gcp-secrets|doppler|infisical)://[A-Za-z0-9_./:@-]+$'
        and envelope_version is null
        and algorithm is null
        and push_token_ciphertext is null
        and push_token_iv is null
        and key_version is null
      )
    )
);

create table public.mobile_push_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  device_id uuid not null
    references public.mobile_devices (id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  deep_link_path text,
  idempotency_key text not null,
  status public.push_outbox_status not null default 'queued',
  lease_token_hash text,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (organization_id, idempotency_key),
  constraint mobile_push_outbox_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint mobile_push_outbox_content_safe
    check (
      char_length(notification_type) between 1 and 100
      and char_length(title) between 1 and 120
      and char_length(body) between 1 and 1000
      and jsonb_typeof(data) = 'object'
      and not private.jsonb_has_secret_keys(data)
      and not private.jsonb_has_raw_pii_keys(data)
      and (deep_link_path is null or deep_link_path ~ '^/[A-Za-z0-9/_?&=.-]{1,500}$')
    ),
  constraint mobile_push_outbox_lease_consistent
    check (
      (
        status = 'leased'
        and lease_token_hash ~ '^[0-9a-f]{64}$'
        and char_length(lease_owner) between 1 and 120
        and lease_expires_at is not null
      )
      or (
        status <> 'leased'
        and lease_token_hash is null
        and lease_owner is null
        and lease_expires_at is null
      )
    ),
  constraint mobile_push_outbox_attempts_valid
    check (attempt_count between 0 and max_attempts and max_attempts between 1 and 20)
);

create index mobile_push_outbox_claim_idx
  on public.mobile_push_outbox (status, next_attempt_at, created_at)
  where status in ('queued', 'retry', 'leased');

create table public.mobile_offline_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  snapshot_version bigint not null,
  content_hash text not null,
  schema_version integer not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (member_id, snapshot_version),
  constraint mobile_offline_snapshots_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint mobile_offline_snapshots_metadata_valid
    check (
      snapshot_version > 0
      and schema_version > 0
      and content_hash ~ '^[0-9a-f]{64}$'
      and expires_at > generated_at
    )
);

create table public.mobile_offline_mutations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  device_id uuid not null
    references public.mobile_devices (id) on delete cascade,
  client_mutation_id text not null,
  entity_type text not null,
  operation text not null,
  base_version bigint,
  mutation_hash text not null,
  status public.offline_mutation_status not null default 'pending',
  conflict_code text,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (device_id, client_mutation_id),
  constraint mobile_offline_mutations_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint mobile_offline_mutations_metadata_valid
    check (
      char_length(client_mutation_id) between 8 and 255
      and entity_type ~ '^[a-z][a-z0-9_.-]{0,99}$'
      and operation in ('create', 'update', 'delete')
      and (base_version is null or base_version >= 0)
      and mutation_hash ~ '^[0-9a-f]{64}$'
      and (
        (status = 'applied' and applied_at is not null)
        or (status <> 'applied' and applied_at is null)
      )
    )
);

create table public.mobile_deep_link_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  route_key text not null,
  path_template text not null,
  enabled boolean not null default true,
  minimum_app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, brand_id, route_key),
  constraint mobile_deep_link_routes_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint mobile_deep_link_routes_safe
    check (
      route_key ~ '^[a-z][a-z0-9_.-]{0,99}$'
      and path_template ~ '^/[A-Za-z0-9/{}_.-]{1,500}$'
      and (
        minimum_app_version is null
        or minimum_app_version ~ '^[0-9]+(?:[.][0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$'
      )
    )
);

create table public.mobile_auth_exchange_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  device_fingerprint_hash text not null,
  device_id uuid,
  redirect_uri_hash text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mobile_auth_exchange_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint mobile_auth_exchange_device_fkey
    foreign key (device_id)
    references public.mobile_devices (id)
    on delete cascade,
  constraint mobile_auth_exchange_hashes_valid
    check (
      token_hash ~ '^[0-9a-f]{64}$'
      and device_fingerprint_hash ~ '^[0-9a-f]{64}$'
      and (
        redirect_uri_hash is null
        or redirect_uri_hash ~ '^[0-9a-f]{64}$'
      )
      and expires_at > created_at
    )
);

create index mobile_auth_exchange_expiry_idx
  on public.mobile_auth_exchange_tokens (expires_at)
  where consumed_at is null;

create table public.mobile_refresh_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  refresh_token_hash text not null unique,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  device_id uuid not null
    references public.mobile_devices (id) on delete cascade,
  parent_session_id uuid
    references public.mobile_refresh_sessions (id) on delete restrict,
  replaced_by_session_id uuid
    references public.mobile_refresh_sessions (id) on delete restrict,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  reuse_detected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mobile_refresh_sessions_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint mobile_refresh_sessions_hash_valid
    check (
      refresh_token_hash ~ '^[0-9a-f]{64}$'
      and expires_at > created_at
    ),
  constraint mobile_refresh_sessions_rotation_valid
    check (
      (replaced_by_session_id is null and rotated_at is null)
      or (replaced_by_session_id is not null and rotated_at is not null)
    )
);

create index mobile_refresh_sessions_family_idx
  on public.mobile_refresh_sessions (family_id, created_at);
create index mobile_refresh_sessions_active_idx
  on public.mobile_refresh_sessions (refresh_token_hash, expires_at)
  where revoked_at is null;

create or replace function public.set_integration_health(
  p_connection_id uuid,
  p_status public.integration_connection_status,
  p_error_code text default null
)
returns public.integration_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_status not in ('configured', 'active', 'degraded', 'disconnected') then
    raise exception using errcode = '22023', message = 'Invalid reconciled integration state.';
  end if;

  update public.integration_connections as c
  set
    status = p_status,
    last_error_code = case
      when p_status = 'degraded' then nullif(p_error_code, '')
      else null
    end,
    last_error_at = case when p_status = 'degraded' then now() else null end,
    updated_at = now()
  where c.id = p_connection_id
    and (
      p_status in ('configured', 'disconnected')
      or (
        c.opted_in
        and exists (
          select 1
          from public.integration_secrets as s
          where s.connection_id = c.id
        )
      )
    )
  returning * into v_connection;

  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'Integration cannot enter the requested state.';
  end if;

  return v_connection;
end;
$$;

create or replace function public.configure_integration_connection(
  p_organization_id uuid,
  p_brand_id uuid,
  p_integration_type public.integration_type,
  p_display_name text default null,
  p_external_account_id text default null,
  p_sync_config jsonb default '{}'::jsonb
)
returns public.integration_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
begin
  if not private.can_manage_brand(p_organization_id, p_brand_id) then
    raise exception using errcode = '42501', message = 'Brand admin authorization is required.';
  end if;

  if private.jsonb_has_secret_keys(p_sync_config) then
    raise exception using errcode = '22023', message = 'Connection metadata cannot contain secrets.';
  end if;

  insert into public.integration_connections (
    organization_id,
    brand_id,
    integration_type,
    display_name,
    external_account_id,
    sync_config
  )
  values (
    p_organization_id,
    p_brand_id,
    p_integration_type,
    nullif(btrim(p_display_name), ''),
    nullif(btrim(p_external_account_id), ''),
    coalesce(p_sync_config, '{}'::jsonb)
  )
  on conflict (
    organization_id,
    (coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    integration_type
  )
  do update set
    display_name = excluded.display_name,
    external_account_id = excluded.external_account_id,
    sync_config = excluded.sync_config,
    updated_at = now()
  returning * into v_connection;

  return v_connection;
end;
$$;

create or replace function public.set_integration_consent(
  p_connection_id uuid,
  p_opted_in boolean
)
returns public.integration_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
begin
  select *
  into v_connection
  from public.integration_connections as c
  where c.id = p_connection_id;

  if v_connection.id is null
    or not private.can_manage_brand(v_connection.organization_id, v_connection.brand_id)
  then
    raise exception using errcode = '42501', message = 'Brand admin authorization is required.';
  end if;

  update public.integration_connections
  set
    opted_in = p_opted_in,
    consented_at = case when p_opted_in then now() else null end,
    consented_by = case
      when auth.auth_surface() = 'staff' then auth.uid()
      else null
    end,
    status = case
      when not p_opted_in then 'disconnected'::public.integration_connection_status
      when exists (
        select 1
        from public.integration_secrets as s
        where s.connection_id = p_connection_id
      ) then 'configured'::public.integration_connection_status
      else 'activation_required'::public.integration_connection_status
    end,
    updated_at = now()
  where id = p_connection_id
  returning * into v_connection;

  return v_connection;
end;
$$;

create or replace function public.disconnect_integration(
  p_connection_id uuid
)
returns public.integration_connections
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.set_integration_consent(p_connection_id, false);
end;
$$;

create or replace function public.store_integration_credentials(
  p_connection_id uuid,
  p_storage_mode public.secret_storage_mode,
  p_envelope_version integer default null,
  p_algorithm text default null,
  p_credential_ciphertext text default null,
  p_credential_iv text default null,
  p_key_version text default null,
  p_external_secret_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select organization_id
  into v_organization_id
  from public.integration_connections
  where id = p_connection_id;

  if v_organization_id is null then
    raise exception using errcode = 'P0002', message = 'Integration connection not found.';
  end if;

  insert into public.integration_secrets (
    connection_id,
    organization_id,
    storage_mode,
    envelope_version,
    algorithm,
    credential_ciphertext,
    credential_iv,
    key_version,
    external_secret_ref,
    rotated_at
  )
  values (
    p_connection_id,
    v_organization_id,
    p_storage_mode,
    p_envelope_version,
    p_algorithm,
    p_credential_ciphertext,
    p_credential_iv,
    p_key_version,
    p_external_secret_ref,
    now()
  )
  on conflict (connection_id)
  do update set
    storage_mode = excluded.storage_mode,
    envelope_version = excluded.envelope_version,
    algorithm = excluded.algorithm,
    credential_ciphertext = excluded.credential_ciphertext,
    credential_iv = excluded.credential_iv,
    key_version = excluded.key_version,
    external_secret_ref = excluded.external_secret_ref,
    rotated_at = now(),
    updated_at = now();

  update public.integration_connections
  set
    status = case
      when opted_in then 'configured'::public.integration_connection_status
      else 'activation_required'::public.integration_connection_status
    end,
    updated_at = now()
  where id = p_connection_id;

  return p_connection_id;
end;
$$;

create or replace function public.get_integration_runtime(
  p_organization_id uuid,
  p_integration_type public.integration_type,
  p_brand_id uuid default null
)
returns table (
  connection_id uuid,
  organization_id uuid,
  brand_id uuid,
  integration_type public.integration_type,
  external_account_id text,
  sync_config jsonb,
  storage_mode public.secret_storage_mode,
  envelope_version integer,
  algorithm text,
  credential_ciphertext text,
  credential_iv text,
  key_version text,
  external_secret_ref text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  return query
  select
    c.id,
    c.organization_id,
    c.brand_id,
    c.integration_type,
    c.external_account_id,
    c.sync_config,
    s.storage_mode,
    s.envelope_version,
    s.algorithm,
    s.credential_ciphertext,
    s.credential_iv,
    s.key_version,
    s.external_secret_ref
  from public.integration_connections as c
  join public.integration_secrets as s on s.connection_id = c.id
  where c.organization_id = p_organization_id
    and c.integration_type = p_integration_type
    and c.brand_id is not distinct from p_brand_id
    and c.status in ('configured', 'active', 'degraded')
    and c.opted_in;
end;
$$;

create or replace function public.enqueue_integration_sync_job(
  p_connection_id uuid,
  p_direction public.integration_job_direction,
  p_sync_type text,
  p_entity_type text,
  p_entity_id text,
  p_idempotency_key text,
  p_cursor_data jsonb default '{}'::jsonb,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 8
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_job_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select *
  into v_connection
  from public.integration_connections
  where id = p_connection_id
    and opted_in
    and (
      status = 'active'
      or (
        status = 'configured'
        and p_sync_type = 'connection.validate'
      )
    );

  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'Integration is not eligible for this sync type.';
  end if;

  insert into public.integration_sync_jobs (
    connection_id,
    organization_id,
    brand_id,
    integration_type,
    direction,
    sync_type,
    entity_type,
    entity_id,
    idempotency_key,
    cursor_data,
    payload,
    max_attempts
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_connection.integration_type,
    p_direction,
    p_sync_type,
    p_entity_type,
    nullif(p_entity_id, ''),
    p_idempotency_key,
    coalesce(p_cursor_data, '{}'::jsonb),
    coalesce(p_payload, '{}'::jsonb),
    p_max_attempts
  )
  on conflict (connection_id, idempotency_key)
  do update set
    updated_at = public.integration_sync_jobs.updated_at
  returning id into v_job_id;

  return v_job_id;
end;
$$;

create or replace function public.claim_integration_sync_jobs(
  p_worker text,
  p_limit integer default 25,
  p_lease_seconds integer default 120,
  p_as_of timestamptz default now()
)
returns table (
  job_id uuid,
  lease_token text,
  connection_id uuid,
  organization_id uuid,
  brand_id uuid,
  integration_type public.integration_type,
  direction public.integration_job_direction,
  sync_type text,
  entity_type text,
  entity_id text,
  cursor_data jsonb,
  payload jsonb,
  idempotency_key text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if char_length(btrim(p_worker)) not between 1 and 120
    or p_limit not between 1 and 100
    or p_lease_seconds not between 15 and 900
  then
    raise exception using errcode = '22023', message = 'Invalid worker lease parameters.';
  end if;

  return query
  with candidates as (
    select
      j.id,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as raw_lease_token
    from public.integration_sync_jobs as j
    join public.integration_connections as c on c.id = j.connection_id
    where (
        j.status in ('queued', 'retry')
        or (
          j.status = 'leased'
          and j.lease_expires_at <= p_as_of
        )
      )
      and j.next_attempt_at <= p_as_of
      and j.attempt_count < j.max_attempts
      and c.opted_in
      and (
        c.status = 'active'
        or (
          c.status = 'configured'
          and j.sync_type = 'connection.validate'
        )
      )
    order by j.next_attempt_at, j.created_at
    for update of j skip locked
    limit p_limit
  ),
  leased as (
    update public.integration_sync_jobs as j
    set
      status = 'leased',
      lease_owner = btrim(p_worker),
      lease_expires_at = p_as_of + make_interval(secs => p_lease_seconds),
      attempt_count = j.attempt_count + 1,
      lease_token_hash = encode(
        extensions.digest(
          convert_to(c.raw_lease_token, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      updated_at = p_as_of
    from candidates as c
    where j.id = c.id
    returning j.*, c.raw_lease_token
  )
  select
    l.id,
    l.raw_lease_token,
    l.connection_id,
    l.organization_id,
    l.brand_id,
    l.integration_type,
    l.direction,
    l.sync_type,
    l.entity_type,
    l.entity_id,
    l.cursor_data,
    l.payload,
    l.idempotency_key,
    l.attempt_count
  from leased as l;
end;
$$;

create or replace function public.complete_integration_sync_job(
  p_job_id uuid,
  p_lease_token text,
  p_outcome public.integration_job_outcome,
  p_records_read integer default 0,
  p_records_written integer default 0,
  p_records_failed integer default 0,
  p_cursor_data jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_duration_ms integer default null,
  p_next_attempt_at timestamptz default null
)
returns public.integration_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.integration_sync_jobs;
  v_status public.integration_job_status;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select *
  into v_job
  from public.integration_sync_jobs
  where id = p_job_id
  for update;

  if v_job.id is null
    or v_job.status <> 'leased'
    or v_job.lease_expires_at <= now()
    or v_job.lease_token_hash <> encode(
      extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
      'hex'
    )
  then
    raise exception using errcode = '42501', message = 'Invalid or expired integration job lease.';
  end if;

  v_status := case p_outcome
    when 'synced' then 'completed'::public.integration_job_status
    when 'partial' then 'completed'::public.integration_job_status
    when 'retry' then
      case
        when v_job.attempt_count >= v_job.max_attempts
          then 'dead_letter'::public.integration_job_status
        else 'retry'::public.integration_job_status
      end
    else 'dead_letter'::public.integration_job_status
  end;

  update public.integration_sync_jobs
  set
    status = v_status,
    cursor_data = coalesce(p_cursor_data, '{}'::jsonb),
    lease_token_hash = null,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = nullif(p_error_code, ''),
    next_attempt_at = case
      when v_status = 'retry' then coalesce(
        p_next_attempt_at,
        now() + make_interval(secs => least(3600, 30 * power(2, greatest(v_job.attempt_count - 1, 0))::integer))
      )
      else next_attempt_at
    end,
    completed_at = case when v_status = 'completed' then now() else null end,
    updated_at = now()
  where id = p_job_id
  returning * into v_job;

  insert into public.integration_sync_logs (
    job_id,
    connection_id,
    organization_id,
    brand_id,
    integration_type,
    outcome,
    records_read,
    records_written,
    records_failed,
    cursor_data,
    error_code,
    duration_ms
  )
  values (
    v_job.id,
    v_job.connection_id,
    v_job.organization_id,
    v_job.brand_id,
    v_job.integration_type,
    case
      when v_status = 'dead_letter' then 'dead_letter'::public.integration_job_outcome
      else p_outcome
    end,
    p_records_read,
    p_records_written,
    p_records_failed,
    coalesce(p_cursor_data, '{}'::jsonb),
    nullif(p_error_code, ''),
    p_duration_ms
  );

  update public.integration_connections
  set
    last_synced_at = case
      when v_status = 'completed' then now()
      else last_synced_at
    end,
    last_error_code = case
      when v_status = 'completed' then null
      else nullif(p_error_code, '')
    end,
    last_error_at = case
      when v_status = 'completed' then null
      else now()
    end,
    updated_at = now()
  where id = v_job.connection_id;

  return v_job;
end;
$$;

create or replace function public.store_mobile_push_token(
  p_device_id uuid,
  p_storage_mode public.secret_storage_mode,
  p_envelope_version integer default null,
  p_algorithm text default null,
  p_push_token_ciphertext text default null,
  p_push_token_iv text default null,
  p_key_version text default null,
  p_external_secret_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select organization_id
  into v_organization_id
  from public.mobile_devices
  where id = p_device_id and active;

  if v_organization_id is null then
    raise exception using errcode = 'P0002', message = 'Active mobile device not found.';
  end if;

  insert into public.mobile_device_secrets (
    device_id,
    organization_id,
    storage_mode,
    envelope_version,
    algorithm,
    push_token_ciphertext,
    push_token_iv,
    key_version,
    external_secret_ref
  )
  values (
    p_device_id,
    v_organization_id,
    p_storage_mode,
    p_envelope_version,
    p_algorithm,
    p_push_token_ciphertext,
    p_push_token_iv,
    p_key_version,
    p_external_secret_ref
  )
  on conflict (device_id)
  do update set
    storage_mode = excluded.storage_mode,
    envelope_version = excluded.envelope_version,
    algorithm = excluded.algorithm,
    push_token_ciphertext = excluded.push_token_ciphertext,
    push_token_iv = excluded.push_token_iv,
    key_version = excluded.key_version,
    external_secret_ref = excluded.external_secret_ref,
    rotated_at = now(),
    updated_at = now();

  update public.mobile_devices
  set notifications_enabled = true, updated_at = now()
  where id = p_device_id;

  return p_device_id;
end;
$$;

create or replace function public.claim_mobile_push_messages(
  p_worker text,
  p_limit integer default 50,
  p_lease_seconds integer default 120,
  p_as_of timestamptz default now()
)
returns table (
  push_id uuid,
  lease_token text,
  organization_id uuid,
  brand_id uuid,
  member_id uuid,
  device_id uuid,
  platform public.mobile_platform,
  notification_type text,
  title text,
  body text,
  data jsonb,
  deep_link_path text,
  storage_mode public.secret_storage_mode,
  envelope_version integer,
  algorithm text,
  push_token_ciphertext text,
  push_token_iv text,
  key_version text,
  external_secret_ref text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if char_length(btrim(p_worker)) not between 1 and 120
    or p_limit not between 1 and 100
    or p_lease_seconds not between 15 and 900
  then
    raise exception using errcode = '22023', message = 'Invalid push lease parameters.';
  end if;

  return query
  with candidates as (
    select
      outbox.id,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as raw_lease_token
    from public.mobile_push_outbox as outbox
    join public.mobile_devices as device
      on device.id = outbox.device_id
     and device.active
     and device.notifications_enabled
    join public.mobile_device_secrets as secret
      on secret.device_id = device.id
    where (
        outbox.status in ('queued', 'retry')
        or (
          outbox.status = 'leased'
          and outbox.lease_expires_at <= p_as_of
        )
      )
      and outbox.next_attempt_at <= p_as_of
      and outbox.attempt_count < outbox.max_attempts
    order by outbox.next_attempt_at, outbox.created_at
    for update of outbox skip locked
    limit p_limit
  ),
  leased as (
    update public.mobile_push_outbox as outbox
    set
      status = 'leased',
      lease_owner = btrim(p_worker),
      lease_expires_at = p_as_of + make_interval(secs => p_lease_seconds),
      lease_token_hash = encode(
        extensions.digest(convert_to(c.raw_lease_token, 'UTF8'), 'sha256'),
        'hex'
      ),
      attempt_count = outbox.attempt_count + 1,
      updated_at = p_as_of
    from candidates as c
    where outbox.id = c.id
    returning outbox.*, c.raw_lease_token
  )
  select
    leased.id,
    leased.raw_lease_token,
    leased.organization_id,
    leased.brand_id,
    leased.member_id,
    leased.device_id,
    device.platform,
    leased.notification_type,
    leased.title,
    leased.body,
    leased.data,
    leased.deep_link_path,
    secret.storage_mode,
    secret.envelope_version,
    secret.algorithm,
    secret.push_token_ciphertext,
    secret.push_token_iv,
    secret.key_version,
    secret.external_secret_ref,
    leased.attempt_count
  from leased
  join public.mobile_devices as device on device.id = leased.device_id
  join public.mobile_device_secrets as secret on secret.device_id = leased.device_id;
end;
$$;

create or replace function public.complete_mobile_push_message(
  p_push_id uuid,
  p_lease_token text,
  p_sent boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null
)
returns public.mobile_push_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_push public.mobile_push_outbox;
  v_status public.push_outbox_status;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select *
  into v_push
  from public.mobile_push_outbox
  where id = p_push_id
  for update;

  if v_push.id is null
    or v_push.status <> 'leased'
    or v_push.lease_expires_at <= now()
    or v_push.lease_token_hash <> encode(
      extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
      'hex'
    )
  then
    raise exception using errcode = '42501', message = 'Invalid or expired push lease.';
  end if;

  v_status := case
    when p_sent then 'sent'::public.push_outbox_status
    when v_push.attempt_count >= v_push.max_attempts then 'dead_letter'::public.push_outbox_status
    else 'retry'::public.push_outbox_status
  end;

  update public.mobile_push_outbox
  set
    status = v_status,
    lease_token_hash = null,
    lease_owner = null,
    lease_expires_at = null,
    provider_message_id = case when p_sent then nullif(p_provider_message_id, '') else null end,
    error_code = case when p_sent then null else nullif(p_error_code, '') end,
    next_attempt_at = case
      when v_status = 'retry' then coalesce(
        p_next_attempt_at,
        now() + make_interval(secs => least(3600, 30 * power(2, greatest(v_push.attempt_count - 1, 0))::integer))
      )
      else next_attempt_at
    end,
    sent_at = case when p_sent then now() else null end,
    updated_at = now()
  where id = p_push_id
  returning * into v_push;

  return v_push;
end;
$$;

create or replace function public.get_klaviyo_member_source(
  p_connection_id uuid,
  p_limit integer default 1000,
  p_after_member_id uuid default null
)
returns table (
  member_id uuid,
  email text,
  first_name text,
  last_name text,
  status public.member_status,
  club_tier_id uuid,
  lifetime_value_cents bigint,
  joined_on date,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Batch limit must be between 1 and 1000.';
  end if;

  select *
  into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'klaviyo'
    and connection.status = 'active'
    and connection.opted_in;

  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'Klaviyo is not active and opted in.';
  end if;

  return query
  select
    m.id,
    m.email,
    m.first_name,
    m.last_name,
    m.status,
    m.club_tier_id,
    m.lifetime_value_cents,
    m.joined_on,
    m.updated_at
  from public.members as m
  where m.organization_id = v_connection.organization_id
    and m.brand_id = v_connection.brand_id
    and m.deleted_at is null
    and (p_after_member_id is null or m.id > p_after_member_id)
  order by m.id
  limit p_limit;
end;
$$;

create or replace function public.upsert_klaviyo_profile_mapping(
  p_connection_id uuid,
  p_member_id uuid,
  p_external_profile_id text,
  p_payload_hash text
)
returns public.klaviyo_profile_mappings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_member public.members;
  v_mapping public.klaviyo_profile_mappings;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select * into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'klaviyo'
    and connection.status = 'active'
    and connection.opted_in;
  select * into v_member
  from public.members
  where id = p_member_id
    and organization_id = v_connection.organization_id
    and brand_id = v_connection.brand_id;

  if v_connection.id is null or v_member.id is null then
    raise exception using errcode = '23503', message = 'Connection and member brand do not match.';
  end if;

  insert into public.klaviyo_profile_mappings (
    connection_id,
    organization_id,
    brand_id,
    member_id,
    external_profile_id,
    last_payload_hash,
    last_synced_at
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_member.id,
    p_external_profile_id,
    p_payload_hash,
    now()
  )
  on conflict (connection_id, member_id)
  do update set
    external_profile_id = excluded.external_profile_id,
    last_payload_hash = excluded.last_payload_hash,
    last_synced_at = now()
  returning * into v_mapping;

  return v_mapping;
end;
$$;

create or replace function public.get_quickbooks_transaction_source(
  p_connection_id uuid,
  p_limit integer default 100,
  p_after_shipment_id uuid default null
)
returns table (
  shipment_id uuid,
  member_id uuid,
  tier_id uuid,
  status public.shipment_status,
  charge_amount_cents integer,
  loyalty_discount_cents integer,
  tax_amount_cents bigint,
  refund_amount_cents integer,
  paid_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Batch limit must be between 1 and 1000.';
  end if;

  select * into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'quickbooks'
    and connection.status = 'active'
    and connection.opted_in;

  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'QuickBooks is not active and opted in.';
  end if;

  return query
  select
    s.id,
    s.member_id,
    s.tier_id,
    s.status,
    s.charge_amount_cents,
    s.loyalty_discount_cents,
    s.tax_amount_cents,
    s.refund_amount_cents,
    s.paid_at,
    s.updated_at
  from public.shipments as s
  where s.organization_id = v_connection.organization_id
    and s.brand_id = v_connection.brand_id
    and s.status in ('charged', 'label_created', 'packed', 'shipped', 'delivered', 'refunded')
    and (p_after_shipment_id is null or s.id > p_after_shipment_id)
  order by s.id
  limit p_limit;
end;
$$;

create or replace function public.get_avalara_shipment_source(
  p_connection_id uuid,
  p_shipment_id uuid
)
returns table (
  shipment_id uuid,
  member_id uuid,
  charge_amount_cents integer,
  shipping_address jsonb,
  shipping_origin_address jsonb,
  exemption_number_hash text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select * into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'avalara'
    and connection.status = 'active'
    and connection.opted_in;

  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'Avalara is not active and opted in.';
  end if;

  return query
  select
    s.id,
    s.member_id,
    s.charge_amount_cents,
    coalesce(s.validated_shipping_address, s.shipping_address),
    o.shipping_origin_address,
    e.exemption_number_hash
  from public.shipments as s
  join public.organizations as o on o.id = s.organization_id
  left join public.avalara_exemptions as e
    on e.organization_id = s.organization_id
   and e.brand_id = s.brand_id
   and e.member_id = s.member_id
   and e.valid_from <= current_date
   and (e.valid_until is null or e.valid_until >= current_date)
  where s.id = p_shipment_id
    and s.organization_id = v_connection.organization_id
    and s.brand_id = v_connection.brand_id;
end;
$$;

create or replace function public.record_avalara_tax_calculation(
  p_connection_id uuid,
  p_shipment_id uuid,
  p_provider_transaction_code text,
  p_document_code text,
  p_document_status text,
  p_taxable_basis_cents bigint,
  p_exempt_amount_cents bigint,
  p_tax_amount_cents bigint,
  p_shipping_tax_cents bigint,
  p_jurisdiction_summary jsonb,
  p_request_hash text,
  p_response_hash text,
  p_currency_code text default 'USD',
  p_document_type text default 'SalesInvoice'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_shipment public.shipments;
  v_calculation_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select * into v_connection
  from public.integration_connections
  where id = p_connection_id and integration_type = 'avalara' and status = 'active' and opted_in;
  select * into v_shipment
  from public.shipments
  where id = p_shipment_id
    and organization_id = v_connection.organization_id
    and brand_id = v_connection.brand_id;

  if v_connection.id is null or v_shipment.id is null then
    raise exception using errcode = '23503', message = 'Connection and shipment brand do not match.';
  end if;

  insert into public.avalara_tax_calculations (
    connection_id,
    organization_id,
    brand_id,
    shipment_id,
    provider_transaction_code,
    document_code,
    document_type,
    document_status,
    currency_code,
    taxable_basis_cents,
    exempt_amount_cents,
    tax_amount_cents,
    shipping_tax_cents,
    jurisdiction_summary,
    request_hash,
    response_hash,
    committed_at,
    voided_at
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_shipment.id,
    p_provider_transaction_code,
    p_document_code,
    p_document_type,
    p_document_status,
    p_currency_code,
    p_taxable_basis_cents,
    p_exempt_amount_cents,
    p_tax_amount_cents,
    p_shipping_tax_cents,
    p_jurisdiction_summary,
    p_request_hash,
    p_response_hash,
    case when p_document_status = 'committed' then now() else null end,
    case when p_document_status = 'voided' then now() else null end
  )
  on conflict (connection_id, shipment_id, request_hash)
  do update set
    document_status = excluded.document_status,
    document_type = excluded.document_type,
    response_hash = excluded.response_hash,
    tax_amount_cents = excluded.tax_amount_cents,
    shipping_tax_cents = excluded.shipping_tax_cents,
    jurisdiction_summary = excluded.jurisdiction_summary,
    committed_at = excluded.committed_at,
    voided_at = excluded.voided_at
  returning id into v_calculation_id;

  return v_calculation_id;
end;
$$;

create or replace function public.set_member_meta_consent(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_consented boolean,
  p_consent_source text,
  p_policy_version text
)
returns public.member_integration_consents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.member_integration_consents;
begin
  if not (
    private.can_manage_brand(p_organization_id, p_brand_id)
    or exists (
      select 1
      from public.members as m
      where m.id = p_member_id
        and m.organization_id = p_organization_id
        and m.brand_id = p_brand_id
        and m.auth_user_id = auth.uid()
    )
  ) then
    raise exception using errcode = '42501', message = 'Member or brand admin authorization is required.';
  end if;

  insert into public.member_integration_consents (
    organization_id,
    brand_id,
    member_id,
    integration_type,
    consented,
    consented_at,
    revoked_at,
    consent_source,
    policy_version
  )
  values (
    p_organization_id,
    p_brand_id,
    p_member_id,
    'meta',
    p_consented,
    case when p_consented then now() else null end,
    case when p_consented then null else now() end,
    nullif(btrim(p_consent_source), ''),
    nullif(btrim(p_policy_version), '')
  )
  on conflict (organization_id, brand_id, member_id, integration_type)
  do update set
    consented = excluded.consented,
    consented_at = excluded.consented_at,
    revoked_at = excluded.revoked_at,
    consent_source = excluded.consent_source,
    policy_version = excluded.policy_version,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.enqueue_meta_conversion_event(
  p_connection_id uuid,
  p_member_id uuid,
  p_event_id text,
  p_event_name text,
  p_event_time timestamptz,
  p_user_data_hashes jsonb,
  p_custom_data jsonb default '{}'::jsonb,
  p_action_source text default 'website'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_event_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select * into v_connection
  from public.integration_connections
  where id = p_connection_id
    and integration_type = 'meta'
    and status = 'active'
    and opted_in;

  if v_connection.id is null
    or not exists (
      select 1
      from public.member_integration_consents as consent
      where consent.organization_id = v_connection.organization_id
        and consent.brand_id = v_connection.brand_id
        and consent.member_id = p_member_id
        and consent.integration_type = 'meta'
        and consent.consented
        and consent.revoked_at is null
    )
  then
    raise exception using errcode = '42501', message = 'Active Meta consent is required.';
  end if;

  insert into public.meta_conversion_events (
    connection_id,
    organization_id,
    brand_id,
    member_id,
    event_id,
    event_name,
    event_time,
    action_source,
    user_data_hashes,
    custom_data
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    p_member_id,
    p_event_id,
    p_event_name,
    p_event_time,
    p_action_source,
    p_user_data_hashes,
    coalesce(p_custom_data, '{}'::jsonb)
  )
  on conflict (connection_id, event_id)
  do update set event_id = excluded.event_id
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.register_mobile_auth_exchange(
  p_token_hash text,
  p_auth_user_id uuid,
  p_organization_id uuid,
  p_brand_id uuid,
  p_device_fingerprint_hash text,
  p_device_id uuid,
  p_redirect_uri_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_exchange_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select m.id
  into v_member_id
  from public.members as m
  where m.auth_user_id = p_auth_user_id
    and m.organization_id = p_organization_id
    and m.brand_id = p_brand_id
    and m.deleted_at is null;

  if v_member_id is null then
    raise exception using errcode = 'P0002', message = 'Active member profile not found.';
  end if;

  if p_device_id is not null and not exists (
    select 1
    from public.mobile_devices as d
    where d.id = p_device_id
      and d.organization_id = p_organization_id
      and d.brand_id = p_brand_id
      and d.member_id = v_member_id
  ) then
    raise exception using errcode = '23503', message = 'Device does not belong to the member brand.';
  end if;

  insert into public.mobile_auth_exchange_tokens (
    token_hash,
    auth_user_id,
    organization_id,
    brand_id,
    member_id,
    device_fingerprint_hash,
    device_id,
    redirect_uri_hash,
    expires_at
  )
  values (
    p_token_hash,
    p_auth_user_id,
    p_organization_id,
    p_brand_id,
    v_member_id,
    p_device_fingerprint_hash,
    p_device_id,
    p_redirect_uri_hash,
    p_expires_at
  )
  returning id into v_exchange_id;

  return v_exchange_id;
end;
$$;

create or replace function public.consume_mobile_auth_exchange(
  p_token_hash text,
  p_device_fingerprint_hash text,
  p_redirect_uri_hash text,
  p_device_id uuid default null,
  p_as_of timestamptz default now()
)
returns table (
  auth_user_id uuid,
  organization_id uuid,
  brand_id uuid,
  member_id uuid,
  device_fingerprint_hash text,
  device_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  return query
  update public.mobile_auth_exchange_tokens as exchange
  set
    consumed_at = p_as_of,
    device_id = coalesce(exchange.device_id, p_device_id)
  where exchange.token_hash = p_token_hash
    and exchange.consumed_at is null
    and exchange.expires_at > p_as_of
    and exchange.device_fingerprint_hash = p_device_fingerprint_hash
    and exchange.redirect_uri_hash = p_redirect_uri_hash
    and (
      exchange.device_id is null
      or p_device_id is null
      or exchange.device_id = p_device_id
    )
  returning
    exchange.auth_user_id,
    exchange.organization_id,
    exchange.brand_id,
    exchange.member_id,
    exchange.device_fingerprint_hash,
    exchange.device_id;
end;
$$;

create or replace function public.register_mobile_refresh_session(
  p_refresh_token_hash text,
  p_auth_user_id uuid,
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_device_id uuid,
  p_expires_at timestamptz,
  p_family_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  if not exists (
    select 1
    from public.mobile_devices as d
    join public.members as m
      on m.organization_id = d.organization_id
     and m.brand_id = d.brand_id
     and m.id = d.member_id
    where d.id = p_device_id
      and d.organization_id = p_organization_id
      and d.brand_id = p_brand_id
      and d.member_id = p_member_id
      and m.auth_user_id = p_auth_user_id
      and d.active
  ) then
    raise exception using errcode = '23503', message = 'Mobile session context is invalid.';
  end if;

  insert into public.mobile_refresh_sessions (
    family_id,
    refresh_token_hash,
    auth_user_id,
    organization_id,
    brand_id,
    member_id,
    device_id,
    expires_at
  )
  values (
    p_family_id,
    p_refresh_token_hash,
    p_auth_user_id,
    p_organization_id,
    p_brand_id,
    p_member_id,
    p_device_id,
    p_expires_at
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

create or replace function public.rotate_mobile_refresh_session(
  p_current_refresh_token_hash text,
  p_new_refresh_token_hash text,
  p_new_expires_at timestamptz,
  p_as_of timestamptz default now()
)
returns table (
  session_id uuid,
  family_id uuid,
  reuse_detected boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.mobile_refresh_sessions;
  v_new_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select *
  into v_current
  from public.mobile_refresh_sessions
  where refresh_token_hash = p_current_refresh_token_hash
  for update;

  if v_current.id is null then
    return;
  end if;

  if v_current.revoked_at is not null
    or v_current.rotated_at is not null
    or v_current.expires_at <= p_as_of
  then
    update public.mobile_refresh_sessions as session
    set
      revoked_at = coalesce(session.revoked_at, p_as_of),
      reuse_detected_at = coalesce(session.reuse_detected_at, p_as_of)
    where session.family_id = v_current.family_id;

    return query select v_current.id, v_current.family_id, true;
    return;
  end if;

  insert into public.mobile_refresh_sessions (
    family_id,
    refresh_token_hash,
    auth_user_id,
    organization_id,
    brand_id,
    member_id,
    device_id,
    parent_session_id,
    expires_at
  )
  values (
    v_current.family_id,
    p_new_refresh_token_hash,
    v_current.auth_user_id,
    v_current.organization_id,
    v_current.brand_id,
    v_current.member_id,
    v_current.device_id,
    v_current.id,
    p_new_expires_at
  )
  returning id into v_new_id;

  update public.mobile_refresh_sessions
  set
    replaced_by_session_id = v_new_id,
    rotated_at = p_as_of,
    last_used_at = p_as_of
  where id = v_current.id;

  return query select v_new_id, v_current.family_id, false;
end;
$$;

create or replace function public.revoke_mobile_refresh_family(
  p_family_id uuid,
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  update public.mobile_refresh_sessions
  set revoked_at = coalesce(revoked_at, p_as_of)
  where family_id = p_family_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.resolve_custom_domain(p_hostname text)
returns table (
  organization_id uuid,
  brand_id uuid,
  brand_name text,
  portal_title text,
  logo_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  font_family text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.organization_id,
    b.id,
    b.name,
    b.portal_title,
    b.logo_url,
    b.primary_color,
    b.secondary_color,
    b.accent_color,
    b.font_family
  from public.brand_custom_domains as d
  join public.brands as b
    on b.organization_id = d.organization_id
   and b.id = d.brand_id
  where d.hostname = lower(btrim(p_hostname))
    and d.status = 'active'
    and d.hostname_status = 'active'
    and d.ssl_status = 'active'
    and b.active;
$$;

-- Composite keys make the brand label part of every relationship. This keeps
-- an explicitly supplied sibling brand from passing an organization-only FK.
alter table public.members
  add constraint members_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.club_tiers
  add constraint club_tiers_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.releases
  add constraint releases_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.release_tiers
  add constraint release_tiers_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.shipments
  add constraint shipments_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.member_imports
  add constraint member_imports_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.email_templates
  add constraint email_templates_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.email_log
  add constraint email_log_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.cancel_flow_attempts
  add constraint cancel_flow_attempts_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.loyalty_redemptions
  add constraint loyalty_redemptions_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.integration_connections
  add constraint integration_connections_org_brand_id_key unique (organization_id, brand_id, id);
alter table public.mobile_devices
  add constraint mobile_devices_org_brand_id_key unique (organization_id, brand_id, id);

alter table public.release_tiers
  add constraint release_tiers_release_same_brand_fkey
    foreign key (organization_id, brand_id, release_id)
    references public.releases (organization_id, brand_id, id);
alter table public.release_wines
  add constraint release_wines_release_same_brand_fkey
    foreign key (organization_id, brand_id, release_id)
    references public.releases (organization_id, brand_id, id);
alter table public.release_tier_items
  add constraint release_tier_items_tier_same_brand_fkey
    foreign key (organization_id, brand_id, release_tier_id)
    references public.release_tiers (organization_id, brand_id, id);
alter table public.shipments
  add constraint shipments_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id),
  add constraint shipments_release_same_brand_fkey
    foreign key (organization_id, brand_id, release_id)
    references public.releases (organization_id, brand_id, id),
  add constraint shipments_release_tier_same_brand_fkey
    foreign key (organization_id, brand_id, release_tier_id)
    references public.release_tiers (organization_id, brand_id, id),
  add constraint shipments_tier_same_brand_fkey
    foreign key (organization_id, brand_id, tier_id)
    references public.club_tiers (organization_id, brand_id, id);
alter table public.shipment_items
  add constraint shipment_items_shipment_same_brand_fkey
    foreign key (organization_id, brand_id, shipment_id)
    references public.shipments (organization_id, brand_id, id);
alter table public.billing_attempts
  add constraint billing_attempts_shipment_same_brand_fkey
    foreign key (organization_id, brand_id, shipment_id)
    references public.shipments (organization_id, brand_id, id);
alter table public.member_import_rows
  add constraint member_import_rows_import_same_brand_fkey
    foreign key (organization_id, brand_id, import_id)
    references public.member_imports (organization_id, brand_id, id);
alter table public.member_email_preferences
  add constraint member_email_preferences_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.email_log
  add constraint email_log_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id),
  add constraint email_log_template_same_brand_fkey
    foreign key (organization_id, brand_id, template_id)
    references public.email_templates (organization_id, brand_id, id);
alter table public.email_outbox
  add constraint email_outbox_log_same_brand_fkey
    foreign key (organization_id, brand_id, email_log_id)
    references public.email_log (organization_id, brand_id, id);
alter table public.email_delivery_events
  add constraint email_delivery_events_log_same_brand_fkey
    foreign key (organization_id, brand_id, email_log_id)
    references public.email_log (organization_id, brand_id, id);
alter table public.email_unsubscribe_tokens
  add constraint email_unsubscribe_tokens_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.churn_scores
  add constraint churn_scores_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.cancel_flow_attempts
  add constraint cancel_flow_attempts_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.cancel_flow_events
  add constraint cancel_flow_events_attempt_same_brand_fkey
    foreign key (organization_id, brand_id, attempt_id)
    references public.cancel_flow_attempts (organization_id, brand_id, id);
alter table public.member_activity_events
  add constraint member_activity_events_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.loyalty_tier_multipliers
  add constraint loyalty_tier_multipliers_tier_same_brand_fkey
    foreign key (organization_id, brand_id, club_tier_id)
    references public.club_tiers (organization_id, brand_id, id);
alter table public.loyalty_redemptions
  add constraint loyalty_redemptions_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.loyalty_ledger
  add constraint loyalty_ledger_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.loyalty_point_lots
  add constraint loyalty_point_lots_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.loyalty_reservation_allocations
  add constraint loyalty_reservation_allocations_redemption_same_brand_fkey
    foreign key (organization_id, brand_id, redemption_id)
    references public.loyalty_redemptions (organization_id, brand_id, id);
alter table public.analytics_events
  add constraint analytics_events_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.ml_feature_snapshots
  add constraint ml_feature_snapshots_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.ml_training_rows
  add constraint ml_training_rows_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.ml_churn_predictions
  add constraint ml_churn_predictions_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.ml_high_risk_alerts
  add constraint ml_high_risk_alerts_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.compliance_checks
  add constraint compliance_checks_shipment_same_brand_fkey
    foreign key (organization_id, brand_id, shipment_id)
    references public.shipments (organization_id, brand_id, id);
alter table public.shipping_label_attempts
  add constraint shipping_label_attempts_shipment_same_brand_fkey
    foreign key (organization_id, brand_id, shipment_id)
    references public.shipments (organization_id, brand_id, id);

alter table public.klaviyo_profile_mappings
  add constraint klaviyo_profile_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id),
  add constraint klaviyo_profile_connection_same_brand_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id);
alter table public.klaviyo_engagement_events
  add constraint klaviyo_engagement_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.quickbooks_account_mappings
  add constraint quickbooks_account_tier_same_brand_fkey
    foreign key (organization_id, brand_id, club_tier_id)
    references public.club_tiers (organization_id, brand_id, id);
alter table public.quickbooks_transaction_mappings
  add constraint quickbooks_transaction_shipment_same_brand_fkey
    foreign key (organization_id, brand_id, shipment_id)
    references public.shipments (organization_id, brand_id, id);
alter table public.avalara_exemptions
  add constraint avalara_exemptions_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.avalara_tax_calculations
  add constraint avalara_tax_shipment_same_brand_fkey
    foreign key (organization_id, brand_id, shipment_id)
    references public.shipments (organization_id, brand_id, id);
alter table public.member_integration_consents
  add constraint member_integration_consents_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.meta_conversion_events
  add constraint meta_conversion_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.mobile_devices
  add constraint mobile_devices_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.mobile_push_outbox
  add constraint mobile_push_device_same_brand_fkey
    foreign key (organization_id, brand_id, device_id)
    references public.mobile_devices (organization_id, brand_id, id),
  add constraint mobile_push_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.mobile_offline_snapshots
  add constraint mobile_snapshot_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.mobile_offline_mutations
  add constraint mobile_mutation_device_same_brand_fkey
    foreign key (organization_id, brand_id, device_id)
    references public.mobile_devices (organization_id, brand_id, id),
  add constraint mobile_mutation_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.mobile_auth_exchange_tokens
  add constraint mobile_auth_exchange_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id);
alter table public.mobile_refresh_sessions
  add constraint mobile_refresh_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id),
  add constraint mobile_refresh_device_same_brand_fkey
    foreign key (organization_id, brand_id, device_id)
    references public.mobile_devices (organization_id, brand_id, id);

alter table public.avalara_tax_calculations
  add constraint avalara_tax_org_brand_id_key
    unique (organization_id, brand_id, id);
alter table public.shipments
  add constraint shipments_avalara_same_brand_fkey
    foreign key (organization_id, brand_id, avalara_tax_calculation_id)
    references public.avalara_tax_calculations (organization_id, brand_id, id);

create or replace function private.enforce_avalara_before_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calculation public.avalara_tax_calculations;
begin
  if new.status = 'charged'
    and old.status is distinct from new.status
    and exists (
      select 1
      from public.integration_connections as c
      where c.organization_id = new.organization_id
        and c.brand_id = new.brand_id
        and c.integration_type = 'avalara'
        and c.status = 'active'
        and c.opted_in
    )
  then
    if new.avalara_tax_calculation_id is null then
      raise exception using
        errcode = '55000',
        message = 'A committed Avalara calculation is required before charging.';
    end if;

    select *
    into v_calculation
    from public.avalara_tax_calculations as calculation
    where calculation.id = new.avalara_tax_calculation_id
      and calculation.organization_id = new.organization_id
      and calculation.brand_id = new.brand_id
      and calculation.shipment_id = new.id
      and calculation.document_status = 'temporary'
      and calculation.committed_at is null
      and calculation.voided_at is null;

    if v_calculation.id is null then
      raise exception using
        errcode = '55000',
        message = 'A saved Avalara calculation is required for this shipment.';
    end if;

    new.tax_amount_cents := v_calculation.tax_amount_cents;
  end if;

  return new;
end;
$$;

create trigger shipments_require_avalara_before_charge
before update of status, avalara_tax_calculation_id on public.shipments
for each row execute function private.enforce_avalara_before_charge();

-- Provider work is durable and event-driven. Triggers enqueue only internal
-- identifiers; service workers hydrate the current source row immediately
-- before calling a provider, so queued payloads never persist raw PII.
create or replace function private.enqueue_active_integration_job(
  p_organization_id uuid,
  p_brand_id uuid,
  p_integration_type public.integration_type,
  p_sync_type text,
  p_entity_type text,
  p_entity_id text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.integration_sync_jobs (
    connection_id,
    organization_id,
    brand_id,
    integration_type,
    direction,
    sync_type,
    entity_type,
    entity_id,
    idempotency_key,
    payload
  )
  select
    connection.id,
    connection.organization_id,
    connection.brand_id,
    connection.integration_type,
    'outbound',
    p_sync_type,
    p_entity_type,
    nullif(p_entity_id, ''),
    p_idempotency_key,
    coalesce(p_payload, '{}'::jsonb)
  from public.integration_connections as connection
  where connection.organization_id = p_organization_id
    and connection.brand_id = p_brand_id
    and connection.integration_type = p_integration_type
    and connection.status = 'active'
    and connection.opted_in
  on conflict (connection_id, idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function private.enqueue_consented_meta_job(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_sync_type text,
  p_entity_type text,
  p_entity_id text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.member_integration_consents as consent
    where consent.organization_id = p_organization_id
      and consent.brand_id = p_brand_id
      and consent.member_id = p_member_id
      and consent.integration_type = 'meta'
      and consent.consented
      and consent.revoked_at is null
  ) then
    return 0;
  end if;

  return private.enqueue_active_integration_job(
    p_organization_id,
    p_brand_id,
    'meta',
    p_sync_type,
    p_entity_type,
    p_entity_id,
    p_idempotency_key,
    p_payload
  );
end;
$$;

create or replace function private.enqueue_connection_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sync_type text;
begin
  if not (
    new.status = 'active'
    and new.opted_in
    and (
      tg_op = 'INSERT'
      or old.status is distinct from new.status
      or old.opted_in is distinct from new.opted_in
    )
  ) then
    return new;
  end if;

  v_sync_type := case new.integration_type
    when 'klaviyo' then 'klaviyo.profiles.bootstrap'
    when 'quickbooks' then 'quickbooks.transactions.bootstrap'
    when 'avalara' then 'avalara.tax.bootstrap'
    else null
  end;

  if v_sync_type is not null and new.brand_id is not null then
    perform private.enqueue_active_integration_job(
      new.organization_id,
      new.brand_id,
      new.integration_type,
      v_sync_type,
      'connection',
      new.id::text,
      'activation:' || new.id::text || ':' ||
        md5(new.updated_at::text || ':' || new.status::text || ':' || new.opted_in::text),
      jsonb_build_object('connection_id', new.id)
    );
  end if;

  return new;
end;
$$;

create trigger integration_connections_enqueue_bootstrap
after insert or update of status, opted_in on public.integration_connections
for each row execute function private.enqueue_connection_bootstrap();

create or replace function private.enqueue_member_integration_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change_hash text;
begin
  if tg_op = 'UPDATE'
    and old.email is not distinct from new.email
    and old.first_name is not distinct from new.first_name
    and old.last_name is not distinct from new.last_name
    and old.status is not distinct from new.status
    and old.club_tier_id is not distinct from new.club_tier_id
    and old.deleted_at is not distinct from new.deleted_at
  then
    return new;
  end if;

  v_change_hash := md5(
    concat_ws(
      ':',
      new.updated_at::text,
      new.status::text,
      coalesce(new.club_tier_id::text, ''),
      coalesce(new.deleted_at::text, '')
    )
  );

  perform private.enqueue_active_integration_job(
    new.organization_id,
    new.brand_id,
    'klaviyo',
    'klaviyo.profile.upsert',
    'member',
    new.id::text,
    'member:' || new.id::text || ':' || v_change_hash,
    jsonb_build_object('member_id', new.id)
  );

  if tg_op = 'UPDATE'
    and old.club_tier_id is distinct from new.club_tier_id
    and new.club_tier_id is not null
  then
    perform private.enqueue_consented_meta_job(
      new.organization_id,
      new.brand_id,
      new.id,
      'meta.event.tier_upgrade',
      'member',
      new.id::text,
      'meta:tier:' || new.id::text || ':' || v_change_hash,
      jsonb_build_object('member_id', new.id)
    );
  end if;

  return new;
end;
$$;

create trigger members_enqueue_integration_changes
after insert or update of email, first_name, last_name, status, club_tier_id, deleted_at
on public.members
for each row execute function private.enqueue_member_integration_changes();

create or replace function private.enqueue_meta_consent_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.integration_type = 'meta'
    and new.consented
    and new.revoked_at is null
    and (
      tg_op = 'INSERT'
      or not old.consented
      or old.revoked_at is not null
    )
  then
    perform private.enqueue_consented_meta_job(
      new.organization_id,
      new.brand_id,
      new.member_id,
      'meta.event.lead',
      'member',
      new.member_id::text,
      'meta:lead:' || new.member_id::text || ':' ||
        md5(new.updated_at::text || ':' || coalesce(new.policy_version, '')),
      jsonb_build_object('member_id', new.member_id)
    );
  end if;

  return new;
end;
$$;

create trigger member_integration_consents_enqueue_meta
after insert or update of consented, revoked_at on public.member_integration_consents
for each row execute function private.enqueue_meta_consent_activation();

create or replace function private.enqueue_shipment_integration_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change_hash text;
  v_is_charge boolean;
  v_is_refund boolean;
begin
  v_is_charge := new.status = 'charged'
    and (tg_op = 'INSERT' or old.status is distinct from new.status);
  v_is_refund := new.refund_amount_cents > 0
    and (
      tg_op = 'INSERT'
      or old.refund_amount_cents is distinct from new.refund_amount_cents
    );

  v_change_hash := md5(
    concat_ws(
      ':',
      new.updated_at::text,
      new.status::text,
      new.charge_amount_cents::text,
      new.refund_amount_cents::text,
      coalesce(new.stripe_charge_id, ''),
      coalesce(new.stripe_refund_id, '')
    )
  );

  if tg_op = 'INSERT' and new.status in ('pending', 'declined') then
    perform private.enqueue_active_integration_job(
      new.organization_id,
      new.brand_id,
      'avalara',
      'avalara.tax.calculate',
      'shipment',
      new.id::text,
      'avalara:shipment:' || new.id::text || ':' || v_change_hash,
      jsonb_build_object('shipment_id', new.id)
    );
  end if;

  if v_is_charge or v_is_refund then
    perform private.enqueue_active_integration_job(
      new.organization_id,
      new.brand_id,
      'quickbooks',
      'quickbooks.transaction.upsert',
      'shipment',
      new.id::text,
      'quickbooks:shipment:' || new.id::text || ':' || v_change_hash,
      jsonb_build_object(
        'change_type',
        case when v_is_refund then 'refund' else 'sale' end,
        'refund_amount_cents',
        new.refund_amount_cents,
        'shipment_id',
        new.id
      )
    );
  end if;

  if v_is_refund then
    perform private.enqueue_active_integration_job(
      new.organization_id,
      new.brand_id,
      'avalara',
      'avalara.tax.refund',
      'shipment',
      new.id::text,
      'avalara:refund:' || new.id::text || ':' || v_change_hash,
      jsonb_build_object('shipment_id', new.id)
    );
  end if;

  if v_is_charge then
    perform private.enqueue_consented_meta_job(
      new.organization_id,
      new.brand_id,
      new.member_id,
      'meta.event.purchase',
      'shipment',
      new.id::text,
      'meta:purchase:' || new.id::text || ':' || v_change_hash,
      jsonb_build_object(
        'member_id', new.member_id,
        'shipment_id', new.id
      )
    );
  end if;

  return new;
end;
$$;

create trigger shipments_enqueue_integration_changes
after insert or update of status, charge_amount_cents, refund_amount_cents,
  stripe_charge_id, stripe_refund_id
on public.shipments
for each row execute function private.enqueue_shipment_integration_changes();

create or replace function private.enqueue_referral_conversion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'referral_completed' then
    perform private.enqueue_consented_meta_job(
      new.organization_id,
      new.brand_id,
      new.member_id,
      'meta.event.referral',
      'member_activity_event',
      new.id::text,
      'meta:referral:' || new.id::text,
      jsonb_build_object(
        'member_id', new.member_id,
        'activity_event_id', new.id
      )
    );
  end if;

  return new;
end;
$$;

create trigger member_activity_events_enqueue_referral
after insert on public.member_activity_events
for each row execute function private.enqueue_referral_conversion();

create or replace function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'This audit table is append-only.';
end;
$$;

create trigger integration_sync_logs_append_only
before update or delete on public.integration_sync_logs
for each row execute function private.reject_append_only_mutation();
create trigger klaviyo_engagement_events_append_only
before update or delete on public.klaviyo_engagement_events
for each row execute function private.reject_append_only_mutation();
create trigger avalara_tax_calculations_append_only
before delete on public.avalara_tax_calculations
for each row execute function private.reject_append_only_mutation();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'brands',
    'organization_staff_access',
    'staff_brand_access',
    'integration_connections',
    'integration_secrets',
    'integration_sync_jobs',
    'klaviyo_field_mappings',
    'quickbooks_account_mappings',
    'quickbooks_transaction_mappings',
    'quickbooks_reconciliations',
    'avalara_exemptions',
    'member_integration_consents',
    'brand_custom_domains',
    'brand_sender_identities',
    'mobile_devices',
    'mobile_device_secrets',
    'mobile_push_outbox',
    'mobile_deep_link_routes'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function private.touch_updated_at()',
      v_table || '_touch_updated_at',
      v_table
    );
  end loop;
end;
$$;

-- Legacy Phase 1-4 service RPCs were organization-scoped. Keep their existing
-- signatures compatible, but resolve or require a brand before any Phase 5
-- write so a non-default brand can never be silently recorded as default.
create or replace function private.require_brand_context(
  p_organization_id uuid,
  p_brand_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.brands as brand
    where brand.organization_id = p_organization_id
      and brand.id = p_brand_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Brand does not belong to the organization.';
  end if;

  if not private.can_access_brand(p_organization_id, p_brand_id) then
    raise exception using
      errcode = '42501',
      message = 'Brand authorization is required.';
  end if;

  return p_brand_id;
end;
$$;

create or replace function private.entity_brand_id(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_table_name text;
begin
  v_table_name := case lower(btrim(p_entity_type))
    when 'member' then 'members'
    when 'club_tier' then 'club_tiers'
    when 'tier' then 'club_tiers'
    when 'release' then 'releases'
    when 'shipment' then 'shipments'
    when 'member_import' then 'member_imports'
    when 'import' then 'member_imports'
    when 'email' then 'email_log'
    when 'email_log' then 'email_log'
    when 'cancel_attempt' then 'cancel_flow_attempts'
    when 'loyalty_redemption' then 'loyalty_redemptions'
    when 'analytics_event' then 'analytics_events'
    when 'compliance_check' then 'compliance_checks'
    else null
  end;

  if v_table_name is not null and p_entity_id is not null then
    execute format(
      'select brand_id from public.%I where organization_id = $1 and id = $2',
      v_table_name
    )
    into v_brand_id
    using p_organization_id, p_entity_id;
  end if;

  return coalesce(v_brand_id, private.default_brand_for_org(p_organization_id));
end;
$$;

alter function public.append_audit_entry(
  uuid,
  uuid,
  text,
  text,
  uuid,
  jsonb
) rename to append_audit_entry_phase4_org_only;

create or replace function public.append_audit_entry(
  p_organization_id uuid,
  p_brand_id uuid,
  p_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id uuid;
  v_previous_brand_context text;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  v_previous_brand_context :=
    current_setting('vinifera.brand_id', true);
  perform set_config('vinifera.brand_id', p_brand_id::text, true);

  begin
    v_audit_id := public.append_audit_entry_phase4_org_only(
      p_organization_id,
      p_user_id,
      p_action,
      p_entity_type,
      p_entity_id,
      p_metadata
    );
  exception when others then
    perform set_config(
      'vinifera.brand_id',
      coalesce(v_previous_brand_context, ''),
      true
    );
    raise;
  end;

  perform set_config(
    'vinifera.brand_id',
    coalesce(v_previous_brand_context, ''),
    true
  );
  return v_audit_id;
end;
$$;

create or replace function public.append_audit_entry(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.append_audit_entry(
    p_organization_id,
    private.entity_brand_id(
      p_organization_id,
      p_entity_type,
      p_entity_id
    ),
    p_user_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_metadata
  );
$$;

alter table public.analytics_events
  drop constraint analytics_events_org_idempotency_key,
  add constraint analytics_events_org_idempotency_key
    unique (organization_id, brand_id, idempotency_key);

create or replace function public.record_analytics_event(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_event_type text,
  p_event_data jsonb,
  p_idempotency_key text,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_existing public.analytics_events%rowtype;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);

  if p_member_id is not null and not exists (
    select 1
    from public.members as member
    where member.id = p_member_id
      and member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Analytics member does not belong to the brand.';
  end if;

  if p_event_type <> all(array[
    'analytics.dashboard_viewed',
    'analytics.widget_exported',
    'analytics.report_scheduled',
    'benchmark.dashboard_viewed',
    'benchmark.opted_in',
    'benchmark.report_generated',
    'churn.dashboard_viewed',
    'churn.alert_acknowledged',
    'compliance.dashboard_viewed',
    'member.created',
    'member.updated',
    'member.cancelled',
    'release.created',
    'release.scheduled',
    'release.processed',
    'shipment.charged',
    'shipment.declined',
    'shipment.compliance_checked',
    'shipment.label_created',
    'shipment.shipped',
    'shipment.delivered',
    'email.sent',
    'email.opened',
    'email.clicked',
    'portal.login',
    'loyalty.redeemed'
  ]::text[]) then
    raise exception using
      errcode = '22023',
      message = 'Unsupported analytics event type.';
  end if;

  if not private.analytics_payload_is_minimized(p_event_data) then
    raise exception using
      errcode = '22023',
      message = 'Analytics payload contains prohibited or excessive data.';
  end if;

  insert into public.analytics_events (
    organization_id,
    brand_id,
    member_id,
    event_type,
    event_data,
    idempotency_key,
    occurred_at
  )
  values (
    p_organization_id,
    p_brand_id,
    p_member_id,
    p_event_type,
    p_event_data,
    p_idempotency_key,
    p_occurred_at
  )
  on conflict on constraint analytics_events_org_idempotency_key
  do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event.*
    into v_existing
    from public.analytics_events as event
    where event.organization_id = p_organization_id
      and event.brand_id = p_brand_id
      and event.idempotency_key = p_idempotency_key;

    if v_existing.member_id is distinct from p_member_id
      or v_existing.event_type is distinct from p_event_type
      or v_existing.event_data is distinct from p_event_data
    then
      raise exception using
        errcode = '23505',
        message = 'Analytics idempotency key was already used for another event.';
    end if;
    v_event_id := v_existing.id;
  end if;

  return v_event_id;
end;
$$;

create or replace function public.record_analytics_event(
  p_organization_id uuid,
  p_member_id uuid,
  p_event_type text,
  p_event_data jsonb,
  p_idempotency_key text,
  p_occurred_at timestamptz default now()
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.record_analytics_event(
    p_organization_id,
    coalesce(
      (
        select member.brand_id
        from public.members as member
        where member.id = p_member_id
          and member.organization_id = p_organization_id
      ),
      private.default_brand_for_org(p_organization_id)
    ),
    p_member_id,
    p_event_type,
    p_event_data,
    p_idempotency_key,
    p_occurred_at
  );
$$;

alter function public.complete_member_import(uuid, text, jsonb, uuid)
  rename to complete_member_import_phase4_org_only;

create or replace function public.complete_member_import(
  p_organization_id uuid,
  p_brand_id uuid,
  p_upload_token text,
  p_column_mapping jsonb,
  p_actor_user_id uuid default null
)
returns table (
  inserted_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_brand_context text;
  v_upload_token_hash text;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  v_upload_token_hash := encode(
    extensions.digest(convert_to(btrim(p_upload_token), 'UTF8'), 'sha256'),
    'hex'
  );

  if not exists (
    select 1
    from public.member_imports as member_import
    where member_import.organization_id = p_organization_id
      and member_import.brand_id = p_brand_id
      and member_import.upload_token_hash = v_upload_token_hash
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'Member import not found for brand.';
  end if;

  v_previous_brand_context :=
    current_setting('vinifera.brand_id', true);
  perform set_config('vinifera.brand_id', p_brand_id::text, true);

  begin
    return query
    select *
    from public.complete_member_import_phase4_org_only(
      p_organization_id,
      p_upload_token,
      p_column_mapping,
      p_actor_user_id
    );
  exception when others then
    perform set_config(
      'vinifera.brand_id',
      coalesce(v_previous_brand_context, ''),
      true
    );
    raise;
  end;

  perform set_config(
    'vinifera.brand_id',
    coalesce(v_previous_brand_context, ''),
    true
  );
end;
$$;

create or replace function public.complete_member_import(
  p_organization_id uuid,
  p_upload_token text,
  p_column_mapping jsonb,
  p_actor_user_id uuid default null
)
returns table (
  inserted_count integer,
  failed_count integer
)
language sql
security definer
set search_path = ''
as $$
  select *
  from public.complete_member_import(
    p_organization_id,
    (
      select member_import.brand_id
      from public.member_imports as member_import
      where member_import.organization_id = p_organization_id
        and member_import.upload_token_hash = encode(
          extensions.digest(
            convert_to(btrim(p_upload_token), 'UTF8'),
            'sha256'
          ),
          'hex'
        )
    ),
    p_upload_token,
    p_column_mapping,
    p_actor_user_id
  );
$$;

create or replace function public.create_release_shipments(
  p_organization_id uuid,
  p_brand_id uuid,
  p_release_id uuid,
  p_actor_user_id uuid default null
)
returns table (
  shipment_id uuid,
  member_id uuid,
  charge_amount_cents integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if not exists (
    select 1 from public.releases as release
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
  ) then
    raise exception using errcode = 'P0002', message = 'Release not found for brand.';
  end if;
  return query
  select *
  from public.create_release_shipments(
    p_organization_id,
    p_release_id,
    p_actor_user_id
  );
end;
$$;

create or replace function public.record_billing_attempt(
  p_organization_id uuid,
  p_brand_id uuid,
  p_shipment_id uuid,
  p_attempt_kind public.billing_attempt_kind,
  p_amount_cents integer,
  p_idempotency_key text,
  p_stripe_payment_intent_id text default null,
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
  v_existing public.billing_attempts%rowtype;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_idempotency_key text;
  v_payable_amount_cents integer;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if p_actor_user_id is not null then
    perform private.resolve_audit_actor(p_organization_id, p_actor_user_id);
  end if;
  v_idempotency_key := btrim(p_idempotency_key);
  if char_length(v_idempotency_key) not between 8 and 255
    or v_idempotency_key !~ '^[A-Za-z0-9_.:/-]+$'
    or jsonb_typeof(p_metadata) is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'Invalid billing attempt input.';
  end if;

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.organization_id = p_organization_id
    and shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found for brand.';
  end if;

  v_payable_amount_cents :=
    v_shipment.charge_amount_cents
    - v_shipment.loyalty_discount_cents
    + v_shipment.tax_amount_cents;
  if p_attempt_kind in ('charge', 'retry')
    and p_amount_cents <> v_payable_amount_cents
  then
    raise exception using
      errcode = '22023',
      message = 'Charge amount must match the net shipment amount plus tax.';
  end if;
  if p_attempt_kind = 'refund'
    and (
      p_amount_cents <= 0
      or v_shipment.stripe_charge_id is null
      or p_amount_cents > v_payable_amount_cents - v_shipment.refund_amount_cents
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Refund requires a captured charge and cannot exceed the payable balance.';
  end if;
  if p_amount_cents < 0 then
    raise exception using errcode = '22023', message = 'Billing amount cannot be negative.';
  end if;

  select attempt.*
  into v_existing
  from public.billing_attempts as attempt
  where attempt.organization_id = p_organization_id
    and attempt.brand_id = p_brand_id
    and attempt.shipment_id = p_shipment_id
    and (
      attempt.idempotency_key = v_idempotency_key
      or (
        p_attempt_kind <> 'refund'
        and p_stripe_payment_intent_id is not null
        and attempt.attempt_kind <> 'refund'
        and attempt.stripe_payment_intent_id = p_stripe_payment_intent_id
      )
    )
  order by case when attempt.idempotency_key = v_idempotency_key then 0 else 1 end
  limit 1
  for update;
  if found then
    if v_existing.attempt_kind <> p_attempt_kind
      or v_existing.amount_cents <> p_amount_cents
    then
      raise exception using
        errcode = '23505',
        message = 'Billing idempotency key was reused with different parameters.';
    end if;
    if p_stripe_payment_intent_id is not null
      and v_existing.stripe_payment_intent_id is null
    then
      update public.billing_attempts
      set stripe_payment_intent_id = p_stripe_payment_intent_id
      where id = v_existing.id;
    end if;
    return v_existing.id;
  end if;

  select coalesce(max(attempt.attempt_number), 0) + 1
  into v_attempt_number
  from public.billing_attempts as attempt
  where attempt.shipment_id = p_shipment_id;

  insert into public.billing_attempts (
    organization_id,
    brand_id,
    shipment_id,
    idempotency_key,
    attempt_number,
    attempt_kind,
    status,
    amount_cents,
    stripe_payment_intent_id,
    started_at,
    created_by,
    metadata
  )
  values (
    p_organization_id,
    p_brand_id,
    p_shipment_id,
    v_idempotency_key,
    v_attempt_number,
    p_attempt_kind,
    'processing',
    p_amount_cents,
    nullif(btrim(p_stripe_payment_intent_id), ''),
    now(),
    p_actor_user_id,
    p_metadata - array['card_number', 'cvc', 'client_secret', 'api_key', 'secret']
  )
  returning id into v_attempt_id;
  return v_attempt_id;
end;
$$;

create table public.integration_refund_deliveries (
  connection_id uuid not null,
  organization_id uuid not null,
  brand_id uuid not null,
  shipment_id uuid not null,
  integration_type public.integration_type not null,
  delivered_cumulative_amount_cents bigint not null default 0,
  inflight_prior_amount_cents bigint,
  inflight_target_amount_cents bigint,
  provider_request_key text,
  lease_token_hash text,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (connection_id, shipment_id),
  constraint integration_refund_delivery_connection_same_brand_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id)
    on delete cascade,
  constraint integration_refund_delivery_shipment_same_brand_fkey
    foreign key (organization_id, brand_id, shipment_id)
    references public.shipments (organization_id, brand_id, id)
    on delete cascade,
  constraint integration_refund_delivery_provider_valid
    check (integration_type in ('quickbooks', 'avalara')),
  constraint integration_refund_delivery_amounts_valid
    check (
      delivered_cumulative_amount_cents >= 0
      and (
        (
          inflight_prior_amount_cents is null
          and inflight_target_amount_cents is null
          and provider_request_key is null
          and lease_token_hash is null
          and lease_owner is null
          and lease_expires_at is null
        )
        or (
          inflight_prior_amount_cents = delivered_cumulative_amount_cents
          and inflight_target_amount_cents > inflight_prior_amount_cents
          and char_length(provider_request_key) between 8 and 255
          and lease_token_hash ~ '^[0-9a-f]{64}$'
          and char_length(lease_owner) between 1 and 200
          and lease_expires_at is not null
        )
      )
    )
);

create index integration_refund_deliveries_lease_idx
  on public.integration_refund_deliveries (lease_expires_at)
  where lease_token_hash is not null;

alter table public.integration_refund_deliveries enable row level security;
alter table public.integration_refund_deliveries force row level security;

create or replace function public.claim_integration_refund_delivery(
  p_connection_id uuid,
  p_shipment_id uuid,
  p_target_cumulative_amount_cents bigint,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns table (
  outcome text,
  delivered_cumulative_amount_cents bigint,
  prior_cumulative_amount_cents bigint,
  target_cumulative_amount_cents bigint,
  delta_amount_cents bigint,
  lease_token text,
  provider_request_key text,
  retry_after timestamptz,
  reclaimed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections%rowtype;
  v_shipment public.shipments%rowtype;
  v_delivery public.integration_refund_deliveries%rowtype;
  v_ledger_cumulative bigint;
  v_raw_lease_token text;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_connection_id is null
    or p_shipment_id is null
    or p_target_cumulative_amount_cents <= 0
    or char_length(btrim(p_lease_owner)) not between 1 and 200
    or p_lease_seconds not between 30 and 600
  then
    raise exception using errcode = '22023', message = 'Invalid refund delivery claim.';
  end if;

  select connection.*
  into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type in ('quickbooks', 'avalara')
    and connection.status = 'active'
    and connection.opted_in;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active refund integration not found.';
  end if;

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.id = p_shipment_id
    and shipment.organization_id = v_connection.organization_id
    and shipment.brand_id = v_connection.brand_id;
  if not found
    or p_target_cumulative_amount_cents > greatest(
      0,
      v_shipment.charge_amount_cents
        - v_shipment.loyalty_discount_cents
        + v_shipment.tax_amount_cents
    )
    or p_target_cumulative_amount_cents > v_shipment.refund_amount_cents
  then
    raise exception using errcode = '22023', message = 'Refund delivery target is invalid.';
  end if;

  insert into public.integration_refund_deliveries (
    connection_id,
    organization_id,
    brand_id,
    shipment_id,
    integration_type
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_shipment.id,
    v_connection.integration_type
  )
  on conflict (connection_id, shipment_id) do nothing;

  select delivery.*
  into v_delivery
  from public.integration_refund_deliveries as delivery
  where delivery.connection_id = v_connection.id
    and delivery.shipment_id = v_shipment.id
  for update;
  if v_delivery.integration_type is distinct from v_connection.integration_type
    or v_delivery.organization_id is distinct from v_connection.organization_id
    or v_delivery.brand_id is distinct from v_connection.brand_id
  then
    raise exception using errcode = '23514', message = 'Refund delivery tenant context is invalid.';
  end if;

  if v_connection.integration_type = 'quickbooks' then
    select coalesce(sum(mapping.amount_cents), 0)
    into v_ledger_cumulative
    from public.quickbooks_transaction_mappings as mapping
    where mapping.connection_id = v_connection.id
      and mapping.organization_id = v_connection.organization_id
      and mapping.brand_id = v_connection.brand_id
      and mapping.shipment_id = v_shipment.id
      and mapping.transaction_type = 'refund';
  else
    select coalesce(
      sum(calculation.taxable_basis_cents + calculation.tax_amount_cents),
      0
    )
    into v_ledger_cumulative
    from public.avalara_tax_calculations as calculation
    where calculation.connection_id = v_connection.id
      and calculation.organization_id = v_connection.organization_id
      and calculation.brand_id = v_connection.brand_id
      and calculation.shipment_id = v_shipment.id
      and calculation.document_type = 'ReturnInvoice'
      and calculation.document_status = 'committed';
  end if;

  if v_ledger_cumulative > v_delivery.delivered_cumulative_amount_cents
    and v_delivery.lease_token_hash is null
  then
    update public.integration_refund_deliveries as delivery
    set
      delivered_cumulative_amount_cents = v_ledger_cumulative,
      updated_at = now()
    where delivery.connection_id = v_connection.id
      and delivery.shipment_id = v_shipment.id
    returning delivery.* into v_delivery;
  end if;

  if v_delivery.inflight_target_amount_cents is not null then
    if v_delivery.inflight_target_amount_cents <> p_target_cumulative_amount_cents
      or v_delivery.lease_expires_at > now()
    then
      outcome := 'blocked';
      delivered_cumulative_amount_cents :=
        v_delivery.delivered_cumulative_amount_cents;
      prior_cumulative_amount_cents :=
        v_delivery.inflight_prior_amount_cents;
      target_cumulative_amount_cents :=
        v_delivery.inflight_target_amount_cents;
      delta_amount_cents :=
        v_delivery.inflight_target_amount_cents
        - v_delivery.inflight_prior_amount_cents;
      lease_token := null;
      provider_request_key := v_delivery.provider_request_key;
      retry_after := greatest(
        coalesce(v_delivery.lease_expires_at, now()),
        now() + interval '5 seconds'
      );
      reclaimed := false;
      return next;
      return;
    end if;

    v_raw_lease_token := gen_random_uuid()::text;
    update public.integration_refund_deliveries as delivery
    set
      lease_token_hash = encode(
        extensions.digest(convert_to(v_raw_lease_token, 'UTF8'), 'sha256'),
        'hex'
      ),
      lease_owner = btrim(p_lease_owner),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
    where delivery.connection_id = v_connection.id
      and delivery.shipment_id = v_shipment.id
    returning delivery.* into v_delivery;

    outcome := 'claimed';
    delivered_cumulative_amount_cents :=
      v_delivery.delivered_cumulative_amount_cents;
    prior_cumulative_amount_cents :=
      v_delivery.inflight_prior_amount_cents;
    target_cumulative_amount_cents :=
      v_delivery.inflight_target_amount_cents;
    delta_amount_cents :=
      v_delivery.inflight_target_amount_cents
      - v_delivery.inflight_prior_amount_cents;
    lease_token := v_raw_lease_token;
    provider_request_key := v_delivery.provider_request_key;
    retry_after := v_delivery.lease_expires_at;
    reclaimed := true;
    return next;
    return;
  end if;

  if p_target_cumulative_amount_cents <=
    v_delivery.delivered_cumulative_amount_cents
  then
    outcome := 'already_delivered';
    delivered_cumulative_amount_cents :=
      v_delivery.delivered_cumulative_amount_cents;
    prior_cumulative_amount_cents :=
      v_delivery.delivered_cumulative_amount_cents;
    target_cumulative_amount_cents :=
      p_target_cumulative_amount_cents;
    delta_amount_cents := 0;
    lease_token := null;
    provider_request_key :=
      v_connection.integration_type::text
      || ':refund:' || v_shipment.id::text
      || ':' || p_target_cumulative_amount_cents::text;
    retry_after := null;
    reclaimed := false;
    return next;
    return;
  end if;

  v_raw_lease_token := gen_random_uuid()::text;
  update public.integration_refund_deliveries as delivery
  set
    inflight_prior_amount_cents =
      delivery.delivered_cumulative_amount_cents,
    inflight_target_amount_cents = p_target_cumulative_amount_cents,
    provider_request_key =
      v_connection.integration_type::text
      || ':refund:' || v_shipment.id::text
      || ':' || p_target_cumulative_amount_cents::text,
    lease_token_hash = encode(
      extensions.digest(convert_to(v_raw_lease_token, 'UTF8'), 'sha256'),
      'hex'
    ),
    lease_owner = btrim(p_lease_owner),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  where delivery.connection_id = v_connection.id
    and delivery.shipment_id = v_shipment.id
  returning delivery.* into v_delivery;

  outcome := 'claimed';
  delivered_cumulative_amount_cents :=
    v_delivery.delivered_cumulative_amount_cents;
  prior_cumulative_amount_cents :=
    v_delivery.inflight_prior_amount_cents;
  target_cumulative_amount_cents :=
    v_delivery.inflight_target_amount_cents;
  delta_amount_cents :=
    v_delivery.inflight_target_amount_cents
    - v_delivery.inflight_prior_amount_cents;
  lease_token := v_raw_lease_token;
  provider_request_key := v_delivery.provider_request_key;
  retry_after := v_delivery.lease_expires_at;
  reclaimed := false;
  return next;
end;
$$;

create or replace function public.release_integration_refund_delivery(
  p_connection_id uuid,
  p_shipment_id uuid,
  p_lease_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  update public.integration_refund_deliveries as delivery
  set
    inflight_prior_amount_cents = null,
    inflight_target_amount_cents = null,
    provider_request_key = null,
    lease_token_hash = null,
    lease_owner = null,
    lease_expires_at = null,
    updated_at = now()
  where delivery.connection_id = p_connection_id
    and delivery.shipment_id = p_shipment_id
    and delivery.lease_token_hash = encode(
      extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
      'hex'
    );
  return found;
end;
$$;

create or replace function public.complete_quickbooks_refund_delivery(
  p_connection_id uuid,
  p_shipment_id uuid,
  p_lease_token text,
  p_provider_transaction_id text,
  p_amount_cents bigint,
  p_tax_cents bigint,
  p_currency_code text,
  p_exchange_rate numeric,
  p_transaction_date date
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.integration_refund_deliveries%rowtype;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  select delivery.*
  into v_delivery
  from public.integration_refund_deliveries as delivery
  where delivery.connection_id = p_connection_id
    and delivery.shipment_id = p_shipment_id
  for update;
  if not found
    or v_delivery.integration_type <> 'quickbooks'
    or v_delivery.lease_token_hash is distinct from encode(
      extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
      'hex'
    )
    or p_amount_cents <>
      v_delivery.inflight_target_amount_cents
      - v_delivery.inflight_prior_amount_cents
    or p_tax_cents not between 0 and p_amount_cents
    or nullif(btrim(p_provider_transaction_id), '') is null
  then
    raise exception using errcode = '42501', message = 'Invalid QuickBooks refund delivery completion.';
  end if;

  insert into public.quickbooks_transaction_mappings (
    connection_id,
    organization_id,
    brand_id,
    shipment_id,
    transaction_type,
    quickbooks_transaction_id,
    amount_cents,
    tax_cents,
    source_cumulative_amount_cents,
    currency_code,
    exchange_rate,
    transaction_date
  )
  values (
    v_delivery.connection_id,
    v_delivery.organization_id,
    v_delivery.brand_id,
    v_delivery.shipment_id,
    'refund',
    btrim(p_provider_transaction_id),
    p_amount_cents,
    p_tax_cents,
    v_delivery.inflight_target_amount_cents,
    upper(p_currency_code),
    p_exchange_rate,
    p_transaction_date
  )
  on conflict (
    connection_id,
    shipment_id,
    transaction_type,
    source_cumulative_amount_cents
  )
  do update set
    quickbooks_transaction_id = excluded.quickbooks_transaction_id,
    amount_cents = excluded.amount_cents,
    tax_cents = excluded.tax_cents,
    currency_code = excluded.currency_code,
    exchange_rate = excluded.exchange_rate,
    transaction_date = excluded.transaction_date,
    updated_at = now();

  update public.integration_refund_deliveries as delivery
  set
    delivered_cumulative_amount_cents =
      v_delivery.inflight_target_amount_cents,
    inflight_prior_amount_cents = null,
    inflight_target_amount_cents = null,
    provider_request_key = null,
    lease_token_hash = null,
    lease_owner = null,
    lease_expires_at = null,
    updated_at = now()
  where delivery.connection_id = v_delivery.connection_id
    and delivery.shipment_id = v_delivery.shipment_id;

  return v_delivery.inflight_target_amount_cents;
end;
$$;

create or replace function public.complete_avalara_refund_delivery(
  p_connection_id uuid,
  p_shipment_id uuid,
  p_lease_token text,
  p_document_code text,
  p_currency_code text,
  p_taxable_basis_cents bigint,
  p_tax_amount_cents bigint,
  p_jurisdiction_summary jsonb,
  p_request_hash text,
  p_response_hash text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.integration_refund_deliveries%rowtype;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  select delivery.*
  into v_delivery
  from public.integration_refund_deliveries as delivery
  where delivery.connection_id = p_connection_id
    and delivery.shipment_id = p_shipment_id
  for update;
  if not found
    or v_delivery.integration_type <> 'avalara'
    or v_delivery.lease_token_hash is distinct from encode(
      extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
      'hex'
    )
    or p_taxable_basis_cents < 0
    or p_tax_amount_cents < 0
    or p_taxable_basis_cents + p_tax_amount_cents <>
      v_delivery.inflight_target_amount_cents
      - v_delivery.inflight_prior_amount_cents
  then
    raise exception using errcode = '42501', message = 'Invalid Avalara refund delivery completion.';
  end if;

  perform public.record_avalara_tax_calculation(
    v_delivery.connection_id,
    v_delivery.shipment_id,
    btrim(p_document_code),
    btrim(p_document_code),
    'committed',
    p_taxable_basis_cents,
    0,
    p_tax_amount_cents,
    0,
    p_jurisdiction_summary,
    p_request_hash,
    p_response_hash,
    p_currency_code,
    'ReturnInvoice'
  );

  update public.integration_refund_deliveries as delivery
  set
    delivered_cumulative_amount_cents =
      v_delivery.inflight_target_amount_cents,
    inflight_prior_amount_cents = null,
    inflight_target_amount_cents = null,
    provider_request_key = null,
    lease_token_hash = null,
    lease_owner = null,
    lease_expires_at = null,
    updated_at = now()
  where delivery.connection_id = v_delivery.connection_id
    and delivery.shipment_id = v_delivery.shipment_id;

  return v_delivery.inflight_target_amount_cents;
end;
$$;

create table public.member_auth_link_contexts (
  token_hash text primary key,
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  email_hash text not null,
  request_host text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_auth_link_context_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id)
    on delete cascade,
  constraint member_auth_link_context_hashes_valid
    check (
      token_hash ~ '^[0-9a-f]{64}$'
      and email_hash ~ '^[0-9a-f]{64}$'
    ),
  constraint member_auth_link_context_host_valid
    check (
      request_host = lower(btrim(request_host))
      and char_length(request_host) between 1 and 253
      and request_host ~ '^[a-z0-9.-]+$'
    ),
  constraint member_auth_link_context_expiry_valid
    check (expires_at > created_at)
);

create index member_auth_link_context_expiry_idx
  on public.member_auth_link_contexts (expires_at)
  where consumed_at is null;

alter table public.member_auth_link_contexts enable row level security;
alter table public.member_auth_link_contexts force row level security;

create or replace function public.register_member_auth_link_context(
  p_token_hash text,
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_email_hash text,
  p_request_host text,
  p_expires_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_email_hash !~ '^[0-9a-f]{64}$'
    or p_request_host is distinct from lower(btrim(p_request_host))
    or p_request_host !~ '^[a-z0-9.-]+$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '20 minutes'
  then
    raise exception using errcode = '22023', message = 'Invalid member auth-link context.';
  end if;
  if not exists (
    select 1
    from public.members as member
    where member.id = p_member_id
      and member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.deleted_at is null
      and encode(
        extensions.digest(
          convert_to(lower(btrim(member.email)), 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = p_email_hash
  ) or not private.brand_accepts_operational_charges(
    p_organization_id,
    p_brand_id
  )
  then
    raise exception using errcode = 'P0002', message = 'Member auth-link target is unavailable.';
  end if;

  insert into public.member_auth_link_contexts (
    token_hash,
    organization_id,
    brand_id,
    member_id,
    email_hash,
    request_host,
    expires_at
  )
  values (
    p_token_hash,
    p_organization_id,
    p_brand_id,
    p_member_id,
    p_email_hash,
    p_request_host,
    p_expires_at
  );

  return p_token_hash;
end;
$$;

drop function public.link_member_auth_user(uuid, text);

create or replace function public.link_member_auth_user(
  p_user_id uuid,
  p_email text,
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_context_token_hash text,
  p_request_host text
)
returns table (
  member_id uuid,
  organization_id uuid,
  brand_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_auth_email text;
  v_member public.members%rowtype;
  v_consumed_token_hash text;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  v_email := lower(btrim(p_email));
  if p_user_id is null
    or p_organization_id is null
    or p_brand_id is null
    or p_member_id is null
    or char_length(v_email) not between 3 and 320
    or position('@' in v_email) <= 1
    or p_context_token_hash !~ '^[0-9a-f]{64}$'
    or p_request_host is distinct from lower(btrim(p_request_host))
    or p_request_host !~ '^[a-z0-9.-]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid member identity.';
  end if;

  select lower(u.email)
  into v_auth_email
  from auth.users as u
  where u.id = p_user_id;
  if not found or v_auth_email is distinct from v_email then
    raise exception using
      errcode = '22023',
      message = 'user_id and email do not identify the same auth user.';
  end if;
  if exists (
    select 1 from public.staff_users as staff where staff.id = p_user_id
  ) or exists (
    select 1 from public.platform_users as platform where platform.id = p_user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Auth user already belongs to another Vinifera surface.';
  end if;

  update public.member_auth_link_contexts as context
  set consumed_at = now()
  where context.token_hash = p_context_token_hash
    and context.organization_id = p_organization_id
    and context.brand_id = p_brand_id
    and context.member_id = p_member_id
    and context.email_hash = encode(
      extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'),
      'hex'
    )
    and context.request_host = p_request_host
    and context.consumed_at is null
    and context.expires_at > now()
  returning context.token_hash into v_consumed_token_hash;
  if v_consumed_token_hash is null then
    raise exception using errcode = '22023', message = 'Member auth-link context is invalid or already used.';
  end if;

  select member.*
  into v_member
  from public.members as member
  where member.id = p_member_id
    and member.organization_id = p_organization_id
    and member.brand_id = p_brand_id
    and member.email = v_email
    and member.deleted_at is null
  for update;
  if not found or not private.brand_accepts_operational_charges(
    p_organization_id,
    p_brand_id
  ) then
    raise exception using errcode = 'P0002', message = 'Member profile not found.';
  end if;
  if v_member.auth_user_id is not null
    and v_member.auth_user_id <> p_user_id
  then
    raise exception using
      errcode = '23505',
      message = 'Member profile is already linked to another auth user.';
  end if;
  if v_member.auth_user_id is null then
    update public.members as member
    set auth_user_id = p_user_id
    where member.id = p_member_id
      and member.organization_id = p_organization_id
      and member.brand_id = p_brand_id;

    perform public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_user_id,
      'member.auth_linked',
      'member',
      p_member_id,
      jsonb_build_object('request_host', p_request_host)
    );
  end if;

  member_id := p_member_id;
  organization_id := p_organization_id;
  brand_id := p_brand_id;
  return next;
end;
$$;

create or replace function public.claim_due_releases(
  p_as_of date default current_date,
  p_limit integer default 25
)
returns table (
  organization_id uuid,
  release_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release record;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_as_of is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Invalid due release claim input.';
  end if;

  for v_release in
    select r.id, r.organization_id, r.brand_id
    from public.releases as r
    where r.status = 'scheduled'
      and r.processing_date <= p_as_of
      and private.brand_accepts_operational_charges(
        r.organization_id,
        r.brand_id
      )
    order by r.processing_date, r.id
    limit p_limit
    for update skip locked
  loop
    update public.releases as target
    set status = 'processing'
    where target.id = v_release.id
      and target.organization_id = v_release.organization_id
      and target.brand_id = v_release.brand_id
      and target.status = 'scheduled';

    if found then
      perform public.append_audit_entry(
        v_release.organization_id,
        v_release.brand_id,
        null,
        'release.processing_claimed',
        'release',
        v_release.id,
        jsonb_build_object('processing_date', p_as_of)
      );
      organization_id := v_release.organization_id;
      release_id := v_release.id;
      return next;
    end if;
  end loop;
end;
$$;

drop function public.schedule_due_shipment_retries(timestamptz, integer);

create or replace function public.schedule_due_shipment_retries(
  p_as_of timestamptz default now(),
  p_limit integer default 100
)
returns table (
  billing_attempt_id uuid,
  shipment_id uuid,
  organization_id uuid,
  brand_id uuid,
  member_id uuid,
  amount_cents integer,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_as_of is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid shipment retry claim input.';
  end if;

  return query
  with due as (
    select
      s.id,
      s.organization_id,
      s.brand_id,
      s.member_id,
      greatest(
        0,
        s.charge_amount_cents
          - s.loyalty_discount_cents
          + s.tax_amount_cents
      )::integer as payable_amount_cents,
      (
        select coalesce(max(a.attempt_number), 0) + 1
        from public.billing_attempts as a
        where a.shipment_id = s.id
      ) as next_attempt_number
    from public.shipments as s
    where s.status = 'declined'
      and s.next_retry_at <= p_as_of
      and s.retry_count < 3
      and private.brand_accepts_operational_charges(
        s.organization_id,
        s.brand_id
      )
    order by s.next_retry_at, s.id
    limit p_limit
    for update of s skip locked
  ),
  claimed as (
    update public.shipments as s
    set next_retry_at = null
    from due as d
    where s.id = d.id
      and s.organization_id = d.organization_id
      and s.brand_id = d.brand_id
    returning s.id
  ),
  attempts as (
    insert into public.billing_attempts (
      organization_id,
      brand_id,
      shipment_id,
      idempotency_key,
      attempt_number,
      attempt_kind,
      status,
      amount_cents,
      scheduled_for,
      started_at,
      metadata
    )
    select
      d.organization_id,
      d.brand_id,
      d.id,
      'auto-retry:' || d.id::text || ':' || d.next_attempt_number::text,
      d.next_attempt_number,
      'retry',
      'processing',
      d.payable_amount_cents,
      p_as_of,
      p_as_of,
      jsonb_build_object('automatic', true)
    from due as d
    join claimed as c on c.id = d.id
    returning
      id,
      billing_attempts.shipment_id,
      billing_attempts.organization_id,
      billing_attempts.brand_id,
      billing_attempts.amount_cents,
      billing_attempts.attempt_number
  )
  select
    a.id,
    a.shipment_id,
    a.organization_id,
    a.brand_id,
    s.member_id,
    a.amount_cents,
    a.attempt_number
  from attempts as a
  join public.shipments as s
    on s.id = a.shipment_id
   and s.organization_id = a.organization_id
   and s.brand_id = a.brand_id;
end;
$$;

create or replace function public.apply_shipment_payment_event(
  p_organization_id uuid,
  p_brand_id uuid,
  p_shipment_id uuid,
  p_billing_attempt_id uuid,
  p_stripe_event_id text,
  p_event_created_at timestamptz,
  p_status public.billing_attempt_status,
  p_stripe_charge_id text default null,
  p_decline_code text default null,
  p_decline_reason text default null,
  p_stripe_refund_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.shipment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applied_status public.shipment_status;
  v_previous_status public.shipment_status;
  v_previous_refunded_at timestamptz;
  v_payable_amount_cents integer;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if not exists (
    select 1
    from public.shipments as shipment
    join public.billing_attempts as attempt
      on attempt.organization_id = shipment.organization_id
     and attempt.brand_id = shipment.brand_id
     and attempt.shipment_id = shipment.id
    where shipment.organization_id = p_organization_id
      and shipment.brand_id = p_brand_id
      and shipment.id = p_shipment_id
      and attempt.id = p_billing_attempt_id
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'Shipment payment attempt not found for brand.';
  end if;

  select
    shipment.status,
    shipment.refunded_at,
    greatest(
      0,
      shipment.charge_amount_cents
        - shipment.loyalty_discount_cents
        + shipment.tax_amount_cents
    )::integer
  into
    v_previous_status,
    v_previous_refunded_at,
    v_payable_amount_cents
  from public.shipments as shipment
  where shipment.organization_id = p_organization_id
    and shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  for update;

  v_applied_status := public.apply_shipment_payment_event(
    p_organization_id,
    p_shipment_id,
    p_billing_attempt_id,
    p_stripe_event_id,
    p_event_created_at,
    p_status,
    p_stripe_charge_id,
    p_decline_code,
    p_decline_reason,
    p_stripe_refund_id,
    p_metadata
  );

  if p_status = 'refunded' then
    update public.shipments as shipment
    set
      status = case
        when shipment.refund_amount_cents >= v_payable_amount_cents
          then 'refunded'::public.shipment_status
        else v_previous_status
      end,
      refunded_at = case
        when shipment.refund_amount_cents >= v_payable_amount_cents
          then coalesce(shipment.refunded_at, p_event_created_at)
        else v_previous_refunded_at
      end
    where shipment.organization_id = p_organization_id
      and shipment.brand_id = p_brand_id
      and shipment.id = p_shipment_id
    returning shipment.status into v_applied_status;
  end if;

  return v_applied_status;
end;
$$;

create or replace function public.record_shipment_compliance_check(
  p_organization_id uuid,
  p_brand_id uuid,
  p_shipment_id uuid,
  p_status public.compliance_check_status,
  p_reason text,
  p_tax_estimate_cents integer,
  p_provider_response_id text,
  p_provider text,
  p_checked_at timestamptz,
  p_actor_user_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.compliance_checks
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if not exists (
    select 1 from public.shipments as shipment
    where shipment.organization_id = p_organization_id
      and shipment.brand_id = p_brand_id
      and shipment.id = p_shipment_id
  ) then
    raise exception using errcode = 'P0002', message = 'Shipment not found for brand.';
  end if;
  return public.record_shipment_compliance_check(
    p_organization_id,
    p_shipment_id,
    p_status,
    p_reason,
    p_tax_estimate_cents,
    p_provider_response_id,
    p_provider,
    p_checked_at,
    p_actor_user_id,
    p_metadata
  );
end;
$$;

create or replace function public.list_churn_intelligence(
  p_organization_id uuid,
  p_brand_id uuid,
  p_risk_level text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  member_id uuid,
  member_name text,
  member_email text,
  tier_name text,
  rules_score numeric,
  ml_probability numeric,
  ml_score numeric,
  effective_score numeric,
  effective_source public.ml_prediction_source,
  risk_level public.churn_risk_level,
  confidence_interval_low numeric,
  confidence_interval_high numeric,
  top_features jsonb,
  predicted_at timestamptz,
  alert_id uuid,
  alert_created_at timestamptz,
  alert_acknowledged_at timestamptz,
  alert_acknowledged_by_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Churn pagination is invalid.';
  end if;

  return query
  with scoped as (
    select intelligence.*
    from public.list_churn_intelligence(
      p_organization_id,
      p_risk_level,
      p_search,
      200,
      0
    ) as intelligence
    join public.members as member
      on member.organization_id = p_organization_id
     and member.brand_id = p_brand_id
     and member.id = intelligence.member_id
  )
  select
    scoped.member_id,
    scoped.member_name,
    scoped.member_email,
    scoped.tier_name,
    scoped.rules_score,
    scoped.ml_probability,
    scoped.ml_score,
    scoped.effective_score,
    scoped.effective_source,
    scoped.risk_level,
    scoped.confidence_interval_low,
    scoped.confidence_interval_high,
    scoped.top_features,
    scoped.predicted_at,
    scoped.alert_id,
    scoped.alert_created_at,
    scoped.alert_acknowledged_at,
    scoped.alert_acknowledged_by_name,
    count(*) over()
  from scoped
  order by scoped.effective_score desc, scoped.member_name
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.get_member_churn_intelligence(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if not exists (
    select 1 from public.members as member
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id
  ) then
    raise exception using errcode = 'P0002', message = 'Member not found for brand.';
  end if;
  return public.get_member_churn_intelligence(
    p_organization_id,
    p_member_id
  );
end;
$$;

create or replace function public.acknowledge_ml_high_risk_alert(
  p_organization_id uuid,
  p_brand_id uuid,
  p_alert_id uuid,
  p_actor_user_id uuid
)
returns public.ml_high_risk_alerts
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if not exists (
    select 1
    from public.ml_high_risk_alerts as alert
    where alert.organization_id = p_organization_id
      and alert.brand_id = p_brand_id
      and alert.id = p_alert_id
  ) then
    raise exception using errcode = 'P0002', message = 'High-risk alert not found for brand.';
  end if;
  return public.acknowledge_ml_high_risk_alert(
    p_organization_id,
    p_alert_id,
    p_actor_user_id
  );
end;
$$;

create or replace function public.get_compliance_dashboard(
  p_organization_id uuid,
  p_brand_id uuid,
  p_release_id uuid default null,
  p_status public.compliance_check_status default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_summary jsonb;
  v_total bigint;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Compliance pagination is invalid.';
  end if;
  if p_release_id is not null and not exists (
    select 1 from public.releases as release
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
  ) then
    raise exception using errcode = 'P0002', message = 'Release not found for brand.';
  end if;

  with scoped as (
    select item.*
    from private.get_compliance_dashboard_rows(
      p_organization_id,
      p_release_id,
      p_status,
      200,
      0
    ) as item
    join public.shipments as shipment
      on shipment.organization_id = p_organization_id
     and shipment.brand_id = p_brand_id
     and shipment.id = item.shipment_id
  ),
  paged as (
    select scoped.*, count(*) over() as scoped_total
    from scoped
    order by scoped.label_blocked desc, scoped.checked_at desc
    limit p_limit offset p_offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(paged) - 'scoped_total'), '[]'::jsonb),
    coalesce(max(paged.scoped_total), 0)
  into v_items, v_total
  from paged;

  select jsonb_build_object(
    'totalChecks', count(compliance.id),
    'compliant', count(compliance.id) filter (where compliance.status = 'compliant'),
    'nonCompliant', count(compliance.id) filter (where compliance.status = 'non_compliant'),
    'unknown', count(*) filter (where compliance.id is null or compliance.status = 'unknown'),
    'taxEstimateCents', coalesce(sum(compliance.tax_estimate_cents), 0)
  )
  into v_summary
  from public.shipments as shipment
  left join public.compliance_checks as compliance
    on compliance.organization_id = shipment.organization_id
   and compliance.brand_id = shipment.brand_id
   and compliance.id = shipment.latest_compliance_check_id
  where shipment.organization_id = p_organization_id
    and shipment.brand_id = p_brand_id
    and (p_release_id is null or shipment.release_id = p_release_id);

  return jsonb_build_object(
    'summary', v_summary,
    'items', v_items,
    'total', v_total,
    'providerStatus', jsonb_build_object(
      'provider', 'shipcompliant',
      'lastCheckedAt', (
        select max(check_result.checked_at)
        from public.compliance_checks as check_result
        where check_result.organization_id = p_organization_id
          and check_result.brand_id = p_brand_id
          and check_result.provider = 'shipcompliant'
      ),
      'liveChecks', (
        select count(*)
        from public.compliance_checks as check_result
        where check_result.organization_id = p_organization_id
          and check_result.brand_id = p_brand_id
          and check_result.provider = 'shipcompliant'
      ),
      'simulatedChecks', (
        select count(*)
        from public.compliance_checks as check_result
        where check_result.organization_id = p_organization_id
          and check_result.brand_id = p_brand_id
          and check_result.provider = 'simulated'
      )
    )
  );
end;
$$;

create or replace function public.apply_brand_subscription_event(
  p_stripe_event_id text,
  p_event_type text,
  p_organization_id uuid,
  p_brand_id uuid,
  p_stripe_customer_id text,
  p_event_created_at timestamptz,
  p_payload jsonb,
  p_livemode boolean default false,
  p_stripe_subscription_id text default null,
  p_subscription_status public.subscription_status default null,
  p_plan_tier public.plan_tier default null
)
returns table (
  duplicate boolean,
  organization_id uuid,
  brand_id uuid,
  access_status public.organization_access_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand public.brands%rowtype;
  v_event_id uuid;
  v_status public.subscription_status;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_event_type not in (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported Stripe event type.';
  end if;
  if p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
    or jsonb_typeof(p_payload) is distinct from 'object'
    or coalesce((p_payload ->> 'livemode')::boolean, false) is distinct from p_livemode
  then
    raise exception using errcode = '22023', message = 'Invalid Stripe event envelope.';
  end if;

  select brand.*
  into v_brand
  from public.brands as brand
  where brand.organization_id = p_organization_id
    and brand.id = p_brand_id
    and brand.billing_mode = 'independent'
    and (
      brand.stripe_customer_id = p_stripe_customer_id
      or (
        p_stripe_subscription_id is not null
        and brand.stripe_subscription_id = p_stripe_subscription_id
      )
    )
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No independent brand matches the Stripe customer or subscription.';
  end if;

  insert into public.subscription_events (
    organization_id,
    brand_id,
    event_type,
    stripe_event_id,
    stripe_created_at,
    livemode,
    payload
  )
  values (
    p_organization_id,
    p_brand_id,
    p_event_type,
    p_stripe_event_id,
    p_event_created_at,
    p_livemode,
    p_payload
  )
  on conflict (stripe_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return query
    select true, v_brand.organization_id, v_brand.id, v_brand.access_status;
    return;
  end if;
  if v_brand.stripe_state_updated_at is not null
    and p_event_created_at < v_brand.stripe_state_updated_at
  then
    update public.subscription_events
    set processing_status = 'ignored',
        ignored_reason = 'older_than_current_stripe_state',
        processed_at = now()
    where id = v_event_id;
    return query
    select false, v_brand.organization_id, v_brand.id, v_brand.access_status;
    return;
  end if;

  v_status := case p_event_type
    when 'customer.subscription.deleted' then 'canceled'::public.subscription_status
    when 'invoice.payment_succeeded' then
      coalesce(p_subscription_status, 'active'::public.subscription_status)
    when 'invoice.payment_failed' then
      coalesce(p_subscription_status, 'past_due'::public.subscription_status)
    else coalesce(p_subscription_status, v_brand.subscription_status)
  end;

  update public.brands as target_brand
  set
    stripe_customer_id = coalesce(
      nullif(btrim(p_stripe_customer_id), ''),
      target_brand.stripe_customer_id
    ),
    stripe_subscription_id = coalesce(
      nullif(btrim(p_stripe_subscription_id), ''),
      target_brand.stripe_subscription_id
    ),
    subscription_status = v_status,
    plan_tier = coalesce(p_plan_tier, target_brand.plan_tier),
    payment_failed_at = case
      when v_status in ('past_due', 'unpaid')
        then coalesce(target_brand.payment_failed_at, p_event_created_at)
      else null
    end,
    access_status = case
      when v_status in ('active', 'trialing')
        then 'active'::public.organization_access_status
      when v_status in ('past_due', 'unpaid')
        then 'grace'::public.organization_access_status
      when v_status in ('canceled', 'incomplete_expired', 'paused')
        then 'suspended'::public.organization_access_status
      else 'onboarding'::public.organization_access_status
    end,
    stripe_state_updated_at = p_event_created_at
  where target_brand.id = p_brand_id
    and target_brand.organization_id = p_organization_id
  returning target_brand.access_status into access_status;

  update public.subscription_events
  set processing_status = 'applied', processed_at = now()
  where id = v_event_id;

  duplicate := false;
  organization_id := p_organization_id;
  brand_id := p_brand_id;
  return next;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'members',
    'subscription_events',
    'club_tiers',
    'releases',
    'release_tiers',
    'release_wines',
    'release_tier_items',
    'shipments',
    'shipment_items',
    'billing_attempts',
    'member_imports',
    'member_import_rows',
    'audit_log',
    'email_templates',
    'member_email_preferences',
    'email_log',
    'email_outbox',
    'email_delivery_events',
    'email_unsubscribe_tokens',
    'churn_scores',
    'cancel_flow_steps',
    'cancel_flow_attempts',
    'cancel_flow_events',
    'member_activity_events',
    'loyalty_tier_multipliers',
    'loyalty_redemptions',
    'loyalty_ledger',
    'loyalty_point_lots',
    'loyalty_reservation_allocations',
    'analytics_events',
    'dashboard_layout_preferences',
    'analytics_report_schedules',
    'ml_feature_snapshots',
    'ml_training_rows',
    'ml_churn_predictions',
    'ml_high_risk_alerts',
    'compliance_checks',
    'shipping_label_attempts'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'create policy %I on public.%I as restrictive
       for all to authenticated
       using (private.can_access_brand(organization_id, brand_id))
       with check (private.can_access_brand(organization_id, brand_id))',
      v_table || '_brand_boundary',
      v_table
    );
  end loop;
end;
$$;

-- Member lists are a hot path. Resolve the JWT principal and accessible brand
-- set as init plans once per statement, rather than executing security-definer
-- lookups once for every member row.
alter policy members_staff_select
  on public.members
  using (
    organization_id = (select auth.org_id())
    and (
      select private.is_staff_for_org((select auth.org_id()))
    )
  );
alter policy members_member_select
  on public.members
  using (
    organization_id = (select auth.org_id())
    and auth_user_id = (select auth.uid())
    and (
      select private.is_member_for_org(
        (select auth.org_id()),
        (select auth.uid())
      )
    )
  );
alter policy members_member_update
  on public.members
  using (
    organization_id = (select auth.org_id())
    and auth_user_id = (select auth.uid())
    and (
      select private.is_member_for_org(
        (select auth.org_id()),
        (select auth.uid())
      )
    )
  )
  with check (
    organization_id = (select auth.org_id())
    and auth_user_id = (select auth.uid())
    and (
      select private.is_member_for_org(
        (select auth.org_id()),
        (select auth.uid())
      )
    )
  );
drop policy members_brand_boundary on public.members;
create policy members_brand_boundary
  on public.members as restrictive
  for all to authenticated
  using (
    brand_id in (
      select unnest(private.current_brand_access_ids())
    )
  )
  with check (
    brand_id in (
      select unnest(private.current_brand_access_ids())
    )
  );

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'brand_analytics_daily_metrics',
    'integration_connections',
    'integration_sync_jobs',
    'integration_sync_logs',
    'klaviyo_field_mappings',
    'klaviyo_profile_mappings',
    'klaviyo_engagement_events',
    'quickbooks_account_mappings',
    'quickbooks_transaction_mappings',
    'quickbooks_reconciliations',
    'avalara_exemptions',
    'avalara_tax_calculations',
    'meta_conversion_events',
    'brand_custom_domains',
    'brand_sender_identities',
    'mobile_deep_link_routes'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'create policy %I on public.%I
       for all to authenticated
       using (
         private.is_staff_for_org(organization_id)
         and private.can_access_brand(organization_id, brand_id)
       )
       with check (
         private.is_staff_for_org(organization_id)
         and private.can_access_brand(organization_id, brand_id)
       )',
      v_table || '_staff_brand_access',
      v_table
    );
  end loop;
end;
$$;

alter table public.organization_staff_access enable row level security;
alter table public.organization_staff_access force row level security;
create policy organization_staff_access_admin_policy
  on public.organization_staff_access
  for all to authenticated
  using (
    private.is_staff_for_org(
      organization_id,
      array['owner', 'admin']::public.staff_role[]
    )
  )
  with check (
    private.is_staff_for_org(
      organization_id,
      array['owner', 'admin']::public.staff_role[]
    )
  );

alter table public.staff_brand_access enable row level security;
alter table public.staff_brand_access force row level security;
create policy staff_brand_access_admin_policy
  on public.staff_brand_access
  for all to authenticated
  using (private.can_manage_brand(organization_id, brand_id))
  with check (private.can_manage_brand(organization_id, brand_id));

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'member_integration_consents',
    'mobile_devices',
    'mobile_push_outbox',
    'mobile_offline_snapshots',
    'mobile_offline_mutations'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'create policy %I on public.%I
       for all to authenticated
       using (
         (
           private.is_staff_for_org(organization_id)
           and private.can_access_brand(organization_id, brand_id)
         )
         or exists (
           select 1 from public.members as member_scope
           where member_scope.id = member_id
             and member_scope.organization_id = organization_id
             and member_scope.brand_id = brand_id
             and member_scope.auth_user_id = auth.uid()
         )
       )
       with check (
         (
           private.is_staff_for_org(organization_id)
           and private.can_access_brand(organization_id, brand_id)
         )
         or exists (
           select 1 from public.members as member_scope
           where member_scope.id = member_id
             and member_scope.organization_id = organization_id
             and member_scope.brand_id = brand_id
             and member_scope.auth_user_id = auth.uid()
         )
       )',
      v_table || '_staff_or_member_policy',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'integration_secrets',
    'mobile_device_secrets',
    'mobile_auth_exchange_tokens',
    'mobile_refresh_sessions'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
  end loop;
end;
$$;

commit;
