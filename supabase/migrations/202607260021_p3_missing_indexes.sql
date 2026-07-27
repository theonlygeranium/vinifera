-- =============================================================================
-- P3-6: Missing Database Indexes
-- =============================================================================
-- Migration 202607260021
--
-- Three foreign-key columns lack supporting indexes, forcing full-table scans
-- on FK validation and ON DELETE CASCADE/RESTRICT operations.
--
-- 1. ml_training_rows.feature_snapshot_id — composite FK to ml_feature_snapshots
--    has no index on either (organization_id, feature_snapshot_id) or
--    feature_snapshot_id alone. Every ON DELETE RESTRICT check and FK validation
--    triggers a sequential scan of ml_training_rows.
--
-- 2. custom_hostname_delete_attempts — composite FK (organization_id, brand_id)
--    to brands uses ON DELETE CASCADE, but no index exists on the FK columns.
--    Deleting a brand row triggers an unindexed scan of all delete attempts.
--
-- 3. stripe_billing_attempts.member_id — FK (organization_id, member_id) to
--    members has no dedicated member index. The existing indexes target
--    recovery and checkout-uniqueness, not the member cascade path.
-- =============================================================================

-- 1. ml_training_rows: index for the feature_snapshot FK
create index if not exists ml_training_rows_feature_snapshot_idx
  on public.ml_training_rows (organization_id, feature_snapshot_id);

-- 2. custom_hostname_delete_attempts: index for the brand FK
create index if not exists custom_hostname_delete_attempts_brand_idx
  on public.custom_hostname_delete_attempts (organization_id, brand_id);

-- 3. stripe_billing_attempts: index for the member FK
create index if not exists stripe_billing_attempts_member_idx
  on public.stripe_billing_attempts (organization_id, member_id)
  where member_id is not null;
