export const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role supabase_auth_admin nologin;
  create schema auth;
  create schema extensions;
  grant usage on schema extensions to public;

  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );

  create or replace function auth.jwt()
  returns jsonb
  language sql
  stable
  set search_path = ''
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  $$;

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  set search_path = ''
  as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid;
  $$;

  create or replace function extensions.digest(value bytea, algorithm text)
  returns bytea
  language sql
  immutable
  set search_path = ''
  as $$
    select decode(
      md5(encode(value, 'hex'))
      || md5(encode(value, 'hex') || algorithm),
      'hex'
    );
  $$;

  create or replace function extensions.plan(expected integer)
  returns integer
  language sql
  as $$ select expected; $$;

  create or replace function extensions.ok(actual boolean, description text)
  returns text
  language plpgsql
  as $$
  begin
    if actual is distinct from true then
      raise exception 'not ok: %', description;
    end if;
    return description;
  end;
  $$;

  create or replace function extensions.is(
    actual anyelement,
    expected anyelement,
    description text
  )
  returns text
  language plpgsql
  as $$
  begin
    if actual is distinct from expected then
      raise exception 'not ok: % (actual %, expected %)',
        description, actual, expected;
    end if;
    return description;
  end;
  $$;

  create or replace function extensions.lives_ok(
    statement text,
    description text
  )
  returns text
  language plpgsql
  as $$
  begin
    execute statement;
    return description;
  exception when others then
    raise exception 'not ok: % (%)', description, sqlerrm;
  end;
  $$;

  create or replace function extensions.throws_ok(
    statement text,
    expected_state text,
    expected_message text,
    description text
  )
  returns text
  language plpgsql
  as $$
  begin
    execute statement;
    raise exception 'not ok: % (statement did not throw)', description;
  exception when others then
    if sqlstate <> expected_state or sqlerrm <> expected_message then
      raise exception 'not ok: % (state %, message %)',
        description, sqlstate, sqlerrm;
    end if;
    return description;
  end;
  $$;

  create or replace function extensions.finish()
  returns setof text
  language sql
  as $$ select null::text where false; $$;
`;
