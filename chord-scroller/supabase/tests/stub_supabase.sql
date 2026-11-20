-- Minimal stand-in for what a Supabase project provides, so the migration and its security rules can be
-- tested on a plain local PostgreSQL: the anon/authenticated roles, auth.uid() from the request claims,
-- and the realtime publication.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create publication supabase_realtime;
