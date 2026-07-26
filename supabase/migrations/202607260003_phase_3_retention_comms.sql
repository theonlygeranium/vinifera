begin;

create type public.email_trigger_type as enum (
  'welcome',
  'pre_shipment',
  'payment_decline',
  'shipped',
  'birthday',
  're_engagement'
);

create type public.email_status as enum (
  'queued',
  'processing',
  'sent',
  'delivered',
  'failed',
  'bounced'
);

create type public.email_outbox_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create type public.email_delivery_event_type as enum (
  'sent',
  'delivered',
  'delivery_delayed',
  'failed',
  'bounced',
  'opened',
  'clicked',
  'complained'
);

create type public.unsubscribe_token_status as enum (
  'active',
  'consumed',
  'revoked'
);

create type public.churn_risk_level as enum (
  'low',
  'medium',
  'high'
);

create type public.cancel_step_type as enum (
  'pause',
  'downgrade',
  'swap',
  'confirm'
);

create type public.cancel_attempt_status as enum (
  'in_progress',
  'intercepted',
  'cancelled',
  'abandoned'
);

create type public.cancel_actor_type as enum (
  'member',
  'staff'
);

create type public.cancel_flow_outcome as enum (
  'viewed',
  'continued',
  'paused',
  'downgraded',
  'swapped',
  'cancelled',
  'abandoned'
);

create type public.member_activity_event_type as enum (
  'portal_login',
  'tier_downgrade',
  'shipment_delivered',
  'event_attendance',
  'referral_completed',
  'birthday',
  'anniversary'
);

create type public.loyalty_ledger_entry_type as enum (
  'award',
  'reservation',
  'reservation_release',
  'expiration',
  'manual_adjustment'
);

create type public.loyalty_redemption_status as enum (
  'held',
  'applied',
  'released',
  'expired',
  'reversed'
);

alter table public.organizations
  add column email_sender_name text,
  add column email_sender_address text,
  add column loyalty_enabled boolean not null default true,
  add column loyalty_points_per_unit integer not null default 100,
  add column loyalty_discount_unit_cents integer not null default 1000,
  add column loyalty_expiration_months integer not null default 24,
  add column loyalty_reservation_minutes integer not null default 30,
  add constraint organizations_email_sender_name_length
    check (
      email_sender_name is null
      or char_length(btrim(email_sender_name)) between 1 and 120
    ),
  add constraint organizations_email_sender_address_format
    check (
      email_sender_address is null
      or (
        email_sender_address = lower(btrim(email_sender_address))
        and char_length(email_sender_address) between 3 and 320
        and position('@' in email_sender_address) > 1
      )
    ),
  add constraint organizations_loyalty_ratio_positive
    check (
      loyalty_points_per_unit > 0
      and loyalty_discount_unit_cents > 0
      and loyalty_expiration_months = 24
      and loyalty_reservation_minutes between 5 and 1440
    );

alter table public.releases
  alter column notification_lead_days set default 3;

alter table public.members
  add column birthday date,
  add column last_portal_login_at timestamptz,
  add column paused_until date,
  add column transactional_email_enabled boolean not null default true,
  add column referred_by_member_id uuid,
  add column tier_change_sequence bigint not null default 0,
  add constraint members_referrer_not_self
    check (referred_by_member_id is null or referred_by_member_id <> id),
  add constraint members_referrer_same_organization_fkey
    foreign key (organization_id, referred_by_member_id)
    references public.members (organization_id, id)
    on delete set null (referred_by_member_id),
  add constraint members_tier_change_sequence_nonnegative
    check (tier_change_sequence >= 0);

create index members_referred_by_member_id_idx
  on public.members (referred_by_member_id)
  where referred_by_member_id is not null;

create index members_org_birthday_idx
  on public.members (
    organization_id,
    extract(month from birthday),
    extract(day from birthday)
  )
  where birthday is not null and deleted_at is null;

create index members_org_last_portal_login_idx
  on public.members (organization_id, last_portal_login_at desc)
  where deleted_at is null;

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  trigger_type public.email_trigger_type not null,
  subject text not null,
  body text not null,
  days_before integer,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_templates_subject_length
    check (
      char_length(btrim(subject)) between 1 and 200
      and subject !~ E'[\\r\\n]'
    ),
  constraint email_templates_body_safe
    check (
      char_length(body) between 1 and 100000
      and lower(body) !~ '<[[:space:]]*script'
      and lower(body) !~ 'javascript[[:space:]]*:'
    ),
  constraint email_templates_days_before_consistent
    check (
      (
        trigger_type = 'pre_shipment'
        and days_before between 1 and 30
      )
      or (
        trigger_type <> 'pre_shipment'
        and days_before is null
      )
    ),
  constraint email_templates_organization_id_id_key
    unique (organization_id, id),
  constraint email_templates_organization_trigger_key
    unique (organization_id, trigger_type)
);

create index email_templates_organization_enabled_idx
  on public.email_templates (organization_id, enabled, trigger_type);

create table public.member_email_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  trigger_type public.email_trigger_type not null,
  enabled boolean not null default true,
  unsubscribed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint member_email_preferences_organization_id_id_key
    unique (organization_id, id),
  constraint member_email_preferences_member_trigger_key
    unique (organization_id, member_id, trigger_type),
  constraint member_email_preferences_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint member_email_preferences_unsubscribe_consistent
    check (
      (enabled and unsubscribed_at is null)
      or (not enabled and unsubscribed_at is not null)
    )
);

create index member_email_preferences_member_id_idx
  on public.member_email_preferences (member_id);

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid,
  template_id uuid,
  trigger_type public.email_trigger_type not null,
  is_test boolean not null default false,
  requested_by uuid,
  idempotency_key text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.email_status not null default 'queued',
  resend_id text,
  error_message text,
  scheduled_for timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_log_idempotency_key_format
    check (
      char_length(idempotency_key) between 8 and 255
      and idempotency_key ~ '^[A-Za-z0-9_.:/-]+$'
    ),
  constraint email_log_to_email_normalized
    check (
      to_email = lower(btrim(to_email))
      and char_length(to_email) between 3 and 320
      and position('@' in to_email) > 1
    ),
  constraint email_log_subject_length
    check (char_length(btrim(subject)) between 1 and 200),
  constraint email_log_body_length
    check (char_length(body) between 1 and 100000),
  constraint email_log_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  constraint email_log_test_recipient_consistent
    check (
      (is_test and member_id is null and requested_by is not null)
      or (not is_test and member_id is not null and requested_by is null)
    ),
  constraint email_log_error_length
    check (error_message is null or char_length(error_message) <= 4000),
  constraint email_log_organization_id_id_key
    unique (organization_id, id),
  constraint email_log_org_idempotency_key
    unique (organization_id, idempotency_key),
  constraint email_log_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict,
  constraint email_log_template_same_organization_fkey
    foreign key (organization_id, template_id)
    references public.email_templates (organization_id, id)
    on delete set null (template_id),
  constraint email_log_requested_by_same_organization_fkey
    foreign key (organization_id, requested_by)
    references public.staff_users (organization_id, id)
    on delete restrict
);

create unique index email_log_resend_id_uidx
  on public.email_log (resend_id)
  where resend_id is not null;

create index email_log_org_member_created_idx
  on public.email_log (organization_id, member_id, created_at desc);

create index email_log_requested_by_idx
  on public.email_log (requested_by)
  where requested_by is not null;

create index email_log_org_status_scheduled_idx
  on public.email_log (organization_id, status, scheduled_for);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  email_log_id uuid not null,
  status public.email_outbox_status not null default 'pending',
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  worker_id text,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_outbox_attempt_count_range
    check (attempt_count between 0 and 20),
  constraint email_outbox_worker_length
    check (worker_id is null or char_length(worker_id) between 1 and 200),
  constraint email_outbox_last_error_length
    check (last_error is null or char_length(last_error) <= 4000),
  constraint email_outbox_lease_consistent
    check (
      (status = 'processing' and lease_expires_at is not null and worker_id is not null)
      or (status <> 'processing' and lease_expires_at is null and worker_id is null)
    ),
  constraint email_outbox_organization_id_id_key
    unique (organization_id, id),
  constraint email_outbox_email_log_key
    unique (organization_id, email_log_id),
  constraint email_outbox_email_log_same_organization_fkey
    foreign key (organization_id, email_log_id)
    references public.email_log (organization_id, id)
    on delete cascade
);

create index email_outbox_claim_idx
  on public.email_outbox (available_at, created_at, id)
  where status in ('pending', 'failed');

create index email_outbox_lease_idx
  on public.email_outbox (lease_expires_at)
  where status = 'processing';

create table public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  email_log_id uuid not null,
  provider_event_id text not null,
  event_type public.email_delivery_event_type not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint email_delivery_events_provider_event_id_length
    check (char_length(provider_event_id) between 3 and 255),
  constraint email_delivery_events_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  constraint email_delivery_events_organization_id_id_key
    unique (organization_id, id),
  constraint email_delivery_events_provider_event_key
    unique (provider_event_id),
  constraint email_delivery_events_email_log_same_organization_fkey
    foreign key (organization_id, email_log_id)
    references public.email_log (organization_id, id)
    on delete cascade
);

create index email_delivery_events_log_occurred_idx
  on public.email_delivery_events (email_log_id, occurred_at desc);

create index email_delivery_events_org_type_occurred_idx
  on public.email_delivery_events (organization_id, event_type, occurred_at desc);

create table public.email_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  trigger_type public.email_trigger_type not null,
  token_hash text not null,
  signing_key_id text not null,
  status public.unsubscribe_token_status not null default 'active',
  signed_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_unsubscribe_tokens_hash_format
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint email_unsubscribe_tokens_signing_key_length
    check (char_length(signing_key_id) between 1 and 120),
  constraint email_unsubscribe_tokens_expiry_order
    check (signed_at <= created_at and created_at < expires_at),
  constraint email_unsubscribe_tokens_consumption_consistent
    check (
      (status = 'consumed' and consumed_at is not null)
      or (status <> 'consumed' and consumed_at is null)
    ),
  constraint email_unsubscribe_tokens_organization_id_id_key
    unique (organization_id, id),
  constraint email_unsubscribe_tokens_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade
);

create unique index email_unsubscribe_tokens_hash_uidx
  on public.email_unsubscribe_tokens (token_hash);

create index email_unsubscribe_tokens_active_expiry_idx
  on public.email_unsubscribe_tokens (expires_at)
  where status = 'active';

create table public.churn_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  score integer not null,
  risk_level public.churn_risk_level not null,
  contributing_factors jsonb not null,
  score_date date not null,
  calculated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint churn_scores_score_range
    check (score between 0 and 100),
  constraint churn_scores_risk_consistent
    check (
      (score between 0 and 30 and risk_level = 'low')
      or (score between 31 and 60 and risk_level = 'medium')
      or (score between 61 and 100 and risk_level = 'high')
    ),
  constraint churn_scores_factors_are_object
    check (jsonb_typeof(contributing_factors) = 'object'),
  constraint churn_scores_organization_id_id_key
    unique (organization_id, id),
  constraint churn_scores_member_day_key
    unique (organization_id, member_id, score_date),
  constraint churn_scores_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade
);

create index churn_scores_org_risk_score_idx
  on public.churn_scores (organization_id, score_date desc, risk_level, score desc);

create index churn_scores_member_calculated_idx
  on public.churn_scores (member_id, calculated_at desc);

create table public.cancel_flow_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  step_type public.cancel_step_type not null,
  position integer not null,
  enabled boolean not null default true,
  headline text not null,
  body text not null,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cancel_flow_steps_position_range
    check (position between 1 and 4),
  constraint cancel_flow_steps_copy_length
    check (
      char_length(btrim(headline)) between 1 and 200
      and char_length(body) between 1 and 5000
    ),
  constraint cancel_flow_steps_configuration_is_object
    check (jsonb_typeof(configuration) = 'object'),
  constraint cancel_flow_steps_organization_id_id_key
    unique (organization_id, id),
  constraint cancel_flow_steps_org_type_key
    unique (organization_id, step_type),
  constraint cancel_flow_steps_org_position_key
    unique (organization_id, position)
    deferrable initially immediate
);

create index cancel_flow_steps_org_enabled_position_idx
  on public.cancel_flow_steps (organization_id, enabled, position);

create table public.cancel_flow_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  actor_type public.cancel_actor_type not null,
  status public.cancel_attempt_status not null default 'in_progress',
  current_step_id uuid,
  configuration_snapshot jsonb not null,
  accepted_outcome public.cancel_flow_outcome,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cancel_flow_attempts_configuration_is_array
    check (jsonb_typeof(configuration_snapshot) = 'array'),
  constraint cancel_flow_attempts_completion_consistent
    check (
      (status = 'in_progress' and completed_at is null and accepted_outcome is null)
      or (
        status <> 'in_progress'
        and completed_at is not null
        and accepted_outcome is not null
      )
    ),
  constraint cancel_flow_attempts_organization_id_id_key
    unique (organization_id, id),
  constraint cancel_flow_attempts_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict,
  constraint cancel_flow_attempts_step_same_organization_fkey
    foreign key (organization_id, current_step_id)
    references public.cancel_flow_steps (organization_id, id)
    on delete restrict
);

create unique index cancel_flow_attempts_one_active_uidx
  on public.cancel_flow_attempts (organization_id, member_id)
  where status = 'in_progress';

create index cancel_flow_attempts_org_status_started_idx
  on public.cancel_flow_attempts (organization_id, status, started_at desc);

create index cancel_flow_attempts_member_started_idx
  on public.cancel_flow_attempts (member_id, started_at desc);

create table public.cancel_flow_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  attempt_id uuid not null,
  step_id uuid not null,
  step_position integer not null,
  outcome public.cancel_flow_outcome not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  actor_type public.cancel_actor_type not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cancel_flow_events_step_position_range
    check (step_position between 1 and 4),
  constraint cancel_flow_events_details_is_object
    check (jsonb_typeof(details) = 'object'),
  constraint cancel_flow_events_organization_id_id_key
    unique (organization_id, id),
  constraint cancel_flow_events_attempt_same_organization_fkey
    foreign key (organization_id, attempt_id)
    references public.cancel_flow_attempts (organization_id, id)
    on delete cascade,
  constraint cancel_flow_events_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict,
  constraint cancel_flow_events_step_same_organization_fkey
    foreign key (organization_id, step_id)
    references public.cancel_flow_steps (organization_id, id)
    on delete restrict
);

create index cancel_flow_events_org_step_outcome_idx
  on public.cancel_flow_events (organization_id, step_position, outcome, created_at);

create index cancel_flow_events_attempt_created_idx
  on public.cancel_flow_events (attempt_id, created_at);

create table public.member_activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  event_type public.member_activity_event_type not null,
  source_entity_type text not null,
  source_entity_id uuid not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint member_activity_events_source_type_format
    check (
      char_length(source_entity_type) between 2 and 80
      and source_entity_type ~ '^[a-z0-9_.-]+$'
    ),
  constraint member_activity_events_idempotency_format
    check (
      char_length(idempotency_key) between 8 and 255
      and idempotency_key ~ '^[A-Za-z0-9_.:/-]+$'
    ),
  constraint member_activity_events_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint member_activity_events_organization_id_id_key
    unique (organization_id, id),
  constraint member_activity_events_org_idempotency_key
    unique (organization_id, idempotency_key),
  constraint member_activity_events_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict
);

create index member_activity_events_org_member_type_occurred_idx
  on public.member_activity_events (
    organization_id,
    member_id,
    event_type,
    occurred_at desc
  );

create table public.loyalty_tier_multipliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  club_tier_id uuid not null,
  multiplier numeric(4, 2) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_tier_multipliers_range
    check (multiplier between 1 and 5),
  constraint loyalty_tier_multipliers_organization_id_id_key
    unique (organization_id, id),
  constraint loyalty_tier_multipliers_org_tier_key
    unique (organization_id, club_tier_id),
  constraint loyalty_tier_multipliers_tier_same_organization_fkey
    foreign key (organization_id, club_tier_id)
    references public.club_tiers (organization_id, id)
    on delete cascade
);

create index loyalty_tier_multipliers_club_tier_id_idx
  on public.loyalty_tier_multipliers (club_tier_id);

create table public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  shipment_id uuid not null,
  idempotency_key text not null,
  points integer not null,
  discount_cents integer not null,
  points_per_unit integer not null,
  discount_unit_cents integer not null,
  status public.loyalty_redemption_status not null default 'held',
  held_at timestamptz not null default now(),
  expires_at timestamptz not null,
  applied_at timestamptz,
  released_at timestamptz,
  reversed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_redemptions_idempotency_format
    check (
      char_length(idempotency_key) between 8 and 255
      and idempotency_key ~ '^[A-Za-z0-9_.:/-]+$'
    ),
  constraint loyalty_redemptions_amounts_positive
    check (
      points > 0
      and discount_cents > 0
      and points_per_unit > 0
      and discount_unit_cents > 0
    ),
  constraint loyalty_redemptions_ratio_exact
    check (
      points % points_per_unit = 0
      and discount_cents = (points / points_per_unit) * discount_unit_cents
    ),
  constraint loyalty_redemptions_expiry_order
    check (held_at < expires_at),
  constraint loyalty_redemptions_status_consistent
    check (
      (status = 'held' and applied_at is null and released_at is null and reversed_at is null)
      or (status = 'applied' and applied_at is not null and released_at is null and reversed_at is null)
      or (status in ('released', 'expired') and applied_at is null and released_at is not null and reversed_at is null)
      or (status = 'reversed' and applied_at is not null and released_at is null and reversed_at is not null)
    ),
  constraint loyalty_redemptions_organization_id_id_key
    unique (organization_id, id),
  constraint loyalty_redemptions_org_idempotency_key
    unique (organization_id, idempotency_key),
  constraint loyalty_redemptions_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict,
  constraint loyalty_redemptions_shipment_same_organization_fkey
    foreign key (organization_id, shipment_id)
    references public.shipments (organization_id, id)
    on delete restrict
);

create unique index loyalty_redemptions_active_shipment_uidx
  on public.loyalty_redemptions (organization_id, shipment_id)
  where status in ('held', 'applied');

create index loyalty_redemptions_expiry_idx
  on public.loyalty_redemptions (expires_at)
  where status = 'held';

create index loyalty_redemptions_member_created_idx
  on public.loyalty_redemptions (member_id, created_at desc);

alter table public.shipments
  add column loyalty_discount_cents integer not null default 0,
  add column loyalty_redemption_id uuid,
  add constraint shipments_loyalty_discount_range
    check (loyalty_discount_cents between 0 and charge_amount_cents),
  add constraint shipments_loyalty_redemption_consistent
    check (
      (loyalty_discount_cents = 0 and loyalty_redemption_id is null)
      or (loyalty_discount_cents > 0 and loyalty_redemption_id is not null)
    ),
  add constraint shipments_loyalty_redemption_same_organization_fkey
    foreign key (organization_id, loyalty_redemption_id)
    references public.loyalty_redemptions (organization_id, id)
    on delete restrict;

create index shipments_loyalty_redemption_id_idx
  on public.shipments (loyalty_redemption_id)
  where loyalty_redemption_id is not null;

alter table public.billing_attempts
  drop constraint billing_attempts_amount_positive,
  add constraint billing_attempts_amount_nonnegative
    check (
      amount_cents >= 0
      and (attempt_kind <> 'refund' or amount_cents > 0)
    );

create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  entry_type public.loyalty_ledger_entry_type not null,
  points integer not null,
  reason text not null,
  idempotency_key text not null,
  source_event_type public.member_activity_event_type,
  source_event_id uuid,
  redemption_id uuid,
  actor_user_id uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint loyalty_ledger_points_nonzero
    check (points <> 0),
  constraint loyalty_ledger_reason_length
    check (char_length(btrim(reason)) between 3 and 500),
  constraint loyalty_ledger_idempotency_format
    check (
      char_length(idempotency_key) between 8 and 255
      and idempotency_key ~ '^[A-Za-z0-9_.:/-]+$'
    ),
  constraint loyalty_ledger_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint loyalty_ledger_expiry_consistent
    check (
      (points > 0 and expires_at is not null)
      or points < 0
      or entry_type = 'reservation_release'
    ),
  constraint loyalty_ledger_organization_id_id_key
    unique (organization_id, id),
  constraint loyalty_ledger_org_idempotency_key
    unique (organization_id, idempotency_key),
  constraint loyalty_ledger_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict,
  constraint loyalty_ledger_redemption_same_organization_fkey
    foreign key (organization_id, redemption_id)
    references public.loyalty_redemptions (organization_id, id)
    on delete restrict
);

create index loyalty_ledger_org_member_created_idx
  on public.loyalty_ledger (organization_id, member_id, created_at desc, id);

create index loyalty_ledger_source_event_id_idx
  on public.loyalty_ledger (source_event_id)
  where source_event_id is not null;

create table public.loyalty_point_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  award_ledger_id uuid not null,
  awarded_points integer not null,
  remaining_points integer not null,
  reserved_points integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_point_lots_amount_range
    check (
      awarded_points > 0
      and remaining_points between 0 and awarded_points
      and reserved_points between 0 and remaining_points
    ),
  constraint loyalty_point_lots_expiry_after_creation
    check (expires_at > created_at),
  constraint loyalty_point_lots_organization_id_id_key
    unique (organization_id, id),
  constraint loyalty_point_lots_award_key
    unique (organization_id, award_ledger_id),
  constraint loyalty_point_lots_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict,
  constraint loyalty_point_lots_award_same_organization_fkey
    foreign key (organization_id, award_ledger_id)
    references public.loyalty_ledger (organization_id, id)
    on delete restrict
);

create index loyalty_point_lots_fifo_idx
  on public.loyalty_point_lots (
    organization_id,
    member_id,
    expires_at,
    created_at,
    id
  )
  where remaining_points > 0;

create table public.loyalty_reservation_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  redemption_id uuid not null,
  lot_id uuid not null,
  points integer not null,
  created_at timestamptz not null default now(),
  constraint loyalty_reservation_allocations_points_positive
    check (points > 0),
  constraint loyalty_reservation_allocations_organization_id_id_key
    unique (organization_id, id),
  constraint loyalty_reservation_allocations_redemption_lot_key
    unique (organization_id, redemption_id, lot_id),
  constraint loyalty_reservation_allocations_redemption_same_organization_fkey
    foreign key (organization_id, redemption_id)
    references public.loyalty_redemptions (organization_id, id)
    on delete cascade,
  constraint loyalty_reservation_allocations_lot_same_organization_fkey
    foreign key (organization_id, lot_id)
    references public.loyalty_point_lots (organization_id, id)
    on delete restrict
);

create index loyalty_reservation_allocations_lot_id_idx
  on public.loyalty_reservation_allocations (lot_id);

create or replace function private.seed_phase3_organization_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_templates (
    organization_id,
    trigger_type,
    subject,
    body,
    days_before
  )
  values
    (
      new.id,
      'welcome',
      'Welcome to {{organization_name}}',
      '<p>Welcome, {{member_first_name}}. We are delighted to have you in the club.</p>',
      null
    ),
    (
      new.id,
      'pre_shipment',
      'Your next wine club shipment is coming',
      '<p>Your {{release_name}} shipment is scheduled for {{processing_date}}.</p>',
      3
    ),
    (
      new.id,
      'payment_decline',
      'Action needed for your wine club shipment',
      '<p>We could not process your payment. Please update your payment method.</p>',
      null
    ),
    (
      new.id,
      'shipped',
      'Your wine club shipment is on its way',
      '<p>Your shipment has shipped. Tracking: {{tracking_number}}</p>',
      null
    ),
    (
      new.id,
      'birthday',
      'Happy birthday from {{organization_name}}',
      '<p>Happy birthday, {{member_first_name}}!</p>',
      null
    ),
    (
      new.id,
      're_engagement',
      'We miss you at {{organization_name}}',
      '<p>It has been a while. Visit your member portal to see what is new.</p>',
      null
    )
  on conflict (organization_id, trigger_type) do nothing;

  insert into public.cancel_flow_steps (
    organization_id,
    step_type,
    position,
    headline,
    body,
    configuration
  )
  values
    (
      new.id,
      'pause',
      1,
      'Would you like to pause instead?',
      'Keep your benefits and pause for one or three months.',
      '{"pause_months":[1,3]}'::jsonb
    ),
    (
      new.id,
      'downgrade',
      2,
      'Would a lower tier work better?',
      'Switch to a lower-priced active club tier.',
      '{}'::jsonb
    ),
    (
      new.id,
      'swap',
      3,
      'Customize your next shipment',
      'Choose a wine swap instead of cancelling.',
      '{}'::jsonb
    ),
    (
      new.id,
      'confirm',
      4,
      'Are you sure you want to cancel?',
      'Cancelling ends club benefits and future loyalty earning.',
      '{}'::jsonb
    )
  on conflict (organization_id, step_type) do nothing;

  return new;
end;
$$;

create trigger organizations_seed_phase3_defaults
after insert on public.organizations
for each row execute function private.seed_phase3_organization_defaults();

insert into public.email_templates (
  organization_id,
  trigger_type,
  subject,
  body,
  days_before
)
select
  o.id,
  seed.trigger_type::public.email_trigger_type,
  seed.subject,
  seed.body,
  seed.days_before
from public.organizations as o
cross join (
  values
    (
      'welcome',
      'Welcome to {{organization_name}}',
      '<p>Welcome, {{member_first_name}}. We are delighted to have you in the club.</p>',
      null::integer
    ),
    (
      'pre_shipment',
      'Your next wine club shipment is coming',
      '<p>Your {{release_name}} shipment is scheduled for {{processing_date}}.</p>',
      3
    ),
    (
      'payment_decline',
      'Action needed for your wine club shipment',
      '<p>We could not process your payment. Please update your payment method.</p>',
      null
    ),
    (
      'shipped',
      'Your wine club shipment is on its way',
      '<p>Your shipment has shipped. Tracking: {{tracking_number}}</p>',
      null
    ),
    (
      'birthday',
      'Happy birthday from {{organization_name}}',
      '<p>Happy birthday, {{member_first_name}}!</p>',
      null
    ),
    (
      're_engagement',
      'We miss you at {{organization_name}}',
      '<p>It has been a while. Visit your member portal to see what is new.</p>',
      null
    )
) as seed(trigger_type, subject, body, days_before)
on conflict (organization_id, trigger_type) do nothing;

insert into public.cancel_flow_steps (
  organization_id,
  step_type,
  position,
  headline,
  body,
  configuration
)
select
  o.id,
  seed.step_type::public.cancel_step_type,
  seed.position,
  seed.headline,
  seed.body,
  seed.configuration
from public.organizations as o
cross join (
  values
    (
      'pause',
      1,
      'Would you like to pause instead?',
      'Keep your benefits and pause for one or three months.',
      '{"pause_months":[1,3]}'::jsonb
    ),
    (
      'downgrade',
      2,
      'Would a lower tier work better?',
      'Switch to a lower-priced active club tier.',
      '{}'::jsonb
    ),
    (
      'swap',
      3,
      'Customize your next shipment',
      'Choose a wine swap instead of cancelling.',
      '{}'::jsonb
    ),
    (
      'confirm',
      4,
      'Are you sure you want to cancel?',
      'Cancelling ends club benefits and future loyalty earning.',
      '{}'::jsonb
    )
) as seed(step_type, position, headline, body, configuration)
on conflict (organization_id, step_type) do nothing;

insert into public.loyalty_tier_multipliers (
  organization_id,
  club_tier_id,
  multiplier
)
select
  t.organization_id,
  t.id,
  case
    when lower(btrim(t.name)) like '%estate%'
      or lower(btrim(t.name)) like '%reserve%' then 1.50
    when lower(btrim(t.name)) like '%cellar%' then 1.25
    else 1.00
  end
from public.club_tiers as t
on conflict (organization_id, club_tier_id) do nothing;

create or replace function private.seed_loyalty_tier_multiplier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.loyalty_tier_multipliers (
    organization_id,
    club_tier_id,
    multiplier
  )
  values (
    new.organization_id,
    new.id,
    case
      when lower(btrim(new.name)) like '%estate%'
        or lower(btrim(new.name)) like '%reserve%' then 1.50
      when lower(btrim(new.name)) like '%cellar%' then 1.25
      else 1.00
    end
  )
  on conflict (organization_id, club_tier_id) do nothing;
  return new;
end;
$$;

create trigger club_tiers_seed_loyalty_multiplier
after insert on public.club_tiers
for each row execute function private.seed_loyalty_tier_multiplier();

create trigger email_templates_touch_updated_at
before update on public.email_templates
for each row execute function private.touch_updated_at();

create trigger member_email_preferences_touch_updated_at
before update on public.member_email_preferences
for each row execute function private.touch_updated_at();

create trigger email_log_touch_updated_at
before update on public.email_log
for each row execute function private.touch_updated_at();

create trigger email_outbox_touch_updated_at
before update on public.email_outbox
for each row execute function private.touch_updated_at();

create trigger cancel_flow_steps_touch_updated_at
before update on public.cancel_flow_steps
for each row execute function private.touch_updated_at();

create trigger cancel_flow_attempts_touch_updated_at
before update on public.cancel_flow_attempts
for each row execute function private.touch_updated_at();

create trigger loyalty_tier_multipliers_touch_updated_at
before update on public.loyalty_tier_multipliers
for each row execute function private.touch_updated_at();

create trigger loyalty_redemptions_touch_updated_at
before update on public.loyalty_redemptions
for each row execute function private.touch_updated_at();

create trigger loyalty_point_lots_touch_updated_at
before update on public.loyalty_point_lots
for each row execute function private.touch_updated_at();

create or replace function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = tg_table_name || ' is append-only';
end;
$$;

create trigger email_delivery_events_reject_update_delete
before update or delete on public.email_delivery_events
for each row execute function private.reject_append_only_mutation();

create trigger email_delivery_events_reject_truncate
before truncate on public.email_delivery_events
for each statement execute function private.reject_append_only_mutation();

create trigger churn_scores_reject_update_delete
before delete on public.churn_scores
for each row execute function private.reject_append_only_mutation();

create trigger cancel_flow_events_reject_update_delete
before update or delete on public.cancel_flow_events
for each row execute function private.reject_append_only_mutation();

create trigger cancel_flow_events_reject_truncate
before truncate on public.cancel_flow_events
for each statement execute function private.reject_append_only_mutation();

create trigger member_activity_events_reject_update_delete
before update or delete on public.member_activity_events
for each row execute function private.reject_append_only_mutation();

create trigger member_activity_events_reject_truncate
before truncate on public.member_activity_events
for each statement execute function private.reject_append_only_mutation();

create trigger loyalty_ledger_reject_update_delete
before update or delete on public.loyalty_ledger
for each row execute function private.reject_append_only_mutation();

create trigger loyalty_ledger_reject_truncate
before truncate on public.loyalty_ledger
for each statement execute function private.reject_append_only_mutation();

create or replace function private.resolve_retention_actor(
  p_organization_id uuid,
  p_member_id uuid,
  p_actor_user_id uuid default null
)
returns table (
  actor_user_id uuid,
  actor_type public.cancel_actor_type
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor_user_id uuid := coalesce(v_auth_user_id, p_actor_user_id);
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'An authenticated actor is required.';
  end if;

  if v_auth_user_id is not null and p_actor_user_id is not null
    and v_auth_user_id <> p_actor_user_id
  then
    raise exception using errcode = '42501', message = 'Actor identity mismatch.';
  end if;

  if v_auth_user_id is null
    and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
  then
    raise exception using errcode = '42501', message = 'Service authorization is required.';
  end if;

  if exists (
    select 1
    from public.staff_users as s
    where s.id = v_actor_user_id
      and s.organization_id = p_organization_id
      and s.status = 'active'
  ) then
    actor_user_id := v_actor_user_id;
    actor_type := 'staff';
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.members as m
    where m.id = p_member_id
      and m.organization_id = p_organization_id
      and m.auth_user_id = v_actor_user_id
      and m.deleted_at is null
  ) then
    actor_user_id := v_actor_user_id;
    actor_type := 'member';
    return next;
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Actor cannot manage this member.';
end;
$$;

create or replace function public.enqueue_email_trigger(
  p_organization_id uuid,
  p_member_id uuid,
  p_trigger_type public.email_trigger_type,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_scheduled_for timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_log_id uuid;
  v_member public.members%rowtype;
  v_template public.email_templates%rowtype;
  v_organization_name text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Email payload must be an object.';
  end if;

  select l.id
  into v_existing_id
  from public.email_log as l
  where l.organization_id = p_organization_id
    and l.idempotency_key = p_idempotency_key;

  if found then
    return v_existing_id;
  end if;

  select m.*
  into v_member
  from public.members as m
  where m.id = p_member_id
    and m.organization_id = p_organization_id
    and m.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Member not found.';
  end if;

  select organization.name
  into v_organization_name
  from public.organizations as organization
  where organization.id = p_organization_id;

  if not v_member.transactional_email_enabled then
    return null;
  end if;

  if exists (
    select 1
    from public.member_email_preferences as preference
    where preference.organization_id = p_organization_id
      and preference.member_id = p_member_id
      and preference.trigger_type = p_trigger_type
      and not preference.enabled
  ) then
    return null;
  end if;

  select template.*
  into v_template
  from public.email_templates as template
  where template.organization_id = p_organization_id
    and template.trigger_type = p_trigger_type
    and template.enabled;

  if not found then
    return null;
  end if;

  insert into public.email_log (
    organization_id,
    member_id,
    template_id,
    trigger_type,
    idempotency_key,
    to_email,
    subject,
    body,
    payload,
    scheduled_for
  )
  values (
    p_organization_id,
    p_member_id,
    v_template.id,
    p_trigger_type,
    p_idempotency_key,
    v_member.email,
    v_template.subject,
    v_template.body,
    p_payload || jsonb_build_object(
      'organization_name', v_organization_name,
      'member_first_name', v_member.first_name,
      'member_last_name', v_member.last_name,
      'member_email', v_member.email
    ),
    p_scheduled_for
  )
  on conflict (organization_id, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning id into v_log_id;

  insert into public.email_outbox (
    organization_id,
    email_log_id,
    available_at
  )
  values (p_organization_id, v_log_id, p_scheduled_for)
  on conflict (organization_id, email_log_id) do nothing;

  return v_log_id;
end;
$$;

create or replace function public.claim_email_outbox_batch(
  p_worker_id text,
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (
  outbox_id uuid,
  email_log_id uuid,
  organization_id uuid,
  member_id uuid,
  to_email text,
  trigger_type public.email_trigger_type,
  subject text,
  body text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Worker ID is required.';
  end if;
  if p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Email claim limit must be between 1 and 100.';
  end if;
  if p_lease_seconds not between 30 and 1800 then
    raise exception using errcode = '22023', message = 'Email lease must be between 30 and 1800 seconds.';
  end if;

  update public.email_outbox as expired
  set
    status = 'failed',
    available_at = now(),
    lease_expires_at = null,
    worker_id = null,
    last_error = 'lease_expired'
  where expired.status = 'processing'
    and expired.lease_expires_at <= now();

  return query
  with claimed as (
    select outbox.id
    from public.email_outbox as outbox
    where outbox.status in ('pending', 'failed')
      and outbox.available_at <= now()
      and outbox.attempt_count < 5
    order by outbox.available_at, outbox.created_at, outbox.id
    limit p_limit
    for update skip locked
  ),
  updated as (
    update public.email_outbox as outbox
    set
      status = 'processing',
      worker_id = btrim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = outbox.attempt_count + 1,
      last_error = null
    from claimed
    where outbox.id = claimed.id
    returning outbox.*
  )
  select
    updated.id,
    log.id,
    log.organization_id,
    log.member_id,
    log.to_email,
    log.trigger_type,
    log.subject,
    log.body,
    log.payload,
    updated.attempt_count
  from updated
  join public.email_log as log
    on log.id = updated.email_log_id
    and log.organization_id = updated.organization_id;

  update public.email_log as log
  set status = 'processing', claimed_at = coalesce(log.claimed_at, now())
  where exists (
    select 1
    from public.email_outbox as outbox
    where outbox.email_log_id = log.id
      and outbox.organization_id = log.organization_id
      and outbox.worker_id = btrim(p_worker_id)
      and outbox.status = 'processing'
      and outbox.lease_expires_at > now()
  );
end;
$$;

create or replace function public.enqueue_test_email(
  p_organization_id uuid,
  p_template_id uuid,
  p_to_email text,
  p_subject text,
  p_body text,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.email_templates%rowtype;
  v_log_id uuid;
begin
  if not exists (
    select 1
    from public.staff_users as staff
    where staff.id = p_actor_user_id
      and staff.organization_id = p_organization_id
      and staff.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active staff authorization is required.';
  end if;
  if lower(btrim(p_to_email)) <> p_to_email
    or char_length(p_to_email) not between 3 and 320
    or position('@' in p_to_email) <= 1
  then
    raise exception using errcode = '22023', message = 'Test recipient email is invalid.';
  end if;
  if char_length(btrim(p_subject)) not between 1 and 200
    or p_subject ~ E'[\\r\\n]'
  then
    raise exception using errcode = '22023', message = 'Test subject is invalid.';
  end if;
  if char_length(p_body) not between 1 and 100000
    or lower(p_body) ~ '<[[:space:]]*script'
    or lower(p_body) ~ 'javascript[[:space:]]*:'
  then
    raise exception using errcode = '22023', message = 'Test email body is unsafe.';
  end if;

  select template.*
  into v_template
  from public.email_templates as template
  where template.id = p_template_id
    and template.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Email template not found.';
  end if;

  insert into public.email_log (
    organization_id,
    member_id,
    template_id,
    trigger_type,
    is_test,
    requested_by,
    idempotency_key,
    to_email,
    subject,
    body,
    payload
  )
  values (
    p_organization_id,
    null,
    v_template.id,
    v_template.trigger_type,
    true,
    p_actor_user_id,
    p_idempotency_key,
    p_to_email,
    p_subject,
    p_body,
    jsonb_build_object('test', true)
  )
  on conflict (organization_id, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning id into v_log_id;

  insert into public.email_outbox (
    organization_id,
    email_log_id,
    available_at
  )
  values (p_organization_id, v_log_id, now())
  on conflict (organization_id, email_log_id) do nothing;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    'email.test_queued',
    'email_log',
    v_log_id,
    jsonb_build_object(
      'template_id', p_template_id,
      'recipient_domain', split_part(p_to_email, '@', 2)
    )
  );

  return v_log_id;
end;
$$;

create or replace function public.mark_email_delivery(
  p_organization_id uuid,
  p_email_log_id uuid,
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
  v_updated integer;
begin
  if p_status not in ('sent', 'delivered', 'failed', 'bounced') then
    raise exception using errcode = '22023', message = 'Unsupported delivery status.';
  end if;

  update public.email_log as log
  set
    status = p_status,
    resend_id = coalesce(p_resend_id, log.resend_id),
    error_message = case when p_status in ('failed', 'bounced') then left(p_error, 4000) else null end,
    sent_at = case when p_status in ('sent', 'delivered') then coalesce(log.sent_at, now()) else log.sent_at end,
    delivered_at = case when p_status = 'delivered' then coalesce(log.delivered_at, now()) else log.delivered_at end,
    failed_at = case when p_status = 'failed' then coalesce(log.failed_at, now()) else log.failed_at end,
    bounced_at = case when p_status = 'bounced' then coalesce(log.bounced_at, now()) else log.bounced_at end
  where log.id = p_email_log_id
    and log.organization_id = p_organization_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  update public.email_outbox as outbox
  set
    status = case
      when p_status in ('sent', 'delivered', 'bounced') then 'completed'::public.email_outbox_status
      when outbox.attempt_count >= 5 then 'completed'::public.email_outbox_status
      else 'failed'::public.email_outbox_status
    end,
    available_at = case
      when p_status = 'failed' and outbox.attempt_count < 5
        then now() + make_interval(secs => least(900, 30 * (2 ^ outbox.attempt_count)::integer))
      else outbox.available_at
    end,
    lease_expires_at = null,
    worker_id = null,
    last_error = case when p_status = 'failed' then left(p_error, 4000) else null end
  where outbox.organization_id = p_organization_id
    and outbox.email_log_id = p_email_log_id;

  return true;
end;
$$;

create or replace function public.record_email_delivery_event(
  p_organization_id uuid,
  p_email_log_id uuid,
  p_provider_event_id text,
  p_event_type public.email_delivery_event_type,
  p_occurred_at timestamptz,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Delivery payload must be an object.';
  end if;

  insert into public.email_delivery_events (
    organization_id,
    email_log_id,
    provider_event_id,
    event_type,
    occurred_at,
    payload
  )
  values (
    p_organization_id,
    p_email_log_id,
    p_provider_event_id,
    p_event_type,
    p_occurred_at,
    p_payload
  )
  on conflict (provider_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  if p_event_type = 'delivered' then
    perform public.mark_email_delivery(
      p_organization_id,
      p_email_log_id,
      'delivered',
      null,
      null
    );
  elsif p_event_type = 'bounced' then
    perform public.mark_email_delivery(
      p_organization_id,
      p_email_log_id,
      'bounced',
      null,
      'Provider reported a bounce.'
    );
  elsif p_event_type = 'failed' then
    perform public.mark_email_delivery(
      p_organization_id,
      p_email_log_id,
      'failed',
      null,
      'Provider reported delivery failure.'
    );
  end if;

  return true;
end;
$$;

create or replace function public.issue_email_unsubscribe_token(
  p_organization_id uuid,
  p_member_id uuid,
  p_trigger_type public.email_trigger_type,
  p_signed_token text,
  p_signing_key_id text,
  p_signed_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_token_hash text;
begin
  if char_length(p_signed_token) not between 32 and 2048 then
    raise exception using errcode = '22023', message = 'Signed unsubscribe token has an invalid length.';
  end if;
  if p_expires_at <= now() or p_signed_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Unsubscribe token timestamps are invalid.';
  end if;

  v_token_hash := encode(
    extensions.digest(convert_to(p_signed_token, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.email_unsubscribe_tokens (
    organization_id,
    member_id,
    trigger_type,
    token_hash,
    signing_key_id,
    signed_at,
    expires_at
  )
  values (
    p_organization_id,
    p_member_id,
    p_trigger_type,
    v_token_hash,
    p_signing_key_id,
    p_signed_at,
    p_expires_at
  )
  on conflict (token_hash)
  do update set token_hash = excluded.token_hash
  returning id into v_token_id;

  return v_token_id;
end;
$$;

create or replace function public.apply_email_unsubscribe(
  p_signed_token text
)
returns table (
  organization_id uuid,
  member_id uuid,
  trigger_type public.email_trigger_type
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.email_unsubscribe_tokens%rowtype;
  v_token_hash text;
begin
  if char_length(p_signed_token) not between 32 and 2048 then
    raise exception using errcode = '22023', message = 'Signed unsubscribe token has an invalid length.';
  end if;

  v_token_hash := encode(
    extensions.digest(convert_to(p_signed_token, 'UTF8'), 'sha256'),
    'hex'
  );

  select token.*
  into v_token
  from public.email_unsubscribe_tokens as token
  where token.token_hash = v_token_hash
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Unsubscribe token not found.';
  end if;
  if v_token.status <> 'active' or v_token.expires_at <= now() then
    raise exception using errcode = '22023', message = 'Unsubscribe token is expired or already used.';
  end if;

  update public.email_unsubscribe_tokens
  set status = 'consumed', consumed_at = now()
  where id = v_token.id;

  insert into public.member_email_preferences (
    organization_id,
    member_id,
    trigger_type,
    enabled,
    unsubscribed_at
  )
  values (
    v_token.organization_id,
    v_token.member_id,
    v_token.trigger_type,
    false,
    now()
  )
  on conflict on constraint member_email_preferences_member_trigger_key
  do update set enabled = false, unsubscribed_at = now();

  organization_id := v_token.organization_id;
  member_id := v_token.member_id;
  trigger_type := v_token.trigger_type;
  return next;
end;
$$;

create or replace function public.enqueue_due_email_triggers(
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_log_id uuid;
  v_queued integer := 0;
begin
  for v_record in
    select distinct
      release.organization_id,
      member.id as member_id,
      release.id as release_id,
      release.name as release_name,
      release.processing_date
    from public.releases as release
    join public.release_tiers as release_tier
      on release_tier.release_id = release.id
      and release_tier.organization_id = release.organization_id
    join public.members as member
      on member.organization_id = release.organization_id
      and member.club_tier_id = release_tier.tier_id
      and member.status = 'active'
      and member.deleted_at is null
    join public.email_templates as template
      on template.organization_id = release.organization_id
      and template.trigger_type = 'pre_shipment'
      and template.enabled
    where release.status = 'scheduled'
      and release.processing_date = (p_as_of at time zone 'UTC')::date + template.days_before
  loop
    v_log_id := public.enqueue_email_trigger(
      v_record.organization_id,
      v_record.member_id,
      'pre_shipment',
      'email:pre_shipment:' || v_record.release_id::text || ':' || v_record.member_id::text,
      jsonb_build_object(
        'release_id', v_record.release_id,
        'release_name', v_record.release_name,
        'processing_date', v_record.processing_date
      ),
      p_as_of
    );
    if v_log_id is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  for v_record in
    select member.organization_id, member.id as member_id
    from public.members as member
    where member.birthday is not null
      and member.status = 'active'
      and member.deleted_at is null
      and extract(month from member.birthday) =
        extract(month from (p_as_of at time zone 'UTC')::date)
      and extract(day from member.birthday) =
        extract(day from (p_as_of at time zone 'UTC')::date)
  loop
    v_log_id := public.enqueue_email_trigger(
      v_record.organization_id,
      v_record.member_id,
      'birthday',
      'email:birthday:' || extract(year from p_as_of at time zone 'UTC')::integer::text
        || ':' || v_record.member_id::text,
      jsonb_build_object('occasion_date', (p_as_of at time zone 'UTC')::date),
      p_as_of
    );
    if v_log_id is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  for v_record in
    select member.organization_id, member.id as member_id
    from public.members as member
    left join lateral (
      select max(activity.occurred_at) as last_activity_at
      from public.member_activity_events as activity
      where activity.organization_id = member.organization_id
        and activity.member_id = member.id
        and activity.event_type in ('portal_login', 'shipment_delivered')
    ) as activity on true
    where member.status = 'active'
      and member.deleted_at is null
      and greatest(
        member.created_at,
        coalesce(member.last_portal_login_at, '-infinity'::timestamptz),
        coalesce(activity.last_activity_at, '-infinity'::timestamptz)
      ) <= p_as_of - interval '60 days'
  loop
    v_log_id := public.enqueue_email_trigger(
      v_record.organization_id,
      v_record.member_id,
      're_engagement',
      'email:re_engagement:initial:' || v_record.member_id::text,
      jsonb_build_object('inactive_days', 60),
      p_as_of
    );
    if v_log_id is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  return v_queued;
end;
$$;

create or replace function private.enqueue_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_email_trigger(
    new.organization_id,
    new.id,
    'welcome',
    'email:welcome:' || new.id::text,
    jsonb_build_object('member_id', new.id),
    now()
  );
  return new;
end;
$$;

create trigger members_enqueue_welcome_email
after insert on public.members
for each row execute function private.enqueue_welcome_email();

create or replace function public.calculate_nightly_churn_scores(
  p_calculated_at timestamptz default now(),
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score_date date := (p_calculated_at at time zone 'UTC')::date;
  v_count integer;
begin
  with shipment_stats as (
    select
      shipment.organization_id,
      shipment.member_id,
      max(
        greatest(
          shipment.delivered_at,
          shipment.shipped_at,
          shipment.packed_at,
          shipment.label_created_at,
          shipment.paid_at,
          shipment.updated_at
        )
      ) as last_shipment_interaction_at
    from public.shipments as shipment
    where shipment.created_at >= p_calculated_at - interval '3 years'
      and (p_organization_id is null or shipment.organization_id = p_organization_id)
    group by shipment.organization_id, shipment.member_id
  ),
  decline_stats as (
    select
      attempt.organization_id,
      shipment.member_id,
      count(*)::integer as declined_charge_count
    from public.billing_attempts as attempt
    join public.shipments as shipment
      on shipment.id = attempt.shipment_id
      and shipment.organization_id = attempt.organization_id
    where attempt.status = 'declined'
      and attempt.created_at >= p_calculated_at - interval '12 months'
      and (p_organization_id is null or attempt.organization_id = p_organization_id)
    group by attempt.organization_id, shipment.member_id
  ),
  email_stats as (
    select
      log.organization_id,
      log.member_id,
      count(*) filter (
        where log.status in ('sent', 'delivered', 'bounced')
      )::integer as sent_count,
      count(*) filter (
        where exists (
          select 1
          from public.email_delivery_events as event
          where event.email_log_id = log.id
            and event.organization_id = log.organization_id
            and event.event_type = 'opened'
        )
      )::integer as opened_count,
      count(*) filter (
        where exists (
          select 1
          from public.email_delivery_events as event
          where event.email_log_id = log.id
            and event.organization_id = log.organization_id
            and event.event_type = 'clicked'
        )
      )::integer as clicked_count
    from public.email_log as log
    where log.created_at >= p_calculated_at - interval '90 days'
      and (p_organization_id is null or log.organization_id = p_organization_id)
    group by log.organization_id, log.member_id
  ),
  activity_stats as (
    select
      activity.organization_id,
      activity.member_id,
      max(activity.occurred_at) filter (
        where activity.event_type = 'portal_login'
      ) as last_portal_login_at,
      count(*) filter (
        where activity.event_type = 'tier_downgrade'
          and activity.occurred_at >= p_calculated_at - interval '12 months'
      )::integer as downgrade_count
    from public.member_activity_events as activity
    where activity.occurred_at >= p_calculated_at - interval '12 months'
      and (p_organization_id is null or activity.organization_id = p_organization_id)
    group by activity.organization_id, activity.member_id
  ),
  inputs as (
    select
      member.organization_id,
      member.id as member_id,
      coalesce(
        (p_calculated_at::date - shipment.last_shipment_interaction_at::date),
        9999
      )::integer as shipment_inactive_days,
      coalesce(decline.declined_charge_count, 0) as declined_charge_count,
      greatest(0, p_calculated_at::date - member.joined_on)::integer
        as membership_days,
      coalesce(email.sent_count, 0) as sent_count,
      coalesce(email.opened_count, 0) as opened_count,
      coalesce(email.clicked_count, 0) as clicked_count,
      coalesce(
        member.last_portal_login_at,
        activity.last_portal_login_at
      ) as last_portal_login_at,
      coalesce(activity.downgrade_count, 0) as downgrade_count
    from public.members as member
    left join shipment_stats as shipment
      on shipment.organization_id = member.organization_id
      and shipment.member_id = member.id
    left join decline_stats as decline
      on decline.organization_id = member.organization_id
      and decline.member_id = member.id
    left join email_stats as email
      on email.organization_id = member.organization_id
      and email.member_id = member.id
    left join activity_stats as activity
      on activity.organization_id = member.organization_id
      and activity.member_id = member.id
    where member.deleted_at is null
      and (p_organization_id is null or member.organization_id = p_organization_id)
  ),
  weighted as (
    select
      inputs.*,
      case
        when shipment_inactive_days >= 180 then 35
        when shipment_inactive_days >= 90 then 25
        when shipment_inactive_days >= 60 then 15
        when shipment_inactive_days >= 30 then 8
        else 0
      end as shipment_weight,
      least(30, declined_charge_count * 10) as decline_weight,
      case
        when membership_days >= 730 then -15
        when membership_days >= 365 then -10
        when membership_days >= 180 then -5
        else 0
      end as tenure_weight,
      case
        when sent_count = 0 then 5
        when opened_count::numeric / sent_count < 0.05 then 10
        when opened_count::numeric / sent_count < 0.20 then 5
        else 0
      end as email_open_weight,
      case
        when sent_count = 0 then 5
        when clicked_count::numeric / sent_count < 0.02 then 10
        when clicked_count::numeric / sent_count < 0.10 then 5
        else 0
      end as email_click_weight,
      case
        when last_portal_login_at is null then 10
        when last_portal_login_at >= p_calculated_at - interval '30 days' then -10
        when last_portal_login_at >= p_calculated_at - interval '90 days' then -5
        else 5
      end as portal_weight,
      least(20, downgrade_count * 10) as downgrade_weight
    from inputs
  ),
  scored as (
    select
      weighted.*,
      greatest(
        0,
        least(
          100,
          20
          + shipment_weight
          + decline_weight
          + tenure_weight
          + email_open_weight
          + email_click_weight
          + portal_weight
          + downgrade_weight
        )
      )::integer as score
    from weighted
  ),
  inserted as (
    insert into public.churn_scores (
      organization_id,
      member_id,
      score,
      risk_level,
      contributing_factors,
      score_date,
      calculated_at
    )
    select
      scored.organization_id,
      scored.member_id,
      scored.score,
      case
        when scored.score <= 30 then 'low'::public.churn_risk_level
        when scored.score <= 60 then 'medium'::public.churn_risk_level
        else 'high'::public.churn_risk_level
      end,
      jsonb_build_object(
        'rules_version', 1,
        'base_score', 20,
        'shipment_inactivity', jsonb_build_object(
          'days', scored.shipment_inactive_days,
          'weight', scored.shipment_weight
        ),
        'declined_charges_12m', jsonb_build_object(
          'count', scored.declined_charge_count,
          'weight', scored.decline_weight
        ),
        'membership_tenure', jsonb_build_object(
          'days', scored.membership_days,
          'weight', scored.tenure_weight
        ),
        'email_open_rate_90d', jsonb_build_object(
          'sent', scored.sent_count,
          'opened', scored.opened_count,
          'rate', case
            when scored.sent_count = 0 then null
            else round(scored.opened_count::numeric / scored.sent_count, 4)
          end,
          'weight', scored.email_open_weight
        ),
        'email_click_rate_90d', jsonb_build_object(
          'sent', scored.sent_count,
          'clicked', scored.clicked_count,
          'rate', case
            when scored.sent_count = 0 then null
            else round(scored.clicked_count::numeric / scored.sent_count, 4)
          end,
          'weight', scored.email_click_weight
        ),
        'portal_activity', jsonb_build_object(
          'last_login_at', scored.last_portal_login_at,
          'weight', scored.portal_weight
        ),
        'tier_downgrades_12m', jsonb_build_object(
          'count', scored.downgrade_count,
          'weight', scored.downgrade_weight
        )
      ),
      v_score_date,
      p_calculated_at
    from scored
    on conflict (organization_id, member_id, score_date)
    do update set
      score = excluded.score,
      risk_level = excluded.risk_level,
      contributing_factors = excluded.contributing_factors,
      calculated_at = excluded.calculated_at
    returning organization_id, member_id, score
  )
  update public.members as member
  set churn_risk_score = inserted.score
  from inserted
  where member.organization_id = inserted.organization_id
    and member.id = inserted.member_id;

  select count(*)::integer
  into v_count
  from public.churn_scores as score
  where score.score_date = v_score_date
    and (p_organization_id is null or score.organization_id = p_organization_id);

  return v_count;
end;
$$;

create or replace function public.update_cancel_flow_configuration(
  p_organization_id uuid,
  p_steps jsonb,
  p_actor_user_id uuid default null
)
returns setof public.cancel_flow_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from private.resolve_retention_actor(
    p_organization_id,
    null,
    p_actor_user_id
  );

  if v_actor.actor_type <> 'staff' then
    raise exception using errcode = '42501', message = 'Staff authorization is required.';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array'
    or jsonb_array_length(p_steps) <> 4
  then
    raise exception using errcode = '22023', message = 'Cancel configuration must contain all four steps.';
  end if;
  if (
    select count(distinct fixture.step_type)
    from jsonb_to_recordset(p_steps) as fixture(step_type text)
    where fixture.step_type in ('pause', 'downgrade', 'swap', 'confirm')
  ) <> 4 then
    raise exception using errcode = '22023', message = 'Cancel step types must be unique and complete.';
  end if;
  if (
    select count(distinct fixture.position)
    from jsonb_to_recordset(p_steps) as fixture(position integer)
    where fixture.position between 1 and 4
  ) <> 4 then
    raise exception using errcode = '22023', message = 'Cancel step positions must be unique from 1 through 4.';
  end if;

  set constraints cancel_flow_steps_org_position_key deferred;

  update public.cancel_flow_steps as step
  set
    position = fixture.position,
    enabled = fixture.enabled,
    headline = fixture.headline,
    body = fixture.body,
    configuration = coalesce(fixture.configuration, '{}'::jsonb)
  from jsonb_to_recordset(p_steps) as fixture(
    step_type text,
    position integer,
    enabled boolean,
    headline text,
    body text,
    configuration jsonb
  )
  where step.organization_id = p_organization_id
    and step.step_type::text = fixture.step_type;

  perform public.append_audit_entry(
    p_organization_id,
    v_actor.actor_user_id,
    'cancel_flow.configuration_updated',
    'organization',
    p_organization_id,
    jsonb_build_object('steps', p_steps)
  );

  return query
  select step.*
  from public.cancel_flow_steps as step
  where step.organization_id = p_organization_id
  order by step.position;
end;
$$;

create or replace function public.start_cancel_flow(
  p_organization_id uuid,
  p_member_id uuid,
  p_actor_user_id uuid default null
)
returns public.cancel_flow_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_attempt public.cancel_flow_attempts%rowtype;
  v_first_step_id uuid;
  v_snapshot jsonb;
begin
  select *
  into v_actor
  from private.resolve_retention_actor(
    p_organization_id,
    p_member_id,
    p_actor_user_id
  );

  select
    jsonb_agg(
      jsonb_build_object(
        'id', step.id,
        'step_type', step.step_type,
        'position', step.position,
        'enabled', step.enabled,
        'headline', step.headline,
        'body', step.body,
        'configuration', step.configuration
      )
      order by step.position
    ),
    (array_agg(step.id order by step.position) filter (where step.enabled))[1]
  into v_snapshot, v_first_step_id
  from public.cancel_flow_steps as step
  where step.organization_id = p_organization_id;

  if v_snapshot is null or jsonb_array_length(v_snapshot) <> 4 then
    raise exception using errcode = '23514', message = 'Cancel flow is not configured.';
  end if;
  if v_first_step_id is null then
    raise exception using errcode = '23514', message = 'At least one cancel step must be enabled.';
  end if;

  select attempt.*
  into v_attempt
  from public.cancel_flow_attempts as attempt
  where attempt.organization_id = p_organization_id
    and attempt.member_id = p_member_id
    and attempt.status = 'in_progress'
  for update;

  if found then
    return v_attempt;
  end if;

  insert into public.cancel_flow_attempts (
    organization_id,
    member_id,
    actor_user_id,
    actor_type,
    current_step_id,
    configuration_snapshot
  )
  values (
    p_organization_id,
    p_member_id,
    v_actor.actor_user_id,
    v_actor.actor_type,
    v_first_step_id,
    v_snapshot
  )
  returning * into v_attempt;

  perform public.append_audit_entry(
    p_organization_id,
    v_actor.actor_user_id,
    'cancel_flow.started',
    'cancel_flow_attempt',
    v_attempt.id,
    jsonb_build_object('member_id', p_member_id)
  );

  return v_attempt;
end;
$$;

create or replace function public.record_cancel_flow_step(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_step_id uuid,
  p_outcome public.cancel_flow_outcome,
  p_details jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null
)
returns public.cancel_flow_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_attempt public.cancel_flow_attempts%rowtype;
  v_step public.cancel_flow_steps%rowtype;
  v_next_step_id uuid;
  v_pause_months integer;
  v_target_tier_id uuid;
  v_current_price integer;
  v_target_price integer;
  v_final_status public.cancel_attempt_status;
  v_shipment_id uuid;
  v_shipment_item_id uuid;
  v_target_release_wine_id uuid;
  v_source_release_wine_id uuid;
  v_swap_quantity integer;
  v_swap_price_cents integer;
begin
  if jsonb_typeof(p_details) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Cancel event details must be an object.';
  end if;

  select attempt.*
  into v_attempt
  from public.cancel_flow_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cancel attempt not found.';
  end if;
  if v_attempt.status <> 'in_progress' then
    return v_attempt;
  end if;

  select *
  into v_actor
  from private.resolve_retention_actor(
    p_organization_id,
    v_attempt.member_id,
    p_actor_user_id
  );

  select step.*
  into v_step
  from public.cancel_flow_steps as step
  where step.id = p_step_id
    and step.organization_id = p_organization_id;

  if not found or v_attempt.current_step_id <> p_step_id then
    raise exception using errcode = '22023', message = 'Cancel step is not current.';
  end if;

  insert into public.cancel_flow_events (
    organization_id,
    member_id,
    attempt_id,
    step_id,
    step_position,
    outcome,
    actor_user_id,
    actor_type,
    details
  )
  values (
    p_organization_id,
    v_attempt.member_id,
    v_attempt.id,
    v_step.id,
    v_step.position,
    p_outcome,
    v_actor.actor_user_id,
    v_actor.actor_type,
    p_details
  );

  if p_outcome = 'viewed' then
    return v_attempt;
  elsif p_outcome = 'continued' then
    select step.id
    into v_next_step_id
    from public.cancel_flow_steps as step
    where step.organization_id = p_organization_id
      and step.enabled
      and step.position > v_step.position
    order by step.position
    limit 1;

    if v_next_step_id is null then
      raise exception using errcode = '22023', message = 'Final confirmation requires a cancellation decision.';
    end if;

    update public.cancel_flow_attempts
    set current_step_id = v_next_step_id
    where id = v_attempt.id
    returning * into v_attempt;
    return v_attempt;
  elsif p_outcome = 'paused' then
    if v_step.step_type <> 'pause' then
      raise exception using errcode = '22023', message = 'Pause outcome is only valid on the pause step.';
    end if;
    v_pause_months := nullif(p_details ->> 'pause_months', '')::integer;
    if v_pause_months not in (1, 3) then
      raise exception using errcode = '22023', message = 'Pause duration must be one or three months.';
    end if;
    update public.members
    set
      status = 'paused',
      paused_until = (current_date + make_interval(months => v_pause_months))::date
    where id = v_attempt.member_id
      and organization_id = p_organization_id;
    v_final_status := 'intercepted';
  elsif p_outcome = 'downgraded' then
    if v_step.step_type <> 'downgrade' then
      raise exception using errcode = '22023', message = 'Downgrade outcome is only valid on the downgrade step.';
    end if;
    if coalesce(p_details ->> 'target_tier_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    then
      raise exception using errcode = '22023', message = 'A valid target tier is required.';
    end if;
    v_target_tier_id := (p_details ->> 'target_tier_id')::uuid;
    select current_tier.price_cents, target_tier.price_cents
    into v_current_price, v_target_price
    from public.members as member
    join public.club_tiers as current_tier
      on current_tier.id = member.club_tier_id
      and current_tier.organization_id = member.organization_id
    join public.club_tiers as target_tier
      on target_tier.id = v_target_tier_id
      and target_tier.organization_id = member.organization_id
      and target_tier.active
    where member.id = v_attempt.member_id
      and member.organization_id = p_organization_id;
    if not found or v_target_price >= v_current_price then
      raise exception using errcode = '22023', message = 'Target tier must be active and lower priced.';
    end if;
    update public.members
    set club_tier_id = v_target_tier_id
    where id = v_attempt.member_id
      and organization_id = p_organization_id;
    v_final_status := 'intercepted';
  elsif p_outcome = 'swapped' then
    if v_step.step_type <> 'swap' then
      raise exception using errcode = '22023', message = 'Swap outcome is only valid on the swap step.';
    end if;
    if coalesce(p_details ->> 'shipment_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(p_details ->> 'shipment_item_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(p_details ->> 'target_release_wine_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    then
      raise exception using errcode = '22023', message = 'Shipment, item, and target wine IDs are required.';
    end if;
    v_shipment_id := (p_details ->> 'shipment_id')::uuid;
    v_shipment_item_id := (p_details ->> 'shipment_item_id')::uuid;
    v_target_release_wine_id := (p_details ->> 'target_release_wine_id')::uuid;

    select item.release_wine_id, item.quantity, item.price_cents
    into v_source_release_wine_id, v_swap_quantity, v_swap_price_cents
    from public.shipments as shipment
    join public.shipment_items as item
      on item.shipment_id = shipment.id
      and item.organization_id = shipment.organization_id
    join public.release_wines as target_wine
      on target_wine.id = v_target_release_wine_id
      and target_wine.organization_id = shipment.organization_id
      and target_wine.release_id = shipment.release_id
    where shipment.id = v_shipment_id
      and shipment.organization_id = p_organization_id
      and shipment.member_id = v_attempt.member_id
      and shipment.status in ('pending', 'charged')
      and shipment.packed_at is null
      and item.id = v_shipment_item_id
      and item.packed_quantity = 0
      and item.release_wine_id is distinct from v_target_release_wine_id
      and not exists (
        select 1
        from public.shipment_items as existing_item
        where existing_item.organization_id = shipment.organization_id
          and existing_item.shipment_id = shipment.id
          and existing_item.release_wine_id = v_target_release_wine_id
      )
    for update of shipment, item;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'Shipment swap target is not eligible or does not belong to the same release.';
    end if;

    update public.shipment_items as item
    set
      release_wine_id = target_wine.id,
      wine_name = target_wine.wine_name,
      vintage = target_wine.vintage,
      sku = target_wine.sku
    from public.release_wines as target_wine
    where item.id = v_shipment_item_id
      and item.organization_id = p_organization_id
      and target_wine.id = v_target_release_wine_id
      and target_wine.organization_id = item.organization_id;

    p_details := p_details || jsonb_build_object(
      'source_release_wine_id', v_source_release_wine_id,
      'preserved_quantity', v_swap_quantity,
      'preserved_price_cents', v_swap_price_cents
    );
    v_final_status := 'intercepted';
  elsif p_outcome = 'cancelled' then
    if v_step.step_type <> 'confirm' then
      raise exception using errcode = '22023', message = 'Cancellation is only valid on the confirmation step.';
    end if;
    update public.members
    set status = 'cancelled', paused_until = null
    where id = v_attempt.member_id
      and organization_id = p_organization_id;
    v_final_status := 'cancelled';
  elsif p_outcome = 'abandoned' then
    v_final_status := 'abandoned';
  else
    raise exception using errcode = '22023', message = 'Outcome cannot complete this cancel step.';
  end if;

  update public.cancel_flow_attempts
  set
    status = v_final_status,
    accepted_outcome = p_outcome,
    completed_at = now()
  where id = v_attempt.id
  returning * into v_attempt;

  perform public.append_audit_entry(
    p_organization_id,
    v_actor.actor_user_id,
    'cancel_flow.' || p_outcome::text,
    'cancel_flow_attempt',
    v_attempt.id,
    jsonb_build_object(
      'member_id', v_attempt.member_id,
      'step_type', v_step.step_type,
      'details', p_details
    )
  );

  return v_attempt;
end;
$$;

create or replace function public.get_cancel_flow_analytics(
  p_organization_id uuid,
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now()
)
returns table (
  step_type public.cancel_step_type,
  step_position integer,
  viewed_count bigint,
  continued_count bigint,
  intercepted_count bigint,
  cancelled_count bigint,
  conversion_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_staff_for_org(p_organization_id) then
    raise exception using errcode = '42501', message = 'Staff authorization is required.';
  end if;

  return query
  select
    step.step_type,
    step.position,
    count(*) filter (where event.outcome = 'viewed'),
    count(*) filter (where event.outcome = 'continued'),
    count(*) filter (where event.outcome in ('paused', 'downgraded', 'swapped')),
    count(*) filter (where event.outcome = 'cancelled'),
    case
      when count(*) filter (where event.outcome = 'viewed') = 0 then 0::numeric
      else round(
        (
          count(*) filter (where event.outcome in ('paused', 'downgraded', 'swapped'))
        )::numeric
        / (count(*) filter (where event.outcome = 'viewed'))::numeric,
        4
      )
    end
  from public.cancel_flow_steps as step
  left join public.cancel_flow_events as event
    on event.step_id = step.id
    and event.organization_id = step.organization_id
    and event.created_at >= p_from
    and event.created_at < p_to
  where step.organization_id = p_organization_id
  group by step.step_type, step.position
  order by step.position;
end;
$$;

create or replace function public.award_loyalty_points(
  p_organization_id uuid,
  p_member_id uuid,
  p_base_points integer,
  p_source_type public.member_activity_event_type,
  p_source_id uuid,
  p_idempotency_key text,
  p_reason text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ledger_id uuid;
  v_multiplier numeric(4, 2);
  v_points integer;
  v_expires_at timestamptz;
begin
  if p_base_points <= 0 then
    raise exception using errcode = '22023', message = 'Award points must be positive.';
  end if;

  select ledger.id
  into v_ledger_id
  from public.loyalty_ledger as ledger
  where ledger.organization_id = p_organization_id
    and ledger.idempotency_key = p_idempotency_key;

  if found then
    return v_ledger_id;
  end if;

  select coalesce(multiplier.multiplier, 1)
  into v_multiplier
  from public.members as member
  join public.organizations as organization
    on organization.id = member.organization_id
    and organization.loyalty_enabled
  left join public.loyalty_tier_multipliers as multiplier
    on multiplier.organization_id = member.organization_id
    and multiplier.club_tier_id = member.club_tier_id
  where member.id = p_member_id
    and member.organization_id = p_organization_id
    and member.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Loyalty member not found or program disabled.';
  end if;

  v_points := floor(p_base_points * v_multiplier)::integer;
  v_expires_at := now() + interval '24 months';

  insert into public.loyalty_ledger (
    organization_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    source_event_type,
    source_event_id,
    actor_user_id,
    expires_at,
    metadata
  )
  values (
    p_organization_id,
    p_member_id,
    'award',
    v_points,
    p_reason,
    p_idempotency_key,
    p_source_type,
    p_source_id,
    p_actor_user_id,
    v_expires_at,
    jsonb_build_object(
      'base_points', p_base_points,
      'multiplier', v_multiplier
    )
  )
  on conflict (organization_id, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning id into v_ledger_id;

  insert into public.loyalty_point_lots (
    organization_id,
    member_id,
    award_ledger_id,
    awarded_points,
    remaining_points,
    expires_at
  )
  values (
    p_organization_id,
    p_member_id,
    v_ledger_id,
    v_points,
    v_points,
    v_expires_at
  )
  on conflict (organization_id, award_ledger_id) do nothing;

  return v_ledger_id;
end;
$$;

create or replace function public.record_member_activity_event(
  p_organization_id uuid,
  p_member_id uuid,
  p_event_type public.member_activity_event_type,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_idempotency_key text,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_inserted integer;
  v_award_points integer;
begin
  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Activity metadata must be an object.';
  end if;

  insert into public.member_activity_events (
    organization_id,
    member_id,
    event_type,
    source_entity_type,
    source_entity_id,
    idempotency_key,
    occurred_at,
    metadata
  )
  values (
    p_organization_id,
    p_member_id,
    p_event_type,
    p_source_entity_type,
    p_source_entity_id,
    p_idempotency_key,
    p_occurred_at,
    p_metadata
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_event_id;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select event.id
    into v_event_id
    from public.member_activity_events as event
    where event.organization_id = p_organization_id
      and event.idempotency_key = p_idempotency_key;
    return v_event_id;
  end if;

  v_award_points := case p_event_type
    when 'shipment_delivered' then 100
    when 'event_attendance' then 50
    when 'referral_completed' then 200
    when 'birthday' then 25
    when 'anniversary' then 50
    else null
  end;

  if v_award_points is not null
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = p_organization_id
        and organization.loyalty_enabled
    )
  then
    perform public.award_loyalty_points(
      p_organization_id,
      p_member_id,
      v_award_points,
      p_event_type,
      v_event_id,
      'loyalty:event:' || v_event_id::text,
      replace(p_event_type::text, '_', ' ') || ' award',
      null
    );
  end if;

  if p_event_type = 'portal_login' then
    update public.members
    set last_portal_login_at = greatest(
      coalesce(last_portal_login_at, '-infinity'::timestamptz),
      p_occurred_at
    )
    where id = p_member_id
      and organization_id = p_organization_id;
  end if;

  return v_event_id;
end;
$$;

create or replace function private.capture_member_tier_downgrade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_price integer;
  v_new_price integer;
begin
  if new.club_tier_id is not distinct from old.club_tier_id
    or new.club_tier_id is null
    or old.club_tier_id is null
  then
    return new;
  end if;

  select old_tier.price_cents, new_tier.price_cents
  into v_old_price, v_new_price
  from public.club_tiers as old_tier
  join public.club_tiers as new_tier
    on new_tier.id = new.club_tier_id
    and new_tier.organization_id = new.organization_id
  where old_tier.id = old.club_tier_id
    and old_tier.organization_id = old.organization_id;

  if found and v_new_price < v_old_price then
    new.tier_change_sequence := old.tier_change_sequence + 1;
    perform public.record_member_activity_event(
      new.organization_id,
      new.id,
      'tier_downgrade',
      'member',
      new.id,
      'activity:tier_downgrade:' || new.id::text || ':'
        || new.tier_change_sequence::text,
      now(),
      jsonb_build_object(
        'previous_tier_id', old.club_tier_id,
        'target_tier_id', new.club_tier_id,
        'previous_price_cents', v_old_price,
        'target_price_cents', v_new_price
      )
    );
  end if;

  return new;
end;
$$;

create trigger members_capture_tier_downgrade
before update of club_tier_id on public.members
for each row execute function private.capture_member_tier_downgrade();

create or replace function private.capture_shipment_retention_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer_id uuid;
begin
  if old.status is distinct from new.status and new.status = 'label_created' then
    perform public.enqueue_email_trigger(
      new.organization_id,
      new.member_id,
      'shipped',
      'email:shipped:' || new.id::text,
      jsonb_build_object(
        'shipment_id', new.id,
        'tracking_number', new.tracking_number,
        'carrier', new.carrier
      ),
      now()
    );
  end if;

  if old.status is distinct from new.status and new.status = 'delivered' then
    perform public.record_member_activity_event(
      new.organization_id,
      new.member_id,
      'shipment_delivered',
      'shipment',
      new.id,
      'activity:shipment_delivered:' || new.id::text,
      coalesce(new.delivered_at, now()),
      jsonb_build_object('shipment_id', new.id)
    );

    select member.referred_by_member_id
    into v_referrer_id
    from public.members as member
    where member.id = new.member_id
      and member.organization_id = new.organization_id;

    if v_referrer_id is not null
      and (
        select count(*)
        from public.shipments as shipment
        where shipment.organization_id = new.organization_id
          and shipment.member_id = new.member_id
          and shipment.status = 'delivered'
      ) = 1
    then
      perform public.record_member_activity_event(
        new.organization_id,
        v_referrer_id,
        'referral_completed',
        'shipment',
        new.id,
        'activity:referral_completed:' || new.id::text,
        coalesce(new.delivered_at, now()),
        jsonb_build_object(
          'referred_member_id', new.member_id,
          'first_shipment_id', new.id
        )
      );
    end if;
  end if;

  return null;
end;
$$;

create trigger shipments_capture_retention_events
after update of status on public.shipments
for each row execute function private.capture_shipment_retention_events();

create or replace function private.capture_billing_decline_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
begin
  if new.status = 'declined'
    and (tg_op = 'INSERT' or old.status is distinct from new.status)
  then
    select shipment.*
    into v_shipment
    from public.shipments as shipment
    where shipment.id = new.shipment_id
      and shipment.organization_id = new.organization_id;

    perform public.enqueue_email_trigger(
      new.organization_id,
      v_shipment.member_id,
      'payment_decline',
      'email:payment_decline:' || new.id::text,
      jsonb_build_object(
        'shipment_id', new.shipment_id,
        'billing_attempt_id', new.id,
        'decline_code', new.decline_code,
        'decline_reason', new.decline_reason
      ),
      now()
    );
  end if;
  return null;
end;
$$;

create trigger billing_attempts_capture_decline_email
after insert or update of status on public.billing_attempts
for each row execute function private.capture_billing_decline_email();

create or replace function private.member_owns_retention_row(
  p_organization_id uuid,
  p_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members as member
    where member.id = p_member_id
      and member.organization_id = p_organization_id
      and member.auth_user_id = auth.uid()
      and member.deleted_at is null
      and private.is_member_for_org(member.organization_id, member.auth_user_id)
  );
$$;

create or replace function private.member_belongs_to_org(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members as member
    where member.organization_id = p_organization_id
      and member.auth_user_id = auth.uid()
      and member.deleted_at is null
      and private.is_member_for_org(member.organization_id, member.auth_user_id)
  );
$$;

alter table public.email_templates enable row level security;
alter table public.email_templates force row level security;
alter table public.member_email_preferences enable row level security;
alter table public.member_email_preferences force row level security;
alter table public.email_log enable row level security;
alter table public.email_log force row level security;
alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;
alter table public.email_delivery_events enable row level security;
alter table public.email_delivery_events force row level security;
alter table public.email_unsubscribe_tokens enable row level security;
alter table public.email_unsubscribe_tokens force row level security;
alter table public.churn_scores enable row level security;
alter table public.churn_scores force row level security;
alter table public.cancel_flow_steps enable row level security;
alter table public.cancel_flow_steps force row level security;
alter table public.cancel_flow_attempts enable row level security;
alter table public.cancel_flow_attempts force row level security;
alter table public.cancel_flow_events enable row level security;
alter table public.cancel_flow_events force row level security;
alter table public.member_activity_events enable row level security;
alter table public.member_activity_events force row level security;
alter table public.loyalty_tier_multipliers enable row level security;
alter table public.loyalty_tier_multipliers force row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.loyalty_redemptions force row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.loyalty_ledger force row level security;
alter table public.loyalty_point_lots enable row level security;
alter table public.loyalty_point_lots force row level security;
alter table public.loyalty_reservation_allocations enable row level security;
alter table public.loyalty_reservation_allocations force row level security;

create policy email_templates_staff_select
on public.email_templates for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy email_templates_super_admin_all
on public.email_templates for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy member_email_preferences_staff_select
on public.member_email_preferences for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy member_email_preferences_member_select
on public.member_email_preferences for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy member_email_preferences_super_admin_all
on public.member_email_preferences for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy email_log_staff_select
on public.email_log for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy email_log_member_select
on public.email_log for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy email_log_super_admin_all
on public.email_log for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy email_outbox_staff_select
on public.email_outbox for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy email_outbox_super_admin_all
on public.email_outbox for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy email_delivery_events_staff_select
on public.email_delivery_events for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy email_delivery_events_super_admin_select
on public.email_delivery_events for select to authenticated
using ((select private.is_super_admin()));

create policy email_unsubscribe_tokens_super_admin_select
on public.email_unsubscribe_tokens for select to authenticated
using ((select private.is_super_admin()));

create policy churn_scores_staff_select
on public.churn_scores for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy churn_scores_member_select
on public.churn_scores for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy churn_scores_super_admin_select
on public.churn_scores for select to authenticated
using ((select private.is_super_admin()));

create policy cancel_flow_steps_staff_select
on public.cancel_flow_steps for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy cancel_flow_steps_member_select
on public.cancel_flow_steps for select to authenticated
using ((select private.member_belongs_to_org(organization_id)));
create policy cancel_flow_steps_super_admin_all
on public.cancel_flow_steps for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy cancel_flow_attempts_staff_select
on public.cancel_flow_attempts for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy cancel_flow_attempts_member_select
on public.cancel_flow_attempts for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy cancel_flow_attempts_super_admin_all
on public.cancel_flow_attempts for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy cancel_flow_events_staff_select
on public.cancel_flow_events for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy cancel_flow_events_member_select
on public.cancel_flow_events for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy cancel_flow_events_super_admin_select
on public.cancel_flow_events for select to authenticated
using ((select private.is_super_admin()));

create policy member_activity_events_staff_select
on public.member_activity_events for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy member_activity_events_member_select
on public.member_activity_events for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy member_activity_events_super_admin_select
on public.member_activity_events for select to authenticated
using ((select private.is_super_admin()));

create policy loyalty_tier_multipliers_staff_select
on public.loyalty_tier_multipliers for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy loyalty_tier_multipliers_member_select
on public.loyalty_tier_multipliers for select to authenticated
using (
  exists (
    select 1
    from public.members as member
    where member.organization_id = loyalty_tier_multipliers.organization_id
      and member.club_tier_id = loyalty_tier_multipliers.club_tier_id
      and private.member_owns_retention_row(member.organization_id, member.id)
  )
);
create policy loyalty_tier_multipliers_super_admin_all
on public.loyalty_tier_multipliers for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy loyalty_redemptions_staff_select
on public.loyalty_redemptions for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy loyalty_redemptions_member_select
on public.loyalty_redemptions for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy loyalty_redemptions_super_admin_all
on public.loyalty_redemptions for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy loyalty_ledger_staff_select
on public.loyalty_ledger for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy loyalty_ledger_member_select
on public.loyalty_ledger for select to authenticated
using ((select private.member_owns_retention_row(organization_id, member_id)));
create policy loyalty_ledger_super_admin_select
on public.loyalty_ledger for select to authenticated
using ((select private.is_super_admin()));

create policy loyalty_point_lots_staff_select
on public.loyalty_point_lots for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy loyalty_point_lots_super_admin_all
on public.loyalty_point_lots for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy loyalty_reservation_allocations_staff_select
on public.loyalty_reservation_allocations for select to authenticated
using ((select private.is_staff_for_org(organization_id)));
create policy loyalty_reservation_allocations_super_admin_all
on public.loyalty_reservation_allocations for all to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

revoke all on table
  public.email_templates,
  public.member_email_preferences,
  public.email_log,
  public.email_outbox,
  public.email_delivery_events,
  public.email_unsubscribe_tokens,
  public.churn_scores,
  public.cancel_flow_steps,
  public.cancel_flow_attempts,
  public.cancel_flow_events,
  public.member_activity_events,
  public.loyalty_tier_multipliers,
  public.loyalty_redemptions,
  public.loyalty_ledger,
  public.loyalty_point_lots,
  public.loyalty_reservation_allocations
from public, anon, authenticated;

grant select on table
  public.email_templates,
  public.member_email_preferences,
  public.email_log,
  public.email_outbox,
  public.email_delivery_events,
  public.email_unsubscribe_tokens,
  public.churn_scores,
  public.cancel_flow_steps,
  public.cancel_flow_attempts,
  public.cancel_flow_events,
  public.member_activity_events,
  public.loyalty_tier_multipliers,
  public.loyalty_redemptions,
  public.loyalty_ledger,
  public.loyalty_point_lots,
  public.loyalty_reservation_allocations
to authenticated;

grant select, insert, update, delete on table
  public.email_templates,
  public.member_email_preferences,
  public.email_log,
  public.email_outbox,
  public.email_unsubscribe_tokens,
  public.cancel_flow_steps,
  public.cancel_flow_attempts,
  public.loyalty_tier_multipliers,
  public.loyalty_redemptions,
  public.loyalty_point_lots,
  public.loyalty_reservation_allocations
to service_role;

grant select, insert on table
  public.email_delivery_events,
  public.churn_scores,
  public.cancel_flow_events,
  public.member_activity_events,
  public.loyalty_ledger
to service_role;

revoke execute on function private.seed_phase3_organization_defaults()
from public, anon, authenticated;
revoke execute on function private.seed_loyalty_tier_multiplier()
from public, anon, authenticated;
revoke execute on function private.reject_append_only_mutation()
from public, anon, authenticated;
revoke execute on function private.resolve_retention_actor(uuid, uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.capture_shipment_retention_events()
from public, anon, authenticated;
revoke execute on function private.capture_billing_decline_email()
from public, anon, authenticated;
revoke execute on function private.member_owns_retention_row(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.member_belongs_to_org(uuid)
from public, anon, authenticated;
revoke execute on function private.enqueue_welcome_email()
from public, anon, authenticated;

grant execute on function private.member_owns_retention_row(uuid, uuid)
to authenticated;
grant execute on function private.member_belongs_to_org(uuid)
to authenticated;

revoke execute on function public.enqueue_email_trigger(
  uuid, uuid, public.email_trigger_type, text, jsonb, timestamptz
) from public, anon, authenticated;
revoke execute on function public.claim_email_outbox_batch(text, integer, integer)
from public, anon, authenticated;
revoke execute on function public.mark_email_delivery(
  uuid, uuid, public.email_status, text, text
) from public, anon, authenticated;
revoke execute on function public.record_email_delivery_event(
  uuid, uuid, text, public.email_delivery_event_type, timestamptz, jsonb
) from public, anon, authenticated;
revoke execute on function public.issue_email_unsubscribe_token(
  uuid, uuid, public.email_trigger_type, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke execute on function public.apply_email_unsubscribe(text)
from public, anon, authenticated;
revoke execute on function public.enqueue_due_email_triggers(timestamptz)
from public, anon, authenticated;
revoke execute on function public.calculate_nightly_churn_scores(timestamptz, uuid)
from public, anon, authenticated;
revoke execute on function public.award_loyalty_points(
  uuid, uuid, integer, public.member_activity_event_type, uuid, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.record_member_activity_event(
  uuid, uuid, public.member_activity_event_type, text, uuid, text, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.enqueue_email_trigger(
  uuid, uuid, public.email_trigger_type, text, jsonb, timestamptz
) to service_role;
grant execute on function public.claim_email_outbox_batch(text, integer, integer)
to service_role;
grant execute on function public.mark_email_delivery(
  uuid, uuid, public.email_status, text, text
) to service_role;
grant execute on function public.record_email_delivery_event(
  uuid, uuid, text, public.email_delivery_event_type, timestamptz, jsonb
) to service_role;
grant execute on function public.issue_email_unsubscribe_token(
  uuid, uuid, public.email_trigger_type, text, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.apply_email_unsubscribe(text)
to service_role;
grant execute on function public.enqueue_due_email_triggers(timestamptz)
to service_role;
grant execute on function public.calculate_nightly_churn_scores(timestamptz, uuid)
to service_role;
grant execute on function public.award_loyalty_points(
  uuid, uuid, integer, public.member_activity_event_type, uuid, text, text, uuid
) to service_role;
grant execute on function public.record_member_activity_event(
  uuid, uuid, public.member_activity_event_type, text, uuid, text, timestamptz, jsonb
) to service_role;

revoke execute on function public.update_cancel_flow_configuration(uuid, jsonb, uuid)
from public, anon;
revoke execute on function public.start_cancel_flow(uuid, uuid, uuid)
from public, anon;
revoke execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid
) from public, anon;
revoke execute on function public.get_cancel_flow_analytics(uuid, timestamptz, timestamptz)
from public, anon;

grant execute on function public.update_cancel_flow_configuration(uuid, jsonb, uuid)
to authenticated, service_role;
grant execute on function public.start_cancel_flow(uuid, uuid, uuid)
to authenticated, service_role;
grant execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid
) to authenticated, service_role;
grant execute on function public.get_cancel_flow_analytics(uuid, timestamptz, timestamptz)
to authenticated, service_role;
create or replace function private.release_loyalty_reservation(
  p_redemption public.loyalty_redemptions,
  p_status public.loyalty_redemption_status,
  p_actor_user_id uuid default null
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation record;
  v_updated public.loyalty_redemptions%rowtype;
begin
  if p_status not in ('released', 'expired') then
    raise exception using errcode = '22023', message = 'Invalid release status.';
  end if;

  for v_allocation in
    select allocation.lot_id, allocation.points
    from public.loyalty_reservation_allocations as allocation
    where allocation.organization_id = p_redemption.organization_id
      and allocation.redemption_id = p_redemption.id
    order by allocation.created_at, allocation.id
  loop
    update public.loyalty_point_lots
    set reserved_points = reserved_points - v_allocation.points
    where id = v_allocation.lot_id
      and organization_id = p_redemption.organization_id;
  end loop;

  insert into public.loyalty_ledger (
    organization_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    redemption_id,
    actor_user_id,
    metadata
  )
  values (
    p_redemption.organization_id,
    p_redemption.member_id,
    'reservation_release',
    p_redemption.points,
    case when p_status = 'expired'
      then 'Expired loyalty reservation released'
      else 'Loyalty reservation released'
    end,
    'loyalty:release:' || p_redemption.id::text,
    p_redemption.id,
    p_actor_user_id,
    jsonb_build_object('release_status', p_status)
  )
  on conflict (organization_id, idempotency_key) do nothing;

  update public.shipments
  set loyalty_discount_cents = 0, loyalty_redemption_id = null
  where organization_id = p_redemption.organization_id
    and loyalty_redemption_id = p_redemption.id;

  update public.loyalty_redemptions
  set status = p_status, released_at = now()
  where id = p_redemption.id
    and organization_id = p_redemption.organization_id
    and status = 'held'
  returning * into v_updated;

  return v_updated;
end;
$$;

create or replace function public.release_expired_loyalty_reservations(
  p_as_of timestamptz default now(),
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.loyalty_redemptions%rowtype;
  v_count integer := 0;
begin
  for v_redemption in
    select redemption.*
    from public.loyalty_redemptions as redemption
    where redemption.status = 'held'
      and redemption.expires_at <= p_as_of
      and (
        p_organization_id is null
        or redemption.organization_id = p_organization_id
      )
    order by redemption.expires_at, redemption.id
    for update skip locked
  loop
    perform private.release_loyalty_reservation(
      v_redemption,
      'expired',
      null
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.reserve_loyalty_discount(
  p_organization_id uuid,
  p_member_id uuid,
  p_shipment_id uuid,
  p_points integer,
  p_idempotency_key text,
  p_actor_user_id uuid default null
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_organization public.organizations%rowtype;
  v_shipment public.shipments%rowtype;
  v_redemption public.loyalty_redemptions%rowtype;
  v_lot public.loyalty_point_lots%rowtype;
  v_available integer;
  v_needed integer;
  v_take integer;
  v_discount_cents integer;
begin
  select redemption.*
  into v_redemption
  from public.loyalty_redemptions as redemption
  where redemption.organization_id = p_organization_id
    and redemption.idempotency_key = p_idempotency_key;
  if found then
    return v_redemption;
  end if;

  select *
  into v_actor
  from private.resolve_retention_actor(
    p_organization_id,
    p_member_id,
    p_actor_user_id
  );

  perform public.release_expired_loyalty_reservations(now(), p_organization_id);

  select organization.*
  into v_organization
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.loyalty_enabled;
  if not found then
    raise exception using errcode = '23514', message = 'Loyalty program is disabled.';
  end if;

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.id = p_shipment_id
    and shipment.organization_id = p_organization_id
    and shipment.member_id = p_member_id
    and shipment.status in ('pending', 'declined')
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Eligible shipment not found.';
  end if;
  if v_shipment.loyalty_redemption_id is not null then
    raise exception using errcode = '23505', message = 'Shipment already has a loyalty reservation.';
  end if;
  if p_points <= 0 or p_points % v_organization.loyalty_points_per_unit <> 0 then
    raise exception using errcode = '22023', message = 'Points must be a positive whole discount unit.';
  end if;

  v_discount_cents :=
    (p_points / v_organization.loyalty_points_per_unit)
    * v_organization.loyalty_discount_unit_cents;
  if v_discount_cents > v_shipment.charge_amount_cents then
    raise exception using errcode = '22023', message = 'Discount exceeds shipment charge.';
  end if;
  if v_shipment.charge_amount_cents - v_discount_cents between 1 and 49 then
    raise exception using
      errcode = '22023',
      message = 'Discount leaves a charge below the provider minimum.';
  end if;

  select coalesce(sum(lot.remaining_points - lot.reserved_points), 0)::integer
  into v_available
  from public.loyalty_point_lots as lot
  where lot.organization_id = p_organization_id
    and lot.member_id = p_member_id
    and lot.expires_at > now();
  if v_available < p_points then
    raise exception using errcode = '22023', message = 'Insufficient unexpired loyalty points.';
  end if;

  insert into public.loyalty_redemptions (
    organization_id,
    member_id,
    shipment_id,
    idempotency_key,
    points,
    discount_cents,
    points_per_unit,
    discount_unit_cents,
    expires_at,
    created_by
  )
  values (
    p_organization_id,
    p_member_id,
    p_shipment_id,
    p_idempotency_key,
    p_points,
    v_discount_cents,
    v_organization.loyalty_points_per_unit,
    v_organization.loyalty_discount_unit_cents,
    now() + make_interval(mins => v_organization.loyalty_reservation_minutes),
    v_actor.actor_user_id
  )
  returning * into v_redemption;

  v_needed := p_points;
  for v_lot in
    select lot.*
    from public.loyalty_point_lots as lot
    where lot.organization_id = p_organization_id
      and lot.member_id = p_member_id
      and lot.expires_at > now()
      and lot.remaining_points > lot.reserved_points
    order by lot.expires_at, lot.created_at, lot.id
    for update
  loop
    exit when v_needed = 0;
    v_take := least(v_needed, v_lot.remaining_points - v_lot.reserved_points);
    update public.loyalty_point_lots
    set reserved_points = reserved_points + v_take
    where id = v_lot.id;
    insert into public.loyalty_reservation_allocations (
      organization_id,
      redemption_id,
      lot_id,
      points
    )
    values (p_organization_id, v_redemption.id, v_lot.id, v_take);
    v_needed := v_needed - v_take;
  end loop;

  if v_needed <> 0 then
    raise exception using errcode = '40001', message = 'Loyalty availability changed; retry.';
  end if;

  insert into public.loyalty_ledger (
    organization_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    redemption_id,
    actor_user_id,
    metadata
  )
  values (
    p_organization_id,
    p_member_id,
    'reservation',
    -p_points,
    'Reserved against upcoming shipment',
    'loyalty:reserve:' || v_redemption.id::text,
    v_redemption.id,
    v_actor.actor_user_id,
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'discount_cents', v_discount_cents
    )
  );

  update public.shipments
  set
    loyalty_discount_cents = v_discount_cents,
    loyalty_redemption_id = v_redemption.id
  where id = p_shipment_id
    and organization_id = p_organization_id;

  perform public.append_audit_entry(
    p_organization_id,
    v_actor.actor_user_id,
    'loyalty.reserved',
    'loyalty_redemption',
    v_redemption.id,
    jsonb_build_object(
      'member_id', p_member_id,
      'shipment_id', p_shipment_id,
      'points', p_points,
      'discount_cents', v_discount_cents
    )
  );

  return v_redemption;
end;
$$;

create or replace function public.finalize_loyalty_redemption(
  p_organization_id uuid,
  p_redemption_id uuid,
  p_apply boolean,
  p_actor_user_id uuid default null
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.loyalty_redemptions%rowtype;
  v_actor_user_id uuid;
  v_allocation record;
begin
  select redemption.*
  into v_redemption
  from public.loyalty_redemptions as redemption
  where redemption.id = p_redemption_id
    and redemption.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Loyalty redemption not found.';
  end if;
  if v_redemption.status <> 'held' then
    return v_redemption;
  end if;

  v_actor_user_id := coalesce(p_actor_user_id, v_redemption.created_by);
  if v_actor_user_id is not null then
    perform private.resolve_audit_actor(
      p_organization_id,
      v_actor_user_id
    );
  end if;

  if not p_apply then
    return private.release_loyalty_reservation(
      v_redemption,
      'released',
      v_actor_user_id
    );
  end if;
  if v_redemption.expires_at <= now() then
    return private.release_loyalty_reservation(
      v_redemption,
      'expired',
      v_actor_user_id
    );
  end if;

  for v_allocation in
    select allocation.lot_id, allocation.points
    from public.loyalty_reservation_allocations as allocation
    where allocation.organization_id = p_organization_id
      and allocation.redemption_id = p_redemption_id
    order by allocation.created_at, allocation.id
  loop
    update public.loyalty_point_lots
    set
      remaining_points = remaining_points - v_allocation.points,
      reserved_points = reserved_points - v_allocation.points
    where id = v_allocation.lot_id
      and organization_id = p_organization_id;
  end loop;

  update public.loyalty_redemptions
  set status = 'applied', applied_at = now()
  where id = p_redemption_id
    and organization_id = p_organization_id
  returning * into v_redemption;

  perform public.append_audit_entry(
    p_organization_id,
    v_actor_user_id,
    'loyalty.redeemed',
    'loyalty_redemption',
    v_redemption.id,
    jsonb_build_object(
      'member_id', v_redemption.member_id,
      'shipment_id', v_redemption.shipment_id,
      'points', v_redemption.points,
      'discount_cents', v_redemption.discount_cents
    )
  );

  return v_redemption;
end;
$$;

create or replace function private.reverse_applied_loyalty_redemption(
  p_redemption public.loyalty_redemptions
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation record;
  v_updated public.loyalty_redemptions%rowtype;
begin
  if p_redemption.status <> 'applied' then
    return p_redemption;
  end if;

  for v_allocation in
    select allocation.lot_id, allocation.points
    from public.loyalty_reservation_allocations as allocation
    where allocation.organization_id = p_redemption.organization_id
      and allocation.redemption_id = p_redemption.id
    order by allocation.created_at, allocation.id
  loop
    update public.loyalty_point_lots
    set remaining_points = remaining_points + v_allocation.points
    where id = v_allocation.lot_id
      and organization_id = p_redemption.organization_id;
  end loop;

  insert into public.loyalty_ledger (
    organization_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    redemption_id,
    actor_user_id,
    metadata
  )
  values (
    p_redemption.organization_id,
    p_redemption.member_id,
    'reservation_release',
    p_redemption.points,
    'Refunded shipment restored redeemed loyalty points',
    'loyalty:reverse:' || p_redemption.id::text,
    p_redemption.id,
    p_redemption.created_by,
    jsonb_build_object('shipment_id', p_redemption.shipment_id)
  )
  on conflict (organization_id, idempotency_key) do nothing;

  update public.loyalty_redemptions
  set status = 'reversed', reversed_at = now()
  where id = p_redemption.id
    and organization_id = p_redemption.organization_id
    and status = 'applied'
  returning * into v_updated;

  perform public.append_audit_entry(
    p_redemption.organization_id,
    p_redemption.created_by,
    'loyalty.redemption_reversed',
    'loyalty_redemption',
    p_redemption.id,
    jsonb_build_object(
      'member_id', p_redemption.member_id,
      'shipment_id', p_redemption.shipment_id,
      'points', p_redemption.points
    )
  );

  return v_updated;
end;
$$;

create or replace function public.net_shipment_charge_cents(
  p_organization_id uuid,
  p_shipment_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select shipment.charge_amount_cents - shipment.loyalty_discount_cents
  from public.shipments as shipment
  where shipment.id = p_shipment_id
    and shipment.organization_id = p_organization_id;
$$;

create or replace function public.record_billing_attempt(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_attempt_kind public.billing_attempt_kind,
  p_amount_cents integer,
  p_idempotency_key text,
  p_stripe_payment_intent_id text default null,
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_existing_attempt public.billing_attempts%rowtype;
  v_idempotency_key text;
  v_net_amount_cents integer;
begin
  if p_actor_user_id is not null then
    perform private.resolve_audit_actor(p_organization_id, p_actor_user_id);
  end if;

  v_idempotency_key := btrim(p_idempotency_key);
  if char_length(v_idempotency_key) not between 8 and 255
    or v_idempotency_key !~ '^[A-Za-z0-9_.:/-]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid billing idempotency key.';
  end if;
  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Billing metadata must be an object.';
  end if;

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.id = p_shipment_id
    and shipment.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found.';
  end if;

  v_net_amount_cents :=
    v_shipment.charge_amount_cents - v_shipment.loyalty_discount_cents;

  if p_attempt_kind in ('charge', 'retry')
    and p_amount_cents <> v_net_amount_cents
  then
    raise exception using
      errcode = '22023',
      message = 'Charge amount must match the net shipment amount.';
  end if;
  if p_attempt_kind = 'refund'
    and (
      p_amount_cents <= 0
      or v_shipment.stripe_charge_id is null
      or p_amount_cents > v_net_amount_cents - v_shipment.refund_amount_cents
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Refund requires a captured net charge and cannot exceed it.';
  end if;
  if p_amount_cents < 0 then
    raise exception using errcode = '22023', message = 'Billing amount cannot be negative.';
  end if;

  select attempt.*
  into v_existing_attempt
  from public.billing_attempts as attempt
  where attempt.shipment_id = p_shipment_id
    and (
      attempt.idempotency_key = v_idempotency_key
      or (
        p_attempt_kind <> 'refund'
        and p_stripe_payment_intent_id is not null
        and attempt.attempt_kind <> 'refund'
        and attempt.stripe_payment_intent_id = p_stripe_payment_intent_id
      )
    )
  order by
    case when attempt.idempotency_key = v_idempotency_key then 0 else 1 end
  limit 1
  for update;

  if found then
    if v_existing_attempt.organization_id <> p_organization_id
      or v_existing_attempt.attempt_kind <> p_attempt_kind
      or v_existing_attempt.amount_cents <> p_amount_cents
    then
      raise exception using
        errcode = '23505',
        message = 'Billing idempotency key was reused with different parameters.';
    end if;
    return v_existing_attempt.id;
  end if;

  select coalesce(max(attempt.attempt_number), 0) + 1
  into v_attempt_number
  from public.billing_attempts as attempt
  where attempt.shipment_id = p_shipment_id;

  insert into public.billing_attempts (
    organization_id,
    shipment_id,
    idempotency_key,
    attempt_number,
    attempt_kind,
    status,
    amount_cents,
    stripe_payment_intent_id,
    started_at,
    created_by,
    metadata
  )
  values (
    p_organization_id,
    p_shipment_id,
    v_idempotency_key,
    v_attempt_number,
    p_attempt_kind,
    'processing',
    p_amount_cents,
    nullif(btrim(p_stripe_payment_intent_id), ''),
    now(),
    p_actor_user_id,
    p_metadata - array['card_number', 'cvc', 'client_secret', 'api_key', 'secret']
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

create or replace function public.schedule_due_shipment_retries(
  p_as_of timestamptz default now(),
  p_limit integer default 100
)
returns table (
  billing_attempt_id uuid,
  shipment_id uuid,
  organization_id uuid,
  member_id uuid,
  amount_cents integer,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_as_of is null then
    raise exception using errcode = '22023', message = 'p_as_of cannot be null.';
  end if;
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 500.';
  end if;

  return query
  with due as (
    select
      shipment.id,
      shipment.organization_id,
      shipment.member_id,
      shipment.charge_amount_cents - shipment.loyalty_discount_cents
        as net_amount_cents,
      (
        select coalesce(max(attempt.attempt_number), 0) + 1
        from public.billing_attempts as attempt
        where attempt.shipment_id = shipment.id
      ) as next_attempt_number
    from public.shipments as shipment
    where shipment.status = 'declined'
      and shipment.next_retry_at <= p_as_of
      and shipment.retry_count < 3
    order by shipment.next_retry_at, shipment.id
    limit p_limit
    for update of shipment skip locked
  ),
  claimed as (
    update public.shipments as shipment
    set next_retry_at = null
    from due
    where shipment.id = due.id
    returning shipment.id
  ),
  attempts as (
    insert into public.billing_attempts (
      organization_id,
      shipment_id,
      idempotency_key,
      attempt_number,
      attempt_kind,
      status,
      amount_cents,
      scheduled_for,
      started_at,
      metadata
    )
    select
      due.organization_id,
      due.id,
      'auto-retry:' || due.id::text || ':' || due.next_attempt_number::text,
      due.next_attempt_number,
      'retry',
      'processing',
      due.net_amount_cents,
      p_as_of,
      p_as_of,
      jsonb_build_object('automatic', true, 'loyalty_discount_applied', true)
    from due
    join claimed on claimed.id = due.id
    returning
      id,
      billing_attempts.shipment_id,
      billing_attempts.organization_id,
      billing_attempts.amount_cents,
      billing_attempts.attempt_number
  )
  select
    attempt.id,
    attempt.shipment_id,
    attempt.organization_id,
    shipment.member_id,
    attempt.amount_cents,
    attempt.attempt_number
  from attempts as attempt
  join public.shipments as shipment on shipment.id = attempt.shipment_id;
end;
$$;

alter function public.apply_shipment_payment_event(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  public.billing_attempt_status,
  text,
  text,
  text,
  text,
  jsonb
) rename to apply_shipment_payment_event_phase2_gross;

create or replace function public.apply_shipment_payment_event(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_billing_attempt_id uuid,
  p_stripe_event_id text,
  p_event_created_at timestamptz,
  p_status public.billing_attempt_status,
  p_stripe_charge_id text default null,
  p_decline_code text default null,
  p_decline_reason text default null,
  p_stripe_refund_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.shipment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.shipment_status;
  v_net_amount_cents integer;
begin
  v_status := public.apply_shipment_payment_event_phase2_gross(
    p_organization_id,
    p_shipment_id,
    p_billing_attempt_id,
    p_stripe_event_id,
    p_event_created_at,
    p_status,
    p_stripe_charge_id,
    p_decline_code,
    p_decline_reason,
    p_stripe_refund_id,
    p_metadata
  );

  if p_status = 'refunded' then
    select shipment.charge_amount_cents - shipment.loyalty_discount_cents
    into v_net_amount_cents
    from public.shipments as shipment
    where shipment.id = p_shipment_id
      and shipment.organization_id = p_organization_id;

    update public.shipments
    set
      status = case
        when refund_amount_cents >= v_net_amount_cents
          then 'refunded'::public.shipment_status
        else status
      end,
      refunded_at = case
        when refund_amount_cents >= v_net_amount_cents
          then coalesce(refunded_at, p_event_created_at)
        else refunded_at
      end
    where id = p_shipment_id
      and organization_id = p_organization_id
    returning status into v_status;
  end if;

  return v_status;
end;
$$;

create or replace function private.converge_shipment_loyalty_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.loyalty_redemptions%rowtype;
begin
  if old.status is not distinct from new.status
    or new.loyalty_redemption_id is null
  then
    return null;
  end if;

  select redemption.*
  into v_redemption
  from public.loyalty_redemptions as redemption
  where redemption.id = new.loyalty_redemption_id
    and redemption.organization_id = new.organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment loyalty redemption not found.';
  end if;

  if new.status = 'charged' and v_redemption.status = 'held' then
    perform public.finalize_loyalty_redemption(
      new.organization_id,
      v_redemption.id,
      true,
      v_redemption.created_by
    );
  elsif new.status in ('declined', 'cancelled')
    and v_redemption.status = 'held'
  then
    perform private.release_loyalty_reservation(
      v_redemption,
      'released',
      v_redemption.created_by
    );
  elsif new.status = 'refunded' and v_redemption.status = 'applied' then
    perform private.reverse_applied_loyalty_redemption(v_redemption);
  end if;

  return null;
end;
$$;

create trigger shipments_converge_loyalty_state
after update of status on public.shipments
for each row execute function private.converge_shipment_loyalty_state();

create or replace function public.expire_loyalty_points(
  p_as_of timestamptz default now(),
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.loyalty_point_lots%rowtype;
  v_expired integer;
  v_count integer := 0;
begin
  perform public.release_expired_loyalty_reservations(p_as_of, p_organization_id);

  for v_lot in
    select lot.*
    from public.loyalty_point_lots as lot
    where lot.expires_at <= p_as_of
      and lot.remaining_points > lot.reserved_points
      and (p_organization_id is null or lot.organization_id = p_organization_id)
    order by lot.expires_at, lot.created_at, lot.id
    for update skip locked
  loop
    v_expired := v_lot.remaining_points - v_lot.reserved_points;
    update public.loyalty_point_lots
    set remaining_points = reserved_points
    where id = v_lot.id;

    insert into public.loyalty_ledger (
      organization_id,
      member_id,
      entry_type,
      points,
      reason,
      idempotency_key,
      metadata
    )
    values (
      v_lot.organization_id,
      v_lot.member_id,
      'expiration',
      -v_expired,
      'Loyalty points expired after 24 months',
      'loyalty:expire:' || v_lot.id::text,
      jsonb_build_object('lot_id', v_lot.id)
    )
    on conflict (organization_id, idempotency_key) do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.adjust_loyalty_points(
  p_organization_id uuid,
  p_member_id uuid,
  p_points integer,
  p_reason text,
  p_idempotency_key text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_ledger_id uuid;
  v_lot public.loyalty_point_lots%rowtype;
  v_needed integer;
  v_take integer;
begin
  if p_points = 0 or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Adjustment and reason are required.';
  end if;

  select ledger.id
  into v_ledger_id
  from public.loyalty_ledger as ledger
  where ledger.organization_id = p_organization_id
    and ledger.idempotency_key = p_idempotency_key;
  if found then
    return v_ledger_id;
  end if;

  select *
  into v_actor
  from private.resolve_retention_actor(
    p_organization_id,
    p_member_id,
    p_actor_user_id
  );
  if v_actor.actor_type <> 'staff' then
    raise exception using errcode = '42501', message = 'Staff authorization is required.';
  end if;

  if p_points < 0 then
    select coalesce(sum(lot.remaining_points - lot.reserved_points), 0)::integer
    into v_needed
    from public.loyalty_point_lots as lot
    where lot.organization_id = p_organization_id
      and lot.member_id = p_member_id
      and lot.expires_at > now();
    if v_needed < abs(p_points) then
      raise exception using errcode = '22023', message = 'Adjustment exceeds available points.';
    end if;
    v_needed := abs(p_points);
    for v_lot in
      select lot.*
      from public.loyalty_point_lots as lot
      where lot.organization_id = p_organization_id
        and lot.member_id = p_member_id
        and lot.expires_at > now()
        and lot.remaining_points > lot.reserved_points
      order by lot.expires_at, lot.created_at, lot.id
      for update
    loop
      exit when v_needed = 0;
      v_take := least(v_needed, v_lot.remaining_points - v_lot.reserved_points);
      update public.loyalty_point_lots
      set remaining_points = remaining_points - v_take
      where id = v_lot.id;
      v_needed := v_needed - v_take;
    end loop;
  end if;

  insert into public.loyalty_ledger (
    organization_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    actor_user_id,
    expires_at,
    metadata
  )
  values (
    p_organization_id,
    p_member_id,
    'manual_adjustment',
    p_points,
    p_reason,
    p_idempotency_key,
    v_actor.actor_user_id,
    case when p_points > 0 then now() + interval '24 months' else null end,
    jsonb_build_object('manual', true)
  )
  returning id into v_ledger_id;

  if p_points > 0 then
    insert into public.loyalty_point_lots (
      organization_id,
      member_id,
      award_ledger_id,
      awarded_points,
      remaining_points,
      expires_at
    )
    values (
      p_organization_id,
      p_member_id,
      v_ledger_id,
      p_points,
      p_points,
      now() + interval '24 months'
    );
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    v_actor.actor_user_id,
    'loyalty.manually_adjusted',
    'loyalty_ledger',
    v_ledger_id,
    jsonb_build_object(
      'member_id', p_member_id,
      'points', p_points,
      'reason', p_reason
    )
  );

  return v_ledger_id;
end;
$$;

create or replace function public.get_loyalty_balance(
  p_organization_id uuid,
  p_member_id uuid,
  p_actor_user_id uuid default null
)
returns table (
  available_points bigint,
  reserved_points bigint,
  lifetime_awarded_points bigint,
  net_ledger_points bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform 1
  from private.resolve_retention_actor(
    p_organization_id,
    p_member_id,
    p_actor_user_id
  );

  return query
  select
    coalesce(sum(lot.remaining_points - lot.reserved_points), 0)::bigint,
    coalesce(sum(lot.reserved_points), 0)::bigint,
    coalesce(sum(lot.awarded_points), 0)::bigint,
    coalesce((
      select sum(ledger.points)
      from public.loyalty_ledger as ledger
      where ledger.organization_id = p_organization_id
        and ledger.member_id = p_member_id
    ), 0)::bigint
  from public.loyalty_point_lots as lot
  where lot.organization_id = p_organization_id
    and lot.member_id = p_member_id
    and lot.expires_at > now();
end;
$$;

create or replace function public.process_daily_loyalty_awards(
  p_as_of date default current_date,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_count integer := 0;
begin
  for v_member in
    select member.*
    from public.members as member
    join public.organizations as organization
      on organization.id = member.organization_id
      and organization.loyalty_enabled
    where member.status = 'active'
      and member.deleted_at is null
      and (p_organization_id is null or member.organization_id = p_organization_id)
      and (
        (
          member.birthday is not null
          and extract(month from member.birthday) = extract(month from p_as_of)
          and extract(day from member.birthday) = extract(day from p_as_of)
        )
        or (
          extract(month from member.joined_on) = extract(month from p_as_of)
          and extract(day from member.joined_on) = extract(day from p_as_of)
          and member.joined_on < p_as_of
        )
      )
  loop
    if v_member.birthday is not null
      and extract(month from v_member.birthday) = extract(month from p_as_of)
      and extract(day from v_member.birthday) = extract(day from p_as_of)
    then
      perform public.record_member_activity_event(
        v_member.organization_id,
        v_member.id,
        'birthday',
        'member',
        v_member.id,
        'activity:birthday:' || extract(year from p_as_of)::integer::text
          || ':' || v_member.id::text,
        p_as_of::timestamptz,
        '{}'::jsonb
      );
      v_count := v_count + 1;
    end if;

    if extract(month from v_member.joined_on) = extract(month from p_as_of)
      and extract(day from v_member.joined_on) = extract(day from p_as_of)
      and v_member.joined_on < p_as_of
    then
      perform public.record_member_activity_event(
        v_member.organization_id,
        v_member.id,
        'anniversary',
        'member',
        v_member.id,
        'activity:anniversary:' || extract(year from p_as_of)::integer::text
          || ':' || v_member.id::text,
        p_as_of::timestamptz,
        '{}'::jsonb
      );
      v_count := v_count + 1;
    end if;
  end loop;

  perform public.expire_loyalty_points(p_as_of::timestamptz, p_organization_id);
  return v_count;
end;
$$;

revoke execute on function private.release_loyalty_reservation(
  public.loyalty_redemptions,
  public.loyalty_redemption_status,
  uuid
) from public, anon, authenticated;
revoke execute on function private.capture_member_tier_downgrade()
from public, anon, authenticated;
revoke execute on function private.reverse_applied_loyalty_redemption(
  public.loyalty_redemptions
) from public, anon, authenticated;
revoke execute on function private.converge_shipment_loyalty_state()
from public, anon, authenticated;

revoke execute on function public.enqueue_test_email(
  uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.release_expired_loyalty_reservations(timestamptz, uuid)
from public, anon, authenticated;
revoke execute on function public.expire_loyalty_points(timestamptz, uuid)
from public, anon, authenticated;
revoke execute on function public.process_daily_loyalty_awards(date, uuid)
from public, anon, authenticated;
revoke execute on function public.reserve_loyalty_discount(
  uuid, uuid, uuid, integer, text, uuid
) from public, anon;
revoke execute on function public.finalize_loyalty_redemption(uuid, uuid, boolean, uuid)
from public, anon, authenticated;
revoke execute on function public.adjust_loyalty_points(
  uuid, uuid, integer, text, text, uuid
) from public, anon;
revoke execute on function public.get_loyalty_balance(uuid, uuid, uuid)
from public, anon;
revoke execute on function public.net_shipment_charge_cents(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.apply_shipment_payment_event_phase2_gross(
  uuid, uuid, uuid, text, timestamptz, public.billing_attempt_status,
  text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke execute on function public.apply_shipment_payment_event(
  uuid, uuid, uuid, text, timestamptz, public.billing_attempt_status,
  text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.enqueue_test_email(
  uuid, uuid, text, text, text, text, uuid
) to service_role;
grant execute on function public.release_expired_loyalty_reservations(timestamptz, uuid)
to service_role;
grant execute on function public.expire_loyalty_points(timestamptz, uuid)
to service_role;
grant execute on function public.process_daily_loyalty_awards(date, uuid)
to service_role;
grant execute on function public.reserve_loyalty_discount(
  uuid, uuid, uuid, integer, text, uuid
) to authenticated, service_role;
grant execute on function public.finalize_loyalty_redemption(uuid, uuid, boolean, uuid)
to service_role;
grant execute on function public.adjust_loyalty_points(
  uuid, uuid, integer, text, text, uuid
) to authenticated, service_role;
grant execute on function public.get_loyalty_balance(uuid, uuid, uuid)
to authenticated, service_role;
grant execute on function public.net_shipment_charge_cents(uuid, uuid)
to service_role;
grant execute on function public.apply_shipment_payment_event(
  uuid, uuid, uuid, text, timestamptz, public.billing_attempt_status,
  text, text, text, text, jsonb
) to service_role;

commit;
