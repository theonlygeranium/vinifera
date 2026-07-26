begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(42);

insert into auth.users (id, email)
values
  ('21000000-0000-4000-8000-000000000001', 'phase2-staff-a@example.test'),
  ('21000000-0000-4000-8000-000000000002', 'phase2-staff-b@example.test'),
  ('21000000-0000-4000-8000-000000000003', 'phase2-member-a@example.test'),
  ('21000000-0000-4000-8000-000000000004', 'phase2-member-b@example.test'),
  ('21000000-0000-4000-8000-000000000005', 'phase2-platform@example.test');

insert into public.organizations (id, name, plan_tier)
values
  ('22000000-0000-4000-8000-000000000001', 'Phase 2 Winery A', 'vine'),
  ('22000000-0000-4000-8000-000000000002', 'Phase 2 Winery B', 'cellar');

insert into public.staff_users (id, organization_id, email, role)
values
  (
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'phase2-staff-a@example.test',
    'owner'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    'phase2-staff-b@example.test',
    'owner'
  );

insert into public.platform_users (id, email)
values (
  '21000000-0000-4000-8000-000000000005',
  'phase2-platform@example.test'
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
  (
    '23000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'A Reserve',
    12000,
    3,
    'quarterly'
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    'B Reserve',
    14000,
    3,
    'quarterly'
  );

insert into public.members (
  id,
  auth_user_id,
  organization_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
values
  (
    '24000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    'phase2-member-a@example.test',
    'Member',
    'A',
    '23000000-0000-4000-8000-000000000001'
  ),
  (
    '24000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000002',
    'phase2-member-b@example.test',
    'Member',
    'B',
    '23000000-0000-4000-8000-000000000002'
  );

insert into public.releases (
  id,
  organization_id,
  name,
  processing_date,
  embargo_date,
  status,
  created_by
)
values
  (
    '25000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Visible Release A',
    current_date + 1,
    current_date,
    'scheduled',
    '21000000-0000-4000-8000-000000000001'
  ),
  (
    '25000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    'Embargoed Release B',
    current_date + 2,
    current_date + 1,
    'scheduled',
    '21000000-0000-4000-8000-000000000002'
  );

insert into public.release_tiers (
  id,
  organization_id,
  release_id,
  tier_id
)
values
  (
    '26000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001'
  ),
  (
    '26000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    '25000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000002'
  );

insert into public.release_wines (
  id,
  organization_id,
  release_id,
  wine_name,
  vintage,
  sku
)
values
  (
    '27000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    'A Cabernet',
    2024,
    'A-CAB-24'
  ),
  (
    '27000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    '25000000-0000-4000-8000-000000000002',
    'B Cabernet',
    2024,
    'B-CAB-24'
  );

insert into public.release_tier_items (
  organization_id,
  release_id,
  release_tier_id,
  release_wine_id,
  quantity,
  unit_price_cents
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    3,
    4000
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '25000000-0000-4000-8000-000000000002',
    '26000000-0000-4000-8000-000000000002',
    '27000000-0000-4000-8000-000000000002',
    3,
    4666
  );

insert into public.shipments (
  id,
  organization_id,
  member_id,
  release_id,
  release_tier_id,
  tier_id,
  shipping_address,
  charge_amount_cents
)
values
  (
    '28000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '{"line1":"1 A Way"}'::jsonb,
    12000
  ),
  (
    '28000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    '24000000-0000-4000-8000-000000000002',
    '25000000-0000-4000-8000-000000000002',
    '26000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000002',
    '{"line1":"2 B Way"}'::jsonb,
    14000
  );

insert into public.shipment_items (
  organization_id,
  shipment_id,
  release_wine_id,
  wine_name,
  quantity,
  price_cents
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    'A Cabernet',
    3,
    4000
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '28000000-0000-4000-8000-000000000002',
    '27000000-0000-4000-8000-000000000002',
    'B Cabernet',
    3,
    4666
  );

insert into public.billing_attempts (
  organization_id,
  shipment_id,
  idempotency_key,
  attempt_number,
  attempt_kind,
  status,
  amount_cents
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000000001',
    'rls-charge-a',
    1,
    'charge',
    'queued',
    12000
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '28000000-0000-4000-8000-000000000002',
    'rls-charge-b',
    1,
    'charge',
    'queued',
    14000
  );

insert into public.member_imports (
  id,
  organization_id,
  upload_token_hash,
  content_sha256,
  source,
  original_filename,
  content_type,
  file_size_bytes,
  status,
  imported_by
)
values
  (
    '29000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    repeat('c', 64),
    'generic',
    'a.csv',
    'text/csv',
    128,
    'previewed',
    '21000000-0000-4000-8000-000000000001'
  ),
  (
    '29000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    repeat('b', 64),
    repeat('d', 64),
    'generic',
    'b.csv',
    'text/csv',
    128,
    'previewed',
    '21000000-0000-4000-8000-000000000002'
  );

insert into public.member_import_rows (
  organization_id,
  import_id,
  row_number,
  raw_data
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    1,
    '{"email":"new-a@example.test"}'::jsonb
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '29000000-0000-4000-8000-000000000002',
    1,
    '{"email":"new-b@example.test"}'::jsonb
  );

select ok(
  public.append_audit_entry(
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'rls.seeded',
    'organization',
    '22000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ) is not null,
  'Org A audit fixture is appended through the server boundary'
);
select ok(
  public.append_audit_entry(
    '22000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    'rls.seeded',
    'organization',
    '22000000-0000-4000-8000-000000000002',
    '{}'::jsonb
  ) is not null,
  'Org B audit fixture is appended through the server boundary'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"21000000-0000-4000-8000-000000000001","role":"authenticated","organization_id":"22000000-0000-4000-8000-000000000001","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.club_tiers), 1::bigint, 'Org A staff sees one tier');
select is((select count(*) from public.releases), 1::bigint, 'Org A staff sees one release');
select is((select count(*) from public.release_tiers), 1::bigint, 'Org A staff sees one release tier');
select is((select count(*) from public.release_wines), 1::bigint, 'Org A staff sees one release wine');
select is((select count(*) from public.release_tier_items), 1::bigint, 'Org A staff sees one tier item');
select is((select count(*) from public.shipments), 1::bigint, 'Org A staff sees one shipment');
select is((select count(*) from public.shipment_items), 1::bigint, 'Org A staff sees one shipment item');
select is((select count(*) from public.billing_attempts), 1::bigint, 'Org A staff sees one billing attempt');
select is((select count(*) from public.member_imports), 1::bigint, 'Org A staff sees one import');
select is((select count(*) from public.member_import_rows), 1::bigint, 'Org A staff sees one import row');
select is((select count(*) from public.audit_log), 1::bigint, 'Org A staff sees one audit entry');

set local request.jwt.claims =
  '{"sub":"21000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"22000000-0000-4000-8000-000000000002","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.club_tiers), 1::bigint, 'Org B staff cannot see Org A tiers');
select is((select count(*) from public.releases), 1::bigint, 'Org B staff cannot see Org A releases');
select is((select count(*) from public.shipments), 1::bigint, 'Org B staff cannot see Org A shipments');
select is((select count(*) from public.billing_attempts), 1::bigint, 'Org B staff cannot see Org A billing');
select is((select count(*) from public.member_imports), 1::bigint, 'Org B staff cannot see Org A imports');
select is((select count(*) from public.audit_log), 1::bigint, 'Org B staff cannot see Org A audit entries');

set local request.jwt.claims =
  '{"sub":"21000000-0000-4000-8000-000000000003","role":"authenticated","organization_id":"22000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';

select is((select count(*) from public.club_tiers), 1::bigint, 'member sees their assigned tier');
select is((select count(*) from public.releases), 1::bigint, 'member sees a release after embargo');
select is((select count(*) from public.release_tiers), 1::bigint, 'member sees their release tier');
select is((select count(*) from public.release_wines), 1::bigint, 'member sees wine after embargo');
select is((select count(*) from public.release_tier_items), 1::bigint, 'member sees tier items after embargo');
select is((select count(*) from public.shipments), 1::bigint, 'member sees their shipment history');
select is((select count(*) from public.shipment_items), 1::bigint, 'member sees their shipment contents after embargo');
select is((select count(*) from public.billing_attempts), 0::bigint, 'member cannot read billing internals');
select is((select count(*) from public.member_imports), 0::bigint, 'member cannot read imports');
select is((select count(*) from public.audit_log), 0::bigint, 'member cannot read the audit ledger');
select lives_ok(
  $$ update public.members set phone = '+1 707 555 0100' where id = '24000000-0000-4000-8000-000000000001' $$,
  'member can update their own approved contact data'
);
select is(
  (
    select phone
    from public.members
    where id = '24000000-0000-4000-8000-000000000001'
  ),
  '+1 707 555 0100',
  'member contact update persists'
);
select lives_ok(
  $$ update public.members set phone = '+1 707 555 0199' where id = '24000000-0000-4000-8000-000000000002' $$,
  'cross-tenant member update fails closed without leaking row existence'
);
select is(
  (
    select count(*)
    from public.members
    where id = '24000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'member cannot read the cross-tenant row after an attempted update'
);

set local request.jwt.claims =
  '{"sub":"21000000-0000-4000-8000-000000000004","role":"authenticated","organization_id":"22000000-0000-4000-8000-000000000002","user_role":"member","auth_surface":"member","platform_role":null}';

select is((select count(*) from public.club_tiers), 1::bigint, 'Org B member sees their tier');
select is((select count(*) from public.releases), 0::bigint, 'release is hidden before embargo');
select is((select count(*) from public.release_wines), 0::bigint, 'wine is hidden before embargo');
select is((select count(*) from public.shipments), 1::bigint, 'shipment history remains visible before embargo');
select is((select count(*) from public.shipment_items), 0::bigint, 'shipment contents remain hidden before embargo');

set local request.jwt.claims =
  '{"sub":"21000000-0000-4000-8000-000000000005","role":"authenticated","organization_id":null,"user_role":"super_admin","auth_surface":"platform","platform_role":"super_admin"}';

select is((select count(*) from public.club_tiers), 2::bigint, 'super-admin sees all tiers');
select is((select count(*) from public.releases), 2::bigint, 'super-admin sees all releases');
select is((select count(*) from public.shipments), 2::bigint, 'super-admin sees all shipments');
select is((select count(*) from public.audit_log), 2::bigint, 'super-admin sees all audit entries');

select * from finish();
rollback;
