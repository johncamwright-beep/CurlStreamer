-- Run after migration 0056. All test rows and changes roll back.
begin;
do $$
declare v_org uuid; v_user uuid:=gen_random_uuid(); v_key uuid; v_token uuid:=gen_random_uuid(); v_before jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(v_user,v_user::text||'@example.invalid',now(),now(),now());
 insert into public.user_profiles(user_id,display_name) values(v_user,'Stripe rollback check');
 select organization_id into v_org from public.create_first_team(v_user,'Stripe rollback check');
 select to_jsonb(a) into v_before from public.team_access a where organization_id=v_org;
 insert into public.team_test_billing(organization_id,customer_id) values(v_org,'cus_rollback_check');
 v_key:=public.claim_test_checkout(v_user);
 if v_key is distinct from public.claim_test_checkout(v_user) then raise exception 'checkout not idempotent'; end if;
 update public.team_test_billing set checkout_until=now()-interval '1 day' where organization_id=v_org;
 if v_key is distinct from public.claim_test_checkout(v_user) then raise exception 'key rotated without expiration'; end if;
 perform public.reset_test_checkout(v_user,gen_random_uuid());
 if v_key is distinct from public.claim_test_checkout(v_user) then raise exception 'wrong key reset'; end if;
 if public.begin_test_billing_sync('cus_rollback_check','evt_check',v_token)<>'claimed' then raise exception 'claim failed'; end if;
 if public.begin_test_billing_sync('cus_rollback_check','evt_other',gen_random_uuid())<>'busy' then raise exception 'concurrent sync allowed'; end if;
 begin
   perform public.finish_test_billing_sync('cus_rollback_check','evt_check',gen_random_uuid(),'{}');
   raise exception 'wrong token accepted' using errcode='P9999';
 exception when sqlstate 'P0001' then null; end;
 perform public.finish_test_billing_sync('cus_rollback_check','evt_check',v_token,'{"status":"active"}');
 if public.begin_test_billing_sync('cus_rollback_check','evt_check',gen_random_uuid())<>'done' then raise exception 'duplicate event accepted'; end if;
 if (select to_jsonb(a) from public.team_access a where organization_id=v_org) is distinct from v_before then raise exception 'test modified broadcast access'; end if;
 if has_table_privilege('authenticated','public.team_test_billing','SELECT') or has_function_privilege('anon','public.claim_test_checkout(uuid)','EXECUTE') then raise exception 'browser privileges exposed'; end if;
end $$;
select 'Stripe test billing rollback checks passed' as result;
rollback;
