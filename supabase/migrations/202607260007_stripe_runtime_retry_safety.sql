create type public.stripe_customer_scope as enum (
  'organization',
  'brand',
  'member'
);

create type public.stripe_billing_operation as enum (
  'checkout',
  'staff_portal',
  'member_portal'
);

create type public.stripe_billing_attempt_status as enum (
  'claimed',
  'open',
  'awaiting_webhook',
  'completed',
  'expired',
  'failed'
);

create table public.stripe_customer_provisioning (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  scope public.stripe_customer_scope not null,
  subject_id uuid not null,
  brand_id uuid,
  member_id uuid,
  stripe_customer_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope, subject_id),
  constraint stripe_customer_provisioning_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint stripe_customer_provisioning_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint stripe_customer_provisioning_scope_target
    check (
      (
        scope = 'organization'
        and subject_id = organization_id
        and brand_id is null
        and member_id is null
      )
      or (
        scope = 'brand'
        and subject_id = brand_id
        and brand_id is not null
        and member_id is null
      )
      or (
        scope = 'member'
        and subject_id = member_id
        and brand_id is not null
        and member_id is not null
      )
    ),
  constraint stripe_customer_provisioning_customer_format
    check (
      stripe_customer_id is null
      or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    ),
  constraint stripe_customer_provisioning_lease_consistent
    check (
      (
        lease_token is null
        and lease_expires_at is null
      )
      or (
        lease_token is not null
        and lease_expires_at is not null
      )
    ),
  constraint stripe_customer_provisioning_link_consistent
    check (
      (stripe_customer_id is null and linked_at is null)
      or (stripe_customer_id is not null and linked_at is not null)
    ),
  constraint stripe_customer_provisioning_attempt_count
    check (attempt_count between 0 and 100)
);

create table public.stripe_billing_attempts (
  id uuid primary key,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  brand_id uuid not null,
  member_id uuid,
  billing_subject_id uuid not null,
  operation public.stripe_billing_operation not null,
  plan_tier public.plan_tier,
  provider_payload_key text not null,
  request_fingerprint text not null,
  status public.stripe_billing_attempt_status not null default 'claimed',
  stripe_customer_id text not null,
  provider_session_id text,
  stripe_subscription_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint stripe_billing_attempts_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint stripe_billing_attempts_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint stripe_billing_attempts_operation_shape
    check (
      (
        operation = 'checkout'
        and member_id is null
        and billing_subject_id in (organization_id, brand_id)
        and plan_tier is not null
      )
      or (
        operation = 'staff_portal'
        and member_id is null
        and billing_subject_id in (organization_id, brand_id)
        and plan_tier is null
      )
      or (
        operation = 'member_portal'
        and member_id is not null
        and billing_subject_id = member_id
        and plan_tier is null
      )
    ),
  constraint stripe_billing_attempts_fingerprint_format
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint stripe_billing_attempts_provider_payload_key_safe
    check (
      provider_payload_key ~ '^[A-Za-z0-9_.:-]{1,255}$'
      and provider_payload_key !~* '(email|name|phone|address)'
    ),
  constraint stripe_billing_attempts_customer_format
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  constraint stripe_billing_attempts_session_format
    check (
      provider_session_id is null
      or (
        operation = 'checkout'
        and provider_session_id ~ '^cs_[A-Za-z0-9_]+$'
      )
      or (
        operation in ('staff_portal', 'member_portal')
        and provider_session_id ~ '^bps_[A-Za-z0-9_]+$'
      )
    ),
  constraint stripe_billing_attempts_subscription_format
    check (
      stripe_subscription_id is null
      or (
        operation = 'checkout'
        and stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
      )
    ),
  constraint stripe_billing_attempts_lease_consistent
    check (
      (
        status = 'claimed'
        and lease_token is not null
        and lease_expires_at is not null
        and provider_session_id is null
        and completed_at is null
      )
      or (
        status = 'open'
        and operation = 'checkout'
        and provider_session_id is not null
        and stripe_subscription_id is null
        and lease_token is null
        and lease_expires_at is null
        and completed_at is null
      )
      or (
        status = 'awaiting_webhook'
        and operation = 'checkout'
        and provider_session_id is not null
        and stripe_subscription_id is null
        and lease_token is null
        and lease_expires_at is null
        and completed_at is null
      )
      or (
        status = 'completed'
        and (
          (operation = 'checkout' and stripe_subscription_id is not null)
          or (
            operation in ('staff_portal', 'member_portal')
            and stripe_subscription_id is null
          )
        )
        and lease_token is null
        and lease_expires_at is null
        and completed_at is not null
      )
      or (
        status in ('expired', 'failed')
        and lease_token is null
        and lease_expires_at is null
        and completed_at is not null
      )
    ),
  constraint stripe_billing_attempts_attempt_count
    check (attempt_count between 1 and 100)
);

create unique index stripe_billing_attempts_one_open_checkout_idx
  on public.stripe_billing_attempts (organization_id, billing_subject_id)
  where operation = 'checkout'
    and status in ('claimed', 'open', 'awaiting_webhook');

create index stripe_billing_attempts_recovery_idx
  on public.stripe_billing_attempts (lease_expires_at, id)
  where status = 'claimed';

alter table public.stripe_customer_provisioning enable row level security;
alter table public.stripe_customer_provisioning force row level security;
alter table public.stripe_billing_attempts enable row level security;
alter table public.stripe_billing_attempts force row level security;

create or replace function public.claim_stripe_customer_provisioning(
  p_organization_id uuid,
  p_scope public.stripe_customer_scope,
  p_subject_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_lease_token uuid
)
returns table (
  state text,
  stripe_customer_id text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id text;
  v_row public.stripe_customer_provisioning%rowtype;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_scope::text || ':' || p_subject_id::text, 0)
  );

  if p_scope = 'organization' then
    if p_subject_id <> p_organization_id
      or p_brand_id is not null
      or p_member_id is not null
    then
      raise exception using errcode = '22023', message = 'Invalid organization customer target.';
    end if;
    select organization.stripe_customer_id
    into v_customer_id
    from public.organizations as organization
    where organization.id = p_organization_id
    for update;
  elsif p_scope = 'brand' then
    if p_subject_id is distinct from p_brand_id or p_member_id is not null then
      raise exception using errcode = '22023', message = 'Invalid brand customer target.';
    end if;
    select brand.stripe_customer_id
    into v_customer_id
    from public.brands as brand
    where brand.organization_id = p_organization_id
      and brand.id = p_brand_id
      and brand.billing_mode = 'independent'
      and brand.active
    for update;
  else
    if p_subject_id is distinct from p_member_id
      or p_brand_id is null
      or p_member_id is null
    then
      raise exception using errcode = '22023', message = 'Invalid member customer target.';
    end if;
    select member.stripe_customer_id
    into v_customer_id
    from public.members as member
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id
    for update;
  end if;

  if not found then
    raise exception using errcode = 'P0002', message = 'Stripe customer target was not found.';
  end if;

  insert into public.stripe_customer_provisioning (
    organization_id,
    scope,
    subject_id,
    brand_id,
    member_id,
    stripe_customer_id,
    linked_at
  )
  values (
    p_organization_id,
    p_scope,
    p_subject_id,
    p_brand_id,
    p_member_id,
    v_customer_id,
    case when v_customer_id is null then null else now() end
  )
  on conflict (scope, subject_id) do nothing;

  select provisioning.*
  into v_row
  from public.stripe_customer_provisioning as provisioning
  where provisioning.scope = p_scope
    and provisioning.subject_id = p_subject_id
  for update;

  if v_customer_id is not null then
    update public.stripe_customer_provisioning
    set
      stripe_customer_id = v_customer_id,
      lease_token = null,
      lease_expires_at = null,
      linked_at = coalesce(linked_at, now()),
      updated_at = now()
    where id = v_row.id;
    return query select 'ready'::text, v_customer_id, null::uuid;
    return;
  end if;

  if v_row.stripe_customer_id is not null then
    if p_scope = 'organization' then
      update public.organizations
      set stripe_customer_id = coalesce(stripe_customer_id, v_row.stripe_customer_id)
      where id = p_organization_id
      returning public.organizations.stripe_customer_id into v_customer_id;
    elsif p_scope = 'brand' then
      update public.brands
      set stripe_customer_id = coalesce(stripe_customer_id, v_row.stripe_customer_id)
      where organization_id = p_organization_id
        and id = p_brand_id
        and billing_mode = 'independent'
      returning public.brands.stripe_customer_id into v_customer_id;
    else
      update public.members
      set stripe_customer_id = coalesce(stripe_customer_id, v_row.stripe_customer_id)
      where organization_id = p_organization_id
        and brand_id = p_brand_id
        and id = p_member_id
      returning public.members.stripe_customer_id into v_customer_id;
    end if;
    return query select 'ready'::text, v_customer_id, null::uuid;
    return;
  end if;

  update public.stripe_customer_provisioning
  set
    lease_token = p_lease_token,
    lease_expires_at = now() + interval '2 minutes',
    attempt_count = attempt_count + 1,
    updated_at = now()
  where id = v_row.id;

  return query select 'claimed'::text, null::text, p_lease_token;
end;
$$;

create or replace function public.finalize_stripe_customer_provisioning(
  p_organization_id uuid,
  p_scope public.stripe_customer_scope,
  p_subject_id uuid,
  p_lease_token uuid,
  p_stripe_customer_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical_customer_id text;
  v_row public.stripe_customer_provisioning%rowtype;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'Invalid Stripe customer identifier.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_scope::text || ':' || p_subject_id::text, 0)
  );
  select provisioning.*
  into v_row
  from public.stripe_customer_provisioning as provisioning
  where provisioning.organization_id = p_organization_id
    and provisioning.scope = p_scope
    and provisioning.subject_id = p_subject_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Stripe customer claim was not found.';
  end if;

  if p_scope = 'organization' then
    update public.organizations
    set stripe_customer_id = coalesce(stripe_customer_id, p_stripe_customer_id)
    where id = p_organization_id
    returning public.organizations.stripe_customer_id into v_canonical_customer_id;
  elsif p_scope = 'brand' then
    update public.brands
    set stripe_customer_id = coalesce(stripe_customer_id, p_stripe_customer_id)
    where organization_id = p_organization_id
      and id = p_subject_id
      and billing_mode = 'independent'
    returning public.brands.stripe_customer_id into v_canonical_customer_id;
  else
    update public.members
    set stripe_customer_id = coalesce(stripe_customer_id, p_stripe_customer_id)
    where organization_id = p_organization_id
      and id = p_subject_id
      and brand_id = v_row.brand_id
    returning public.members.stripe_customer_id into v_canonical_customer_id;
  end if;
  if v_canonical_customer_id is null then
    raise exception using errcode = 'P0002', message = 'Stripe customer target was not found.';
  end if;

  update public.stripe_customer_provisioning
  set
    stripe_customer_id = v_canonical_customer_id,
    lease_token = null,
    lease_expires_at = null,
    linked_at = coalesce(linked_at, now()),
    updated_at = now()
  where id = v_row.id
    and (
      lease_token = p_lease_token
      or stripe_customer_id = v_canonical_customer_id
    );

  return v_canonical_customer_id;
end;
$$;

create or replace function public.claim_stripe_billing_attempt(
  p_attempt_id uuid,
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_billing_subject_id uuid,
  p_operation public.stripe_billing_operation,
  p_plan_tier public.plan_tier,
  p_provider_payload_key text,
  p_request_fingerprint text,
  p_stripe_customer_id text,
  p_lease_token uuid
)
returns table (
  state text,
  attempt_id uuid,
  plan_tier public.plan_tier,
  provider_payload_key text,
  provider_session_id text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.stripe_billing_attempts%rowtype;
  v_expected_subject_id uuid;
  v_subscription_status public.subscription_status;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_request_fingerprint !~ '^[0-9a-f]{64}$'
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_provider_payload_key !~ '^[A-Za-z0-9_.:-]{1,255}$'
    or p_provider_payload_key ~* '(email|name|phone|address)'
  then
    raise exception using errcode = '22023', message = 'Invalid billing attempt envelope.';
  end if;

  select
    case
      when p_operation = 'member_portal' then p_member_id
      when brand.billing_mode = 'independent' then brand.id
      else organization.id
    end,
    case
      when brand.billing_mode = 'independent' then brand.subscription_status
      else organization.subscription_status
    end
  into v_expected_subject_id, v_subscription_status
  from public.brands as brand
  join public.organizations as organization
    on organization.id = brand.organization_id
  where brand.organization_id = p_organization_id
    and brand.id = p_brand_id
    and brand.active;
  if not found then
    raise exception using errcode = 'P0002', message = 'Billing target was not found.';
  end if;
  if v_expected_subject_id is null
    or p_billing_subject_id <> v_expected_subject_id
  then
    raise exception using
      errcode = '23514',
      message = 'The billing subject does not match the configured billing mode.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_billing_subject_id::text || ':' || p_operation::text,
      0
    )
  );

  select attempt.*
  into v_attempt
  from public.stripe_billing_attempts as attempt
  where attempt.id = p_attempt_id
  for update;
  if found then
    if v_attempt.organization_id <> p_organization_id
      or v_attempt.brand_id <> p_brand_id
      or v_attempt.billing_subject_id <> p_billing_subject_id
      or v_attempt.operation <> p_operation
      or v_attempt.request_fingerprint <> p_request_fingerprint
    then
      raise exception using
        errcode = '23514',
        message = 'A billing attempt identifier cannot be reused with changed input.';
    end if;
    if v_attempt.status = 'awaiting_webhook' then
      return query
      select
        'awaiting_reconciliation'::text,
        v_attempt.id,
        v_attempt.plan_tier,
        v_attempt.provider_payload_key,
        v_attempt.provider_session_id,
        null::uuid;
      return;
    end if;
    if v_attempt.status = 'completed' and v_attempt.operation = 'checkout' then
      return query
      select
        'subscription_exists'::text,
        v_attempt.id,
        v_attempt.plan_tier,
        v_attempt.provider_payload_key,
        v_attempt.provider_session_id,
        null::uuid;
      return;
    end if;
    if v_attempt.status in ('open', 'completed') then
      return query
      select
        'replay'::text,
        v_attempt.id,
        v_attempt.plan_tier,
        v_attempt.provider_payload_key,
        v_attempt.provider_session_id,
        p_lease_token;
      return;
    end if;
    if v_attempt.status = 'claimed' then
      update public.stripe_billing_attempts
      set
        lease_token = p_lease_token,
        lease_expires_at = now() + interval '2 minutes',
        attempt_count = least(attempt_count + 1, 100),
        updated_at = now()
      where id = v_attempt.id;
      return query
      select
        'claimed'::text,
        v_attempt.id,
        v_attempt.plan_tier,
        v_attempt.provider_payload_key,
        null::text,
        p_lease_token;
      return;
    end if;
    return query
    select
      'closed'::text,
      v_attempt.id,
      v_attempt.plan_tier,
      v_attempt.provider_payload_key,
      v_attempt.provider_session_id,
      null::uuid;
    return;
  end if;

  if p_operation = 'checkout' then
    if v_subscription_status not in ('not_started', 'canceled', 'incomplete_expired') then
      return query
      select
        'subscription_exists'::text,
        p_attempt_id,
        p_plan_tier,
        p_provider_payload_key,
        null::text,
        null::uuid;
      return;
    end if;

    select attempt.*
    into v_attempt
    from public.stripe_billing_attempts as attempt
    where attempt.organization_id = p_organization_id
      and attempt.billing_subject_id = p_billing_subject_id
      and attempt.operation = 'checkout'
      and attempt.status in ('claimed', 'open', 'awaiting_webhook')
    order by attempt.created_at
    limit 1
    for update;
    if found then
      if v_attempt.status = 'awaiting_webhook' then
        return query
        select
          'awaiting_reconciliation'::text,
          v_attempt.id,
          v_attempt.plan_tier,
          v_attempt.provider_payload_key,
          v_attempt.provider_session_id,
          null::uuid;
        return;
      end if;
      if v_attempt.status = 'open' then
        return query
        select
          'open_attempt'::text,
          v_attempt.id,
          v_attempt.plan_tier,
          v_attempt.provider_payload_key,
          v_attempt.provider_session_id,
          null::uuid;
        return;
      end if;
      if v_attempt.lease_expires_at > now() then
        return query
        select
          'busy'::text,
          v_attempt.id,
          v_attempt.plan_tier,
          v_attempt.provider_payload_key,
          null::text,
          null::uuid;
        return;
      end if;
      update public.stripe_billing_attempts
      set
        lease_token = p_lease_token,
        lease_expires_at = now() + interval '2 minutes',
        attempt_count = least(attempt_count + 1, 100),
        updated_at = now()
      where id = v_attempt.id;
      return query
      select
        'recover'::text,
        v_attempt.id,
        v_attempt.plan_tier,
        v_attempt.provider_payload_key,
        null::text,
        p_lease_token;
      return;
    end if;
  end if;

  insert into public.stripe_billing_attempts (
    id,
    organization_id,
    brand_id,
    member_id,
    billing_subject_id,
    operation,
    plan_tier,
    provider_payload_key,
    request_fingerprint,
    stripe_customer_id,
    lease_token,
    lease_expires_at
  )
  values (
    p_attempt_id,
    p_organization_id,
    p_brand_id,
    p_member_id,
    p_billing_subject_id,
    p_operation,
    p_plan_tier,
    p_provider_payload_key,
    p_request_fingerprint,
    p_stripe_customer_id,
    p_lease_token,
    now() + interval '2 minutes'
  );

  return query
  select
    'claimed'::text,
    p_attempt_id,
    p_plan_tier,
    p_provider_payload_key,
    null::text,
    p_lease_token;
end;
$$;

create or replace function public.finalize_stripe_billing_attempt(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_stripe_customer_id text,
  p_provider_session_id text,
  p_status public.stripe_billing_attempt_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_status not in ('open', 'completed') then
    raise exception using errcode = '22023', message = 'Invalid billing finalize status.';
  end if;

  update public.stripe_billing_attempts
  set
    stripe_customer_id = p_stripe_customer_id,
    provider_session_id = p_provider_session_id,
    status = p_status,
    lease_token = null,
    lease_expires_at = null,
    completed_at = case when p_status = 'completed' then now() else null end,
    updated_at = now()
  where id = p_attempt_id
    and (
      (status = 'claimed' and lease_token = p_lease_token)
      or (
        status = p_status
        and stripe_customer_id = p_stripe_customer_id
        and provider_session_id = p_provider_session_id
      )
    );
  if not found then
    raise exception using errcode = '40001', message = 'Billing attempt finalize lease was lost.';
  end if;
end;
$$;

create or replace function public.close_stripe_billing_attempt(
  p_attempt_id uuid,
  p_status public.stripe_billing_attempt_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_status not in ('awaiting_webhook', 'expired', 'failed') then
    raise exception using errcode = '22023', message = 'Invalid billing close status.';
  end if;
  update public.stripe_billing_attempts
  set
    status = p_status,
    lease_token = null,
    lease_expires_at = null,
    completed_at = case
      when p_status in ('expired', 'failed') then now()
      else null
    end,
    updated_at = now()
  where id = p_attempt_id
    and status in ('claimed', 'open');
end;
$$;

create or replace function public.reconcile_stripe_billing_attempt(
  p_attempt_id uuid,
  p_organization_id uuid,
  p_stripe_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.stripe_billing_attempts%rowtype;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'Invalid Stripe subscription identifier.';
  end if;

  select attempt.*
  into v_attempt
  from public.stripe_billing_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.organization_id = p_organization_id
    and attempt.operation = 'checkout'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Billing attempt was not found.';
  end if;
  if v_attempt.status = 'completed' then
    if v_attempt.stripe_subscription_id <> p_stripe_subscription_id then
      raise exception using
        errcode = '23514',
        message = 'A billing attempt cannot be reconciled to a different subscription.';
    end if;
    return;
  end if;
  if v_attempt.status not in ('open', 'awaiting_webhook') then
    raise exception using
      errcode = '23514',
      message = 'The billing attempt is not awaiting subscription reconciliation.';
  end if;

  update public.stripe_billing_attempts
  set
    status = 'completed',
    stripe_subscription_id = p_stripe_subscription_id,
    lease_token = null,
    lease_expires_at = null,
    completed_at = now(),
    updated_at = now()
  where id = p_attempt_id;
end;
$$;

create or replace function public.reconcile_stripe_subscription_target(
  p_organization_id uuid,
  p_brand_id uuid,
  p_stripe_subscription_id text,
  p_subscription_status public.subscription_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_billing_mode public.brand_billing_mode;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'Invalid Stripe subscription identifier.';
  end if;
  select brand.billing_mode
  into v_billing_mode
  from public.brands as brand
  where brand.organization_id = p_organization_id
    and brand.id = p_brand_id
    and brand.active
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Billing target was not found.';
  end if;

  if v_billing_mode = 'independent' then
    update public.brands
    set
      stripe_subscription_id = p_stripe_subscription_id,
      subscription_status = p_subscription_status,
      stripe_state_updated_at = now()
    where organization_id = p_organization_id
      and id = p_brand_id;
  else
    update public.organizations
    set
      stripe_subscription_id = p_stripe_subscription_id,
      subscription_status = p_subscription_status,
      stripe_state_updated_at = now()
    where id = p_organization_id;
  end if;
end;
$$;

revoke all on table public.stripe_customer_provisioning from anon, authenticated;
revoke all on table public.stripe_billing_attempts from anon, authenticated;

revoke execute on function public.claim_stripe_customer_provisioning(
  uuid,
  public.stripe_customer_scope,
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.claim_stripe_customer_provisioning(
  uuid,
  public.stripe_customer_scope,
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

revoke execute on function public.finalize_stripe_customer_provisioning(
  uuid,
  public.stripe_customer_scope,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.finalize_stripe_customer_provisioning(
  uuid,
  public.stripe_customer_scope,
  uuid,
  uuid,
  text
) to service_role;

revoke execute on function public.claim_stripe_billing_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  public.stripe_billing_operation,
  public.plan_tier,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.claim_stripe_billing_attempt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  public.stripe_billing_operation,
  public.plan_tier,
  text,
  text,
  text,
  uuid
) to service_role;

revoke execute on function public.finalize_stripe_billing_attempt(
  uuid,
  uuid,
  text,
  text,
  public.stripe_billing_attempt_status
) from public, anon, authenticated;
grant execute on function public.finalize_stripe_billing_attempt(
  uuid,
  uuid,
  text,
  text,
  public.stripe_billing_attempt_status
) to service_role;

revoke execute on function public.close_stripe_billing_attempt(
  uuid,
  public.stripe_billing_attempt_status
) from public, anon, authenticated;
grant execute on function public.close_stripe_billing_attempt(
  uuid,
  public.stripe_billing_attempt_status
) to service_role;

revoke execute on function public.reconcile_stripe_billing_attempt(
  uuid,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.reconcile_stripe_billing_attempt(
  uuid,
  uuid,
  text
) to service_role;

revoke execute on function public.reconcile_stripe_subscription_target(
  uuid,
  uuid,
  text,
  public.subscription_status
) from public, anon, authenticated;
grant execute on function public.reconcile_stripe_subscription_target(
  uuid,
  uuid,
  text,
  public.subscription_status
) to service_role;
