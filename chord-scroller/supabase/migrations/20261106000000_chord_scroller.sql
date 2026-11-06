-- คอร์ดเลื่อนตามเพลง: bands, members, invites, the band's shared documents, and an audit trail.
--
-- The web app keeps three kinds of documents (songs, events, items) plus its own history; here they live
-- in one table `docs` keyed by (band_id, col, id) with the body in jsonb, so the app's data layer works the
-- same on every backend. Access is decided per band by the caller's role:
--   owner  - everything, plus members, invites and band settings
--   editor - read and write songs, gigs and sets
--   viewer - read only
-- Every update or delete of a document is copied to doc_audit by a trigger, whatever the client does.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.bands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.band_members (
  band_id uuid not null references public.bands(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  display_name text not null default '' check (length(display_name) <= 60),
  joined_at timestamptz not null default now(),
  primary key (band_id, user_id)
);
create index if not exists band_members_user on public.band_members (user_id);

create table if not exists public.band_invites (
  code text primary key default encode(extensions.gen_random_bytes(12), 'hex'),
  band_id uuid not null references public.bands(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  max_uses int not null default 20 check (max_uses between 1 and 200),
  uses int not null default 0
);

create table if not exists public.docs (
  band_id uuid not null references public.bands(id) on delete cascade,
  col text not null check (col in ('songs', 'events', 'items', 'history')),
  id text not null check (id ~ '^[A-Za-z0-9_.~:@+-]{1,80}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 262144),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (band_id, col, id)
);

create table if not exists public.doc_audit (
  audit_id bigint generated always as identity primary key,
  band_id uuid not null,
  col text not null,
  id text not null,
  op text not null check (op in ('update', 'delete')),
  data jsonb,
  version bigint,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index if not exists doc_audit_lookup on public.doc_audit (band_id, col, id, changed_at desc);

create table if not exists public.ocr_log (
  id bigint generated always as identity primary key,
  band_id uuid not null references public.bands(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  images int not null,
  at timestamptz not null default now()
);
create index if not exists ocr_log_user_time on public.ocr_log (user_id, at desc);

-- ---------- who am I in this band ----------
create or replace function public.band_role(p_band uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.band_members where band_id = p_band and user_id = auth.uid()
$$;

-- ---------- row level security ----------
alter table public.bands enable row level security;
alter table public.band_members enable row level security;
alter table public.band_invites enable row level security;
alter table public.docs enable row level security;
alter table public.doc_audit enable row level security;
alter table public.ocr_log enable row level security;

drop policy if exists bands_select on public.bands;
create policy bands_select on public.bands for select using (public.band_role(id) is not null);
drop policy if exists bands_update on public.bands;
create policy bands_update on public.bands for update using (public.band_role(id) = 'owner') with check (public.band_role(id) = 'owner');

drop policy if exists members_select on public.band_members;
create policy members_select on public.band_members for select using (public.band_role(band_id) is not null);
drop policy if exists members_update_self on public.band_members;
create policy members_update_self on public.band_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists invites_select on public.band_invites;
create policy invites_select on public.band_invites for select using (public.band_role(band_id) = 'owner');

drop policy if exists docs_select on public.docs;
create policy docs_select on public.docs for select using (public.band_role(band_id) is not null);
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert with check (public.band_role(band_id) in ('owner', 'editor'));
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update using (public.band_role(band_id) in ('owner', 'editor')) with check (public.band_role(band_id) in ('owner', 'editor'));
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete using (public.band_role(band_id) in ('owner', 'editor'));

drop policy if exists audit_select on public.doc_audit;
create policy audit_select on public.doc_audit for select using (public.band_role(band_id) in ('owner', 'editor'));

drop policy if exists ocr_insert on public.ocr_log;
create policy ocr_insert on public.ocr_log for insert with check (user_id = auth.uid() and public.band_role(band_id) in ('owner', 'editor'));
drop policy if exists ocr_select on public.ocr_log;
create policy ocr_select on public.ocr_log for select using (user_id = auth.uid());

-- ---------- triggers: version, author, audit ----------
create or replace function public.docs_before_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists docs_before_write on public.docs;
create trigger docs_before_write before insert or update on public.docs
  for each row execute function public.docs_before_write();

create or replace function public.docs_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.col = 'history' then return null; end if;   -- history is the app's own record; no need to copy it twice
  insert into public.doc_audit (band_id, col, id, op, data, version, changed_by)
  values (old.band_id, old.col, old.id, lower(tg_op), old.data, old.version, auth.uid());
  return null;
end $$;
drop trigger if exists docs_audit on public.docs;
create trigger docs_audit after update or delete on public.docs
  for each row execute function public.docs_audit();

-- ---------- functions the app calls ----------
-- New band; the caller becomes its owner.
create or replace function public.create_band(p_name text, p_display_name text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  insert into public.bands (name, created_by) values (btrim(p_name), auth.uid()) returning id into v_id;
  insert into public.band_members (band_id, user_id, role, display_name) values (v_id, auth.uid(), 'owner', left(coalesce(p_display_name, ''), 60));
  return v_id;
end $$;

-- Invite link for an editor or a viewer. Owners only.
create or replace function public.create_invite(p_band uuid, p_role text, p_days int default 14, p_max_uses int default 20) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if public.band_role(p_band) is distinct from 'owner' then raise exception 'only the band owner can invite' using errcode = '42501'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'role must be editor or viewer' using errcode = '22023'; end if;
  insert into public.band_invites (band_id, role, created_by, expires_at, max_uses)
  values (p_band, p_role, auth.uid(), now() + make_interval(days => greatest(1, least(p_days, 90))), greatest(1, least(p_max_uses, 200)))
  returning code into v_code;
  return v_code;
end $$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.band_invites i where i.code = p_code and public.band_role(i.band_id) = 'owner';
end $$;

-- Join with a link. Never lowers an existing member's role.
create or replace function public.accept_invite(p_code text, p_display_name text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.band_invites; v_cur text;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into v from public.band_invites where code = p_code for update;
  if not found or v.expires_at < now() or v.uses >= v.max_uses then
    raise exception 'invite link is invalid or expired' using errcode = 'P0002';
  end if;
  select role into v_cur from public.band_members where band_id = v.band_id and user_id = auth.uid();
  if v_cur is null then
    insert into public.band_members (band_id, user_id, role, display_name) values (v.band_id, auth.uid(), v.role, left(coalesce(p_display_name, ''), 60));
  elsif v_cur = 'viewer' and v.role = 'editor' then
    update public.band_members set role = 'editor' where band_id = v.band_id and user_id = auth.uid();
  end if;
  update public.band_invites set uses = uses + 1 where code = p_code;
  return v.band_id;
end $$;

-- Owners change roles; a band always keeps at least one owner.
create or replace function public.set_member_role(p_band uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.band_role(p_band) is distinct from 'owner' then raise exception 'only the band owner can change roles' using errcode = '42501'; end if;
  if p_role not in ('owner', 'editor', 'viewer') then raise exception 'bad role' using errcode = '22023'; end if;
  if p_role <> 'owner' and (select role from public.band_members where band_id = p_band and user_id = p_user) = 'owner'
     and (select count(*) from public.band_members where band_id = p_band and role = 'owner') <= 1 then
    raise exception 'a band needs at least one owner' using errcode = '23514';
  end if;
  update public.band_members set role = p_role where band_id = p_band and user_id = p_user;
end $$;

-- Owners remove anyone; anyone may leave. The last owner cannot leave.
create or replace function public.remove_member(p_band uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and public.band_role(p_band) is distinct from 'owner' then
    raise exception 'only the band owner can remove members' using errcode = '42501';
  end if;
  if (select role from public.band_members where band_id = p_band and user_id = p_user) = 'owner'
     and (select count(*) from public.band_members where band_id = p_band and role = 'owner') <= 1 then
    raise exception 'a band needs at least one owner' using errcode = '23514';
  end if;
  delete from public.band_members where band_id = p_band and user_id = p_user;
end $$;

-- Write a document only if its "rev" is still the one the editor started from (no lost updates).
-- Runs as the caller, so row level security still applies.
create or replace function public.put_doc_if(p_band uuid, p_col text, p_id text, p_data jsonb, p_expected_rev bigint) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_cur jsonb; v_version bigint;
begin
  select data into v_cur from public.docs where band_id = p_band and col = p_col and id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'missing', true);
  end if;
  if coalesce((v_cur->>'rev')::bigint, 0) <> p_expected_rev then
    return jsonb_build_object('ok', false, 'current', v_cur);
  end if;
  update public.docs set data = p_data where band_id = p_band and col = p_col and id = p_id returning version into v_version;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'version', v_version);
end $$;

-- Merge fields into an existing document in one statement (two people changing different fields both win).
create or replace function public.merge_doc(p_band uuid, p_col text, p_id text, p_patch jsonb) returns bigint
language plpgsql security invoker set search_path = public as $$
declare v_version bigint;
begin
  update public.docs set data = data || p_patch where band_id = p_band and col = p_col and id = p_id returning version into v_version;
  if not found then raise exception 'document does not exist or not allowed' using errcode = 'P0002'; end if;
  return v_version;
end $$;

-- Image reading allowance: at most 40 pictures per person per hour.
create or replace function public.ocr_allowance() returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, 40 - coalesce(sum(images), 0))::int from public.ocr_log where user_id = auth.uid() and at > now() - interval '1 hour'
$$;

-- ---------- privileges ----------
revoke all on all tables in schema public from anon;
grant select on public.bands to authenticated;
grant update (name) on public.bands to authenticated;                -- owners only, by policy
grant select on public.band_members to authenticated;
grant update (display_name) on public.band_members to authenticated;  -- own name only; roles change through set_member_role
grant select on public.band_invites to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select on public.doc_audit to authenticated;
grant select, insert on public.ocr_log to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.band_role(uuid), public.create_band(text, text), public.create_invite(uuid, text, int, int),
  public.revoke_invite(text), public.accept_invite(text, text), public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.put_doc_if(uuid, text, text, jsonb, bigint), public.merge_doc(uuid, text, text, jsonb),
  public.ocr_allowance() to authenticated;

-- ---------- live updates ----------
alter table public.docs replica identity full;
alter table public.band_members replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then
      alter publication supabase_realtime add table public.docs;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'band_members') then
      alter publication supabase_realtime add table public.band_members;
    end if;
  end if;
end $$;
