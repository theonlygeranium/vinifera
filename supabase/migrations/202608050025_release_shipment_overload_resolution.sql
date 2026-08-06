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
  if not private.brand_accepts_operational_charges(
    p_organization_id,
    p_brand_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'The brand is not available for operational charges.';
  end if;
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
    p_organization_id := p_organization_id,
    p_release_id := p_release_id,
    p_actor_user_id := p_actor_user_id
  );
end;
$$;
