begin;

-- Preserve release-wine identity when a draft aggregate is rebuilt. Stable
-- identifiers let an exact command retry reach the durable replay record
-- instead of failing service-side after the first response was lost.
create or replace function public.apply_release_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_operation text,
  p_release_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id uuid;
  v_command_input jsonb;
  v_operation text := lower(btrim(p_operation));
  v_release public.releases%rowtype;
  v_release_tier public.release_tiers%rowtype;
  v_release_wine public.release_wines%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_tier record;
  v_wine record;
  v_wine_ids uuid[] := '{}'::uuid[];
begin
  perform private.require_core_club_staff(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    array['owner', 'admin', 'manager']::public.staff_role[]
  );
  if v_operation not in ('create', 'update', 'schedule')
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - array[
      'description',
      'embargo_date',
      'initial_status',
      'name',
      'processing_date',
      'tiers',
      'wines'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'The release command is invalid.';
  end if;

  v_command_input := jsonb_build_object(
    'release_id',
    p_release_id,
    'payload',
    p_payload
  );
  v_replay := private.load_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'release.' || v_operation,
    v_command_input
  );
  if v_replay is not null then
    return v_replay;
  end if;

  if v_operation in ('create', 'update') then
    if not (
      p_payload ? 'name'
      and jsonb_typeof(p_payload -> 'name') = 'string'
      and p_payload ? 'processing_date'
      and jsonb_typeof(p_payload -> 'processing_date') = 'string'
      and p_payload ? 'embargo_date'
      and jsonb_typeof(p_payload -> 'embargo_date') = 'string'
      and p_payload ? 'tiers'
      and p_payload ? 'wines'
      and jsonb_typeof(p_payload -> 'tiers') = 'array'
      and jsonb_typeof(p_payload -> 'wines') = 'array'
      and jsonb_array_length(p_payload -> 'tiers') > 0
      and jsonb_array_length(p_payload -> 'wines') > 0
    ) then
      raise exception using
        errcode = '22023',
        message = 'The release aggregate payload is incomplete.';
    end if;
    if (
      select count(*) <> count(distinct tier_id)
      from jsonb_to_recordset(p_payload -> 'tiers')
        as tier(tier_id uuid, price_cents integer)
    ) then
      raise exception using
        errcode = '22023',
        message = 'Release tiers must be unique.';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_payload -> 'tiers')
        as tier(tier_id uuid, price_cents integer)
      where tier.tier_id is null
        or tier.price_cents is null
        or tier.price_cents <= 0
        or not exists (
          select 1
          from public.club_tiers as club_tier
          where club_tier.organization_id = p_organization_id
            and club_tier.brand_id = p_brand_id
            and club_tier.id = tier.tier_id
            and club_tier.active
        )
    ) then
      raise exception using
        errcode = 'P0002',
        message = 'One or more release tiers were not found in this brand.';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_payload -> 'wines')
        as wine(
          wine_id uuid,
          wine_name text,
          quantity integer,
          price_cents integer
        )
      where char_length(btrim(coalesce(wine.wine_name, ''))) not between 1 and 200
        or wine.quantity is null
        or wine.quantity not between 1 and 120
        or wine.price_cents is null
        or wine.price_cents < 0
    ) then
      raise exception using
        errcode = '22023',
        message = 'One or more release wines are invalid.';
    end if;
    if (
      select count(wine.wine_id) <> count(distinct wine.wine_id)
      from jsonb_to_recordset(p_payload -> 'wines')
        as wine(wine_id uuid)
    ) then
      raise exception using
        errcode = '22023',
        message = 'Release wine identifiers must be unique.';
    end if;
  end if;

  if v_operation = 'create' then
    if p_release_id is not null
      or coalesce(
        nullif(p_payload ->> 'initial_status', ''),
        'draft'
      ) not in ('draft', 'scheduled')
      or exists (
        select 1
        from jsonb_array_elements(p_payload -> 'wines') as wine(value)
        where wine.value ? 'wine_id'
      )
    then
      raise exception using
        errcode = '22023',
        message = 'The release create state is invalid.';
    end if;

    insert into public.releases (
      organization_id,
      brand_id,
      name,
      description,
      processing_date,
      embargo_date,
      status,
      created_by
    )
    values (
      p_organization_id,
      p_brand_id,
      btrim(p_payload ->> 'name'),
      coalesce(p_payload ->> 'description', ''),
      (p_payload ->> 'processing_date')::date,
      (p_payload ->> 'embargo_date')::date,
      coalesce(
        nullif(p_payload ->> 'initial_status', ''),
        'draft'
      )::public.release_status,
      p_actor_user_id
    )
    returning * into v_release;
  elsif v_operation = 'update' then
    select release.*
    into v_release
    from public.releases as release
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Release not found.';
    end if;
    if v_release.status <> 'draft' then
      raise exception using
        errcode = '23514',
        message = 'Only a draft release can be updated.';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_payload -> 'wines')
        as wine(wine_id uuid)
      where wine.wine_id is not null
        and not exists (
          select 1
          from public.release_wines as existing_wine
          where existing_wine.organization_id = p_organization_id
            and existing_wine.brand_id = p_brand_id
            and existing_wine.release_id = p_release_id
            and existing_wine.id = wine.wine_id
        )
    ) then
      raise exception using
        errcode = 'P0002',
        message = 'One or more release wines were not found in this release.';
    end if;

    update public.releases as release
    set
      name = btrim(p_payload ->> 'name'),
      description = coalesce(p_payload ->> 'description', ''),
      processing_date = (p_payload ->> 'processing_date')::date,
      embargo_date = (p_payload ->> 'embargo_date')::date
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    returning * into v_release;

    delete from public.release_tier_items as item
    where item.organization_id = p_organization_id
      and item.brand_id = p_brand_id
      and item.release_id = p_release_id;
    delete from public.release_wines as wine
    where wine.organization_id = p_organization_id
      and wine.brand_id = p_brand_id
      and wine.release_id = p_release_id;
    delete from public.release_tiers as tier
    where tier.organization_id = p_organization_id
      and tier.brand_id = p_brand_id
      and tier.release_id = p_release_id;
  else
    select release.*
    into v_release
    from public.releases as release
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Release not found.';
    end if;
    if v_release.status <> 'draft' then
      raise exception using
        errcode = '23514',
        message = 'Only a draft release can be scheduled.';
    end if;
    perform private.assert_release_ready(
      p_organization_id,
      p_brand_id,
      p_release_id
    );
    update public.releases as release
    set status = 'scheduled'
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    returning * into v_release;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'release.scheduled',
      'release',
      v_release.id,
      jsonb_build_object('processing_date', v_release.processing_date)
    );
  end if;

  if v_operation in ('create', 'update') then
    for v_wine in
      select
        wine.ordinality,
        (wine.value ->> 'wine_id')::uuid as wine_id,
        wine.value ->> 'wine_name' as wine_name,
        (wine.value ->> 'quantity')::integer as quantity,
        (wine.value ->> 'price_cents')::integer as price_cents
      from jsonb_array_elements(p_payload -> 'wines')
        with ordinality as wine(value, ordinality)
      order by wine.ordinality
    loop
      if v_wine.wine_id is null then
        insert into public.release_wines (
          organization_id,
          brand_id,
          release_id,
          wine_name
        )
        values (
          p_organization_id,
          p_brand_id,
          v_release.id,
          v_wine.wine_name
        )
        returning * into v_release_wine;
      else
        insert into public.release_wines (
          id,
          organization_id,
          brand_id,
          release_id,
          wine_name
        )
        values (
          v_wine.wine_id,
          p_organization_id,
          p_brand_id,
          v_release.id,
          v_wine.wine_name
        )
        returning * into v_release_wine;
      end if;
      v_wine_ids[v_wine.ordinality::integer] := v_release_wine.id;
    end loop;

    for v_tier in
      select tier.tier_id, tier.price_cents
      from jsonb_to_recordset(p_payload -> 'tiers')
        as tier(tier_id uuid, price_cents integer)
      order by tier.tier_id
    loop
      insert into public.release_tiers (
        organization_id,
        brand_id,
        release_id,
        tier_id
      )
      values (
        p_organization_id,
        p_brand_id,
        v_release.id,
        v_tier.tier_id
      )
      returning * into v_release_tier;

      update public.release_tiers as release_tier
      set price_cents = v_tier.price_cents
      where release_tier.organization_id = p_organization_id
        and release_tier.brand_id = p_brand_id
        and release_tier.id = v_release_tier.id
      returning * into v_release_tier;

      for v_wine in
        select
          wine.ordinality,
          wine.value ->> 'wine_name' as wine_name,
          (wine.value ->> 'quantity')::integer as quantity,
          (wine.value ->> 'price_cents')::integer as price_cents
        from jsonb_array_elements(p_payload -> 'wines')
          with ordinality as wine(value, ordinality)
        order by wine.ordinality
      loop
        insert into public.release_tier_items (
          organization_id,
          brand_id,
          release_id,
          release_tier_id,
          release_wine_id,
          quantity,
          unit_price_cents
        )
        values (
          p_organization_id,
          p_brand_id,
          v_release.id,
          v_release_tier.id,
          v_wine_ids[v_wine.ordinality::integer],
          v_wine.quantity,
          v_wine.price_cents
        );
      end loop;
    end loop;

    if v_release.status = 'scheduled' then
      perform private.assert_release_ready(
        p_organization_id,
        p_brand_id,
        v_release.id
      );
    end if;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      case
        when v_operation = 'create' then 'release.created'
        else 'release.updated'
      end,
      'release',
      v_release.id,
      case
        when v_operation = 'create' then jsonb_build_object(
          'initial_status',
          v_release.status,
          'tier_count',
          jsonb_array_length(p_payload -> 'tiers'),
          'wine_count',
          jsonb_array_length(p_payload -> 'wines')
        )
        else jsonb_build_object(
          'changed_fields',
          jsonb_build_array(
            'description',
            'embargo_date',
            'name',
            'processing_date',
            'tiers',
            'wines'
          )
        )
      end
    );
  end if;

  v_result := jsonb_build_object(
    'entityId',
    v_release.id,
    'status',
    v_release.status,
    'updatedAt',
    v_release.updated_at
  );
  return private.store_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'release.' || v_operation,
    v_command_input,
    'release',
    v_release.id,
    v_result,
    v_audit_id
  );
end;
$$;

revoke all on function public.apply_release_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function public.apply_release_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  jsonb
) to service_role;

commit;
