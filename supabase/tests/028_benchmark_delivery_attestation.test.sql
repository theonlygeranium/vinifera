begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(11);

select ok(
  to_regprocedure('public.enqueue_benchmark_report_artifact(uuid,uuid,date,date,text,text,text,jsonb,text,uuid,uuid,uuid)') is not null,
  'benchmark report enqueue persists its contribution and aggregate binding'
);

select ok(
  to_regprocedure('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)') is not null,
  'benchmark delivery has a protected database attestation RPC'
);

select ok(
  not has_function_privilege('anon', 'public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)', 'execute'),
  'browser roles cannot read benchmark delivery attestations'
);

select ok(
  has_function_privilege('service_role', 'public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)', 'execute'),
  'service role can read benchmark delivery attestations'
);

select ok(
  pg_get_function_result('public.get_due_benchmark_report_recipients(timestamptz)'::regprocedure) like '%contribution_id uuid%'
  and pg_get_function_result('public.get_due_benchmark_report_recipients(timestamptz)'::regprocedure) like '%aggregate_id uuid%',
  'due benchmark recipients expose the selected contribution and aggregate identifiers'
);

select ok(
  lower(pg_get_functiondef('public.get_due_benchmark_report_recipients(timestamptz)'::regprocedure)) like '%order by candidate.coarsening_level%'
  and lower(pg_get_functiondef('public.get_due_benchmark_report_recipients(timestamptz)'::regprocedure)) like '%date_trunc(''quarter''%p_as_of%3 mon%',
  'due benchmark selection uses the least-coarsened prior-quarter aggregate'
);

select ok(
  pg_get_functiondef('public.enqueue_benchmark_report_artifact(uuid,uuid,date,date,text,text,text,jsonb,text,uuid,uuid,uuid)'::regprocedure) like '%benchmark_contribution_id%'
  and pg_get_functiondef('public.enqueue_benchmark_report_artifact(uuid,uuid,date,date,text,text,text,jsonb,text,uuid,uuid,uuid)'::regprocedure) like '%benchmark_aggregate_id%',
  'benchmark enqueue writes both selected database identifiers into the email payload'
);

select ok(
  pg_get_functiondef('public.enqueue_benchmark_report_artifact(uuid,uuid,date,date,text,text,text,jsonb,text,uuid,uuid,uuid)'::regprocedure) like '%jsonb_array_length(p_attachments) <> 2%'
  and pg_get_functiondef('public.enqueue_benchmark_report_artifact(uuid,uuid,date,date,text,text,text,jsonb,text,uuid,uuid,uuid)'::regprocedure) like '%application/pdf%'
  and pg_get_functiondef('public.enqueue_benchmark_report_artifact(uuid,uuid,date,date,text,text,text,jsonb,text,uuid,uuid,uuid)'::regprocedure) like '%text/csv%',
  'benchmark enqueue requires exactly the PDF and CSV artifacts'
);

select ok(
  pg_get_functiondef('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)'::regprocedure) like '%email_delivery_events%'
  and pg_get_functiondef('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)'::regprocedure) like '%event_type = ''delivered''%',
  'delivery attestation joins the exact persisted delivered provider event'
);

select ok(
  pg_get_functiondef('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)'::regprocedure) like '%pdf_attachment_sha256%'
  and pg_get_functiondef('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)'::regprocedure) like '%csv_attachment_sha256%'
  and pg_get_functiondef('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)'::regprocedure) like '%persisted_report_content_sha256%',
  'delivery attestation hashes stored report content and both stored attachments'
);

select ok(
  pg_get_functiondef('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)'::regprocedure) like '%source_window_start%period_start%'
  and pg_get_functiondef('public.get_benchmark_delivery_attestation(uuid,uuid,uuid,uuid)'::regprocedure) like '%source_window_end%period_end%',
  'delivery attestation reports the exact source dates persisted with the artifact'
);

select * from finish();
rollback;
