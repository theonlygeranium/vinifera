-- Phase 5 Meta first-party attribution.
-- Browser identifiers are encrypted by the Worker before they cross this
-- boundary. Authenticated users can access only aggregate reporting.

create table public.meta_attribution_touchpoints (
  id uuid primary key,
  organization_id uuid not null,
  brand_id uuid not null,
  member_id uuid not null,
  event_source_url text not null,
  campaign_id text,
  campaign_name text,
  source text,
  medium text,
  storage_mode text not null default 'encrypted_envelope',
  algorithm text,
  envelope_version integer,
  key_version text,
  browser_data_ciphertext text,
  browser_data_iv text,
  payload_hash text not null,
  occurred_at timestamptz not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meta_attribution_touchpoints_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint meta_attribution_touchpoints_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id),
  constraint meta_attribution_touchpoints_organization_brand_id_key
    unique (organization_id, brand_id, id),
  constraint meta_attribution_touchpoints_url_safe
    check (
      char_length(event_source_url) between 9 and 2048
      and event_source_url ~ '^https://'
      and event_source_url !~ '[[:space:]<>]'
    ),
  constraint meta_attribution_touchpoints_campaign_safe
    check (
      (campaign_id is null or (
        char_length(campaign_id) between 1 and 120
        and campaign_id !~ '[[:cntrl:]<>]'
      ))
      and (campaign_name is null or (
        char_length(campaign_name) between 1 and 200
        and campaign_name !~ '[[:cntrl:]<>]'
      ))
      and (source is null or (
        char_length(source) between 1 and 120
        and source !~ '[[:cntrl:]<>]'
      ))
      and (medium is null or (
        char_length(medium) between 1 and 120
        and medium !~ '[[:cntrl:]<>]'
      ))
    ),
  constraint meta_attribution_touchpoints_envelope_valid
    check (
      (
        storage_mode = 'encrypted_envelope'
        and algorithm = 'A256GCM'
        and envelope_version = 1
        and key_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
        and browser_data_ciphertext ~ '^[A-Za-z0-9+/=_-]{24,}$'
        and browser_data_iv ~ '^[A-Za-z0-9+/=_-]{12,}$'
      )
      or (
        storage_mode = 'redacted'
        and algorithm is null
        and envelope_version is null
        and key_version is null
        and browser_data_ciphertext is null
        and browser_data_iv is null
      )
    ),
  constraint meta_attribution_touchpoints_payload_hash_valid
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint meta_attribution_touchpoints_time_valid
    check (
      occurred_at <= captured_at + interval '5 minutes'
      and captured_at <= created_at + interval '5 minutes'
    )
);

create index meta_attribution_touchpoints_member_time_idx
  on public.meta_attribution_touchpoints (
    organization_id,
    brand_id,
    member_id,
    occurred_at desc
  );

create index meta_attribution_touchpoints_campaign_time_idx
  on public.meta_attribution_touchpoints (
    organization_id,
    brand_id,
    campaign_id,
    occurred_at desc
  );

alter table public.meta_conversion_events
  add column attribution_touchpoint_id uuid,
  add column event_source_url text,
  add constraint meta_conversion_events_attribution_fkey
    foreign key (
      organization_id,
      brand_id,
      attribution_touchpoint_id
    )
    references public.meta_attribution_touchpoints (
      organization_id,
      brand_id,
      id
    )
    on delete set null (attribution_touchpoint_id),
  add constraint meta_conversion_events_source_url_safe
    check (
      event_source_url is null
      or (
        char_length(event_source_url) between 9 and 2048
        and event_source_url ~ '^https://'
        and event_source_url !~ '[[:space:]<>]'
      )
    );

create index meta_conversion_events_attribution_idx
  on public.meta_conversion_events (
    organization_id,
    brand_id,
    attribution_touchpoint_id,
    event_time
  )
  where attribution_touchpoint_id is not null;

create or replace function public.store_meta_attribution_touchpoint(
  p_id uuid,
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_event_source_url text,
  p_campaign_id text,
  p_campaign_name text,
  p_source text,
  p_medium text,
  p_algorithm text,
  p_envelope_version integer,
  p_key_version text,
  p_browser_data_ciphertext text,
  p_browser_data_iv text,
  p_payload_hash text,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.meta_attribution_touchpoints;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Meta attribution capture is service-only.';
  end if;

  if not exists (
    select 1
    from public.members as member
    join public.member_integration_consents as consent
      on consent.organization_id = member.organization_id
     and consent.brand_id = member.brand_id
     and consent.member_id = member.id
     and consent.integration_type = 'meta'
     and consent.consented
     and consent.revoked_at is null
    where member.id = p_member_id
      and member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'Active member Meta consent is required.';
  end if;

  insert into public.meta_attribution_touchpoints (
    id,
    organization_id,
    brand_id,
    member_id,
    event_source_url,
    campaign_id,
    campaign_name,
    source,
    medium,
    algorithm,
    envelope_version,
    key_version,
    browser_data_ciphertext,
    browser_data_iv,
    payload_hash,
    occurred_at
  )
  values (
    p_id,
    p_organization_id,
    p_brand_id,
    p_member_id,
    btrim(p_event_source_url),
    nullif(btrim(p_campaign_id), ''),
    nullif(btrim(p_campaign_name), ''),
    nullif(btrim(p_source), ''),
    nullif(btrim(p_medium), ''),
    p_algorithm,
    p_envelope_version,
    p_key_version,
    p_browser_data_ciphertext,
    p_browser_data_iv,
    p_payload_hash,
    p_occurred_at
  )
  on conflict (id) do nothing;

  select * into strict v_existing
  from public.meta_attribution_touchpoints
  where id = p_id;

  if v_existing.organization_id <> p_organization_id
    or v_existing.brand_id <> p_brand_id
    or v_existing.member_id <> p_member_id
    or v_existing.payload_hash <> p_payload_hash
  then
    raise exception using
      errcode = '23505',
      message = 'Meta attribution idempotency key was reused for another payload.';
  end if;

  return v_existing.id;
end;
$$;

create or replace function public.get_meta_attribution_report(
  p_organization_id uuid,
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaigns jsonb;
  v_summary jsonb;
begin
  if p_from is null
    or p_to is null
    or p_from > p_to
    or p_to > now() + interval '5 minutes'
    or p_to - p_from > interval '2 years'
  then
    raise exception using
      errcode = '22023',
      message = 'Meta attribution report range is invalid.';
  end if;

  if not (
    private.is_staff_for_org(p_organization_id)
    and private.can_access_brand(p_organization_id, p_brand_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'Brand staff authorization is required.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'campaignId', campaign.campaign_id,
        'campaignName', campaign.campaign_name,
        'source', campaign.source,
        'medium', campaign.medium,
        'touchpoints', campaign.touchpoints,
        'members', campaign.members,
        'conversions', campaign.conversions,
        'purchases', campaign.purchases,
        'purchaseValue', campaign.purchase_value
      )
      order by campaign.purchase_value desc, campaign.touchpoints desc,
        campaign.campaign_id nulls last
    ),
    '[]'::jsonb
  )
  into v_campaigns
  from (
    select
      touch.campaign_id,
      touch.campaign_name,
      touch.source,
      touch.medium,
      count(distinct touch.id)::integer as touchpoints,
      count(distinct touch.member_id)::integer as members,
      count(distinct conversion.id)::integer as conversions,
      count(distinct conversion.id)
        filter (where conversion.event_name = 'Purchase')::integer
        as purchases,
      coalesce(sum(
        case
          when conversion.event_name = 'Purchase'
            and jsonb_typeof(conversion.custom_data -> 'value') = 'number'
            then (conversion.custom_data ->> 'value')::numeric
          else 0
        end
      ), 0) as purchase_value
    from public.meta_attribution_touchpoints as touch
    left join public.meta_conversion_events as conversion
      on conversion.organization_id = touch.organization_id
     and conversion.brand_id = touch.brand_id
     and conversion.attribution_touchpoint_id = touch.id
     and conversion.event_time between p_from and p_to
    where touch.organization_id = p_organization_id
      and touch.brand_id = p_brand_id
      and touch.occurred_at between p_from and p_to
    group by
      touch.campaign_id,
      touch.campaign_name,
      touch.source,
      touch.medium
  ) as campaign;

  select jsonb_build_object(
    'touchpoints', (
      select count(*)::integer
      from public.meta_attribution_touchpoints as touch
      where touch.organization_id = p_organization_id
        and touch.brand_id = p_brand_id
        and touch.occurred_at between p_from and p_to
    ),
    'members', (
      select count(distinct touch.member_id)::integer
      from public.meta_attribution_touchpoints as touch
      where touch.organization_id = p_organization_id
        and touch.brand_id = p_brand_id
        and touch.occurred_at between p_from and p_to
    ),
    'attributedConversions', (
      select count(*)::integer
      from public.meta_conversion_events as conversion
      where conversion.organization_id = p_organization_id
        and conversion.brand_id = p_brand_id
        and conversion.attribution_touchpoint_id is not null
        and conversion.event_time between p_from and p_to
    ),
    'unattributedConversions', (
      select count(*)::integer
      from public.meta_conversion_events as conversion
      where conversion.organization_id = p_organization_id
        and conversion.brand_id = p_brand_id
        and conversion.attribution_touchpoint_id is null
        and conversion.event_time between p_from and p_to
    ),
    'completedConversions', (
      select count(*)::integer
      from public.meta_conversion_events as conversion
      where conversion.organization_id = p_organization_id
        and conversion.brand_id = p_brand_id
        and conversion.attribution_touchpoint_id is not null
        and conversion.status = 'completed'
        and conversion.event_time between p_from and p_to
    ),
    'queuedConversions', (
      select count(*)::integer
      from public.meta_conversion_events as conversion
      where conversion.organization_id = p_organization_id
        and conversion.brand_id = p_brand_id
        and conversion.attribution_touchpoint_id is not null
        and conversion.status in ('queued', 'retry', 'leased')
        and conversion.event_time between p_from and p_to
    )
  )
  into v_summary
  ;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'summary', coalesce(v_summary, jsonb_build_object(
      'touchpoints', 0,
      'members', 0,
      'attributedConversions', 0,
      'unattributedConversions', 0,
      'completedConversions', 0,
      'queuedConversions', 0
    )),
    'campaigns', v_campaigns,
    'generatedAt', now()
  );
end;
$$;

create or replace function private.redact_meta_attribution_on_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.integration_type = 'meta'
    and (not new.consented or new.revoked_at is not null)
    and (
      tg_op = 'INSERT'
      or old.consented
      or old.revoked_at is distinct from new.revoked_at
    )
  then
    update public.meta_attribution_touchpoints
    set
      storage_mode = 'redacted',
      algorithm = null,
      envelope_version = null,
      key_version = null,
      browser_data_ciphertext = null,
      browser_data_iv = null,
      payload_hash = repeat('0', 64)
    where organization_id = new.organization_id
      and brand_id = new.brand_id
      and member_id = new.member_id
      and storage_mode = 'encrypted_envelope';
  end if;
  return new;
end;
$$;

create trigger member_meta_consent_redact_attribution
after insert or update of consented, revoked_at
on public.member_integration_consents
for each row execute function private.redact_meta_attribution_on_consent();

alter table public.meta_attribution_touchpoints enable row level security;
alter table public.meta_attribution_touchpoints force row level security;

revoke all on function private.redact_meta_attribution_on_consent()
from public, anon, authenticated;
revoke all on table public.meta_attribution_touchpoints
from public, anon, authenticated;
grant select on table public.meta_attribution_touchpoints to service_role;
revoke all on function public.store_meta_attribution_touchpoint(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, integer,
  text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.store_meta_attribution_touchpoint(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, integer,
  text, text, text, text, timestamptz
) to service_role;

revoke all on function public.get_meta_attribution_report(
  uuid, uuid, timestamptz, timestamptz
) from public, anon;
grant execute on function public.get_meta_attribution_report(
  uuid, uuid, timestamptz, timestamptz
) to authenticated, service_role;
