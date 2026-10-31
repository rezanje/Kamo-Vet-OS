-- Rollback 20261105010000_coa_bagan_baru — HANYA untuk membatalkan rilis bagan akun baru.
-- Satu transaksi. Jalankan bersama rollback aplikasi ke versi sebelum bagan akun baru (kode lama).
-- Tidak menghapus jurnal. Akun bagan baru yang sudah dipakai jurnal/rekening TIDAK dihapus (dilaporkan).
begin;
do $$ begin
 if to_regclass('public.coa_bagan_baru_backup') is null or not exists(select 1 from public.coa_bagan_baru_backup)
 then raise exception 'ROLLBACK_COA: cadangan bagan akun lama tidak ada';end if;
end $$;
create temp table coa_recode(old_code text primary key,new_code text unique not null) on commit drop;
insert into coa_recode values
 ('1101','110003'),
 ('1102','120002'),
 ('1105','182004'),
 ('1201','150001'),
 ('1202','130009'),
 ('1203','182001'),
 ('1301','170001'),
 ('1302','170003'),
 ('1303','160001'),
 ('1401','181001'),
 ('1501','200008'),
 ('1509','200015'),
 ('2101','311001'),
 ('2102','311003'),
 ('2103','314001'),
 ('2201','312005'),
 ('2301','312001'),
 ('3101','410001'),
 ('3201','420001'),
 ('4101','510001'),
 ('4102','520002'),
 ('4201','510002'),
 ('4301','810001'),
 ('4302','810003'),
 ('4303','810004'),
 ('5101','600001'),
 ('5201','710001'),
 ('5301','720002'),
 ('5302','740001'),
 ('5303','740003'),
 ('5304','740007'),
 ('5305','740020'),
 ('5401','760003'),
 ('5501','740010'),
 ('5601','750004'),
 ('5602','820004'),
 ('5901','760002'),
 ('5902','720010');

-- 1. Kode/nama/induk/penanda induk akun lama dikembalikan dari cadangan (kolom pemakai ikut lewat cascade).
do $$ declare t text; touched text[]:=array['cash_accounts','cash_entries','budgets','budget_transfers','clinic_demo_policies',
 'sale_payments','asset_categories','bank_reconciliations','clinic_payment_receipt_parts','invoice_payments','clinic_refunds','sales_refund_payouts'];
begin
 foreach t in array touched loop
  if to_regclass('public.'||t) is not null then execute format('alter table public.%I disable trigger user',t);end if;
 end loop;
 update public.coa_accounts a set parent_id=null where exists(select 1 from public.coa_bagan_baru_backup b where b.id=a.id);
 update public.coa_accounts a set code=b.code,name=b.name,is_header=b.is_header,is_active=b.is_active
  from public.coa_bagan_baru_backup b where b.id=a.id and (a.code,a.name,a.is_header,a.is_active) is distinct from (b.code,b.name,b.is_header,b.is_active);
 update public.coa_accounts a set parent_id=b.parent_id from public.coa_bagan_baru_backup b where b.id=a.id;
 update public.asset_categories set akun_beban=m.old_code from coa_recode m where akun_beban=m.new_code;
 update public.asset_categories set akun_akumulasi=m.old_code from coa_recode m where akun_akumulasi=m.new_code;
 update public.bank_reconciliations set bank_coa_code=m.old_code from coa_recode m where bank_coa_code=m.new_code;
 update public.clinic_payment_receipt_parts set kas_code=m.old_code from coa_recode m where kas_code=m.new_code;
 update public.invoice_payments set kas_code=m.old_code from coa_recode m where kas_code=m.new_code;
 foreach t in array array['sale_payments','clinic_refunds','sales_refund_payouts'] loop
  execute format($f$update public.%I x set account_snapshot=jsonb_set(account_snapshot,'{code}',to_jsonb(m.old_code)) from pg_temp.coa_recode m where x.account_snapshot->>'code'=m.new_code$f$,t);
  execute format($f$update public.%I x set account_snapshot=jsonb_set(account_snapshot,'{coa_code}',to_jsonb(m.old_code)) from pg_temp.coa_recode m where x.account_snapshot->>'coa_code'=m.new_code$f$,t);
 end loop;
 foreach t in array touched loop
  if to_regclass('public.'||t) is not null then execute format('alter table public.%I enable trigger user',t);end if;
 end loop;
end $$;
alter table public.asset_categories alter column akun_beban set default '5601', alter column akun_akumulasi set default '1509';

-- 2. Akun bagan baru yang tidak ada di cadangan dan tidak dipakai dihapus; yang dipakai dibiarkan.
delete from public.coa_accounts a where not exists(select 1 from public.coa_bagan_baru_backup b where b.id=a.id)
 and a.code ~ '^[1-8][0-9]{5}$'
 and not exists(select 1 from public.journal_lines l where l.account_id=a.id)
 and not exists(select 1 from public.cash_accounts c where c.coa_code=a.code)
 and not exists(select 1 from public.coa_accounts ch where ch.parent_id=a.id and exists(select 1 from public.journal_lines l where l.account_id=ch.id));
-- Induk yang anaknya tersisa: lepas dulu anaknya agar penghapusan berulang aman.
update public.coa_accounts c set parent_id=null where parent_id is not null and not exists(select 1 from public.coa_accounts p where p.id=c.parent_id);

-- 3. Fungsi kembali ke kode lama; aturan impor kembali ke pola 4–6 digit.
do $$ declare f record; def text; m record; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname not in('pg_catalog','information_schema') and n.nspname not like 'pg_%' and p.prokind in('f','p')
    and p.prosrc ~ '(?<![0-9.])(110003|120002|182004|150001|130009|182001|170001|170003|160001|181001|200008|200015|311001|311003|314001|312005|312001|410001|420001|510001|520002|510002|810001|810003|810004|600001|710001|720002|740001|740003|740007|740020|760003|740010|750004|820004|760002|720010)(?![0-9])'
    and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
  def:=pg_get_functiondef(f.oid);
  for m in select * from pg_temp.coa_recode loop
   def:=regexp_replace(def,'(?<![0-9.])'||m.new_code||'(?![0-9])',m.old_code,'g');
  end loop;
  execute def;
 end loop;
end $$;
do $$ declare def text;
 a1 text:=$a$case when code ~ '^[1-5][0-9]{3,5}$' then
      type <> (case left(code, 1) when '1' then 'ASET' when '2' then 'LIABILITAS' when '3' then 'EKUITAS'
                                  when '4' then 'PENDAPATAN' else 'BEBAN' end)
      or code::integer between 1103 and 1199$a$;
 b1 text:=$b$case when code ~ '^[1-8][0-9]{5}$' then
      type is distinct from public.coa_type_for_code(code)
      or code::integer between 110023 and 119999 or code::integer between 120007 and 129999$b$;
 a2 text:=$a$(type = 'PENDAPATAN' and normal_balance <> 'K')$a$;
 b2 text:=$b$(type = 'PENDAPATAN' and normal_balance <> 'K' and code !~ '^52[0-9]{4}$')$b$;
 a3 text:=$a$type <> (case left(code, 1) when '1' then 'ASET' when '2' then 'LIABILITAS' when '3' then 'EKUITAS'
                                    when '4' then 'PENDAPATAN' when '5' then 'BEBAN' else '' end)$a$;
 b3 text:=$b$type is distinct from public.coa_type_for_code(code)$b$;
begin
 def:=pg_get_functiondef('public.import_coa_accounts(jsonb,text)'::regprocedure);
 if strpos(def,b3)=0 then return;end if;
 execute replace(replace(replace(def,b1,a1),b2,a2),b3,a3);
end $$;

-- 4. Pemeriksaan.
do $$ declare bad text; begin
 select string_agg(m.old_code,', ') into bad from coa_recode m
  where exists(select 1 from public.coa_bagan_baru_backup b where b.code=m.old_code)
   and not exists(select 1 from public.coa_accounts a where a.code=m.old_code);
 if bad is not null then raise exception 'ROLLBACK_COA: kode lama belum kembali: %',bad;end if;
 select string_agg(code,', ') into bad from public.coa_accounts a where a.code ~ '^[1-8][0-9]{5}$'
  and not exists(select 1 from public.coa_bagan_baru_backup b where b.id=a.id);
 if bad is not null then raise notice 'ROLLBACK_COA: akun bagan baru dipertahankan karena sudah dipakai: %',bad;end if;
end $$;
delete from public.coa_bagan_baru_backup;
commit;
