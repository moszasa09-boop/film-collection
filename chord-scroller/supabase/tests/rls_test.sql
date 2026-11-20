-- Security and behaviour checks for the migration. Run on a scratch database after stub_supabase.sql and
-- the migration. Each check prints PASS/FAIL; the run ends with a count.
\set ON_ERROR_STOP off
\set QUIET on
create temp table results (n serial, ok boolean, what text);
grant all on results to public;
grant usage, select on sequence results_n_seq to public;
create or replace function pg_temp.check(ok boolean, what text) returns void language sql as $$ insert into results (ok, what) values (coalesce(ok, false), what) $$;

-- people
\set owner   '11111111-1111-1111-1111-111111111111'
\set editor  '22222222-2222-2222-2222-222222222222'
\set viewer  '33333333-3333-3333-3333-333333333333'
\set outsider '44444444-4444-4444-4444-444444444444'

-- owner creates a band and two invites
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner', false);
create temp table t_band as select public.create_band('วงทดสอบ', 'เจ้าของ') as id;
select pg_temp.check((select role from public.band_members where band_id = (select id from t_band) and user_id = :'owner') = 'owner', 'creator becomes owner');
create temp table t_inv as select public.create_invite((select id from t_band), 'editor') as ed, public.create_invite((select id from t_band), 'viewer') as vw;
select pg_temp.check((select count(*) from public.band_invites) = 2, 'owner sees the band''s invites');
insert into public.docs (band_id, col, id, data) values ((select id from t_band), 'songs', 's1', '{"title":"เพลงหนึ่ง","rev":1}');
select pg_temp.check((select version from public.docs where id = 's1') = 1, 'owner writes a song, version 1');

-- editor and viewer join with the links
select set_config('request.jwt.claim.sub', :'editor', false);
select pg_temp.check(public.accept_invite((select ed from t_inv), 'มือกีตาร์') = (select id from t_band), 'editor joins with the editor link');
select set_config('request.jwt.claim.sub', :'viewer', false);
select pg_temp.check(public.accept_invite((select vw from t_inv), 'นักร้อง') = (select id from t_band), 'viewer joins with the viewer link');

-- editor can write
select set_config('request.jwt.claim.sub', :'editor', false);
insert into public.docs (band_id, col, id, data) values ((select id from t_band), 'items', 'i1', '{"songId":"s1","order":1000}');
select pg_temp.check(exists(select 1 from public.docs where id = 'i1'), 'editor adds a row to a set');
select pg_temp.check(public.merge_doc((select id from t_band), 'items', 'i1', '{"singer":"นุ่น"}') = 2, 'editor merges a field (version 2)');
select pg_temp.check((select data->>'songId' from public.docs where id = 'i1') = 's1', 'merge keeps the other fields');
select pg_temp.check((select count(*) from public.band_invites) = 0, 'editor cannot see invite codes');
do $$ begin perform public.create_invite((select id from t_band), 'editor'); raise notice 'x'; exception when others then insert into results(ok, what) values (true, 'editor cannot create invites'); end $$;

-- viewer cannot write, cannot promote themself
select set_config('request.jwt.claim.sub', :'viewer', false);
select pg_temp.check((select count(*) from public.docs) = 2, 'viewer reads the band''s documents');
do $$ begin insert into public.docs (band_id, col, id, data) values ((select id from t_band), 'songs', 'hack', '{}'); insert into results(ok, what) values (false, 'viewer cannot insert'); exception when others then insert into results(ok, what) values (true, 'viewer cannot insert'); end $$;
update public.docs set data = '{"title":"ถูกแก้"}' where id = 's1';
select pg_temp.check((select data->>'title' from public.docs where id = 's1') = 'เพลงหนึ่ง', 'viewer update changes nothing');
delete from public.docs where id = 's1';
select pg_temp.check(exists(select 1 from public.docs where id = 's1'), 'viewer delete removes nothing');
do $$ begin update public.band_members set role = 'owner' where user_id = auth.uid(); insert into results(ok, what) values (false, 'viewer cannot make themself owner'); exception when others then insert into results(ok, what) values (true, 'viewer cannot make themself owner'); end $$;
select pg_temp.check((select role from public.band_members where user_id = :'viewer') = 'viewer', 'viewer is still a viewer');
update public.band_members set display_name = 'นักร้องนำ' where user_id = auth.uid();
select pg_temp.check((select display_name from public.band_members where user_id = :'viewer') = 'นักร้องนำ', 'member can change their own display name');
do $$ begin perform public.set_member_role((select band_id from public.band_members limit 1), auth.uid(), 'owner'); insert into results(ok, what) values (false, 'viewer cannot call set_member_role'); exception when others then insert into results(ok, what) values (true, 'viewer cannot call set_member_role'); end $$;

-- outsider sees nothing and cannot write
select set_config('request.jwt.claim.sub', :'outsider', false);
select pg_temp.check((select count(*) from public.docs) = 0 and (select count(*) from public.bands) = 0 and (select count(*) from public.band_members) = 0, 'outsider sees no bands, members or documents');
do $$ begin insert into public.docs (band_id, col, id, data) values ((select id from t_band), 'songs', 'x', '{}'); insert into results(ok, what) values (false, 'outsider cannot insert'); exception when others then insert into results(ok, what) values (true, 'outsider cannot insert'); end $$;
do $$ begin perform public.accept_invite('not-a-code', ''); insert into results(ok, what) values (false, 'bad invite code refused'); exception when others then insert into results(ok, what) values (true, 'bad invite code refused'); end $$;

-- signed-out (anon) gets nothing
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
do $$ begin perform count(*) from public.docs; insert into results(ok, what) values (false, 'anon cannot read documents'); exception when others then insert into results(ok, what) values (true, 'anon cannot read documents'); end $$;
reset role; set role authenticated;

-- lost-update protection: two editors start from rev 1, only the first save wins
select set_config('request.jwt.claim.sub', :'owner', false);
select pg_temp.check((public.put_doc_if((select id from t_band), 'songs', 's1', '{"title":"ฉบับเจ้าของ","rev":2}', 1)->>'ok')::boolean, 'first save with the right rev succeeds');
select set_config('request.jwt.claim.sub', :'editor', false);
select pg_temp.check(not (public.put_doc_if((select id from t_band), 'songs', 's1', '{"title":"ฉบับมือกีตาร์","rev":2}', 1)->>'ok')::boolean, 'second save from the old rev is refused');
select pg_temp.check((public.put_doc_if((select id from t_band), 'songs', 's1', '{"title":"x","rev":2}', 1)->'current'->>'title') = 'ฉบับเจ้าของ', 'refusal returns the newer version to choose from');
select set_config('request.jwt.claim.sub', :'viewer', false);
do $$ begin if (public.put_doc_if((select band_id from public.band_members limit 1), 'songs', 's1', '{"title":"v","rev":3}', 2)->>'ok')::boolean then insert into results(ok, what) values (false, 'viewer cannot save through put_doc_if'); else insert into results(ok, what) values (true, 'viewer cannot save through put_doc_if'); end if; exception when others then insert into results(ok, what) values (true, 'viewer cannot save through put_doc_if'); end $$;

-- audit trail keeps every earlier version, even after delete
select set_config('request.jwt.claim.sub', :'editor', false);
delete from public.docs where id = 's1';
select pg_temp.check((select count(*) from public.doc_audit where id = 's1') = 2, 'audit kept the overwritten and the deleted version');
select pg_temp.check((select data->>'title' from public.doc_audit where id = 's1' and op = 'delete') = 'ฉบับเจ้าของ', 'deleted song is recoverable from the audit');
select set_config('request.jwt.claim.sub', :'viewer', false);
select pg_temp.check((select count(*) from public.doc_audit) = 0, 'viewer cannot read the audit trail');

-- roles and leaving
select set_config('request.jwt.claim.sub', :'owner', false);
do $$ begin perform public.set_member_role((select id from t_band), auth.uid(), 'editor'); insert into results(ok, what) values (false, 'last owner cannot step down'); exception when others then insert into results(ok, what) values (true, 'last owner cannot step down'); end $$;
select public.set_member_role((select id from t_band), :'viewer', 'editor');
select pg_temp.check((select role from public.band_members where user_id = :'viewer') = 'editor', 'owner promotes viewer to editor');
select public.remove_member((select id from t_band), :'editor');
select pg_temp.check(not exists(select 1 from public.band_members where user_id = :'editor'), 'owner removes a member');
select set_config('request.jwt.claim.sub', :'editor', false);
select pg_temp.check((select count(*) from public.docs) = 0, 'removed member no longer sees the band');
select set_config('request.jwt.claim.sub', :'viewer', false);
select public.remove_member((select band_id from public.band_members where user_id = auth.uid()), auth.uid());
select pg_temp.check((select count(*) from public.bands) = 0, 'a member can leave');

-- image reading allowance
select set_config('request.jwt.claim.sub', :'owner', false);
select pg_temp.check(public.ocr_allowance() = 40, 'fresh allowance is 40 pictures per hour');
insert into public.ocr_log (band_id, images) values ((select id from t_band), 5);
select pg_temp.check(public.ocr_allowance() = 35, 'allowance goes down as pictures are read');

reset role;
\set QUIET off
select case when ok then 'PASS ' else 'FAIL ' end || what as result from results order by n;
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as summary from results;
