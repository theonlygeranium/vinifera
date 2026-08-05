-- Migration 024: Public RPC to resolve an organization's default brand ID
--
-- The existing private.default_brand_for_org is SECURITY DEFINER and inherently
-- tenant-scoped (filters by p_organization_id). This public wrapper exposes
-- it to the service_role so the Worker can resolve the default brand via RPC
-- instead of a direct PostgREST column query, which fails when the Supabase
-- client cannot inject CF Access service-token headers into PostgREST requests.

create or replace function public.resolve_default_brand_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select default_brand_for_org(p_organization_id);
$$;

grant execute on function public.resolve_default_brand_id(uuid) to service_role;
grant execute on function public.resolve_default_brand_id(uuid) to anon;
