do $$
declare
  v_definition text;
  v_original text := 'digest(gen_random_uuid()::text, ''sha256'')';
  v_replacement text := 'extensions.digest(gen_random_uuid()::text, ''sha256'')';
begin
  select pg_get_functiondef(
    'public.claim_email_outbox_batch(text,integer,integer)'::regprocedure
  )
  into v_definition;

  if position(v_original in v_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Email outbox digest call was not found for qualification.';
  end if;

  execute replace(v_definition, v_original, v_replacement);
end;
$$;
