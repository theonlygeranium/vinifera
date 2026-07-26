-- Credential-independent provider activation/runtime seams.

alter table public.integration_secrets
  drop constraint integration_secrets_envelope_consistent;

alter table public.integration_secrets
  add constraint integration_secrets_envelope_consistent
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
      and external_secret_ref ~ '^env://VINIFERA_INTEGRATION_SECRET_[A-Z0-9_]{1,96}$'
      and envelope_version is null
      and algorithm is null
      and credential_ciphertext is null
      and credential_iv is null
      and key_version is null
    )
  ) not valid;

create or replace function public.set_brand_sender_identity_verification(
  p_organization_id uuid,
  p_brand_id uuid,
  p_provider_identity_id text,
  p_status public.sender_identity_status
)
returns public.brand_sender_identities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender public.brand_sender_identities%rowtype;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_status not in ('pending', 'verified')
    or p_provider_identity_id !~ '^[A-Za-z0-9_-]{1,128}$'
  then
    raise exception using errcode = '22023', message = 'Sender verification state is invalid.';
  end if;

  update public.brand_sender_identities
  set
    provider_identity_id = p_provider_identity_id,
    status = p_status,
    verified_at = case when p_status = 'verified' then now() else null end,
    updated_at = now()
  where organization_id = p_organization_id
    and brand_id = p_brand_id
    and status <> 'disabled'
  returning * into v_sender;

  if v_sender.id is null then
    raise exception using errcode = 'P0002', message = 'Brand sender identity not found.';
  end if;
  return v_sender;
end;
$$;

drop function public.claim_email_outbox_batch(text, integer, integer);

create function public.claim_email_outbox_batch(
  p_worker_id text,
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (
  outbox_id uuid,
  email_log_id uuid,
  organization_id uuid,
  brand_id uuid,
  member_id uuid,
  to_email text,
  trigger_type public.email_trigger_type,
  subject text,
  body text,
  payload jsonb,
  attempt_count integer,
  sender_identity_id uuid,
  sender_from_name text,
  sender_from_email text,
  sender_status public.sender_identity_status
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Worker ID is required.';
  end if;
  if p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Email claim limit must be between 1 and 100.';
  end if;
  if p_lease_seconds not between 30 and 1800 then
    raise exception using errcode = '22023', message = 'Email lease must be between 30 and 1800 seconds.';
  end if;

  update public.email_outbox as expired
  set
    status = 'failed',
    available_at = now(),
    lease_expires_at = null,
    worker_id = null,
    last_error = 'lease_expired'
  where expired.status = 'processing'
    and expired.lease_expires_at <= now();

  return query
  with claimed as (
    select outbox.id
    from public.email_outbox as outbox
    where outbox.status in ('pending', 'failed')
      and outbox.available_at <= now()
      and outbox.attempt_count < 5
    order by outbox.available_at, outbox.created_at, outbox.id
    limit p_limit
    for update skip locked
  ),
  updated as (
    update public.email_outbox as outbox
    set
      status = 'processing',
      worker_id = btrim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = outbox.attempt_count + 1,
      last_error = null
    from claimed
    where outbox.id = claimed.id
    returning outbox.*
  )
  select
    updated.id,
    log.id,
    log.organization_id,
    log.brand_id,
    log.member_id,
    log.to_email,
    log.trigger_type,
    log.subject,
    log.body,
    log.payload,
    updated.attempt_count,
    sender.id,
    sender.from_name,
    sender.from_email,
    sender.status
  from updated
  join public.email_log as log
    on log.id = updated.email_log_id
    and log.organization_id = updated.organization_id
  left join public.brand_sender_identities as sender
    on sender.organization_id = log.organization_id
    and sender.brand_id = log.brand_id
    and sender.status <> 'disabled';

  update public.email_log as log
  set status = 'processing', claimed_at = coalesce(log.claimed_at, now())
  where exists (
    select 1
    from public.email_outbox as outbox
    where outbox.email_log_id = log.id
      and outbox.organization_id = log.organization_id
      and outbox.worker_id = btrim(p_worker_id)
      and outbox.status = 'processing'
      and outbox.lease_expires_at > now()
  );
end;
$$;

revoke execute on function public.set_brand_sender_identity_verification(
  uuid,
  uuid,
  text,
  public.sender_identity_status
) from public, anon, authenticated;
grant execute on function public.set_brand_sender_identity_verification(
  uuid,
  uuid,
  text,
  public.sender_identity_status
) to service_role;

revoke execute on function public.claim_email_outbox_batch(
  text,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.claim_email_outbox_batch(
  text,
  integer,
  integer
) to service_role;
