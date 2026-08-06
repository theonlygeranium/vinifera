-- Gate 8 acceptance must never run the global due-email selector. Expose one
-- service-role-only command that validates and enqueues an exact tenant,
-- brand, member, and release tuple through the canonical email primitive.

create or replace function public.enqueue_scoped_pre_shipment_trigger(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_release_id uuid,
  p_as_of timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.releases%rowtype;
begin
  select release.*
  into v_release
  from public.releases as release
  join public.brands as brand
    on brand.organization_id = release.organization_id
    and brand.id = release.brand_id
  join public.release_tiers as release_tier
    on release_tier.organization_id = release.organization_id
    and release_tier.brand_id = release.brand_id
    and release_tier.release_id = release.id
  join public.members as member
    on member.organization_id = release.organization_id
    and member.brand_id = release.brand_id
    and member.club_tier_id = release_tier.tier_id
  join public.email_templates as template
    on template.organization_id = release.organization_id
    and template.brand_id = release.brand_id
    and template.trigger_type = 'pre_shipment'
    and template.enabled
  where release.organization_id = p_organization_id
    and release.brand_id = p_brand_id
    and release.id = p_release_id
    and release.status = 'scheduled'
    and member.organization_id = p_organization_id
    and member.brand_id = p_brand_id
    and member.id = p_member_id
    and member.status = 'active'
    and member.deleted_at is null
    and release.processing_date =
      (p_as_of at time zone brand.time_zone)::date + template.days_before;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Scoped pre-shipment trigger target is not due or tenant-bound.';
  end if;

  return public.enqueue_email_trigger(
    p_organization_id,
    p_member_id,
    'pre_shipment',
    'email:pre_shipment:' || p_release_id::text || ':' || p_member_id::text,
    jsonb_build_object(
      'release_id', p_release_id,
      'release_name', v_release.name,
      'processing_date', v_release.processing_date
    ),
    p_as_of
  );
end;
$$;

revoke execute on function public.enqueue_scoped_pre_shipment_trigger(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_scoped_pre_shipment_trigger(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;
