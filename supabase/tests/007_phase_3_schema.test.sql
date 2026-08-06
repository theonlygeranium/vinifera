begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(45);

select is(
  (
    select count(*)
    from pg_catalog.pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname in (
        'email_templates',
        'member_email_preferences',
        'email_log',
        'email_outbox',
        'email_delivery_events',
        'email_unsubscribe_tokens',
        'churn_scores',
        'cancel_flow_steps',
        'cancel_flow_attempts',
        'cancel_flow_events',
        'member_activity_events',
        'loyalty_tier_multipliers',
        'loyalty_redemptions',
        'loyalty_ledger',
        'loyalty_point_lots',
        'loyalty_reservation_allocations'
      )
  ),
  16::bigint,
  'all Phase 3 tables exist'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relrowsecurity
      and relforcerowsecurity
      and relname in (
        'email_templates',
        'member_email_preferences',
        'email_log',
        'email_outbox',
        'email_delivery_events',
        'email_unsubscribe_tokens',
        'churn_scores',
        'cancel_flow_steps',
        'cancel_flow_attempts',
        'cancel_flow_events',
        'member_activity_events',
        'loyalty_tier_multipliers',
        'loyalty_redemptions',
        'loyalty_ledger',
        'loyalty_point_lots',
        'loyalty_reservation_allocations'
      )
  ),
  16::bigint,
  'every Phase 3 table has forced RLS'
);
select ok(
  (
    select count(*) >= 14
    from pg_catalog.pg_constraint
    where contype = 'f'
      and connamespace = 'public'::regnamespace
      and pg_get_constraintdef(oid) like
        '%FOREIGN KEY (organization_id, %REFERENCES %(organization_id, id)%'
  ),
  'tenant child references use composite organization keys'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.email_templates'::regclass
      and attname = 'days_before'
      and not attisdropped
  ),
  'email templates store configurable pre-shipment lead days'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.email_templates'::regclass
      and conname = 'email_templates_days_before_consistent'
  ),
  'template lead days are constrained to pre-shipment templates'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.email_templates'::regclass
      and conname = 'email_templates_body_safe'
      and position('script' in lower(pg_get_constraintdef(oid))) > 0
  ),
  'template bodies reject script content'
);
select ok(
  (
    select not attnotnull
    from pg_catalog.pg_attribute
    where attrelid = 'public.email_log'::regclass
      and attname = 'member_id'
  ),
  'email log supports non-member test recipients'
);
select ok(
  (
    select attnotnull
    from pg_catalog.pg_attribute
    where attrelid = 'public.email_log'::regclass
      and attname = 'is_test'
  ),
  'test email records are explicit'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.email_log'::regclass
      and conname in (
        'email_log_test_recipient_consistent',
        'email_log_recipient_consistent'
      )
  ),
  'email rows retain the current recipient-identity constraint'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'email_outbox'
      and indexname = 'email_outbox_claim_idx'
      and indexdef like '%WHERE (status = ANY%'
  ),
  'email outbox has a partial claim index'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.email_delivery_events'::regclass
      and conname = 'email_delivery_events_provider_event_key'
  ),
  'provider delivery event IDs are globally replay-safe'
);
select ok(
  (
    select enum_range(null::public.email_delivery_event_type)::text[]
  ) @> array[
    'delivery_delayed',
    'failed',
    'opened',
    'clicked',
    'complained'
  ],
  'delivery event type covers Resend terminal and engagement events'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.email_unsubscribe_tokens'::regclass
      and attname = 'token_hash'
      and attnotnull
  ),
  'unsubscribe state stores a required token hash'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_attribute
    where attrelid = 'public.email_unsubscribe_tokens'::regclass
      and attname in ('token', 'raw_token', 'signed_token')
      and not attisdropped
  ),
  0::bigint,
  'unsubscribe state never stores raw signed tokens'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'email_unsubscribe_tokens'
      and indexname = 'email_unsubscribe_tokens_hash_uidx'
  ),
  'unsubscribe hashes are unique'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.churn_scores'::regclass
      and conname = 'churn_scores_score_range'
  ),
  'churn scores are bounded from zero through one hundred'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.churn_scores'::regclass
      and conname = 'churn_scores_risk_consistent'
  ),
  'risk labels are constrained to score thresholds'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.churn_scores'::regclass
      and conname = 'churn_scores_member_day_key'
  ),
  'nightly churn snapshots are idempotent per member and day'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'churn_scores'
      and indexname = 'churn_scores_org_risk_score_idx'
  ),
  'high-risk dashboard reads have a covering order index'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.cancel_flow_steps'::regclass
      and conname = 'cancel_flow_steps_org_position_key'
      and condeferrable
  ),
  'cancel step positions can be reordered atomically'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'cancel_flow_attempts'
      and indexname = 'cancel_flow_attempts_one_active_uidx'
  ),
  'a member can have only one active cancellation attempt'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.cancel_flow_attempts'::regclass
      and attname = 'configuration_snapshot'
      and attnotnull
  ),
  'cancel attempts retain an immutable configuration snapshot'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.loyalty_redemptions'::regclass
      and conname = 'loyalty_redemptions_ratio_exact'
  ),
  'loyalty reservations snapshot and enforce the discount ratio'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'loyalty_point_lots'
      and indexname = 'loyalty_point_lots_fifo_idx'
  ),
  'loyalty lots have an expiration-first FIFO index'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.loyalty_point_lots'::regclass
      and conname = 'loyalty_point_lots_amount_range'
  ),
  'lot remaining and reserved balances cannot exceed awards'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.loyalty_ledger'::regclass
      and conname in (
        'loyalty_ledger_org_idempotency_key',
        'loyalty_ledger_org_brand_idempotency_key'
      )
  ),
  'loyalty ledger operations are exact-once at the current tenant scope'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.loyalty_ledger'::regclass
      and tgname = 'loyalty_ledger_reject_update_delete'
      and not tgisinternal
  ),
  'loyalty ledger rejects mutation'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.member_activity_events'::regclass
      and tgname = 'member_activity_events_reject_update_delete'
      and not tgisinternal
  ),
  'member activity is append-only'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.shipments'::regclass
      and tgname = 'shipments_capture_retention_events'
      and not tgisinternal
  ),
  'shipment status changes drive email, delivery, and referral events'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.billing_attempts'::regclass
      and tgname = 'billing_attempts_capture_decline_email'
      and not tgisinternal
  ),
  'billing declines enqueue exact-once notices'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.members'::regclass
      and tgname = 'members_enqueue_welcome_email'
      and not tgisinternal
  ),
  'member signup enqueues welcome email'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.members'::regclass
      and tgname = 'members_capture_tier_downgrade'
      and not tgisinternal
  ),
  'all lower-priced tier transitions feed churn scoring'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_email_outbox_batch(text,integer,integer)',
    'execute'
  ),
  'service role can claim email outbox work'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_email_outbox_batch(text,integer,integer)',
    'execute'
  ),
  'browser roles cannot claim email work'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.calculate_nightly_churn_scores(timestamptz,uuid)',
    'execute'
  ),
  'service role can run nightly churn scoring'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.calculate_nightly_churn_scores(timestamptz,uuid)',
    'execute'
  ),
  'browser roles cannot forge churn snapshots'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.start_cancel_flow(uuid,uuid,uuid)',
    'execute'
  ),
  'service role can enter cancel flow'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reserve_loyalty_discount(uuid,uuid,uuid,integer,text,uuid)',
    'execute'
  ),
  'service role can reserve loyalty points'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.award_loyalty_points(uuid,uuid,integer,public.member_activity_event_type,uuid,text,text,uuid)',
    'execute'
  ),
  'browser roles cannot award loyalty points'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_test_email(uuid,uuid,text,text,text,text,uuid)',
    'execute'
  ),
  'test email enqueue is server-only'
);

insert into auth.users (id, email)
values ('61000000-0000-4000-8000-000000000001', 'phase3-schema@example.test');
insert into public.organizations (id, name, plan_tier)
values ('62000000-0000-4000-8000-000000000001', 'Phase 3 Schema Winery', 'vine');
insert into public.staff_users (id, organization_id, email, role)
values (
  '61000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',
  'phase3-schema@example.test',
  'owner'
);
insert into public.club_tiers (
  id,
  organization_id,
  name,
  price_cents,
  bottle_count,
  frequency
)
values
  ('63000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'Vine', 5000, 1, 'quarterly'),
  ('63000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', 'Cellar', 9000, 2, 'quarterly'),
  ('63000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000001', 'Estate', 15000, 3, 'quarterly'),
  ('63000000-0000-4000-8000-000000000004', '62000000-0000-4000-8000-000000000001', 'Reserve', 20000, 4, 'quarterly');

select is(
  (
    select count(*)
    from public.email_templates
    where organization_id = '62000000-0000-4000-8000-000000000001'
      and trigger_type in (
        'welcome', 'pre_shipment', 'payment_decline', 'shipped',
        'birthday', 're_engagement'
      )
  ),
  6::bigint,
  'new organizations receive all six Phase 3 templates'
);
select is(
  (
    select days_before
    from public.email_templates
    where organization_id = '62000000-0000-4000-8000-000000000001'
      and trigger_type = 'pre_shipment'
  ),
  3,
  'pre-shipment template defaults to three days'
);
select is(
  (
    select count(*)
    from public.cancel_flow_steps
    where organization_id = '62000000-0000-4000-8000-000000000001'
      and enabled
  ),
  4::bigint,
  'new organizations receive four enabled cancel steps'
);
select is(
  (
    select array_agg(step_type::text order by position)
    from public.cancel_flow_steps
    where organization_id = '62000000-0000-4000-8000-000000000001'
  ),
  array['pause', 'downgrade', 'swap', 'confirm']::text[],
  'cancel steps have deterministic semantic order'
);
select is(
  (
    select array_agg(multiplier order by tier.name)
    from public.loyalty_tier_multipliers as multiplier
    join public.club_tiers as tier on tier.id = multiplier.club_tier_id
    where multiplier.organization_id = '62000000-0000-4000-8000-000000000001'
  ),
  array[1.25, 1.50, 1.50, 1.00]::numeric[],
  'Cellar, Estate, Reserve, and Vine multipliers seed exactly'
);

select * from finish();
rollback;
