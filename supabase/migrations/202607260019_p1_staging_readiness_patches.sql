-- =============================================================================
-- P1 Staging Readiness Patches
-- =============================================================================
-- Migration 202607260019
--
-- Addresses two P1 findings from the expert codebase assessment:
--
-- P1-7: NULL brand_id RLS blind spots
--   Two tables retrofitted with brand_id in migration 005 still have nullable
--   columns: integration_sync_jobs and integration_sync_logs.  NULL brand_id
--   values bypass brand-level RLS filtering, creating cross-tenant data
--   exposure.  The other three tables identified in the assessment
--   (integration_connections, stripe_customer_provisioning,
--   email_provider_event_inbox) were already backfilled and constrained in
--   their respective migrations.
--   Fix: Backfill NULL brand_id with the organization's default_brand_id,
--   then add NOT NULL constraints and a CHECK constraint.
--
-- P1-8: RLS not forced on credential envelope and custom hostname tables
--   Four tables have RLS enabled but not forced: credential_envelope_rotation_runs,
--   credential_envelope_rotation_items, custom_hostname_write_attempts,
--   custom_hostname_delete_attempts.  Without FORCE, table owners bypass RLS
--   policies.  While service_role intentionally bypasses RLS, the table owner
--   role should also be subject to policies for defense-in-depth.
--   Fix: Add ALTER TABLE ... FORCE ROW LEVEL SECURITY for all four tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- P1-7: Backfill NULL brand_id on integration_sync_jobs
-- -----------------------------------------------------------------------------

update public.integration_sync_jobs as job
set brand_id = org.default_brand_id
from public.organizations as org
where org.id = job.organization_id
  and job.brand_id is null;

alter table public.integration_sync_jobs
  alter column brand_id set not null;

alter table public.integration_sync_jobs
  add constraint integration_sync_jobs_brand_not_null
  check (brand_id is not null);

-- -----------------------------------------------------------------------------
-- P1-7: Backfill NULL brand_id on integration_sync_logs
-- -----------------------------------------------------------------------------

update public.integration_sync_logs as log
set brand_id = org.default_brand_id
from public.organizations as org
where org.id = log.organization_id
  and log.brand_id is null;

alter table public.integration_sync_logs
  alter column brand_id set not null;

alter table public.integration_sync_logs
  add constraint integration_sync_logs_brand_not_null
  check (brand_id is not null);

-- -----------------------------------------------------------------------------
-- P1-8: Force RLS on credential envelope rotation tables
-- -----------------------------------------------------------------------------

alter table public.credential_envelope_rotation_runs
  force row level security;

alter table public.credential_envelope_rotation_items
  force row level security;

-- -----------------------------------------------------------------------------
-- P1-8: Force RLS on custom hostname safety tables
-- -----------------------------------------------------------------------------

alter table public.custom_hostname_write_attempts
  force row level security;

alter table public.custom_hostname_delete_attempts
  force row level security;
