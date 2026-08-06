create or replace function public.complete_email_outbox_claim(
  p_outbox_id uuid,
  p_completion_token text,
  p_status public.email_status,
  p_resend_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.email_outbox%rowtype;
  v_log public.email_log%rowtype;
begin
  if p_status not in ('sent', 'delivered', 'failed', 'bounced') then
    raise exception using errcode = '22023', message = 'Unsupported delivery status.';
  end if;

  select outbox.*
  into v_outbox
  from public.email_outbox as outbox
  where outbox.id = p_outbox_id
  for update;
  if not found
    or v_outbox.status <> 'processing'
    or v_outbox.completion_token is distinct from p_completion_token
    or v_outbox.lease_expires_at <= now()
  then
    return false;
  end if;

  select log.*
  into v_log
  from public.email_log as log
  where log.id = v_outbox.email_log_id
    and log.organization_id = v_outbox.organization_id
  for update;

  if p_resend_id is not null
    and v_log.resend_id is not null
    and v_log.resend_id <> p_resend_id
  then
    raise exception using
      errcode = '23505',
      message = 'Provider email ID does not match the original delivery.';
  end if;

  update public.email_log
  set resend_id = coalesce(resend_id, p_resend_id)
  where id = v_log.id;
  perform private.converge_email_status(
    v_log.organization_id,
    v_log.id,
    p_status,
    now(),
    p_error
  );

  update public.email_outbox
  set
    status = case
      when p_status in ('sent', 'delivered', 'bounced') then 'completed'::public.email_outbox_status
      when attempt_count >= 5 then 'completed'::public.email_outbox_status
      else 'failed'::public.email_outbox_status
    end,
    available_at = case
      when p_status = 'failed' and attempt_count < 5
        then now() + make_interval(secs => least(900, 30 * (2 ^ attempt_count)::integer))
      else available_at
    end,
    lease_expires_at = null,
    worker_id = null,
    completion_token = null,
    last_error = case when p_status = 'failed' then left(p_error, 4000) else null end
  where id = v_outbox.id;

  if p_resend_id is not null then
    perform private.reconcile_email_provider_events(p_resend_id);
  end if;
  return true;
end;
$$;
