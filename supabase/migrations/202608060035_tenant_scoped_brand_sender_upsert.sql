-- Migration 035: atomic tenant-scoped brand creation and safe sender identity upsert

create or replace function public.create_brand_with_profile(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_billing_mode public.brand_billing_mode,
  p_description text,
  p_default_shipping_charge_cents integer
)
returns public.brands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand public.brands;
begin
  -- create_brand owns the all-brand authorization and staff-access grant. Any
  -- failure below aborts this enclosing statement and rolls that creation back.
  v_brand := public.create_brand(
    p_organization_id,
    p_name,
    p_slug,
    p_billing_mode
  );

  update public.brands
  set
    description = coalesce(p_description, ''),
    default_shipping_charge_cents = p_default_shipping_charge_cents,
    updated_at = now()
  where organization_id = p_organization_id
    and id = v_brand.id
  returning * into v_brand;

  if v_brand.id is null then
    raise exception using errcode = 'P0002', message = 'Created brand not found.';
  end if;
  return v_brand;
end;
$$;

revoke all on function public.create_brand_with_profile(
  uuid,
  text,
  text,
  public.brand_billing_mode,
  text,
  integer
) from public;
grant execute on function public.create_brand_with_profile(
  uuid,
  text,
  text,
  public.brand_billing_mode,
  text,
  integer
) to authenticated, service_role;

drop function if exists public.upsert_brand_sender_identity(
  uuid,
  uuid,
  text,
  text,
  text,
  public.sender_identity_status,
  timestamptz
);

create or replace function public.upsert_brand_sender_identity(
  p_organization_id uuid,
  p_brand_id uuid,
  p_from_name text,
  p_from_email text
)
returns public.brand_sender_identities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender public.brand_sender_identities;
begin
  if not (
    private.is_service_role()
    or (
      private.is_staff_for_org(
        p_organization_id,
        array['owner', 'admin']::public.staff_role[]
      )
      and private.can_access_brand(p_organization_id, p_brand_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'Brand sender authorization is required.';
  end if;

  insert into public.brand_sender_identities (
    organization_id,
    brand_id,
    from_name,
    from_email,
    provider_identity_id,
    status,
    verified_at
  )
  values (
    p_organization_id,
    p_brand_id,
    btrim(p_from_name),
    lower(btrim(p_from_email)),
    null,
    'pending',
    null
  )
  on conflict (organization_id, brand_id) do update
  set
    from_name = excluded.from_name,
    from_email = excluded.from_email,
    provider_identity_id = case
      when brand_sender_identities.status <> 'disabled'
        and brand_sender_identities.from_name = excluded.from_name
        and brand_sender_identities.from_email = excluded.from_email
      then brand_sender_identities.provider_identity_id
      else null
    end,
    status = case
      when brand_sender_identities.status <> 'disabled'
        and brand_sender_identities.from_name = excluded.from_name
        and brand_sender_identities.from_email = excluded.from_email
      then brand_sender_identities.status
      else 'pending'::public.sender_identity_status
    end,
    verified_at = case
      when brand_sender_identities.status <> 'disabled'
        and brand_sender_identities.from_name = excluded.from_name
        and brand_sender_identities.from_email = excluded.from_email
      then brand_sender_identities.verified_at
      else null
    end,
    updated_at = now()
  where brand_sender_identities.organization_id = p_organization_id
    and brand_sender_identities.brand_id = p_brand_id
  returning * into v_sender;

  return v_sender;
end;
$$;

revoke all on function public.upsert_brand_sender_identity(
  uuid,
  uuid,
  text,
  text
) from public;
grant execute on function public.upsert_brand_sender_identity(
  uuid,
  uuid,
  text,
  text
) to authenticated, service_role;
