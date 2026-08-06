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
declare
  v_release public.releases%rowtype;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  perform private.resolve_audit_actor(p_organization_id, p_actor_user_id);
  if not private.brand_accepts_operational_charges(
    p_organization_id,
    p_brand_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'The brand is not available for operational charges.';
  end if;

  select r.*
  into v_release
  from public.releases as r
  where r.id = p_release_id
    and r.organization_id = p_organization_id
    and r.brand_id = p_brand_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Release not found for brand.';
  end if;
  if v_release.status not in ('scheduled', 'processing') then
    raise exception using
      errcode = '23514',
      message = 'Only scheduled or processing releases can create shipments.';
  end if;
  if not exists (
    select 1
    from public.release_tier_items as i
    where i.release_id = p_release_id
      and i.organization_id = p_organization_id
      and i.brand_id = p_brand_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Release must include at least one tier item.';
  end if;

  insert into public.shipments (
    organization_id,
    brand_id,
    member_id,
    release_id,
    release_tier_id,
    tier_id,
    shipping_address,
    charge_amount_cents
  )
  select
    m.organization_id,
    m.brand_id,
    m.id,
    rt.release_id,
    rt.id,
    rt.tier_id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'name', btrim(concat_ws(' ', m.first_name, m.last_name)),
        'line1', m.shipping_address_line1,
        'line2', m.shipping_address_line2,
        'city', m.shipping_city,
        'region', m.shipping_region,
        'postal_code', m.shipping_postal_code,
        'country_code', m.shipping_country_code,
        'phone', m.phone
      )
    ),
    rt.price_cents
  from public.release_tiers as rt
  join public.members as m
    on m.organization_id = rt.organization_id
    and m.brand_id = rt.brand_id
    and m.brand_id = p_brand_id
    and m.club_tier_id = rt.tier_id
    and m.status = 'active'
    and m.deleted_at is null
  where rt.organization_id = p_organization_id
    and rt.brand_id = p_brand_id
    and rt.release_id = p_release_id
  on conflict on constraint shipments_release_member_key do nothing;

  insert into public.shipment_items (
    organization_id,
    brand_id,
    shipment_id,
    release_wine_id,
    wine_name,
    vintage,
    sku,
    quantity,
    price_cents
  )
  select
    s.organization_id,
    s.brand_id,
    s.id,
    rw.id,
    rw.wine_name,
    rw.vintage,
    rw.sku,
    rti.quantity,
    rti.unit_price_cents
  from public.shipments as s
  join public.release_tier_items as rti
    on rti.organization_id = s.organization_id
    and rti.brand_id = s.brand_id
    and rti.brand_id = p_brand_id
    and rti.release_id = s.release_id
    and rti.release_tier_id = s.release_tier_id
  join public.release_wines as rw
    on rw.id = rti.release_wine_id
    and rw.organization_id = rti.organization_id
    and rw.brand_id = rti.brand_id
    and rw.brand_id = p_brand_id
  where s.organization_id = p_organization_id
    and s.brand_id = p_brand_id
    and s.release_id = p_release_id
  on conflict do nothing;

  if v_release.status = 'scheduled' then
    update public.releases as release
    set status = 'processing'
    where release.id = p_release_id
      and release.organization_id = p_organization_id
      and release.brand_id = p_brand_id;
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    'release.shipments_created',
    'release',
    p_release_id,
    jsonb_build_object(
      'shipment_count',
      (
        select count(*)
        from public.shipments as s
        where s.release_id = p_release_id
          and s.organization_id = p_organization_id
          and s.brand_id = p_brand_id
      )
    )
  );

  return query
  select s.id, s.member_id, s.charge_amount_cents
  from public.shipments as s
  where s.organization_id = p_organization_id
    and s.brand_id = p_brand_id
    and s.release_id = p_release_id
  order by s.created_at, s.id;
end;
$$;
