begin;

create type public.club_frequency as enum (
  'monthly',
  'bi_monthly',
  'quarterly',
  'semi_annual',
  'annual'
);

create type public.club_billing_interval as enum (
  'monthly',
  'quarterly'
);

create type public.release_status as enum (
  'draft',
  'scheduled',
  'processing',
  'completed'
);

create type public.shipment_status as enum (
  'pending',
  'charged',
  'declined',
  'label_created',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
);

create type public.billing_attempt_kind as enum (
  'charge',
  'retry',
  'refund'
);

create type public.billing_attempt_status as enum (
  'queued',
  'processing',
  'succeeded',
  'declined',
  'failed',
  'refunded',
  'ignored'
);

create type public.address_validation_status as enum (
  'pending',
  'valid',
  'invalid',
  'not_supported'
);

create type public.member_import_source as enum (
  'generic',
  'commerce7',
  'wine_direct'
);

create type public.member_import_status as enum (
  'uploaded',
  'previewed',
  'processing',
  'completed',
  'completed_with_errors',
  'failed'
);

create type public.member_import_row_status as enum (
  'pending',
  'valid',
  'invalid',
  'imported',
  'failed'
);

create type public.audit_actor_type as enum (
  'staff',
  'member',
  'system',
  'webhook'
);

alter table public.organizations
  add column shipping_origin_address jsonb,
  add column shipping_origin_validated_at timestamptz,
  add constraint organizations_shipping_origin_address_valid
    check (
      shipping_origin_address is null
      or (
        jsonb_typeof(shipping_origin_address) = 'object'
        and char_length(coalesce(shipping_origin_address ->> 'company', '')) <= 200
        and char_length(coalesce(shipping_origin_address ->> 'name', '')) <= 200
        and (
          char_length(btrim(coalesce(shipping_origin_address ->> 'company', '')))
            between 1 and 200
          or char_length(btrim(coalesce(shipping_origin_address ->> 'name', '')))
            between 1 and 200
        )
        and char_length(btrim(coalesce(shipping_origin_address ->> 'phone', '')))
          between 7 and 30
        and btrim(coalesce(shipping_origin_address ->> 'phone', ''))
          ~ '^[0-9+(). /-]+$'
        and char_length(coalesce(shipping_origin_address ->> 'line1', '')) between 1 and 200
        and char_length(coalesce(shipping_origin_address ->> 'line2', '')) <= 200
        and char_length(coalesce(shipping_origin_address ->> 'city', '')) between 1 and 120
        and char_length(coalesce(shipping_origin_address ->> 'state', '')) between 2 and 80
        and char_length(coalesce(shipping_origin_address ->> 'postal_code', '')) between 3 and 24
        and coalesce(shipping_origin_address ->> 'country', '') ~ '^[A-Z]{2}$'
      )
    ),
  add constraint organizations_shipping_origin_validation_consistent
    check (
      shipping_origin_validated_at is null
      or shipping_origin_address is not null
    );

create table public.club_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  price_cents integer not null,
  billing_interval public.club_billing_interval not null default 'quarterly',
  bottle_count integer not null,
  frequency public.club_frequency not null,
  upgrade_path_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_tiers_name_length
    check (char_length(btrim(name)) between 1 and 120),
  constraint club_tiers_description_length
    check (char_length(description) <= 2000),
  constraint club_tiers_price_positive
    check (price_cents > 0),
  constraint club_tiers_bottle_count_positive
    check (bottle_count between 1 and 120),
  constraint club_tiers_upgrade_not_self
    check (upgrade_path_id is null or upgrade_path_id <> id),
  constraint club_tiers_organization_id_id_key
    unique (organization_id, id),
  constraint club_tiers_upgrade_same_organization_fkey
    foreign key (organization_id, upgrade_path_id)
    references public.club_tiers (organization_id, id)
    on delete set null (upgrade_path_id)
);

create unique index club_tiers_organization_name_uidx
  on public.club_tiers (organization_id, lower(name));

create index club_tiers_upgrade_path_id_idx
  on public.club_tiers (upgrade_path_id)
  where upgrade_path_id is not null;

create index club_tiers_organization_active_idx
  on public.club_tiers (organization_id, active, name);

alter table public.members
  add column phone text,
  add column shipping_address_line1 text,
  add column shipping_address_line2 text,
  add column shipping_city text,
  add column shipping_region text,
  add column shipping_postal_code text,
  add column shipping_country_code text not null default 'US',
  add column shipping_validated_at timestamptz,
  add column club_tier_id uuid,
  add column joined_on date not null default current_date,
  add column paused_at timestamptz,
  add column cancelled_at timestamptz,
  add column reactivated_at timestamptz,
  add column lifetime_value_cents bigint not null default 0,
  add column churn_risk_score numeric(5, 2),
  add column stripe_customer_id text,
  add column stripe_payment_method_id text,
  add column deleted_at timestamptz,
  add constraint members_phone_format
    check (
      phone is null
      or (
        char_length(phone) between 7 and 30
        and phone ~ '^[0-9+(). /-]+$'
      )
    ),
  add constraint members_shipping_country_code_format
    check (shipping_country_code ~ '^[A-Z]{2}$'),
  add constraint members_shipping_field_lengths
    check (
      char_length(coalesce(shipping_address_line1, '')) <= 200
      and char_length(coalesce(shipping_address_line2, '')) <= 200
      and char_length(coalesce(shipping_city, '')) <= 120
      and char_length(coalesce(shipping_region, '')) <= 80
      and char_length(coalesce(shipping_postal_code, '')) <= 24
    ),
  add constraint members_lifetime_value_nonnegative
    check (lifetime_value_cents >= 0),
  add constraint members_churn_risk_range
    check (churn_risk_score between 0 and 100),
  add constraint members_stripe_customer_id_format
    check (
      stripe_customer_id is null
      or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    ),
  add constraint members_stripe_payment_method_id_format
    check (
      stripe_payment_method_id is null
      or stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'
    ),
  add constraint members_organization_id_id_key
    unique (organization_id, id),
  add constraint members_club_tier_same_organization_fkey
    foreign key (organization_id, club_tier_id)
    references public.club_tiers (organization_id, id)
    on delete set null (club_tier_id);

create unique index members_organization_email_uidx
  on public.members (organization_id, email)
  where deleted_at is null;

create unique index members_stripe_customer_id_uidx
  on public.members (stripe_customer_id)
  where stripe_customer_id is not null;

create index members_club_tier_id_idx
  on public.members (club_tier_id)
  where club_tier_id is not null;

create index members_org_tier_status_idx
  on public.members (organization_id, club_tier_id, status)
  where deleted_at is null;

create index members_org_joined_idx
  on public.members (organization_id, joined_on desc)
  where deleted_at is null;

create index members_org_search_name_idx
  on public.members (
    organization_id,
    lower(last_name),
    lower(first_name)
  )
  where deleted_at is null;

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  processing_date date not null,
  embargo_date date not null,
  notification_lead_days integer not null default 7,
  status public.release_status not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint releases_name_length
    check (char_length(btrim(name)) between 1 and 160),
  constraint releases_description_length
    check (char_length(description) <= 5000),
  constraint releases_embargo_before_processing
    check (embargo_date <= processing_date),
  constraint releases_notification_lead_range
    check (notification_lead_days between 0 and 90),
  constraint releases_organization_id_id_key
    unique (organization_id, id),
  constraint releases_created_by_same_organization_fkey
    foreign key (organization_id, created_by)
    references public.staff_users (organization_id, id)
    on delete set null (created_by)
);

create index releases_created_by_idx
  on public.releases (created_by)
  where created_by is not null;

create index releases_org_status_processing_idx
  on public.releases (organization_id, status, processing_date);

create index releases_scheduled_processing_idx
  on public.releases (processing_date)
  where status = 'scheduled';

create table public.release_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  release_id uuid not null,
  tier_id uuid not null,
  tier_name text not null default '',
  price_cents integer not null default 0,
  bottle_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint release_tiers_price_positive
    check (price_cents > 0),
  constraint release_tiers_bottle_count_positive
    check (bottle_count between 1 and 120),
  constraint release_tiers_organization_release_id_key
    unique (organization_id, release_id, id),
  constraint release_tiers_release_tier_key
    unique (release_id, tier_id),
  constraint release_tiers_release_same_organization_fkey
    foreign key (organization_id, release_id)
    references public.releases (organization_id, id)
    on delete cascade,
  constraint release_tiers_tier_same_organization_fkey
    foreign key (organization_id, tier_id)
    references public.club_tiers (organization_id, id)
    on delete restrict
);

create index release_tiers_organization_id_idx
  on public.release_tiers (organization_id);

create index release_tiers_tier_id_idx
  on public.release_tiers (tier_id);

create table public.release_wines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  release_id uuid not null,
  wine_name text not null,
  vintage integer,
  sku text,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_wines_name_length
    check (char_length(btrim(wine_name)) between 1 and 200),
  constraint release_wines_vintage_range
    check (vintage is null or vintage between 1800 and 2200),
  constraint release_wines_sku_length
    check (sku is null or char_length(btrim(sku)) between 1 and 100),
  constraint release_wines_description_length
    check (char_length(description) <= 2000),
  constraint release_wines_organization_id_id_key
    unique (organization_id, id),
  constraint release_wines_organization_release_id_key
    unique (organization_id, release_id, id),
  constraint release_wines_release_same_organization_fkey
    foreign key (organization_id, release_id)
    references public.releases (organization_id, id)
    on delete cascade
);

create unique index release_wines_release_sku_uidx
  on public.release_wines (release_id, sku)
  where sku is not null;

create index release_wines_organization_id_idx
  on public.release_wines (organization_id);

create index release_wines_release_id_idx
  on public.release_wines (release_id);

create table public.release_tier_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  release_id uuid not null,
  release_tier_id uuid not null,
  release_wine_id uuid not null,
  quantity integer not null,
  unit_price_cents integer not null,
  created_at timestamptz not null default now(),
  constraint release_tier_items_quantity_positive
    check (quantity between 1 and 120),
  constraint release_tier_items_price_nonnegative
    check (unit_price_cents >= 0),
  constraint release_tier_items_release_tier_wine_key
    unique (release_tier_id, release_wine_id),
  constraint release_tier_items_release_tier_same_release_fkey
    foreign key (organization_id, release_id, release_tier_id)
    references public.release_tiers (organization_id, release_id, id)
    on delete cascade,
  constraint release_tier_items_wine_same_release_fkey
    foreign key (organization_id, release_id, release_wine_id)
    references public.release_wines (organization_id, release_id, id)
    on delete cascade
);

create index release_tier_items_organization_id_idx
  on public.release_tier_items (organization_id);

create index release_tier_items_release_id_idx
  on public.release_tier_items (release_id);

create index release_tier_items_release_wine_id_idx
  on public.release_tier_items (release_wine_id);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  release_id uuid not null,
  release_tier_id uuid not null,
  tier_id uuid not null,
  status public.shipment_status not null default 'pending',
  shipping_address jsonb not null,
  address_validation_status public.address_validation_status not null default 'pending',
  address_validation_messages jsonb not null default '[]'::jsonb,
  validated_shipping_address jsonb,
  tracking_number text,
  carrier text,
  shipping_provider text,
  external_shipment_id text,
  external_rate_id text,
  external_label_id text,
  label_url text,
  label_format text,
  label_cost_cents integer,
  shipping_provider_metadata jsonb not null default '{}'::jsonb,
  charge_amount_cents integer not null,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_refund_id text,
  refund_amount_cents integer not null default 0,
  decline_code text,
  decline_reason text,
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  last_payment_event_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  label_created_at timestamptz,
  packed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_charge_amount_positive
    check (charge_amount_cents > 0),
  constraint shipments_refund_amount_range
    check (refund_amount_cents between 0 and charge_amount_cents),
  constraint shipments_retry_count_range
    check (retry_count between 0 and 3),
  constraint shipments_shipping_address_is_object
    check (jsonb_typeof(shipping_address) = 'object'),
  constraint shipments_address_messages_are_array
    check (jsonb_typeof(address_validation_messages) = 'array'),
  constraint shipments_validated_address_is_object
    check (
      validated_shipping_address is null
      or jsonb_typeof(validated_shipping_address) = 'object'
    ),
  constraint shipments_provider_metadata_is_object
    check (jsonb_typeof(shipping_provider_metadata) = 'object'),
  constraint shipments_label_cost_nonnegative
    check (label_cost_cents is null or label_cost_cents >= 0),
  constraint shipments_stripe_payment_intent_id_format
    check (
      stripe_payment_intent_id is null
      or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
    ),
  constraint shipments_stripe_charge_id_format
    check (
      stripe_charge_id is null
      or stripe_charge_id ~ '^ch_[A-Za-z0-9]+$'
    ),
  constraint shipments_stripe_refund_id_format
    check (
      stripe_refund_id is null
      or stripe_refund_id ~ '^re_[A-Za-z0-9]+$'
    ),
  constraint shipments_label_state_consistent
    check (
      status not in ('label_created', 'packed', 'shipped', 'delivered')
      or (
        nullif(btrim(tracking_number), '') is not null
        and nullif(btrim(carrier), '') is not null
        and nullif(btrim(shipping_provider), '') is not null
        and nullif(btrim(external_label_id), '') is not null
        and nullif(btrim(label_url), '') is not null
        and label_created_at is not null
      )
    ),
  constraint shipments_organization_id_id_key
    unique (organization_id, id),
  constraint shipments_release_member_key
    unique (release_id, member_id),
  constraint shipments_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict,
  constraint shipments_release_same_organization_fkey
    foreign key (organization_id, release_id)
    references public.releases (organization_id, id)
    on delete restrict,
  constraint shipments_release_tier_same_release_fkey
    foreign key (organization_id, release_id, release_tier_id)
    references public.release_tiers (organization_id, release_id, id)
    on delete restrict,
  constraint shipments_tier_same_organization_fkey
    foreign key (organization_id, tier_id)
    references public.club_tiers (organization_id, id)
    on delete restrict
);

create index shipments_member_id_idx
  on public.shipments (member_id);

create index shipments_release_id_idx
  on public.shipments (release_id);

create index shipments_release_tier_id_idx
  on public.shipments (release_tier_id);

create index shipments_tier_id_idx
  on public.shipments (tier_id);

create index shipments_org_status_created_idx
  on public.shipments (organization_id, status, created_at desc);

create index shipments_recovery_queue_idx
  on public.shipments (next_retry_at, organization_id)
  where status = 'declined' and next_retry_at is not null;

create index shipments_tracking_number_idx
  on public.shipments (tracking_number)
  where tracking_number is not null;

create table public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shipment_id uuid not null,
  release_wine_id uuid,
  wine_name text not null,
  vintage integer,
  sku text,
  barcode text,
  quantity integer not null,
  packed_quantity integer not null default 0,
  price_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipment_items_name_length
    check (char_length(btrim(wine_name)) between 1 and 200),
  constraint shipment_items_vintage_range
    check (vintage is null or vintage between 1800 and 2200),
  constraint shipment_items_quantity_positive
    check (quantity between 1 and 120),
  constraint shipment_items_packed_quantity_range
    check (packed_quantity between 0 and quantity),
  constraint shipment_items_price_nonnegative
    check (price_cents >= 0),
  constraint shipment_items_organization_id_id_key
    unique (organization_id, id),
  constraint shipment_items_shipment_same_organization_fkey
    foreign key (organization_id, shipment_id)
    references public.shipments (organization_id, id)
    on delete cascade,
  constraint shipment_items_wine_same_organization_fkey
    foreign key (organization_id, release_wine_id)
    references public.release_wines (organization_id, id)
    on delete restrict
);

create unique index shipment_items_shipment_wine_uidx
  on public.shipment_items (shipment_id, release_wine_id)
  where release_wine_id is not null;

create index shipment_items_organization_id_idx
  on public.shipment_items (organization_id);

create index shipment_items_release_wine_id_idx
  on public.shipment_items (release_wine_id)
  where release_wine_id is not null;

create table public.billing_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shipment_id uuid not null,
  idempotency_key text not null,
  attempt_number integer not null,
  attempt_kind public.billing_attempt_kind not null,
  status public.billing_attempt_status not null default 'queued',
  amount_cents integer not null,
  livemode boolean not null default false,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_refund_id text,
  stripe_event_id text,
  stripe_event_created_at timestamptz,
  decline_code text,
  decline_reason text,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_attempts_number_positive
    check (attempt_number > 0),
  constraint billing_attempts_idempotency_key_format
    check (
      char_length(idempotency_key) between 8 and 255
      and idempotency_key ~ '^[A-Za-z0-9_.:/-]+$'
    ),
  constraint billing_attempts_amount_positive
    check (amount_cents > 0),
  constraint billing_attempts_test_mode_only
    check (livemode = false),
  constraint billing_attempts_stripe_payment_intent_id_format
    check (
      stripe_payment_intent_id is null
      or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
    ),
  constraint billing_attempts_stripe_charge_id_format
    check (
      stripe_charge_id is null
      or stripe_charge_id ~ '^ch_[A-Za-z0-9]+$'
    ),
  constraint billing_attempts_stripe_refund_id_format
    check (
      stripe_refund_id is null
      or stripe_refund_id ~ '^re_[A-Za-z0-9]+$'
    ),
  constraint billing_attempts_stripe_event_id_format
    check (
      stripe_event_id is null
      or stripe_event_id ~ '^evt_[A-Za-z0-9]+$'
    ),
  constraint billing_attempts_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint billing_attempts_terminal_timestamps
    check (
      (
        status in ('queued', 'processing')
        and completed_at is null
      )
      or (
        status in ('succeeded', 'declined', 'failed', 'refunded', 'ignored')
        and completed_at is not null
      )
    ),
  constraint billing_attempts_organization_id_id_key
    unique (organization_id, id),
  constraint billing_attempts_shipment_idempotency_key
    unique (shipment_id, idempotency_key),
  constraint billing_attempts_shipment_attempt_key
    unique (shipment_id, attempt_number),
  constraint billing_attempts_shipment_same_organization_fkey
    foreign key (organization_id, shipment_id)
    references public.shipments (organization_id, id)
    on delete cascade
);

create unique index billing_attempts_stripe_event_id_uidx
  on public.billing_attempts (stripe_event_id)
  where stripe_event_id is not null;

create unique index billing_attempts_shipment_payment_intent_uidx
  on public.billing_attempts (shipment_id, stripe_payment_intent_id)
  where stripe_payment_intent_id is not null
    and attempt_kind <> 'refund';

create index billing_attempts_organization_id_idx
  on public.billing_attempts (organization_id);

create index billing_attempts_shipment_id_idx
  on public.billing_attempts (shipment_id);

create index billing_attempts_due_idx
  on public.billing_attempts (scheduled_for, organization_id)
  where status = 'queued';

create index billing_attempts_declined_idx
  on public.billing_attempts (organization_id, completed_at desc)
  where status in ('declined', 'failed');

create index billing_attempts_created_by_idx
  on public.billing_attempts (created_by)
  where created_by is not null;

create table public.member_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  upload_token_hash text not null,
  content_sha256 text not null,
  source public.member_import_source not null default 'generic',
  original_filename text not null,
  content_type text not null,
  file_size_bytes integer not null,
  headers jsonb not null default '[]'::jsonb,
  column_mapping jsonb not null default '{}'::jsonb,
  status public.member_import_status not null default 'uploaded',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  imported_rows integer not null default 0,
  failed_rows integer not null default 0,
  imported_by uuid,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  committed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_imports_filename_length
    check (char_length(btrim(original_filename)) between 1 and 255),
  constraint member_imports_upload_token_hash_format
    check (upload_token_hash ~ '^[a-f0-9]{64}$'),
  constraint member_imports_content_sha256_format
    check (content_sha256 ~ '^[a-f0-9]{64}$'),
  constraint member_imports_content_type_csv
    check (
      content_type in (
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel'
      )
    ),
  constraint member_imports_file_size
    check (file_size_bytes between 1 and 5242880),
  constraint member_imports_mapping_is_object
    check (jsonb_typeof(column_mapping) = 'object'),
  constraint member_imports_headers_are_array
    check (jsonb_typeof(headers) = 'array'),
  constraint member_imports_counts_nonnegative
    check (
      total_rows >= 0
      and valid_rows >= 0
      and invalid_rows >= 0
      and imported_rows >= 0
      and failed_rows >= 0
    ),
  constraint member_imports_expiry_after_creation
    check (expires_at > created_at),
  constraint member_imports_commit_consistent
    check (
      (
        status in ('uploaded', 'previewed', 'processing')
        and committed_at is null
      )
      or (
        status in ('completed', 'completed_with_errors')
        and committed_at is not null
        and completed_at is not null
      )
      or status = 'failed'
    ),
  constraint member_imports_organization_id_id_key
    unique (organization_id, id),
  constraint member_imports_imported_by_same_organization_fkey
    foreign key (organization_id, imported_by)
    references public.staff_users (organization_id, id)
    on delete set null (imported_by)
);

create index member_imports_imported_by_idx
  on public.member_imports (imported_by)
  where imported_by is not null;

create index member_imports_org_created_idx
  on public.member_imports (organization_id, created_at desc);

create unique index member_imports_upload_token_hash_uidx
  on public.member_imports (upload_token_hash);

create index member_imports_expiry_idx
  on public.member_imports (expires_at)
  where committed_at is null;

create table public.member_import_rows (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  import_id uuid not null,
  row_number integer not null,
  raw_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  status public.member_import_row_status not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_import_rows_row_number_positive
    check (row_number > 0),
  constraint member_import_rows_raw_is_object
    check (jsonb_typeof(raw_data) = 'object'),
  constraint member_import_rows_normalized_is_object
    check (jsonb_typeof(normalized_data) = 'object'),
  constraint member_import_rows_errors_are_array
    check (jsonb_typeof(validation_errors) = 'array'),
  constraint member_import_rows_import_row_key
    unique (import_id, row_number),
  constraint member_import_rows_import_same_organization_fkey
    foreign key (organization_id, import_id)
    references public.member_imports (organization_id, id)
    on delete cascade,
  constraint member_import_rows_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete set null (member_id)
);

create index member_import_rows_organization_id_idx
  on public.member_import_rows (organization_id);

create index member_import_rows_import_status_idx
  on public.member_import_rows (import_id, status, row_number);

create index member_import_rows_member_id_idx
  on public.member_import_rows (member_id)
  where member_id is not null;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  actor_type public.audit_actor_type not null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  sequence_number bigint not null,
  previous_hash text,
  entry_hash text not null,
  created_at timestamptz not null default now(),
  constraint audit_log_action_format
    check (
      char_length(action) between 3 and 120
      and action ~ '^[a-z0-9_.-]+$'
    ),
  constraint audit_log_entity_type_format
    check (
      char_length(entity_type) between 2 and 80
      and entity_type ~ '^[a-z0-9_.-]+$'
    ),
  constraint audit_log_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint audit_log_sequence_positive
    check (sequence_number > 0),
  constraint audit_log_previous_hash_format
    check (
      previous_hash is null
      or previous_hash ~ '^[a-f0-9]{64}$'
    ),
  constraint audit_log_entry_hash_format
    check (entry_hash ~ '^[a-f0-9]{64}$'),
  constraint audit_log_actor_consistent
    check (
      (actor_type in ('staff', 'member') and user_id is not null)
      or
      (actor_type in ('system', 'webhook') and user_id is null)
    )
);

create index audit_log_organization_created_idx
  on public.audit_log (organization_id, created_at desc, id);

create index audit_log_entity_idx
  on public.audit_log (organization_id, entity_type, entity_id, created_at desc);

create index audit_log_user_id_idx
  on public.audit_log (user_id)
  where user_id is not null;

create unique index audit_log_organization_entry_hash_uidx
  on public.audit_log (organization_id, entry_hash);

create unique index audit_log_organization_sequence_uidx
  on public.audit_log (organization_id, sequence_number);

create or replace function private.snapshot_release_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier public.club_tiers%rowtype;
begin
  select t.*
  into v_tier
  from public.club_tiers as t
  where t.id = new.tier_id
    and t.organization_id = new.organization_id
    and t.active;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Release tier must reference an active tier in the same organization.';
  end if;

  new.tier_name := v_tier.name;
  new.price_cents := v_tier.price_cents;
  new.bottle_count := v_tier.bottle_count;
  return new;
end;
$$;

create trigger release_tiers_snapshot
before insert on public.release_tiers
for each row execute function private.snapshot_release_tier();

create or replace function private.enforce_member_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'paused' then
      new.paused_at := coalesce(new.paused_at, now());
    elsif new.status = 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;

    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'active' and new.status in ('paused', 'cancelled'))
    or (old.status = 'paused' and new.status in ('active', 'cancelled'))
    or (old.status = 'cancelled' and new.status = 'active')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Invalid member status transition.';
  end if;

  if new.status = 'paused' then
    new.paused_at := now();
  elsif new.status = 'cancelled' then
    new.cancelled_at := now();
  elsif new.status = 'active' then
    new.reactivated_at := now();
    new.paused_at := null;
    new.cancelled_at := null;
  end if;

  return new;
end;
$$;

create trigger members_enforce_status_transition
before insert or update of status on public.members
for each row execute function private.enforce_member_status_transition();

create or replace function private.enforce_release_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'draft' and new.status = 'scheduled')
    or (old.status = 'scheduled' and new.status = 'processing')
    or (old.status = 'processing' and new.status = 'completed')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Invalid release status transition.';
  end if;

  return new;
end;
$$;

create trigger releases_enforce_status_transition
before update of status on public.releases
for each row execute function private.enforce_release_status_transition();

create or replace function private.enforce_shipment_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'pending' and new.status in ('charged', 'declined', 'cancelled'))
    or (old.status = 'declined' and new.status in ('charged', 'declined', 'cancelled'))
    or (old.status = 'charged' and new.status in ('label_created', 'refunded', 'cancelled'))
    or (old.status = 'label_created' and new.status in ('packed', 'refunded', 'cancelled'))
    or (old.status = 'packed' and new.status in ('shipped', 'refunded', 'cancelled'))
    or (old.status = 'shipped' and new.status in ('delivered', 'refunded'))
    or (old.status = 'delivered' and new.status = 'refunded')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Invalid shipment status transition.';
  end if;

  return new;
end;
$$;

create trigger shipments_enforce_status_transition
before update of status on public.shipments
for each row execute function private.enforce_shipment_status_transition();

create or replace function private.complete_release_when_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('delivered', 'cancelled', 'refunded')
    and not exists (
      select 1
      from public.shipments as s
      where s.release_id = new.release_id
        and s.status not in ('delivered', 'cancelled', 'refunded')
    )
  then
    update public.releases
    set status = 'completed'
    where id = new.release_id
      and organization_id = new.organization_id
      and status = 'processing';
  end if;

  return null;
end;
$$;

create trigger shipments_complete_release
after update of status on public.shipments
for each row execute function private.complete_release_when_terminal();

create trigger club_tiers_touch_updated_at
before update on public.club_tiers
for each row execute function private.touch_updated_at();

create trigger releases_touch_updated_at
before update on public.releases
for each row execute function private.touch_updated_at();

create trigger release_wines_touch_updated_at
before update on public.release_wines
for each row execute function private.touch_updated_at();

create trigger shipments_touch_updated_at
before update on public.shipments
for each row execute function private.touch_updated_at();

create trigger shipment_items_touch_updated_at
before update on public.shipment_items
for each row execute function private.touch_updated_at();

create trigger billing_attempts_touch_updated_at
before update on public.billing_attempts
for each row execute function private.touch_updated_at();

create trigger member_imports_touch_updated_at
before update on public.member_imports
for each row execute function private.touch_updated_at();

create trigger member_import_rows_touch_updated_at
before update on public.member_import_rows
for each row execute function private.touch_updated_at();

create or replace function private.reject_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'audit_log is append-only';
end;
$$;

create trigger audit_log_reject_update_delete
before update or delete on public.audit_log
for each row execute function private.reject_audit_log_mutation();

create trigger audit_log_reject_truncate
before truncate on public.audit_log
for each statement execute function private.reject_audit_log_mutation();

create or replace function private.resolve_audit_actor(
  p_organization_id uuid,
  p_user_id uuid
)
returns public.audit_actor_type
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return 'system'::public.audit_actor_type;
  end if;

  if exists (
    select 1
    from public.staff_users as s
    where s.id = p_user_id
      and s.organization_id = p_organization_id
      and s.status = 'active'
  ) then
    return 'staff'::public.audit_actor_type;
  end if;

  if exists (
    select 1
    from public.members as m
    where m.auth_user_id = p_user_id
      and m.organization_id = p_organization_id
      and m.deleted_at is null
  ) then
    return 'member'::public.audit_actor_type;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Audit actor does not belong to the organization.';
end;
$$;

create or replace function public.append_audit_entry(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id uuid;
  v_actor_type public.audit_actor_type;
  v_action text;
  v_entity_type text;
  v_metadata jsonb;
  v_previous_hash text;
  v_entry_hash text;
  v_created_at timestamptz;
  v_canonical_payload jsonb;
  v_request_id text;
  v_sequence_number bigint;
begin
  if not exists (
    select 1
    from public.organizations as o
    where o.id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'Organization not found.';
  end if;

  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Audit metadata must be an object.';
  end if;

  v_actor_type := private.resolve_audit_actor(p_organization_id, p_user_id);
  v_action := lower(btrim(p_action));
  v_entity_type := lower(btrim(p_entity_type));
  v_metadata :=
    p_metadata - array['card_number', 'cvc', 'client_secret', 'api_key', 'secret'];
  v_audit_id := gen_random_uuid();
  v_created_at := clock_timestamp();
  v_request_id := nullif(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id',
    ''
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text, 2)
  );

  select a.entry_hash, a.sequence_number
  into v_previous_hash, v_sequence_number
  from public.audit_log as a
  where a.organization_id = p_organization_id
  order by a.sequence_number desc
  limit 1;

  v_sequence_number := coalesce(v_sequence_number, 0) + 1;

  v_canonical_payload := jsonb_build_object(
    'id', v_audit_id::text,
    'organization_id', p_organization_id::text,
    'user_id', p_user_id::text,
    'actor_type', v_actor_type::text,
    'action', v_action,
    'entity_type', v_entity_type,
    'entity_id', p_entity_id::text,
    'metadata', v_metadata,
    'sequence_number', v_sequence_number,
    'created_at', to_char(
      v_created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'previous_hash', v_previous_hash
  );

  v_entry_hash := encode(
    extensions.digest(
      convert_to(v_canonical_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.audit_log (
    id,
    organization_id,
    user_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    metadata,
    request_id,
    sequence_number,
    previous_hash,
    entry_hash,
    created_at
  )
  values (
    v_audit_id,
    p_organization_id,
    p_user_id,
    v_actor_type,
    v_action,
    v_entity_type,
    p_entity_id,
    v_metadata,
    v_request_id,
    v_sequence_number,
    v_previous_hash,
    v_entry_hash,
    v_created_at
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

create or replace function public.verify_audit_chain(
  p_organization_id uuid
)
returns table (
  valid boolean,
  invalid_entry_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry public.audit_log%rowtype;
  v_expected_previous_hash text;
  v_expected_entry_hash text;
  v_canonical_payload jsonb;
begin
  for v_entry in
    select a.*
    from public.audit_log as a
    where a.organization_id = p_organization_id
    order by a.sequence_number
  loop
    v_canonical_payload := jsonb_build_object(
      'id', v_entry.id::text,
      'organization_id', v_entry.organization_id::text,
      'user_id', v_entry.user_id::text,
      'actor_type', v_entry.actor_type::text,
      'action', v_entry.action,
      'entity_type', v_entry.entity_type,
      'entity_id', v_entry.entity_id::text,
      'metadata', v_entry.metadata,
      'sequence_number', v_entry.sequence_number,
      'created_at', to_char(
        v_entry.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'previous_hash', v_expected_previous_hash
    );

    v_expected_entry_hash := encode(
      extensions.digest(
        convert_to(v_canonical_payload::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

    if v_entry.previous_hash is distinct from v_expected_previous_hash
      or v_entry.entry_hash is distinct from v_expected_entry_hash
    then
      valid := false;
      invalid_entry_id := v_entry.id;
      return next;
      return;
    end if;

    v_expected_previous_hash := v_entry.entry_hash;
  end loop;

  valid := true;
  invalid_entry_id := null;
  return next;
end;
$$;

create or replace function public.link_member_auth_user(
  p_user_id uuid,
  p_email text
)
returns table (
  member_id uuid,
  organization_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_auth_email text;
  v_member public.members%rowtype;
begin
  v_email := lower(btrim(p_email));

  if p_user_id is null
    or char_length(v_email) not between 3 and 320
    or position('@' in v_email) <= 1
  then
    raise exception using errcode = '22023', message = 'Invalid member identity.';
  end if;

  select lower(u.email)
  into v_auth_email
  from auth.users as u
  where u.id = p_user_id;

  if not found or v_auth_email is distinct from v_email then
    raise exception using
      errcode = '22023',
      message = 'user_id and email do not identify the same auth user.';
  end if;

  if exists (
    select 1
    from public.staff_users as s
    where s.id = p_user_id
  ) or exists (
    select 1
    from public.platform_users as p
    where p.id = p_user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Auth user already belongs to another Vinifera surface.';
  end if;

  select m.*
  into v_member
  from public.members as m
  where m.email = v_email
    and m.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Member profile not found.';
  end if;

  if v_member.auth_user_id is not null
    and v_member.auth_user_id <> p_user_id
  then
    raise exception using
      errcode = '23505',
      message = 'Member profile is already linked to another auth user.';
  end if;

  if v_member.auth_user_id is null then
    update public.members
    set auth_user_id = p_user_id
    where id = v_member.id;

    perform public.append_audit_entry(
      v_member.organization_id,
      p_user_id,
      'member.auth_linked',
      'member',
      v_member.id,
      '{}'::jsonb
    );
  end if;

  member_id := v_member.id;
  organization_id := v_member.organization_id;
  return next;
end;
$$;

create or replace function public.claim_due_releases(
  p_as_of date default current_date,
  p_limit integer default 25
)
returns table (
  organization_id uuid,
  release_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release record;
begin
  if p_as_of is null then
    raise exception using errcode = '22023', message = 'p_as_of cannot be null.';
  end if;

  if p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 100.';
  end if;

  for v_release in
    select r.id, r.organization_id
    from public.releases as r
    where r.status = 'scheduled'
      and r.processing_date <= p_as_of
    order by r.processing_date, r.id
    limit p_limit
    for update skip locked
  loop
    update public.releases as target
    set status = 'processing'
    where target.id = v_release.id
      and target.organization_id = v_release.organization_id
      and target.status = 'scheduled';

    if found then
      perform public.append_audit_entry(
        v_release.organization_id,
        null,
        'release.processing_claimed',
        'release',
        v_release.id,
        jsonb_build_object('processing_date', p_as_of)
      );

      organization_id := v_release.organization_id;
      release_id := v_release.id;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.create_release_shipments(
  p_organization_id uuid,
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
  perform private.resolve_audit_actor(p_organization_id, p_actor_user_id);

  select r.*
  into v_release
  from public.releases as r
  where r.id = p_release_id
    and r.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Release not found.';
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
  ) then
    raise exception using
      errcode = '23514',
      message = 'Release must include at least one tier item.';
  end if;

  insert into public.shipments (
    organization_id,
    member_id,
    release_id,
    release_tier_id,
    tier_id,
    shipping_address,
    charge_amount_cents
  )
  select
    m.organization_id,
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
    and m.club_tier_id = rt.tier_id
    and m.status = 'active'
    and m.deleted_at is null
  where rt.organization_id = p_organization_id
    and rt.release_id = p_release_id
  on conflict on constraint shipments_release_member_key do nothing;

  insert into public.shipment_items (
    organization_id,
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
    and rti.release_id = s.release_id
    and rti.release_tier_id = s.release_tier_id
  join public.release_wines as rw
    on rw.id = rti.release_wine_id
    and rw.organization_id = rti.organization_id
  where s.organization_id = p_organization_id
    and s.release_id = p_release_id
  on conflict do nothing;

  if v_release.status = 'scheduled' then
    update public.releases
    set status = 'processing'
    where id = p_release_id
      and organization_id = p_organization_id;
  end if;

  perform public.append_audit_entry(
    p_organization_id,
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
      )
    )
  );

  return query
  select s.id, s.member_id, s.charge_amount_cents
  from public.shipments as s
  where s.organization_id = p_organization_id
    and s.release_id = p_release_id
  order by s.created_at, s.id;
end;
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
begin
  if p_actor_user_id is not null then
    perform private.resolve_audit_actor(p_organization_id, p_actor_user_id);
  end if;

  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'Billing amount must be positive.';
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

  select s.*
  into v_shipment
  from public.shipments as s
  where s.id = p_shipment_id
    and s.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found.';
  end if;

  if p_attempt_kind in ('charge', 'retry')
    and p_amount_cents <> v_shipment.charge_amount_cents
  then
    raise exception using
      errcode = '22023',
      message = 'Charge amount must match the release snapshot.';
  end if;

  if p_attempt_kind = 'refund'
    and (
      v_shipment.stripe_charge_id is null
      or p_amount_cents > (
        v_shipment.charge_amount_cents - v_shipment.refund_amount_cents
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Refund requires a captured charge and cannot exceed it.';
  end if;

  select a.*
  into v_existing_attempt
  from public.billing_attempts as a
  where a.shipment_id = p_shipment_id
    and (
      a.idempotency_key = v_idempotency_key
      or (
        p_attempt_kind <> 'refund'
        and p_stripe_payment_intent_id is not null
        and a.attempt_kind <> 'refund'
        and a.stripe_payment_intent_id = p_stripe_payment_intent_id
      )
    )
  order by
    case when a.idempotency_key = v_idempotency_key then 0 else 1 end
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

    if v_existing_attempt.stripe_payment_intent_id is null
      and nullif(btrim(p_stripe_payment_intent_id), '') is not null
    then
      update public.billing_attempts
      set stripe_payment_intent_id = btrim(p_stripe_payment_intent_id)
      where id = v_existing_attempt.id;
    end if;

    return v_existing_attempt.id;
  end if;

  select coalesce(max(a.attempt_number), 0) + 1
  into v_attempt_number
  from public.billing_attempts as a
  where a.shipment_id = p_shipment_id;

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
  v_shipment public.shipments%rowtype;
  v_attempt public.billing_attempts%rowtype;
  v_retry_count integer;
  v_next_retry_at timestamptz;
  v_existing_status public.shipment_status;
begin
  if p_status not in ('succeeded', 'declined', 'failed', 'refunded') then
    raise exception using
      errcode = '22023',
      message = 'Payment events must have a terminal billing status.';
  end if;

  if p_stripe_event_id is not null
    and p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
  then
    raise exception using errcode = '22023', message = 'Invalid Stripe event identifier.';
  end if;

  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Payment metadata must be an object.';
  end if;

  if p_stripe_event_id is not null then
    select s.status
    into v_existing_status
    from public.billing_attempts as a
    join public.shipments as s
      on s.id = a.shipment_id
      and s.organization_id = a.organization_id
    where a.stripe_event_id = p_stripe_event_id;

    if found then
      return v_existing_status;
    end if;
  end if;

  select s.*
  into v_shipment
  from public.shipments as s
  where s.id = p_shipment_id
    and s.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found.';
  end if;

  select a.*
  into v_attempt
  from public.billing_attempts as a
  where a.id = p_billing_attempt_id
    and a.shipment_id = p_shipment_id
    and a.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Billing attempt not found.';
  end if;

  if (
    v_attempt.attempt_kind = 'refund'
    and p_status not in ('refunded', 'declined', 'failed')
  ) or (
    v_attempt.attempt_kind <> 'refund'
    and p_status = 'refunded'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Refund attempts and refund results must match.';
  end if;

  if v_attempt.status in ('succeeded', 'declined', 'failed', 'refunded', 'ignored') then
    update public.billing_attempts
    set
      stripe_event_id = coalesce(
        nullif(btrim(p_stripe_event_id), ''),
        stripe_event_id
      ),
      stripe_event_created_at = coalesce(
        stripe_event_created_at,
        p_event_created_at
      ),
      metadata = metadata
        || (
          p_metadata
          - array['card_number', 'cvc', 'client_secret', 'api_key', 'secret']
        )
        || jsonb_build_object('webhook_reconciled', p_stripe_event_id is not null)
    where id = p_billing_attempt_id;

    return v_shipment.status;
  end if;

  if v_shipment.last_payment_event_at is not null
    and p_event_created_at < v_shipment.last_payment_event_at
  then
    update public.billing_attempts
    set
      status = 'ignored',
      stripe_event_id = p_stripe_event_id,
      stripe_event_created_at = p_event_created_at,
      completed_at = now(),
      metadata = metadata || jsonb_build_object('ignored_reason', 'older_than_current_payment_state')
    where id = p_billing_attempt_id;

    return v_shipment.status;
  end if;

  v_retry_count := greatest(v_shipment.retry_count, v_attempt.attempt_number - 1);
  v_next_retry_at := case
    when v_retry_count = 0 then p_event_created_at + interval '1 day'
    when v_retry_count = 1 then p_event_created_at + interval '3 days'
    when v_retry_count = 2 then p_event_created_at + interval '7 days'
    else null
  end;

  update public.billing_attempts
  set
    status = p_status,
    stripe_charge_id = coalesce(
      nullif(btrim(p_stripe_charge_id), ''),
      stripe_charge_id
    ),
    stripe_refund_id = coalesce(
      nullif(btrim(p_stripe_refund_id), ''),
      stripe_refund_id
    ),
    stripe_event_id = p_stripe_event_id,
    stripe_event_created_at = p_event_created_at,
    decline_code = nullif(btrim(p_decline_code), ''),
    decline_reason = nullif(btrim(p_decline_reason), ''),
    completed_at = now(),
    metadata = metadata
      || (
        p_metadata
        - array['card_number', 'cvc', 'client_secret', 'api_key', 'secret']
      )
  where id = p_billing_attempt_id;

  if v_attempt.attempt_kind = 'refund'
    and p_status in ('declined', 'failed')
  then
    perform public.append_audit_entry(
      p_organization_id,
      null,
      'shipment.refund_failed',
      'shipment',
      p_shipment_id,
      jsonb_build_object(
        'billing_attempt_id', p_billing_attempt_id,
        'stripe_event_id', p_stripe_event_id,
        'amount_cents', v_attempt.amount_cents,
        'decline_code', nullif(btrim(p_decline_code), '')
      )
    );

    return v_shipment.status;
  elsif p_status = 'succeeded' then
    update public.shipments
    set
      status = 'charged',
      stripe_payment_intent_id = coalesce(
        v_attempt.stripe_payment_intent_id,
        stripe_payment_intent_id
      ),
      stripe_charge_id = coalesce(
        nullif(btrim(p_stripe_charge_id), ''),
        stripe_charge_id
      ),
      decline_code = null,
      decline_reason = null,
      next_retry_at = null,
      last_payment_event_at = p_event_created_at,
      paid_at = coalesce(paid_at, p_event_created_at)
    where id = p_shipment_id
    returning status into v_existing_status;

    update public.members
    set lifetime_value_cents = lifetime_value_cents + v_attempt.amount_cents
    where id = v_shipment.member_id
      and organization_id = p_organization_id;
  elsif p_status in ('declined', 'failed') then
    update public.shipments
    set
      status = 'declined',
      stripe_payment_intent_id = coalesce(
        v_attempt.stripe_payment_intent_id,
        stripe_payment_intent_id
      ),
      decline_code = coalesce(nullif(btrim(p_decline_code), ''), 'unknown'),
      decline_reason = coalesce(nullif(btrim(p_decline_reason), ''), 'Payment failed.'),
      retry_count = least(v_retry_count, 3),
      next_retry_at = v_next_retry_at,
      last_payment_event_at = p_event_created_at
    where id = p_shipment_id
    returning status into v_existing_status;
  else
    update public.shipments
    set
      status = case
        when refund_amount_cents + v_attempt.amount_cents >= charge_amount_cents
          then 'refunded'::public.shipment_status
        else status
      end,
      stripe_refund_id = nullif(btrim(p_stripe_refund_id), ''),
      refund_amount_cents = refund_amount_cents + v_attempt.amount_cents,
      last_payment_event_at = p_event_created_at,
      refunded_at = case
        when refund_amount_cents + v_attempt.amount_cents >= charge_amount_cents
          then p_event_created_at
        else refunded_at
      end
    where id = p_shipment_id
    returning status into v_existing_status;

    update public.members
    set lifetime_value_cents = greatest(
      lifetime_value_cents - v_attempt.amount_cents,
      0
    )
    where id = v_shipment.member_id
      and organization_id = p_organization_id;
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    null,
    case p_status
      when 'succeeded' then 'shipment.charge_succeeded'
      when 'declined' then 'shipment.charge_declined'
      when 'failed' then 'shipment.charge_failed'
      else 'shipment.refunded'
    end,
    'shipment',
    p_shipment_id,
    jsonb_build_object(
      'billing_attempt_id', p_billing_attempt_id,
      'stripe_event_id', p_stripe_event_id,
      'amount_cents', v_attempt.amount_cents,
      'decline_code', nullif(btrim(p_decline_code), '')
    )
  );

  return v_existing_status;
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
      s.id,
      s.organization_id,
      s.member_id,
      s.charge_amount_cents,
      (
        select coalesce(max(a.attempt_number), 0) + 1
        from public.billing_attempts as a
        where a.shipment_id = s.id
      ) as next_attempt_number
    from public.shipments as s
    where s.status = 'declined'
      and s.next_retry_at <= p_as_of
      and s.retry_count < 3
    order by s.next_retry_at, s.id
    limit p_limit
    for update of s skip locked
  ),
  claimed as (
    update public.shipments as s
    set next_retry_at = null
    from due as d
    where s.id = d.id
    returning s.id
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
      d.organization_id,
      d.id,
      'auto-retry:' || d.id::text || ':' || d.next_attempt_number::text,
      d.next_attempt_number,
      'retry',
      'processing',
      d.charge_amount_cents,
      p_as_of,
      p_as_of,
      jsonb_build_object('automatic', true)
    from due as d
    join claimed as c on c.id = d.id
    returning
      id,
      billing_attempts.shipment_id,
      billing_attempts.organization_id,
      billing_attempts.amount_cents,
      billing_attempts.attempt_number
  )
  select
    a.id,
    a.shipment_id,
    a.organization_id,
    s.member_id,
    a.amount_cents,
    a.attempt_number
  from attempts as a
  join public.shipments as s on s.id = a.shipment_id;
end;
$$;

create or replace function public.transition_shipment(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_target_status public.shipment_status,
  p_actor_user_id uuid default null,
  p_tracking_number text default null,
  p_carrier text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.shipment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.shipment_status;
begin
  perform private.resolve_audit_actor(p_organization_id, p_actor_user_id);

  if p_target_status not in (
    'label_created',
    'packed',
    'shipped',
    'delivered',
    'cancelled'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Shipment transition is not an operational shipping state.';
  end if;

  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Shipping metadata must be an object.';
  end if;

  update public.shipments
  set
    status = p_target_status,
    tracking_number = coalesce(
      nullif(btrim(p_tracking_number), ''),
      tracking_number
    ),
    carrier = coalesce(nullif(btrim(p_carrier), ''), carrier),
    shipping_provider = coalesce(
      nullif(btrim(p_metadata ->> 'shipping_provider'), ''),
      shipping_provider
    ),
    external_shipment_id = coalesce(
      nullif(btrim(p_metadata ->> 'external_shipment_id'), ''),
      external_shipment_id
    ),
    external_rate_id = coalesce(
      nullif(btrim(p_metadata ->> 'external_rate_id'), ''),
      external_rate_id
    ),
    external_label_id = coalesce(
      nullif(btrim(p_metadata ->> 'external_label_id'), ''),
      external_label_id
    ),
    label_url = coalesce(
      nullif(btrim(p_metadata ->> 'label_url'), ''),
      label_url
    ),
    label_format = coalesce(
      nullif(btrim(p_metadata ->> 'label_format'), ''),
      label_format
    ),
    label_cost_cents = coalesce(
      nullif(p_metadata ->> 'label_cost_cents', '')::integer,
      label_cost_cents
    ),
    address_validation_status = coalesce(
      nullif(p_metadata ->> 'address_validation_status', '')::public.address_validation_status,
      address_validation_status
    ),
    address_validation_messages = coalesce(
      p_metadata -> 'address_validation_messages',
      address_validation_messages
    ),
    validated_shipping_address = coalesce(
      p_metadata -> 'validated_shipping_address',
      validated_shipping_address
    ),
    shipping_provider_metadata = shipping_provider_metadata
      || (
        coalesce(p_metadata -> 'provider_metadata', '{}'::jsonb)
        - array['api_key', 'secret', 'token']
      ),
    label_created_at = case
      when p_target_status = 'label_created' then now()
      else label_created_at
    end,
    packed_at = case
      when p_target_status = 'packed' then now()
      else packed_at
    end,
    shipped_at = case
      when p_target_status = 'shipped' then now()
      else shipped_at
    end,
    delivered_at = case
      when p_target_status = 'delivered' then now()
      else delivered_at
    end,
    cancelled_at = case
      when p_target_status = 'cancelled' then now()
      else cancelled_at
    end
  where id = p_shipment_id
    and organization_id = p_organization_id
  returning status into v_status;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found.';
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    'shipment.' || p_target_status::text,
    'shipment',
    p_shipment_id,
    p_metadata - array['api_key', 'secret', 'token']
  );

  return v_status;
end;
$$;

create or replace function public.complete_member_import(
  p_organization_id uuid,
  p_upload_token text,
  p_column_mapping jsonb,
  p_actor_user_id uuid default null
)
returns table (
  inserted_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.member_imports%rowtype;
  v_row public.member_import_rows%rowtype;
  v_member_id uuid;
  v_inserted integer := 0;
  v_failed integer := 0;
  v_invalid integer := 0;
  v_error_message text;
  v_errors jsonb;
  v_normalized jsonb;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_upload_token_hash text;
begin
  perform private.resolve_audit_actor(p_organization_id, p_actor_user_id);

  if char_length(btrim(p_upload_token)) not between 32 and 512 then
    raise exception using errcode = '22023', message = 'Invalid member import token.';
  end if;

  if jsonb_typeof(p_column_mapping) is distinct from 'object'
    or nullif(btrim(p_column_mapping ->> 'email'), '') is null
  then
    raise exception using
      errcode = '22023',
      message = 'Column mapping must be an object with an email column.';
  end if;

  v_upload_token_hash := encode(
    extensions.digest(convert_to(btrim(p_upload_token), 'UTF8'), 'sha256'),
    'hex'
  );

  select i.*
  into v_import
  from public.member_imports as i
  where i.upload_token_hash = v_upload_token_hash
    and i.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Member import not found.';
  end if;

  if v_import.status in ('completed', 'completed_with_errors') then
    inserted_count := v_import.imported_rows;
    failed_count := v_import.failed_rows;
    return next;
    return;
  end if;

  if v_import.expires_at <= now() then
    raise exception using errcode = '22023', message = 'Member import token has expired.';
  end if;

  if v_import.status <> 'previewed' then
    raise exception using
      errcode = '23514',
      message = 'Only previewed imports can be completed.';
  end if;

  update public.member_imports
  set
    status = 'processing',
    column_mapping = p_column_mapping
  where id = v_import.id;

  for v_row in
    select r.*
    from public.member_import_rows as r
    where r.import_id = v_import.id
      and r.organization_id = p_organization_id
    order by r.row_number
    for update
  loop
    v_email := lower(
      btrim(
        coalesce(
          v_row.raw_data ->> (p_column_mapping ->> 'email'),
          ''
        )
      )
    );
    v_first_name := btrim(
      coalesce(
        v_row.raw_data ->> coalesce(
          nullif(p_column_mapping ->> 'first_name', ''),
          'first_name'
        ),
        ''
      )
    );
    v_last_name := btrim(
      coalesce(
        v_row.raw_data ->> coalesce(
          nullif(p_column_mapping ->> 'last_name', ''),
          'last_name'
        ),
        ''
      )
    );

    v_normalized := jsonb_strip_nulls(
      jsonb_build_object(
        'email', v_email,
        'first_name', v_first_name,
        'last_name', v_last_name,
        'phone',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'phone', ''),
                  'phone'
                ),
                ''
              )
            ),
            ''
          ),
        'shipping_address_line1',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'shipping_address_line1', ''),
                  'shipping_address_line1'
                ),
                ''
              )
            ),
            ''
          ),
        'shipping_address_line2',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'shipping_address_line2', ''),
                  'shipping_address_line2'
                ),
                ''
              )
            ),
            ''
          ),
        'shipping_city',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'shipping_city', ''),
                  'shipping_city'
                ),
                ''
              )
            ),
            ''
          ),
        'shipping_region',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'shipping_region', ''),
                  'shipping_region'
                ),
                ''
              )
            ),
            ''
          ),
        'shipping_postal_code',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'shipping_postal_code', ''),
                  'shipping_postal_code'
                ),
                ''
              )
            ),
            ''
          ),
        'shipping_country_code',
          coalesce(
            nullif(
              upper(
                btrim(
                  coalesce(
                    v_row.raw_data ->> coalesce(
                      nullif(p_column_mapping ->> 'shipping_country_code', ''),
                      'shipping_country_code'
                    ),
                    ''
                  )
                )
              ),
              ''
            ),
            'US'
          ),
        'club_tier_id',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'club_tier_id', ''),
                  'club_tier_id'
                ),
                ''
              )
            ),
            ''
          ),
        'joined_on',
          nullif(
            btrim(
              coalesce(
                v_row.raw_data ->> coalesce(
                  nullif(p_column_mapping ->> 'joined_on', ''),
                  'joined_on'
                ),
                ''
              )
            ),
            ''
          ),
        'status',
          nullif(
            lower(
              btrim(
                coalesce(
                  v_row.raw_data ->> coalesce(
                    nullif(p_column_mapping ->> 'status', ''),
                    'status'
                  ),
                  ''
                )
              )
            ),
            ''
          )
      )
    );

    v_errors := '[]'::jsonb;

    if v_email = ''
      or v_email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
    then
      v_errors := v_errors || jsonb_build_array('Invalid or missing email.');
    end if;

    if v_first_name = '' and v_last_name = '' then
      v_errors := v_errors || jsonb_build_array('Member name is required.');
    end if;

    update public.member_import_rows
    set
      normalized_data = v_normalized,
      status = case
        when jsonb_array_length(v_errors) = 0
          then 'valid'::public.member_import_row_status
        else 'invalid'::public.member_import_row_status
      end,
      validation_errors = v_errors,
      member_id = null
    where id = v_row.id;
  end loop;

  with duplicate_rows as (
    select r.id
    from public.member_import_rows as r
    where r.import_id = v_import.id
      and r.status = 'valid'
      and (
        exists (
          select 1
          from public.member_import_rows as earlier
          where earlier.import_id = r.import_id
            and earlier.status = 'valid'
            and earlier.normalized_data ->> 'email' = r.normalized_data ->> 'email'
            and earlier.row_number < r.row_number
        )
        or exists (
          select 1
          from public.members as m
          where m.organization_id = p_organization_id
            and m.email = r.normalized_data ->> 'email'
            and m.deleted_at is null
        )
      )
  )
  update public.member_import_rows as r
  set
    status = 'invalid',
    validation_errors = r.validation_errors || jsonb_build_array('Duplicate member email.')
  from duplicate_rows as d
  where r.id = d.id;

  for v_row in
    select r.*
    from public.member_import_rows as r
    where r.import_id = v_import.id
      and r.organization_id = p_organization_id
      and r.status = 'valid'
    order by r.row_number
    for update
  loop
    begin
      insert into public.members (
        organization_id,
        email,
        first_name,
        last_name,
        phone,
        shipping_address_line1,
        shipping_address_line2,
        shipping_city,
        shipping_region,
        shipping_postal_code,
        shipping_country_code,
        club_tier_id,
        joined_on,
        status
      )
      values (
        p_organization_id,
        lower(btrim(v_row.normalized_data ->> 'email')),
        btrim(coalesce(v_row.normalized_data ->> 'first_name', '')),
        btrim(coalesce(v_row.normalized_data ->> 'last_name', '')),
        nullif(btrim(v_row.normalized_data ->> 'phone'), ''),
        nullif(btrim(v_row.normalized_data ->> 'shipping_address_line1'), ''),
        nullif(btrim(v_row.normalized_data ->> 'shipping_address_line2'), ''),
        nullif(btrim(v_row.normalized_data ->> 'shipping_city'), ''),
        nullif(btrim(v_row.normalized_data ->> 'shipping_region'), ''),
        nullif(btrim(v_row.normalized_data ->> 'shipping_postal_code'), ''),
        coalesce(
          nullif(upper(btrim(v_row.normalized_data ->> 'shipping_country_code')), ''),
          'US'
        ),
        nullif(v_row.normalized_data ->> 'club_tier_id', '')::uuid,
        coalesce(
          nullif(v_row.normalized_data ->> 'joined_on', '')::date,
          current_date
        ),
        coalesce(
          nullif(v_row.normalized_data ->> 'status', '')::public.member_status,
          'active'
        )
      )
      returning id into v_member_id;

      update public.member_import_rows
      set
        status = 'imported',
        member_id = v_member_id
      where id = v_row.id;

      v_inserted := v_inserted + 1;
    exception
      when unique_violation then
        v_error_message := 'Duplicate member email.';
        update public.member_import_rows
        set
          status = 'failed',
          validation_errors = jsonb_build_array(v_error_message)
        where id = v_row.id;
        v_failed := v_failed + 1;
      when check_violation or foreign_key_violation or invalid_text_representation then
        v_error_message := sqlerrm;
        update public.member_import_rows
        set
          status = 'failed',
          validation_errors = jsonb_build_array(v_error_message)
        where id = v_row.id;
        v_failed := v_failed + 1;
    end;
  end loop;

  select count(*)::integer
  into v_invalid
  from public.member_import_rows as r
  where r.import_id = v_import.id
    and r.status = 'invalid';

  update public.member_imports
  set
    status = case
      when v_failed > 0 or v_invalid > 0
        then 'completed_with_errors'::public.member_import_status
      else 'completed'::public.member_import_status
    end,
    total_rows = (
      select count(*)::integer
      from public.member_import_rows as r
      where r.import_id = v_import.id
    ),
    valid_rows = v_inserted + v_failed,
    invalid_rows = v_invalid,
    imported_rows = v_inserted,
    failed_rows = v_failed + v_invalid,
    committed_at = now(),
    completed_at = now()
  where id = v_import.id;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    'member_import.completed',
    'member_import',
    v_import.id,
    jsonb_build_object(
      'inserted_count', v_inserted,
      'failed_count', v_failed + v_invalid
    )
  );

  inserted_count := v_inserted;
  failed_count := v_failed + v_invalid;
  return next;
end;
$$;

create or replace function private.member_has_tier(
  p_organization_id uuid,
  p_tier_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members as m
    where m.organization_id = p_organization_id
      and m.club_tier_id = p_tier_id
      and m.auth_user_id = auth.uid()
      and m.deleted_at is null
      and private.is_member_for_org(m.organization_id, m.auth_user_id)
  );
$$;

create or replace function private.member_can_view_release(
  p_organization_id uuid,
  p_release_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.releases as r
    join public.shipments as s
      on s.release_id = r.id
      and s.organization_id = r.organization_id
    join public.members as m
      on m.id = s.member_id
      and m.organization_id = s.organization_id
    where r.id = p_release_id
      and r.organization_id = p_organization_id
      and r.embargo_date <= current_date
      and m.auth_user_id = auth.uid()
      and m.deleted_at is null
      and private.is_member_for_org(m.organization_id, m.auth_user_id)
  );
$$;

create or replace function private.member_can_view_release_tier(
  p_organization_id uuid,
  p_release_tier_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.release_tiers as rt
    where rt.id = p_release_tier_id
      and rt.organization_id = p_organization_id
      and private.member_can_view_release(rt.organization_id, rt.release_id)
  );
$$;

create or replace function private.member_can_view_shipment(
  p_organization_id uuid,
  p_shipment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shipments as s
    join public.members as m
      on m.id = s.member_id
      and m.organization_id = s.organization_id
    where s.id = p_shipment_id
      and s.organization_id = p_organization_id
      and m.auth_user_id = auth.uid()
      and m.deleted_at is null
      and private.is_member_for_org(m.organization_id, m.auth_user_id)
  );
$$;

create or replace function private.member_can_view_shipment_contents(
  p_organization_id uuid,
  p_shipment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shipments as s
    join public.releases as r
      on r.id = s.release_id
      and r.organization_id = s.organization_id
    where s.id = p_shipment_id
      and s.organization_id = p_organization_id
      and r.embargo_date <= current_date
      and private.member_can_view_shipment(s.organization_id, s.id)
  );
$$;

alter table public.club_tiers enable row level security;
alter table public.club_tiers force row level security;
alter table public.releases enable row level security;
alter table public.releases force row level security;
alter table public.release_tiers enable row level security;
alter table public.release_tiers force row level security;
alter table public.release_wines enable row level security;
alter table public.release_wines force row level security;
alter table public.release_tier_items enable row level security;
alter table public.release_tier_items force row level security;
alter table public.shipments enable row level security;
alter table public.shipments force row level security;
alter table public.shipment_items enable row level security;
alter table public.shipment_items force row level security;
alter table public.billing_attempts enable row level security;
alter table public.billing_attempts force row level security;
alter table public.member_imports enable row level security;
alter table public.member_imports force row level security;
alter table public.member_import_rows enable row level security;
alter table public.member_import_rows force row level security;
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

create policy club_tiers_staff_select
on public.club_tiers
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy club_tiers_member_select
on public.club_tiers
for select
to authenticated
using (
  (select private.member_has_tier(organization_id, id))
);

create policy club_tiers_super_admin_all
on public.club_tiers
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy releases_staff_select
on public.releases
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy releases_member_select
on public.releases
for select
to authenticated
using (
  (select private.member_can_view_release(organization_id, id))
);

create policy releases_super_admin_all
on public.releases
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy release_tiers_staff_select
on public.release_tiers
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy release_tiers_member_select
on public.release_tiers
for select
to authenticated
using (
  (select private.member_can_view_release_tier(organization_id, id))
);

create policy release_tiers_super_admin_all
on public.release_tiers
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy release_wines_staff_select
on public.release_wines
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy release_wines_member_select
on public.release_wines
for select
to authenticated
using (
  (select private.member_can_view_release(organization_id, release_id))
);

create policy release_wines_super_admin_all
on public.release_wines
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy release_tier_items_staff_select
on public.release_tier_items
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy release_tier_items_member_select
on public.release_tier_items
for select
to authenticated
using (
  (select private.member_can_view_release_tier(organization_id, release_tier_id))
);

create policy release_tier_items_super_admin_all
on public.release_tier_items
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy shipments_staff_select
on public.shipments
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy shipments_member_select
on public.shipments
for select
to authenticated
using (
  (select private.member_can_view_shipment(organization_id, id))
);

create policy shipments_super_admin_all
on public.shipments
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy shipment_items_staff_select
on public.shipment_items
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy shipment_items_member_select
on public.shipment_items
for select
to authenticated
using (
  (select private.member_can_view_shipment_contents(organization_id, shipment_id))
);

create policy shipment_items_super_admin_all
on public.shipment_items
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy billing_attempts_staff_select
on public.billing_attempts
for select
to authenticated
using (
  (select private.is_staff_for_org(
    organization_id,
    array['owner', 'admin', 'manager']::public.staff_role[]
  ))
);

create policy billing_attempts_super_admin_all
on public.billing_attempts
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy member_imports_staff_select
on public.member_imports
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy member_imports_super_admin_all
on public.member_imports
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy member_import_rows_staff_select
on public.member_import_rows
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy member_import_rows_super_admin_all
on public.member_import_rows
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy audit_log_staff_select
on public.audit_log
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy audit_log_super_admin_select
on public.audit_log
for select
to authenticated
using ((select private.is_super_admin()));

create policy members_member_update
on public.members
for update
to authenticated
using ((select private.is_member_for_org(organization_id, auth_user_id)))
with check ((select private.is_member_for_org(organization_id, auth_user_id)));

revoke all on table
  public.club_tiers,
  public.releases,
  public.release_tiers,
  public.release_wines,
  public.release_tier_items,
  public.shipments,
  public.shipment_items,
  public.billing_attempts,
  public.member_imports,
  public.member_import_rows,
  public.audit_log
from anon, authenticated;

grant select on table
  public.club_tiers,
  public.releases,
  public.release_tiers,
  public.release_wines,
  public.release_tier_items,
  public.shipments,
  public.shipment_items,
  public.billing_attempts,
  public.member_imports,
  public.member_import_rows,
  public.audit_log
to authenticated;

grant update (
  phone,
  shipping_address_line1,
  shipping_address_line2,
  shipping_city,
  shipping_region,
  shipping_postal_code,
  shipping_country_code
) on public.members to authenticated;

grant all on table
  public.club_tiers,
  public.releases,
  public.release_tiers,
  public.release_wines,
  public.release_tier_items,
  public.shipments,
  public.shipment_items,
  public.billing_attempts,
  public.member_imports,
  public.member_import_rows
to service_role;

grant select on table public.audit_log to service_role;
grant usage, select on sequence public.member_import_rows_id_seq to service_role;

revoke execute on function private.snapshot_release_tier()
  from public, anon, authenticated;
revoke execute on function private.enforce_member_status_transition()
  from public, anon, authenticated;
revoke execute on function private.enforce_release_status_transition()
  from public, anon, authenticated;
revoke execute on function private.enforce_shipment_status_transition()
  from public, anon, authenticated;
revoke execute on function private.complete_release_when_terminal()
  from public, anon, authenticated;
revoke execute on function private.reject_audit_log_mutation()
  from public, anon, authenticated;
revoke execute on function private.resolve_audit_actor(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function private.member_has_tier(uuid, uuid)
  from public, anon;
revoke execute on function private.member_can_view_release(uuid, uuid)
  from public, anon;
revoke execute on function private.member_can_view_release_tier(uuid, uuid)
  from public, anon;
revoke execute on function private.member_can_view_shipment(uuid, uuid)
  from public, anon;
revoke execute on function private.member_can_view_shipment_contents(uuid, uuid)
  from public, anon;
grant execute on function private.resolve_audit_actor(uuid, uuid)
  to service_role;
grant execute on function private.member_has_tier(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.member_can_view_release(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.member_can_view_release_tier(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.member_can_view_shipment(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.member_can_view_shipment_contents(uuid, uuid)
  to authenticated, service_role;

revoke execute on function public.append_audit_entry(
  uuid,
  uuid,
  text,
  text,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function public.append_audit_entry(
  uuid,
  uuid,
  text,
  text,
  uuid,
  jsonb
) to service_role;

revoke execute on function public.verify_audit_chain(uuid)
  from public, anon, authenticated;
grant execute on function public.verify_audit_chain(uuid)
  to service_role;

revoke execute on function public.link_member_auth_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.link_member_auth_user(uuid, text)
  to service_role;

revoke execute on function public.claim_due_releases(date, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_releases(date, integer)
  to service_role;

revoke execute on function public.create_release_shipments(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_release_shipments(uuid, uuid, uuid)
  to service_role;

revoke execute on function public.record_billing_attempt(
  uuid,
  uuid,
  public.billing_attempt_kind,
  integer,
  text,
  text,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function public.record_billing_attempt(
  uuid,
  uuid,
  public.billing_attempt_kind,
  integer,
  text,
  text,
  uuid,
  jsonb
) to service_role;

revoke execute on function public.apply_shipment_payment_event(
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
) from public, anon, authenticated;
grant execute on function public.apply_shipment_payment_event(
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
) to service_role;

revoke execute on function public.schedule_due_shipment_retries(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.schedule_due_shipment_retries(timestamptz, integer)
  to service_role;

revoke execute on function public.transition_shipment(
  uuid,
  uuid,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.transition_shipment(
  uuid,
  uuid,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb
) to service_role;

revoke execute on function public.complete_member_import(uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_member_import(uuid, text, jsonb, uuid)
  to service_role;

commit;
