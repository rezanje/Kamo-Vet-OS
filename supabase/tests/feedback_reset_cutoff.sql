-- Preserve the actual target automatic-period guard, using only a synthetic
-- control row carrying its non-personal cutoff date; no real backup is copied.
begin;
insert into coa_accounts(code,name,type,normal_balance)values('3101','Fiction integration equity','EKUITAS','K')on conflict(code)do update set is_active=true,is_header=false;
do $$declare cutoff date;blocked boolean:=false;n bigint;begin
 cutoff:=operational_reset_cutoff();if cutoff is null then raise exception 'Expected mirrored target reset cutoff';end if;
 select count(*)into n from journal_entries;
 begin perform clinic_write_journal(cutoff,'Fiction prohibited automatic period','recurring','integration-cutoff-blocked',null,'[{"code":"1101","debit":1,"credit":0},{"code":"3101","debit":0,"credit":1}]');
 exception when others then if sqlerrm not like 'RESET_PERIOD:%'then raise;end if;blocked:=true;end;
 if not blocked or(select count(*)from journal_entries)<>n then raise exception 'Target cutoff guard was weakened or left partial journal';end if;
 perform clinic_write_journal((date_trunc('month',cutoff)+interval '1 month')::date,'Fiction allowed subsequent automatic period','recurring','integration-cutoff-next',null,'[{"code":"1101","debit":1,"credit":0},{"code":"3101","debit":0,"credit":1}]');
 perform clinic_write_journal(cutoff,'Fiction nonautomatic source','klinik','integration-cutoff-nonautomatic',null,'[{"code":"1101","debit":1,"credit":0},{"code":"3101","debit":0,"credit":1}]');
 if(select count(*)from journal_entries)<>n+2 then raise exception 'Cutoff incorrectly blocked subsequent period or nonautomatic source';end if;
end$$;
rollback;
