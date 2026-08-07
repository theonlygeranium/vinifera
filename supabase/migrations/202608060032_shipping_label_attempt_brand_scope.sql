-- Gate 13 follow-up: make durable shipping-label acquisition explicitly
-- brand-scoped while retaining the original implementation as an internal,
-- non-callable compatibility target.

create or replace function public.acquire_shipping_label_attempt(
  p_organization_id uuid,
  p_brand_id uuid,
  p_shipment_id uuid,
  p_worker_id text,
  p_actor_user_id uuid,
  p_lease_seconds integer default 300,
  p_provider text default 'easypost'
)
returns table (
  attempt_id uuid,
  disposition text,
  lease_token text,
  request_fingerprint text,
  correlation_reference text,
  provider text,
  external_shipment_id text,
  external_rate_id text,
  external_label_id text,
  label_url text,
  tracking_number text,
  carrier text,
  label_cost_cents integer,
  provider_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Shipping label acquisition is service-only.';
  end if;

  -- Hold the exact tenant/brand shipment identity stable for the duration of
  -- the delegated acquisition transaction. The legacy implementation then
  -- operates only on this globally unique, locked shipment identity.
  perform 1
  from public.shipments as shipment
  where shipment.organization_id = p_organization_id
    and shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found.';
  end if;

  return query
  select *
  from public.acquire_shipping_label_attempt(
    p_organization_id,
    p_shipment_id,
    p_worker_id,
    p_actor_user_id,
    p_lease_seconds,
    p_provider
  );
end;
$$;

revoke execute on function public.acquire_shipping_label_attempt(
  uuid, uuid, text, uuid, integer, text
) from public, anon, authenticated, service_role;
revoke execute on function public.acquire_shipping_label_attempt(
  uuid, uuid, uuid, text, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.acquire_shipping_label_attempt(
  uuid, uuid, uuid, text, uuid, integer, text
) to service_role;
