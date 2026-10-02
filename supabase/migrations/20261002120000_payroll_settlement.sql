begin;
-- Every source mutation joins one serialization boundary before acquiring row locks.
create table public.hris_payroll_source_revision(id boolean primary key default true check(id),revision bigint not null default 0);
insert into public.hris_payroll_source_revision(id)values(true);
revoke all on public.hris_payroll_source_revision from public,anon,authenticated;
create function public.hris_payroll_source_changed()returns trigger language plpgsql security definer set search_path=''as $$begin
 perform pg_advisory_xact_lock(72310402);
 update public.hris_payroll_source_revision set revision=revision+1 where id;
 return null;
end$$;
revoke all on function public.hris_payroll_source_changed()from public,anon,authenticated;
do $$declare t text;begin foreach t in array array['employees','profiles','branches','user_branches','employee_branch_assignments','employee_schedules','work_shifts','attendance','leave_requests','overtime_requests','salary_components','employee_salary_components','payroll_settings','cash_advances','cash_advance_installments','reimbursements','commission_rules','sales','sale_items','sales_returns','sales_return_items','invoices','invoice_items','visits','items','item_categories','sales_invoices','sales_invoice_items','sales_delivery_items','payment_account_map','cash_accounts','coa_accounts','accounting_locks']loop
 if to_regclass('public.'||t)is null then raise exception 'HRIS: Sumber wajib belum tersedia: %',t;end if;
 execute format('create trigger hris_payroll_source_revision before insert or update or delete on public.%I for each statement execute function public.hris_payroll_source_changed()',t);
 end loop;end$$;
create table public.hris_payroll_runs(periode varchar(7)primary key,version int not null,source_revision bigint not null,status text not null check(status in('draft','final')),prepared_by uuid not null references public.profiles(id),prepared_at timestamptz not null default now(),finalized_at timestamptz,journal_id uuid references public.journal_entries(id));
alter table public.hris_payroll_runs enable row level security;
create policy payroll_run_read on public.hris_payroll_runs for select to authenticated using(public.hris_owner());
grant select on public.hris_payroll_runs to authenticated;
revoke insert,update,delete on public.hris_payroll_runs from authenticated,anon;
alter table public.payrolls add column source_revision bigint,add column draft_version int,add column source_snapshot jsonb,add column settlement_plan jsonb;
create table public.hris_payroll_events(id uuid primary key default gen_random_uuid(),periode varchar(7)not null references public.hris_payroll_runs(periode),version int not null,actor_id uuid not null references public.profiles(id),reason text not null,kind text not null,created_at timestamptz not null default now(),summary jsonb not null);
alter table public.hris_payroll_events enable row level security;
create policy payroll_event_read on public.hris_payroll_events for select to authenticated using(public.hris_owner());
grant select on public.hris_payroll_events to authenticated;
revoke insert,update,delete on public.hris_payroll_events from authenticated,anon;

drop policy payroll_owner_write on public.payrolls;
drop policy installment_owner_write on public.cash_advance_installments;
drop policy advance_owner_update on public.cash_advances;
drop policy reimbursement_owner_update on public.reimbursements;
revoke insert,update,delete on public.payrolls,public.cash_advance_installments,public.cash_advances,public.reimbursements from authenticated,anon;

create function public.hris_payroll_owner_lock()returns void language plpgsql security definer set search_path=''as $$begin
 perform pg_advisory_xact_lock(72310402);
 perform 1 from public.profiles where id=auth.uid()for share;
 if not public.hris_owner()then raise exception 'HRIS: Data gaji seluruh perusahaan hanya untuk OWNER';end if;
end$$;
create function public.hris_payroll_source_state(p_period text default null)returns jsonb language plpgsql security definer set search_path=''as $$declare v bigint;version int;begin
 perform public.hris_payroll_owner_lock();
 select revision into v from public.hris_payroll_source_revision where id;
 select r.version into version from public.hris_payroll_runs r where periode=p_period;
 return jsonb_build_object('revision',v,'version',coalesce(version,0));
end$$;
-- Settlement identifiers/sums are checked against locked live rows, never arbitrary IDs.
create function public.hris_validate_payroll_plan(p_employee uuid,p_period text,p_row jsonb)returns void language plpgsql security definer set search_path=''as $$
declare r jsonb:=p_row->'rincian';c jsonb;v_id uuid;v_amount numeric;v_left numeric;v_due numeric;v_total numeric:=0;v_reim numeric:=0;v_count int;v_requested int;v_before numeric;v_net numeric;v_expected numeric;
begin
 if jsonb_typeof(p_row->'cicilanKasbon')<>'array'or jsonb_typeof(p_row->'reimburseIds')<>'array'or jsonb_typeof(p_row->'sourceSnapshot')<>'object'or p_row->'sourceSnapshot'->'rincian' is distinct from r then raise exception 'HRIS: Potret/rencana gaji tidak lengkap';end if;
 for c in select value from jsonb_array_elements(p_row->'cicilanKasbon')loop
  v_id:=(c->>'id')::uuid;v_amount:=(c->>'jumlah')::numeric;
  select round(a.jumlah-coalesce((select sum(i.jumlah)from public.cash_advance_installments i where i.advance_id=a.id),0)),case when floor(round(a.jumlah)/a.tenor_bulan)<=0 then round(a.jumlah)else floor(round(a.jumlah)/a.tenor_bulan)end into v_left,v_due
  from public.cash_advances a where a.id=v_id and a.employee_id=p_employee and a.status='Disetujui'and a.disbursed_at is not null for update;
  if not found or v_amount is null or v_amount<=0 or v_amount<>round(v_amount)or v_left<=0 or v_amount>v_left or(v_left-v_due>=v_due and v_amount>v_due)or exists(select 1 from public.cash_advance_installments where advance_id=v_id and periode=p_period)then raise exception 'HRIS: Cicilan kasbon tidak sah';end if;
  v_total:=v_total+v_amount;
 end loop;
 if(select count(*)from jsonb_array_elements(p_row->'cicilanKasbon'))<>(select count(distinct x->>'id')from jsonb_array_elements(p_row->'cicilanKasbon')x)then raise exception 'HRIS: Kasbon dalam rencana berulang';end if;
 select count(*)into v_requested from jsonb_array_elements_text(p_row->'reimburseIds');
 if v_requested<>(select count(distinct value)from jsonb_array_elements_text(p_row->'reimburseIds'))then raise exception 'HRIS: Reimburse dalam rencana berulang';end if;
 perform 1 from public.reimbursements where id in(select value::uuid from jsonb_array_elements_text(p_row->'reimburseIds'))order by id for update;
 select count(*),coalesce(sum(jumlah),0)into v_count,v_reim from public.reimbursements where id in(select value::uuid from jsonb_array_elements_text(p_row->'reimburseIds'))and employee_id=p_employee and status='Disetujui'and paid_periode is null;
 if v_count<>v_requested or v_reim is distinct from(r->>'reimburse')::numeric or v_total is distinct from(r->>'cicilanKasbon')::numeric then raise exception 'HRIS: Nilai cicilan/reimburse berbeda dari dokumennya';end if;
 if exists(select 1 from jsonb_each(r)x where x.key in('gajiPokok','tunjangan','upahLembur','reimburse','potonganTetap','potonganTelat','potonganBolos','cicilanKasbon','hariKerja','hariHadir','hariBolos','menitTelat','jamLembur','total')and(x.value::text::numeric<0 or x.value::text::numeric>1000000000000000))then raise exception 'HRIS: Rincian gaji tidak valid';end if;
 v_before:=(r->>'gajiPokok')::numeric+(r->>'tunjangan')::numeric+(r->>'upahLembur')::numeric+(r->>'reimburse')::numeric+(r->>'komisi')::numeric+(r->>'penyesuaian')::numeric-(r->>'potonganTetap')::numeric-(r->>'potonganTelat')::numeric-(r->>'potonganBolos')::numeric;
 v_net:=greatest(0,floor(v_before-v_total+0.5));
 select coalesce(sum(case when remaining<=0 then 0 when due<=0 or remaining-due<due then remaining else due end),0)into v_expected from(
 select round(a.jumlah-coalesce((select sum(i.jumlah)from public.cash_advance_installments i where i.advance_id=a.id),0))remaining,floor(round(a.jumlah)/a.tenor_bulan)due from public.cash_advances a where employee_id=p_employee and status='Disetujui'and disbursed_at is not null)loans;
 if v_total is distinct from least(v_expected,greatest(0,floor(v_before+0.5)))or v_count<>(select count(*)from public.reimbursements where employee_id=p_employee and status='Disetujui'and paid_periode is null)then raise exception 'HRIS: Rencana cicilan/reimburse tidak lengkap untuk kapasitas gaji';end if;
 if v_before is null or(r->>'total')::numeric is distinct from v_net or v_total>greatest(0,floor(v_before+0.5))then raise exception 'HRIS: Total gaji/kapasitas cicilan tidak sesuai rincian';end if;
 if(r->>'penyesuaian')::numeric<>0 and length(trim(coalesce(p_row->>'catatan','')))not between 3 and 1000 then raise exception 'HRIS: Penyesuaian wajib memiliki alasan 3–1000 karakter';end if;
end$$;
create function public.hris_prepare_payroll(p_period text,p_revision bigint,p_version int,p_rows jsonb,p_reason text)returns int language plpgsql security definer set search_path=''as $$
declare v_run public.hris_payroll_runs;v_revision bigint;v_version int;row jsonb;r jsonb;e uuid;n int;
begin
 perform public.hris_payroll_owner_lock();
 if p_period!~'^[0-9]{4}-(0[1-9]|1[0-2])$'or p_period is null or p_reason is null or length(trim(p_reason))not between 3 and 1000 or jsonb_typeof(p_rows)<>'array'then raise exception 'HRIS: Periode/alasan/baris gaji tidak valid';end if;
 select revision into v_revision from public.hris_payroll_source_revision where id;
 if v_revision is distinct from p_revision then raise exception 'HRIS: Data gaji berubah. Hitung ulang sebelum menyimpan';end if;
 select * into v_run from public.hris_payroll_runs where periode=p_period for update;
 if coalesce(v_run.version,0)is distinct from p_version then raise exception 'HRIS: Draft gaji sudah berubah. Muat ulang';end if;
 if v_run.status='final'or exists(select 1 from public.payrolls where periode=p_period and status='final')then raise exception 'HRIS: Penggajian sudah final';end if;
 perform 1 from public.employees where status='Aktif'order by id for update;
 select count(*)into n from public.employees where status='Aktif';
 if n=0 or n>5000 or n<>jsonb_array_length(p_rows)or n<>(select count(distinct x->>'employeeId')from jsonb_array_elements(p_rows)x)or exists(select 1 from jsonb_array_elements(p_rows)x where not exists(select 1 from public.employees where id=(x->>'employeeId')::uuid and status='Aktif'))then raise exception 'HRIS: Daftar gaji seluruh karyawan aktif tidak lengkap';end if;
 v_version:=coalesce(v_run.version,0)+1;
 insert into public.hris_payroll_runs(periode,version,source_revision,status,prepared_by)values(p_period,v_version,p_revision,'draft',auth.uid())on conflict(periode)do update set version=excluded.version,source_revision=excluded.source_revision,prepared_by=excluded.prepared_by,prepared_at=statement_timestamp();
 delete from public.payrolls where periode=p_period;
 for row in select value from jsonb_array_elements(p_rows)loop
  e:=(row->>'employeeId')::uuid;r:=row->'rincian';perform public.hris_validate_payroll_plan(e,p_period,row);
  insert into public.payrolls(periode,employee_id,gaji_pokok,tunjangan,potongan,total,hari_kerja,hari_hadir,hari_bolos,menit_telat,jam_lembur,upah_lembur,potongan_telat,potongan_bolos,cicilan_kasbon,reimburse,komisi,penyesuaian,catatan,status,source_revision,draft_version,source_snapshot,settlement_plan)
  values(p_period,e,(r->>'gajiPokok')::numeric,(r->>'tunjangan')::numeric,(r->>'potonganTetap')::numeric+(r->>'potonganTelat')::numeric+(r->>'potonganBolos')::numeric+(r->>'cicilanKasbon')::numeric,(r->>'total')::numeric,(r->>'hariKerja')::int,(r->>'hariHadir')::int,(r->>'hariBolos')::int,(r->>'menitTelat')::int,(r->>'jamLembur')::numeric,(r->>'upahLembur')::numeric,(r->>'potonganTelat')::numeric,(r->>'potonganBolos')::numeric,(r->>'cicilanKasbon')::numeric,(r->>'reimburse')::numeric,(r->>'komisi')::numeric,(r->>'penyesuaian')::numeric,nullif(trim(row->>'catatan'),''),'draft',p_revision,v_version,row->'sourceSnapshot',jsonb_build_object('cicilanKasbon',row->'cicilanKasbon','reimburseIds',row->'reimburseIds'));
 end loop;
 insert into public.hris_payroll_events(periode,version,actor_id,reason,kind,summary)values(p_period,v_version,auth.uid(),trim(p_reason),'prepare',jsonb_build_object('employees',n,'source_revision',p_revision,'rows',p_rows));
 return v_version;
end$$;
create function public.hris_finalize_payroll(p_period text,p_version int,p_account uuid default null,p_reason text default null)returns uuid language plpgsql security definer set search_path=''as $$
declare v_run public.hris_payroll_runs;v_revision bigint;s public.payrolls;c jsonb;v_id uuid;v_net numeric;v_install numeric;v_code text;v_date date;v_lines jsonb;
begin
 perform public.hris_payroll_owner_lock();
 if p_reason is null or length(trim(p_reason))not between 3 and 1000 then raise exception 'HRIS: Alasan pengesahan wajib diisi';end if;
 select * into v_run from public.hris_payroll_runs where periode=p_period for update;
 if v_run.periode is null or v_run.status<>'draft'or v_run.version is distinct from p_version then raise exception 'HRIS: Draft tidak tersedia/berubah atau sudah final';end if;
 select revision into v_revision from public.hris_payroll_source_revision where id;
 if v_revision is distinct from v_run.source_revision then raise exception 'HRIS: Sumber gaji berubah. Hitung ulang sebelum mengesahkan';end if;
 perform 1 from public.employees where id in(select employee_id from public.payrolls where periode=p_period)order by id for update;
 perform 1 from public.payrolls where periode=p_period order by employee_id for update;
 if not exists(select 1 from public.payrolls where periode=p_period)or exists(select 1 from public.payrolls where periode=p_period and(status<>'draft'or draft_version is distinct from p_version or source_revision is distinct from v_revision or source_snapshot is null or settlement_plan is null))then raise exception 'HRIS: Slip gaji tidak lengkap/berubah';end if;
 v_date:=((p_period||'-01')::date+interval'1 month'-interval'1 day')::date;
 select sum(total),sum(cicilan_kasbon)into v_net,v_install from public.payrolls where periode=p_period;
 if v_net<0 or v_install<0 or v_net+v_install<=0 then raise exception 'HRIS: Tidak ada nilai gaji yang sah untuk dibukukan';end if;
 v_code:=public.hris_cash_code('Transfer',null,p_account);
 v_lines:=jsonb_build_array(jsonb_build_object('code','5201','debit',v_net+v_install,'credit',0),jsonb_build_object('code','1203','debit',0,'credit',v_install),jsonb_build_object('code',v_code,'debit',0,'credit',v_net));
 -- Journal and period lock validation occur before any money settlement writes.
 v_id:=public.hris_post_financial_journal('payroll',p_period,null,v_date,'Penggajian '||p_period,v_lines);
 for s in select * from public.payrolls where periode=p_period order by employee_id loop
  perform public.hris_validate_payroll_plan(s.employee_id,p_period,jsonb_build_object('rincian',s.source_snapshot->'rincian','sourceSnapshot',s.source_snapshot,'catatan',s.catatan,'cicilanKasbon',s.settlement_plan->'cicilanKasbon','reimburseIds',s.settlement_plan->'reimburseIds'));
  for c in select value from jsonb_array_elements(s.settlement_plan->'cicilanKasbon')loop
   insert into public.cash_advance_installments(advance_id,periode,jumlah)values((c->>'id')::uuid,p_period,(c->>'jumlah')::numeric);
   update public.cash_advances a set status='Lunas'where a.id=(c->>'id')::uuid and a.jumlah<=(select sum(i.jumlah)from public.cash_advance_installments i where i.advance_id=a.id);
  end loop;
  update public.reimbursements set status='Dibayar',paid_periode=p_period where id in(select value::uuid from jsonb_array_elements_text(s.settlement_plan->'reimburseIds'));
 end loop;
 update public.payrolls set status='final',disahkan_at=statement_timestamp(),disahkan_by=auth.uid()where periode=p_period;
 update public.hris_payroll_runs set status='final',finalized_at=statement_timestamp(),journal_id=v_id where periode=p_period;
 insert into public.hris_payroll_events(periode,version,actor_id,reason,kind,summary)values(p_period,p_version,auth.uid(),trim(p_reason),'finalize',jsonb_build_object('net',v_net,'installments',v_install,'journal_id',v_id));
 return v_id;
end$$;

-- Final historical amounts/settlement/journal cannot be edited via another API.
create function public.hris_final_payroll_immutable()returns trigger language plpgsql security definer set search_path=''as $$begin
 if old.status='final'then raise exception 'HRIS: Slip gaji final tidak dapat diubah/dihapus';end if;
 if tg_op='DELETE'then return old;else return new;end if;
end$$;
create trigger hris_final_payroll_immutable before update or delete on public.payrolls for each row execute function public.hris_final_payroll_immutable();
create function public.hris_preserve_employee_payroll()returns trigger language plpgsql security definer set search_path=''as $$begin
 if exists(select 1 from public.payrolls where employee_id=old.id and status='final')then raise exception 'HRIS: Karyawan memiliki gaji final; nonaktifkan tanpa menghapus riwayat';end if;return old;
end$$;
create trigger hris_preserve_employee_payroll before delete on public.employees for each row execute function public.hris_preserve_employee_payroll();
-- Invoker context distinguishes a raw authenticated write from private RPC posting.
create function public.hris_protect_financial_journal()returns trigger language plpgsql set search_path=''as $$declare v_source text;v_ref text;v_new_source text;v_new_ref text;begin
 if tg_table_name='journal_entries'then
  if tg_op<>'INSERT'then v_source:=old.source;v_ref:=old.source_ref;end if;
  if tg_op<>'DELETE'then v_new_source:=new.source;v_new_ref:=new.source_ref;end if;
 else
  if tg_op<>'INSERT'then select source,source_ref into v_source,v_ref from public.journal_entries where id=old.entry_id;end if;
  if tg_op<>'DELETE'then select source,source_ref into v_new_source,v_new_ref from public.journal_entries where id=new.entry_id;end if;
 end if;
 if current_user in('authenticated','anon')and(v_source in('payroll','kasbon')or v_new_source in('payroll','kasbon'))then raise exception 'HRIS: Jurnal gaji/kasbon hanya melalui transaksi HRIS';end if;
 if exists(select 1 from public.payrolls where status='final'and((v_source='payroll'and periode=v_ref)or(v_new_source='payroll'and periode=v_new_ref)))then raise exception 'HRIS: Jurnal gaji final tidak dapat diubah/dihapus';end if;
 if tg_op='DELETE'then return old;else return new;end if;
end$$;
create trigger hris_protect_financial_journal before insert or update or delete on public.journal_entries for each row execute function public.hris_protect_financial_journal();
create trigger hris_protect_financial_journal before insert or update or delete on public.journal_lines for each row execute function public.hris_protect_financial_journal();
revoke all on function public.hris_payroll_owner_lock(),public.hris_validate_payroll_plan(uuid,text,jsonb),public.hris_final_payroll_immutable(),public.hris_preserve_employee_payroll(),public.hris_protect_financial_journal()from public,anon,authenticated;
revoke all on function public.hris_payroll_source_state(text),public.hris_prepare_payroll(text,bigint,int,jsonb,text),public.hris_finalize_payroll(text,int,uuid,text)from public,anon;
grant execute on function public.hris_payroll_source_state(text),public.hris_prepare_payroll(text,bigint,int,jsonb,text),public.hris_finalize_payroll(text,int,uuid,text)to authenticated;
commit;
