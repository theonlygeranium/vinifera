-- Vinifera Phase 5 privilege boundary.
-- Kept separate so every Phase 5 object exists before grants are evaluated.

begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'brands',
    'organization_staff_access',
    'staff_brand_access',
    'brand_analytics_daily_metrics',
    'integration_connections',
    'integration_secrets',
    'integration_sync_jobs',
    'integration_sync_logs',
    'klaviyo_field_mappings',
    'klaviyo_profile_mappings',
    'klaviyo_engagement_events',
    'quickbooks_account_mappings',
    'quickbooks_transaction_mappings',
    'quickbooks_reconciliations',
    'avalara_exemptions',
    'avalara_tax_calculations',
    'member_integration_consents',
    'meta_conversion_events',
    'brand_custom_domains',
    'brand_sender_identities',
    'mobile_devices',
    'mobile_device_secrets',
    'mobile_push_outbox',
    'mobile_offline_snapshots',
    'mobile_offline_mutations',
    'mobile_deep_link_routes',
    'mobile_auth_exchange_tokens',
    'mobile_refresh_sessions',
    'member_auth_link_contexts',
    'integration_refund_deliveries'
  ]
  loop
    execute format(
      'revoke all on table public.%I from public, anon, authenticated',
      v_table
    );
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$$;

grant select on table
  public.brands,
  public.brand_analytics_daily_metrics,
  public.integration_connections,
  public.integration_sync_jobs,
  public.integration_sync_logs,
  public.klaviyo_field_mappings,
  public.klaviyo_profile_mappings,
  public.klaviyo_engagement_events,
  public.quickbooks_account_mappings,
  public.quickbooks_transaction_mappings,
  public.quickbooks_reconciliations,
  public.avalara_exemptions,
  public.avalara_tax_calculations,
  public.meta_conversion_events,
  public.brand_custom_domains,
  public.brand_sender_identities,
  public.mobile_deep_link_routes
to authenticated;

grant select, insert, update, delete on table
  public.organization_staff_access,
  public.staff_brand_access,
  public.member_integration_consents,
  public.mobile_devices,
  public.mobile_offline_snapshots,
  public.mobile_offline_mutations
to authenticated;

grant usage, select on all sequences in schema public to service_role;

alter table public.mobile_devices
  add constraint mobile_devices_org_brand_member_id_key
    unique (organization_id, brand_id, member_id, id);

alter table public.mobile_push_outbox
  drop constraint mobile_push_device_same_brand_fkey,
  add constraint mobile_push_device_same_member_fkey
    foreign key (organization_id, brand_id, member_id, device_id)
    references public.mobile_devices (organization_id, brand_id, member_id, id)
    on delete cascade;

alter table public.mobile_offline_mutations
  drop constraint mobile_mutation_device_same_brand_fkey,
  add constraint mobile_mutation_device_same_member_fkey
    foreign key (organization_id, brand_id, member_id, device_id)
    references public.mobile_devices (organization_id, brand_id, member_id, id)
    on delete cascade;

do $$
declare
  v_name text;
  v_function regprocedure;
begin
  foreach v_name in array array[
    'jsonb_has_secret_keys',
    'jsonb_has_raw_pii_keys',
    'jsonb_is_meta_hash_map',
    'slugify_brand_name',
    'seed_default_brand',
    'seed_staff_brand_access',
    'default_brand_for_org',
    'can_access_brand',
    'current_brand_access_ids',
    'brand_accepts_operational_charges',
    'can_manage_brand',
    'assign_and_validate_brand',
    'seed_phase3_organization_defaults',
    'seed_phase4_organization_defaults',
    'enforce_avalara_before_charge',
    'enqueue_active_integration_job',
    'enqueue_consented_meta_job',
    'enqueue_connection_bootstrap',
    'enqueue_member_integration_changes',
    'enqueue_meta_consent_activation',
    'enqueue_shipment_integration_changes',
    'enqueue_referral_conversion',
    'reject_append_only_mutation',
    'require_brand_context',
    'entity_brand_id'
  ]
  loop
    for v_function in
      select p.oid::regprocedure
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname = v_name
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format('grant execute on function %s to service_role', v_function);
    end loop;
  end loop;
end;
$$;

grant execute on function private.can_access_brand(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.current_brand_access_ids()
  to authenticated, service_role;
grant execute on function private.can_manage_brand(uuid, uuid)
  to authenticated, service_role;

do $$
declare
  v_name text;
  v_function regprocedure;
begin
  foreach v_name in array array[
    'append_audit_entry',
    'record_analytics_event',
    'complete_member_import',
    'create_release_shipments',
    'record_billing_attempt',
    'apply_shipment_payment_event',
    'record_shipment_compliance_check',
    'enqueue_email_trigger',
    'enqueue_test_email',
    'claim_due_releases',
    'schedule_due_shipment_retries',
    'update_cancel_flow_configuration',
    'start_cancel_flow',
    'record_cancel_flow_step',
    'get_cancel_flow_analytics',
    'reserve_loyalty_discount',
    'adjust_loyalty_points',
    'get_loyalty_balance',
    'get_analytics_dashboard',
    'get_analytics_series',
    'save_dashboard_layout',
    'save_analytics_dashboard_layout',
    'get_analytics_dashboard_layout',
    'upsert_analytics_report_schedule',
    'list_analytics_report_schedules',
    'get_shipment_compliance_check',
    'get_latest_shipment_compliance',
    'get_release_compliance_queue',
    'list_churn_intelligence',
    'get_member_churn_intelligence',
    'acknowledge_ml_high_risk_alert',
    'get_compliance_dashboard',
    'apply_brand_subscription_event',
    'store_integration_credentials',
    'get_integration_runtime',
    'set_integration_health',
    'enqueue_integration_sync_job',
    'claim_integration_sync_jobs',
    'complete_integration_sync_job',
    'get_klaviyo_member_source',
    'upsert_klaviyo_profile_mapping',
    'get_quickbooks_transaction_source',
    'get_avalara_shipment_source',
    'record_avalara_tax_calculation',
    'enqueue_meta_conversion_event',
    'register_member_auth_link_context',
    'link_member_auth_user',
    'claim_integration_refund_delivery',
    'release_integration_refund_delivery',
    'complete_quickbooks_refund_delivery',
    'complete_avalara_refund_delivery',
    'register_mobile_auth_exchange',
    'consume_mobile_auth_exchange',
    'register_mobile_refresh_session',
    'rotate_mobile_refresh_session',
    'revoke_mobile_refresh_family',
    'store_mobile_push_token',
    'claim_mobile_push_messages',
    'complete_mobile_push_message'
  ]
  loop
    for v_function in
      select p.oid::regprocedure
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_name
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format('grant execute on function %s to service_role', v_function);
    end loop;
  end loop;
end;
$$;

grant execute on function public.create_brand(
  uuid, text, text, public.brand_billing_mode
) to authenticated, service_role;
grant execute on function public.grant_staff_brand_access(
  uuid, uuid, uuid, public.brand_access_level
) to authenticated, service_role;
grant execute on function public.configure_integration_connection(
  uuid, uuid, public.integration_type, text, text, jsonb
) to authenticated, service_role;
grant execute on function public.set_integration_consent(uuid, boolean)
  to authenticated, service_role;
grant execute on function public.disconnect_integration(uuid)
  to authenticated, service_role;
grant execute on function public.set_member_meta_consent(
  uuid, uuid, uuid, boolean, text, text
) to authenticated, service_role;
grant execute on function public.resolve_custom_domain(text)
  to anon, authenticated, service_role;

commit;
