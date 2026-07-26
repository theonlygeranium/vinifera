begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.plan_tier as enum (
  'vine',
  'cellar',
  'estate',
  'reserve'
);

create type public.staff_role as enum (
  'owner',
  'admin',
  'manager',
  'staff'
);

create type public.staff_user_status as enum (
  'active',
  'suspended'
);

create type public.member_status as enum (
  'active',
  'paused',
  'cancelled'
);

create type public.platform_role as enum (
  'super_admin'
);

create type public.auth_surface as enum (
  'staff',
  'member',
  'platform'
);

create type public.subscription_status as enum (
  'not_started',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);

create type public.organization_access_status as enum (
  'onboarding',
  'active',
  'grace',
  'restricted',
  'suspended'
);

create type public.invite_status as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

create type public.subscription_event_status as enum (
  'received',
  'applied',
  'ignored'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_tier public.plan_tier not null,
  subscription_status public.subscription_status not null default 'not_started',
  access_status public.organization_access_status not null default 'onboarding',
  payment_failed_at timestamptz,
  grace_period_ends_at timestamptz,
  suspension_at timestamptz,
  restricted_at timestamptz,
  suspended_at timestamptz,
  stripe_state_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length
    check (char_length(btrim(name)) between 1 and 200),
  constraint organizations_stripe_customer_id_format
    check (
      stripe_customer_id is null
      or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    ),
  constraint organizations_stripe_subscription_id_format
    check (
      stripe_subscription_id is null
      or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
    ),
  constraint organizations_billing_window_order
    check (
      (
        payment_failed_at is null
        and grace_period_ends_at is null
        and suspension_at is null
      )
      or (
        payment_failed_at is not null
        and grace_period_ends_at is not null
        and suspension_at is not null
        and payment_failed_at <= grace_period_ends_at
        and grace_period_ends_at <= suspension_at
      )
    )
);

create unique index organizations_stripe_customer_id_uidx
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index organizations_stripe_subscription_id_uidx
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index organizations_access_status_idx
  on public.organizations (access_status);

create table public.staff_users (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  email text not null,
  role public.staff_role not null,
  status public.staff_user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_users_email_normalized
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    )
);

create unique index staff_users_email_uidx
  on public.staff_users (email);

create index staff_users_organization_id_idx
  on public.staff_users (organization_id);

create index staff_users_organization_role_idx
  on public.staff_users (organization_id, role);

alter table public.staff_users
  add constraint staff_users_organization_id_id_key
  unique (organization_id, id);

create unique index staff_users_one_owner_per_organization_uidx
  on public.staff_users (organization_id)
  where role = 'owner' and status = 'active';

create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint members_email_normalized
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    ),
  constraint members_first_name_length
    check (char_length(first_name) <= 100),
  constraint members_last_name_length
    check (char_length(last_name) <= 100)
);

create unique index members_email_uidx
  on public.members (email);

create index members_organization_id_idx
  on public.members (organization_id);

create index members_organization_status_idx
  on public.members (organization_id, status);

create table public.platform_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role public.platform_role not null default 'super_admin',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_users_email_normalized
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    )
);

create unique index platform_users_email_uidx
  on public.platform_users (email);

create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  email text not null,
  role public.staff_role not null,
  token_hash text not null,
  status public.invite_status not null default 'pending',
  invited_by uuid,
  accepted_by uuid,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invites_cannot_invite_owner
    check (role <> 'owner'),
  constraint organization_invites_email_normalized
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    ),
  constraint organization_invites_token_hash_format
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint organization_invites_expiry_after_creation
    check (expires_at > created_at),
  constraint organization_invites_acceptance_consistent
    check (
      (status = 'accepted' and accepted_by is not null and accepted_at is not null)
      or
      (status <> 'accepted' and accepted_by is null and accepted_at is null)
    ),
  constraint organization_invites_invited_by_same_org_fkey
    foreign key (organization_id, invited_by)
    references public.staff_users (organization_id, id)
    on delete set null (invited_by),
  constraint organization_invites_accepted_by_same_org_fkey
    foreign key (organization_id, accepted_by)
    references public.staff_users (organization_id, id)
    on delete set null (accepted_by)
);

create unique index organization_invites_token_hash_uidx
  on public.organization_invites (token_hash);

create unique index organization_invites_pending_org_email_uidx
  on public.organization_invites (organization_id, email)
  where status = 'pending';

create index organization_invites_organization_id_idx
  on public.organization_invites (organization_id);

create index organization_invites_invited_by_idx
  on public.organization_invites (invited_by)
  where invited_by is not null;

create index organization_invites_accepted_by_idx
  on public.organization_invites (accepted_by)
  where accepted_by is not null;

create index organization_invites_pending_expiry_idx
  on public.organization_invites (expires_at)
  where status = 'pending';

create table public.member_magic_link_requests (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  allowed boolean not null,
  created_at timestamptz not null default now(),
  constraint member_magic_link_requests_email_hash_format
    check (email_hash ~ '^[a-f0-9]{64}$'),
  constraint member_magic_link_requests_ip_hash_format
    check (ip_hash ~ '^[a-f0-9]{64}$')
);

create index member_magic_link_requests_email_window_idx
  on public.member_magic_link_requests (email_hash, created_at desc)
  where allowed;

create index member_magic_link_requests_ip_window_idx
  on public.member_magic_link_requests (ip_hash, created_at desc)
  where allowed;

create index member_magic_link_requests_created_at_idx
  on public.member_magic_link_requests (created_at);

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  event_type text not null,
  stripe_event_id text not null,
  stripe_created_at timestamptz not null,
  livemode boolean not null default false,
  payload jsonb not null,
  processing_status public.subscription_event_status not null default 'received',
  ignored_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint subscription_events_event_type_supported
    check (
      event_type in (
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_succeeded',
        'invoice.payment_failed'
      )
    ),
  constraint subscription_events_stripe_event_id_format
    check (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  constraint subscription_events_test_mode_only
    check (livemode = false),
  constraint subscription_events_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  constraint subscription_events_processing_consistent
    check (
      (processing_status = 'received' and processed_at is null)
      or
      (processing_status = 'applied' and processed_at is not null and ignored_reason is null)
      or
      (processing_status = 'ignored' and processed_at is not null and ignored_reason is not null)
    )
);

create unique index subscription_events_stripe_event_id_uidx
  on public.subscription_events (stripe_event_id);

create index subscription_events_organization_id_idx
  on public.subscription_events (organization_id);

create index subscription_events_org_created_idx
  on public.subscription_events (organization_id, stripe_created_at desc);

create index subscription_events_processing_status_idx
  on public.subscription_events (processing_status, created_at)
  where processing_status = 'received';

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch_updated_at
before update on public.organizations
for each row execute function private.touch_updated_at();

create trigger staff_users_touch_updated_at
before update on public.staff_users
for each row execute function private.touch_updated_at();

create trigger members_touch_updated_at
before update on public.members
for each row execute function private.touch_updated_at();

create trigger platform_users_touch_updated_at
before update on public.platform_users
for each row execute function private.touch_updated_at();

create trigger organization_invites_touch_updated_at
before update on public.organization_invites
for each row execute function private.touch_updated_at();

create or replace function private.expire_previous_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organization_invites as i
  set status = 'expired'
  where i.organization_id = new.organization_id
    and i.email = new.email
    and i.status = 'pending'
    and i.expires_at <= now();

  return new;
end;
$$;

create trigger organization_invites_expire_previous
before insert on public.organization_invites
for each row execute function private.expire_previous_invites();

create or replace function private.sync_organization_access_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subscription_status in ('active', 'trialing') then
    new.access_status := 'active';
    new.payment_failed_at := null;
    new.grace_period_ends_at := null;
    new.suspension_at := null;
    new.restricted_at := null;
    new.suspended_at := null;
  elsif new.subscription_status in ('past_due', 'unpaid') then
    new.payment_failed_at := coalesce(new.payment_failed_at, now());
    new.grace_period_ends_at :=
      coalesce(new.grace_period_ends_at, new.payment_failed_at + interval '7 days');
    new.suspension_at :=
      coalesce(new.suspension_at, new.payment_failed_at + interval '14 days');

    if now() >= new.suspension_at then
      new.access_status := 'suspended';
      new.suspended_at := coalesce(new.suspended_at, new.suspension_at);
      new.restricted_at := coalesce(new.restricted_at, new.grace_period_ends_at);
    elsif now() >= new.grace_period_ends_at then
      new.access_status := 'restricted';
      new.restricted_at := coalesce(new.restricted_at, new.grace_period_ends_at);
      new.suspended_at := null;
    else
      new.access_status := 'grace';
      new.restricted_at := null;
      new.suspended_at := null;
    end if;
  elsif new.subscription_status in ('canceled', 'incomplete_expired', 'paused') then
    new.access_status := 'suspended';
    new.suspended_at := coalesce(new.suspended_at, now());
  else
    new.access_status := 'onboarding';
    new.payment_failed_at := null;
    new.grace_period_ends_at := null;
    new.suspension_at := null;
    new.restricted_at := null;
    new.suspended_at := null;
  end if;

  return new;
end;
$$;

create trigger organizations_sync_access_state
before insert or update of subscription_status, payment_failed_at,
  grace_period_ends_at, suspension_at
on public.organizations
for each row execute function private.sync_organization_access_state();

create or replace function private.enforce_single_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
  v_conflict boolean;
begin
  if tg_table_name = 'members' then
    v_auth_user_id := nullif(to_jsonb(new) ->> 'auth_user_id', '')::uuid;
  else
    v_auth_user_id := (to_jsonb(new) ->> 'id')::uuid;
  end if;

  if v_auth_user_id is null then
    return new;
  end if;

  if tg_table_name = 'staff_users' then
    select
      exists (
        select 1
        from public.members as m
        where m.auth_user_id = v_auth_user_id
      )
      or exists (
        select 1
        from public.platform_users as p
        where p.id = v_auth_user_id
      )
    into v_conflict;
  elsif tg_table_name = 'members' then
    select
      exists (
        select 1
        from public.staff_users as s
        where s.id = v_auth_user_id
      )
      or exists (
        select 1
        from public.platform_users as p
        where p.id = v_auth_user_id
      )
    into v_conflict;
  else
    select
      exists (
        select 1
        from public.staff_users as s
        where s.id = v_auth_user_id
      )
      or exists (
        select 1
        from public.members as m
        where m.auth_user_id = v_auth_user_id
      )
    into v_conflict;
  end if;

  if v_conflict then
    raise exception using
      errcode = '23514',
      message = 'An auth user can belong to only one Vinifera auth surface.';
  end if;

  return new;
end;
$$;

create trigger staff_users_single_auth_profile
before insert or update of id on public.staff_users
for each row execute function private.enforce_single_auth_profile();

create trigger members_single_auth_profile
before insert or update of auth_user_id on public.members
for each row execute function private.enforce_single_auth_profile();

create trigger platform_users_single_auth_profile
before insert or update of id on public.platform_users
for each row execute function private.enforce_single_auth_profile();

create or replace function auth.org_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claim text;
begin
  v_claim := auth.jwt() ->> 'organization_id';

  if v_claim is null
    or v_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return null;
  end if;

  return v_claim::uuid;
end;
$$;

create or replace function auth.user_role()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() ->> 'user_role';
$$;

create or replace function auth.auth_surface()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() ->> 'auth_surface';
$$;

create or replace function auth.platform_role()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() ->> 'platform_role';
$$;

create or replace function private.is_staff_for_org(
  p_organization_id uuid,
  p_roles public.staff_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.auth_surface() = 'staff'
    and auth.org_id() = p_organization_id
    and exists (
      select 1
      from public.staff_users as s
      where s.id = auth.uid()
        and s.organization_id = p_organization_id
        and s.status = 'active'
        and s.role::text = auth.user_role()
        and (p_roles is null or s.role = any (p_roles))
    );
$$;

create or replace function private.is_member_for_org(
  p_organization_id uuid,
  p_auth_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.auth_surface() = 'member'
    and auth.user_role() = 'member'
    and auth.org_id() = p_organization_id
    and auth.uid() = p_auth_user_id
    and exists (
      select 1
      from public.members as m
      where m.auth_user_id = auth.uid()
        and m.organization_id = p_organization_id
    );
$$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.auth_surface() = 'platform'
    and auth.platform_role() = 'super_admin'
    and exists (
      select 1
      from public.platform_users as p
      where p.id = auth.uid()
        and p.role = 'super_admin'
        and p.active
    );
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_claims jsonb;
  v_organization_id uuid;
  v_user_role text;
  v_auth_surface text;
  v_platform_role text;
  v_profile_count integer;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  select count(*)
  into v_profile_count
  from (
    select s.id
    from public.staff_users as s
    where s.id = v_user_id and s.status = 'active'
    union all
    select m.auth_user_id
    from public.members as m
    where m.auth_user_id = v_user_id
    union all
    select p.id
    from public.platform_users as p
    where p.id = v_user_id and p.active
  ) as profiles;

  if v_profile_count > 1 then
    raise exception using
      errcode = '23514',
      message = 'Multiple Vinifera auth profiles exist for this user.';
  end if;

  select
    s.organization_id,
    s.role::text,
    'staff'
  into
    v_organization_id,
    v_user_role,
    v_auth_surface
  from public.staff_users as s
  where s.id = v_user_id
    and s.status = 'active';

  if not found then
    select
      m.organization_id,
      'member',
      'member'
    into
      v_organization_id,
      v_user_role,
      v_auth_surface
    from public.members as m
    where m.auth_user_id = v_user_id;
  end if;

  if not found then
    select
      null::uuid,
      p.role::text,
      'platform',
      p.role::text
    into
      v_organization_id,
      v_user_role,
      v_auth_surface,
      v_platform_role
    from public.platform_users as p
    where p.id = v_user_id
      and p.active;
  end if;

  v_claims := jsonb_set(
    v_claims,
    '{organization_id}',
    coalesce(to_jsonb(v_organization_id::text), 'null'::jsonb),
    true
  );
  v_claims := jsonb_set(
    v_claims,
    '{user_role}',
    coalesce(to_jsonb(v_user_role), 'null'::jsonb),
    true
  );
  v_claims := jsonb_set(
    v_claims,
    '{auth_surface}',
    coalesce(to_jsonb(v_auth_surface), 'null'::jsonb),
    true
  );
  v_claims := jsonb_set(
    v_claims,
    '{platform_role}',
    coalesce(to_jsonb(v_platform_role), 'null'::jsonb),
    true
  );
  v_claims := jsonb_set(v_claims, '{vinifera_claims_version}', '1'::jsonb, true);

  return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;

create or replace function public.bootstrap_organization(
  p_owner_user_id uuid,
  p_owner_email text,
  p_organization_name text,
  p_plan_tier public.plan_tier,
  p_stripe_customer_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_auth_email text;
  v_existing_organization_id uuid;
  v_organization_id uuid;
begin
  v_email := lower(btrim(p_owner_email));

  if p_owner_user_id is null then
    raise exception using errcode = '22023', message = 'owner_user_id is required';
  end if;

  if char_length(v_email) not between 3 and 320
    or position('@' in v_email) <= 1
  then
    raise exception using errcode = '22023', message = 'owner_email is invalid';
  end if;

  if char_length(btrim(p_organization_name)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'organization_name is invalid';
  end if;

  select lower(u.email)
  into v_auth_email
  from auth.users as u
  where u.id = p_owner_user_id;

  if not found or v_auth_email is distinct from v_email then
    raise exception using
      errcode = '22023',
      message = 'owner_user_id and owner_email do not identify the same auth user';
  end if;

  select s.organization_id
  into v_existing_organization_id
  from public.staff_users as s
  where s.id = p_owner_user_id;

  if found then
    if exists (
      select 1
      from public.staff_users as s
      where s.id = p_owner_user_id
        and s.email = v_email
        and s.role = 'owner'
    ) then
      return v_existing_organization_id;
    end if;

    raise exception using
      errcode = '23505',
      message = 'owner_user_id already has a non-owner staff profile';
  end if;

  insert into public.organizations (
    name,
    plan_tier,
    stripe_customer_id
  )
  values (
    btrim(p_organization_name),
    p_plan_tier,
    nullif(btrim(p_stripe_customer_id), '')
  )
  returning id into v_organization_id;

  insert into public.staff_users (
    id,
    organization_id,
    email,
    role
  )
  values (
    p_owner_user_id,
    v_organization_id,
    v_email,
    'owner'
  );

  return v_organization_id;
end;
$$;

create or replace function public.record_magic_link_request(
  p_normalized_email text,
  p_ip_hash text
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_email_hash text;
  v_ip_hash text;
  v_email_count integer;
  v_ip_count integer;
  v_email_retry_at timestamptz;
  v_ip_retry_at timestamptz;
  v_retry_at timestamptz;
  v_allowed boolean;
begin
  v_email := lower(btrim(p_normalized_email));
  v_ip_hash := lower(btrim(p_ip_hash));

  if char_length(v_email) not between 3 and 320
    or position('@' in v_email) <= 1
  then
    raise exception using errcode = '22023', message = 'normalized_email is invalid';
  end if;

  if v_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'ip_hash must be a SHA-256 hex digest';
  end if;

  v_email_hash := encode(
    extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_email_hash, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_ip_hash, 1)
  );

  select count(*), min(r.created_at) + interval '1 hour'
  into v_email_count, v_email_retry_at
  from public.member_magic_link_requests as r
  where r.email_hash = v_email_hash
    and r.allowed
    and r.created_at > now() - interval '1 hour';

  select count(*), min(r.created_at) + interval '1 hour'
  into v_ip_count, v_ip_retry_at
  from public.member_magic_link_requests as r
  where r.ip_hash = v_ip_hash
    and r.allowed
    and r.created_at > now() - interval '1 hour';

  v_allowed := v_email_count < 5 and v_ip_count < 25;

  if not v_allowed then
    v_retry_at := greatest(
      case when v_email_count >= 5 then v_email_retry_at end,
      case when v_ip_count >= 25 then v_ip_retry_at end
    );
  end if;

  insert into public.member_magic_link_requests (
    email_hash,
    ip_hash,
    allowed
  )
  values (
    v_email_hash,
    v_ip_hash,
    v_allowed
  );

  allowed := v_allowed;
  retry_after_seconds := case
    when v_allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (v_retry_at - now())))::integer
    )
  end;

  return next;
end;
$$;

create or replace function public.complete_staff_invite(
  p_email text,
  p_invite_token text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_auth_email text;
  v_invite_token text;
  v_token_hash text;
  v_invite public.organization_invites%rowtype;
  v_existing_organization_id uuid;
begin
  v_email := lower(btrim(p_email));

  select
    lower(u.email),
    coalesce(
      nullif(btrim(p_invite_token), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'invite_token'), '')
    )
  into
    v_auth_email,
    v_invite_token
  from auth.users as u
  where u.id = p_user_id;

  if not found or v_auth_email is distinct from v_email then
    raise exception using
      errcode = '22023',
      message = 'user_id and email do not identify the same auth user';
  end if;

  select s.organization_id
  into v_existing_organization_id
  from public.staff_users as s
  where s.id = p_user_id
    and s.email = v_email;

  if found then
    return v_existing_organization_id;
  end if;

  if v_invite_token is null then
    raise exception using errcode = '22023', message = 'invite token is required';
  end if;

  v_token_hash := encode(
    extensions.digest(convert_to(v_invite_token, 'UTF8'), 'sha256'),
    'hex'
  );

  select i.*
  into v_invite
  from public.organization_invites as i
  where i.email = v_email
    and i.token_hash = v_token_hash
    and i.status = 'pending'
    and i.expires_at > now()
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'invitation is invalid or expired';
  end if;

  insert into public.staff_users (
    id,
    organization_id,
    email,
    role
  )
  values (
    p_user_id,
    v_invite.organization_id,
    v_email,
    v_invite.role
  );

  update public.organization_invites
  set
    status = 'accepted',
    accepted_by = p_user_id,
    accepted_at = now()
  where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;

create or replace function public.apply_subscription_event(
  p_stripe_event_id text,
  p_event_type text,
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
  access_status public.organization_access_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization public.organizations%rowtype;
  v_event_id uuid;
  v_new_subscription_status public.subscription_status;
begin
  if p_livemode then
    raise exception using
      errcode = '22023',
      message = 'Live-mode Stripe events are disabled through Phase 4.';
  end if;

  if coalesce((p_payload ->> 'livemode')::boolean, false) then
    raise exception using
      errcode = '22023',
      message = 'Live-mode Stripe payloads are disabled through Phase 4.';
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

  if p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'Invalid Stripe event identifier.';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Stripe event payload must be an object.';
  end if;

  select o.*
  into v_organization
  from public.organizations as o
  where o.stripe_customer_id = p_stripe_customer_id
    or (
      p_stripe_subscription_id is not null
      and o.stripe_subscription_id = p_stripe_subscription_id
    )
  order by
    case when o.stripe_customer_id = p_stripe_customer_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No organization matches the Stripe customer or subscription.';
  end if;

  insert into public.subscription_events (
    organization_id,
    event_type,
    stripe_event_id,
    stripe_created_at,
    livemode,
    payload
  )
  values (
    v_organization.id,
    p_event_type,
    p_stripe_event_id,
    p_event_created_at,
    p_livemode,
    p_payload
  )
  on conflict (stripe_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    duplicate := true;
    organization_id := v_organization.id;
    access_status := v_organization.access_status;
    return next;
    return;
  end if;

  if v_organization.stripe_state_updated_at is not null
    and p_event_created_at < v_organization.stripe_state_updated_at
  then
    update public.subscription_events
    set
      processing_status = 'ignored',
      ignored_reason = 'older_than_current_stripe_state',
      processed_at = now()
    where id = v_event_id;

    duplicate := false;
    organization_id := v_organization.id;
    access_status := v_organization.access_status;
    return next;
    return;
  end if;

  v_new_subscription_status := case p_event_type
    when 'customer.subscription.deleted' then 'canceled'::public.subscription_status
    when 'invoice.payment_succeeded' then
      coalesce(p_subscription_status, 'active'::public.subscription_status)
    when 'invoice.payment_failed' then
      coalesce(p_subscription_status, 'past_due'::public.subscription_status)
    else coalesce(p_subscription_status, v_organization.subscription_status)
  end;

  update public.organizations
  set
    stripe_subscription_id = coalesce(
      nullif(btrim(p_stripe_subscription_id), ''),
      stripe_subscription_id
    ),
    plan_tier = coalesce(p_plan_tier, plan_tier),
    subscription_status = v_new_subscription_status,
    payment_failed_at = case
      when v_new_subscription_status in ('past_due', 'unpaid')
        then coalesce(payment_failed_at, p_event_created_at)
      else payment_failed_at
    end,
    stripe_state_updated_at = p_event_created_at
  where id = v_organization.id
  returning public.organizations.access_status into access_status;

  update public.subscription_events
  set
    processing_status = 'applied',
    processed_at = now()
  where id = v_event_id;

  duplicate := false;
  organization_id := v_organization.id;
  return next;
end;
$$;

create or replace function public.reconcile_subscription_access(
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_changed integer;
  v_restored integer;
begin
  if p_as_of is null then
    raise exception using errcode = '22023', message = 'p_as_of cannot be null';
  end if;

  with desired as (
    select
      o.id,
      case
        when o.subscription_status in ('active', 'trialing')
          then 'active'::public.organization_access_status
        when o.subscription_status in ('past_due', 'unpaid')
          and p_as_of >= o.suspension_at
          then 'suspended'::public.organization_access_status
        when o.subscription_status in ('past_due', 'unpaid')
          and p_as_of >= o.grace_period_ends_at
          then 'restricted'::public.organization_access_status
        when o.subscription_status in ('past_due', 'unpaid')
          then 'grace'::public.organization_access_status
        when o.subscription_status in ('canceled', 'incomplete_expired', 'paused')
          then 'suspended'::public.organization_access_status
        else 'onboarding'::public.organization_access_status
      end as access_status
    from public.organizations as o
  )
  update public.organizations as o
  set
    access_status = d.access_status,
    restricted_at = case
      when d.access_status in ('restricted', 'suspended')
        then coalesce(o.restricted_at, o.grace_period_ends_at, p_as_of)
      else null
    end,
    suspended_at = case
      when d.access_status = 'suspended'
        then coalesce(o.suspended_at, o.suspension_at, p_as_of)
      else null
    end
  from desired as d
  where o.id = d.id
    and o.subscription_status not in ('active', 'trialing')
    and (
      o.access_status is distinct from d.access_status
      or (
        d.access_status in ('restricted', 'suspended')
        and o.restricted_at is null
      )
      or (
        d.access_status = 'suspended'
        and o.suspended_at is null
      )
    );

  get diagnostics v_access_changed = row_count;

  update public.organizations as o
  set
    access_status = 'active',
    payment_failed_at = null,
    grace_period_ends_at = null,
    suspension_at = null,
    restricted_at = null,
    suspended_at = null
  where o.subscription_status in ('active', 'trialing')
    and (
      o.access_status <> 'active'
      or o.payment_failed_at is not null
      or o.grace_period_ends_at is not null
      or o.suspension_at is not null
      or o.restricted_at is not null
      or o.suspended_at is not null
    );

  get diagnostics v_restored = row_count;
  return v_access_changed + v_restored;
end;
$$;

alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.staff_users enable row level security;
alter table public.staff_users force row level security;
alter table public.members enable row level security;
alter table public.members force row level security;
alter table public.platform_users enable row level security;
alter table public.platform_users force row level security;
alter table public.organization_invites enable row level security;
alter table public.organization_invites force row level security;
alter table public.member_magic_link_requests enable row level security;
alter table public.member_magic_link_requests force row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_events force row level security;

create policy organizations_staff_select
on public.organizations
for select
to authenticated
using ((select private.is_staff_for_org(id)));

create policy organizations_member_select
on public.organizations
for select
to authenticated
using ((select private.is_member_for_org(id, auth.uid())));

create policy organizations_super_admin_all
on public.organizations
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy staff_users_staff_select
on public.staff_users
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy staff_users_super_admin_all
on public.staff_users
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy members_staff_select
on public.members
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy members_member_select
on public.members
for select
to authenticated
using ((select private.is_member_for_org(organization_id, auth_user_id)));

create policy members_super_admin_all
on public.members
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy platform_users_self_select
on public.platform_users
for select
to authenticated
using (
  id = (select auth.uid())
  and (select private.is_super_admin())
);

create policy platform_users_super_admin_all
on public.platform_users
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy organization_invites_staff_select
on public.organization_invites
for select
to authenticated
using (
  (select private.is_staff_for_org(
    organization_id,
    array['owner', 'admin']::public.staff_role[]
  ))
);

create policy organization_invites_super_admin_all
on public.organization_invites
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy subscription_events_staff_select
on public.subscription_events
for select
to authenticated
using (
  (select private.is_staff_for_org(
    organization_id,
    array['owner', 'admin']::public.staff_role[]
  ))
);

create policy subscription_events_super_admin_all
on public.subscription_events
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

revoke all on all tables in schema public from anon, authenticated;
grant select on table
  public.organizations,
  public.staff_users,
  public.members,
  public.platform_users,
  public.organization_invites,
  public.subscription_events
to authenticated;

grant all on table
  public.organizations,
  public.staff_users,
  public.members,
  public.platform_users,
  public.organization_invites,
  public.member_magic_link_requests,
  public.subscription_events
to service_role;

grant usage, select on all sequences in schema public to service_role;

revoke execute on function auth.org_id() from public, anon;
revoke execute on function auth.user_role() from public, anon;
revoke execute on function auth.auth_surface() from public, anon;
revoke execute on function auth.platform_role() from public, anon;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.org_id() to authenticated, service_role;
grant execute on function auth.user_role() to authenticated, service_role;
grant execute on function auth.auth_surface() to authenticated, service_role;
grant execute on function auth.platform_role() to authenticated, service_role;

grant usage on schema private to authenticated, service_role;
revoke execute on function private.is_staff_for_org(uuid, public.staff_role[])
  from public, anon;
revoke execute on function private.is_member_for_org(uuid, uuid)
  from public, anon;
revoke execute on function private.is_super_admin()
  from public, anon;
grant execute on function private.is_staff_for_org(uuid, public.staff_role[])
  to authenticated, service_role;
grant execute on function private.is_member_for_org(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.is_super_admin()
  to authenticated, service_role;

revoke execute on function public.custom_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;

revoke execute on function public.bootstrap_organization(
  uuid,
  text,
  text,
  public.plan_tier,
  text
) from public, anon, authenticated;
grant execute on function public.bootstrap_organization(
  uuid,
  text,
  text,
  public.plan_tier,
  text
) to service_role;

revoke execute on function public.record_magic_link_request(text, text)
  from public, anon, authenticated;
grant execute on function public.record_magic_link_request(text, text)
  to service_role;

revoke execute on function public.complete_staff_invite(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_staff_invite(text, text, uuid)
  to service_role;

revoke execute on function public.apply_subscription_event(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  boolean,
  text,
  public.subscription_status,
  public.plan_tier
) from public, anon, authenticated;
grant execute on function public.apply_subscription_event(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  boolean,
  text,
  public.subscription_status,
  public.plan_tier
) to service_role;

revoke execute on function public.reconcile_subscription_access(timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_subscription_access(timestamptz)
  to service_role;

commit;
