alter table public.journal_entries add column opening_retired_at timestamptz;
create unique index opening_balance_one_active on public.journal_entries(source)
 where source='saldo-awal' and opening_retired_at is null;
create table public.opening_balance_revisions(
 id uuid primary key,action text not null check(action in ('save','void')),reason text not null,
 original_entry_id uuid references public.journal_entries(id),reversal_entry_id uuid references public.journal_entries(id),
 replacement_entry_id uuid references public.journal_entries(id),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
alter table public.opening_balance_revisions enable row level security;
revoke all on public.opening_balance_revisions from public,anon,authenticated,service_role;
grant select on public.opening_balance_revisions to authenticated;
create policy opening_balance_history_read on public.opening_balance_revisions for select to authenticated using(
 public.has_role_capability('all_branches') and exists(select 1 from public.profiles p where id=auth.uid() and is_active and role in ('OWNER','ADMIN','FINANCE')
  and (p.role='OWNER' or not exists(select 1 from public.role_modules where role=p.role) or exists(select 1 from public.role_modules where role=p.role and module_id='buku-besar')))
);
create table public.opening_balance_requests(
 actor_id uuid not null references public.profiles(id),request_key text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_key)
);
alter table public.opening_balance_requests enable row level security;
revoke all on public.opening_balance_requests from public,anon,authenticated,service_role;
create function public.guard_opening_balance_journal() returns trigger language plpgsql set search_path='' as $$
declare protected boolean;
begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=new.source in ('saldo-awal','saldo-awal-reversal') or old.source in ('saldo-awal','saldo-awal-reversal') or new.opening_retired_at is distinct from old.opening_retired_at;
  else
   select exists(select 1 from public.journal_entries where id in (new.entry_id,old.entry_id) and source in ('saldo-awal','saldo-awal-reversal')) into protected;
  end if;
  if protected then raise exception 'Saldo awal hanya boleh diubah melalui jalur resmi' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end$$;
create trigger opening_balance_header_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_opening_balance_journal();
create trigger opening_balance_line_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_opening_balance_journal();

create function public.mutate_opening_balance(p_request_key text,p_expected_entry_id uuid,p_action text,p_tanggal date,p_rows jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor public.profiles%rowtype;prior public.opening_balance_requests%rowtype;old_entry public.journal_entries%rowtype;
 payload jsonb;result jsonb;closed date;row_data jsonb;v_code text;amount numeric;side text;account uuid;modal_account uuid;
 total_d numeric:=0;total_k numeric:=0;v_modal numeric;lines jsonb:='[]';v_debit numeric;v_credit numeric;v_count integer;
 entry uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();audit uuid:=gen_random_uuid();number text;
begin
 if auth.uid() is null or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(p_request_key)>120 or p_action is null or p_action not in ('save','void') or length(coalesce(p_reason,''))>1000 then raise exception 'Identitas saldo awal tidak valid';end if;
 select * into actor from public.profiles where id=auth.uid() for update;
 if not found or not actor.is_active or actor.role not in ('OWNER','ADMIN','FINANCE') or not public.has_role_capability('all_branches')
  or ((p_expected_entry_id is not null or p_action='void') and actor.role<>'OWNER') then raise exception 'Akses saldo awal ditolak' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='buku-besar') then raise exception 'Akses Buku Besar diperlukan' using errcode='42501';end if;
 payload:=jsonb_build_object('expected',p_expected_entry_id,'action',p_action,'tanggal',p_tanggal,'rows',p_rows,'reason',nullif(btrim(p_reason),''));
 perform pg_advisory_xact_lock(hashtextextended('vetos:opening-balance',0));
 select * into prior from public.opening_balance_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;
  return prior.result;
 end if;
 select * into old_entry from public.journal_entries where source='saldo-awal' and opening_retired_at is null for update;
 if old_entry.id is distinct from p_expected_entry_id then raise exception 'Saldo awal sudah berubah. Muat ulang dan periksa saldo aktif';end if;
 if (old_entry.id is not null or p_action='void') and length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Alasan koreksi saldo awal wajib diisi';end if;
 if p_action='void' and old_entry.id is null then raise exception 'Saldo awal aktif tidak ditemukan';end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if old_entry.id is not null then
  if old_entry.branch_id is not null then raise exception 'Saldo awal lama berbeda lingkup cabang';end if;
  if old_entry.tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal saldo awal sumber masih di masa depan';end if;
  if closed is not null and old_entry.tanggal<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
  perform 1 from public.journal_lines where entry_id=old_entry.id for update;
  select sum(debit),sum(credit),count(*) into v_debit,v_credit,v_count from public.journal_lines where entry_id=old_entry.id;
  if v_count<2 or v_debit is null or v_debit<=0 or v_debit is distinct from v_credit
   or exists(select 1 from public.journal_lines where entry_id=old_entry.id and (debit<0 or credit<0 or debit::text in ('NaN','Infinity','-Infinity') or credit::text in ('NaN','Infinity','-Infinity') or (debit>0 and credit>0))) then raise exception 'Jurnal saldo awal lama tidak lengkap atau tidak seimbang';end if;
 end if;
 if p_action='save' then
  if p_tanggal is null or p_tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal saldo awal tidak valid';end if;
  if closed is not null and p_tanggal<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Baris saldo awal tidak valid';end if;
  for row_data in select value from jsonb_array_elements(p_rows) loop
   v_code:=btrim(row_data->>'code');amount:=(row_data->>'nilai')::numeric;side:=row_data->>'sisi';
   if jsonb_typeof(row_data) is distinct from 'object' or side is null or side not in ('D','K') or amount is null
    or amount<>round(amount) or abs(amount)>1000000000000 or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Nilai saldo awal harus rupiah bulat yang valid';end if;
   if amount=0 then continue;end if;
   if v_code='3101' then raise exception 'Modal pemilik dihitung otomatis';end if;
   select id into account from public.coa_accounts where coa_accounts.code=v_code and is_active and not is_header and type in ('ASET','LIABILITAS','EKUITAS') for share;
   if not found then raise exception 'Akun saldo awal tidak valid atau tidak aktif';end if;
   if amount<0 then side:=case side when 'D' then 'K' else 'D' end;amount:=-amount;end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('account_id',account,'debit',case when side='D' then amount else 0 end,'credit',case when side='K' then amount else 0 end));
   if side='D' then total_d:=total_d+amount;else total_k:=total_k+amount;end if;
  end loop;
  v_modal:=total_d-total_k;
  if greatest(total_d,total_k)<=0 or greatest(total_d,total_k)>1000000000000 then raise exception 'Total saldo awal tidak valid';end if;
  if v_modal<>0 then
   select id into modal_account from public.coa_accounts where coa_accounts.code='3101' and is_active and not is_header and type='EKUITAS' for share;
   if not found then raise exception 'Akun Modal Pemilik tidak tersedia';end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('account_id',modal_account,'debit',greatest(-v_modal,0),'credit',greatest(v_modal,0)));
  end if;
  if jsonb_array_length(lines)<2 then raise exception 'Minimal dua baris jurnal diperlukan';end if;
 end if;
 if old_entry.id is not null then
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(reversal,public.sales_next_number('JRN',old_entry.tanggal),old_entry.tanggal,'Pembalik saldo awal '||old_entry.no_jurnal,'saldo-awal-reversal',audit::text,null);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=old_entry.id;
  update public.journal_entries set opening_retired_at=now() where id=old_entry.id;
 end if;
 if p_action='save' then
  number:=public.sales_next_number('JRN',p_tanggal);
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(entry,number,p_tanggal,'Saldo awal per '||p_tanggal::text,'saldo-awal',audit::text,null);
  insert into public.journal_lines(entry_id,account_id,debit,credit)
   select entry,(x->>'account_id')::uuid,(x->>'debit')::numeric,(x->>'credit')::numeric from jsonb_array_elements(lines) x;
 end if;
 insert into public.opening_balance_revisions(id,action,reason,original_entry_id,reversal_entry_id,replacement_entry_id,created_by)
  values(audit,p_action,coalesce(nullif(btrim(p_reason),''),'Saldo awal pertama'),old_entry.id,case when old_entry.id is not null then reversal end,case when p_action='save' then entry end,actor.id);
 result:=jsonb_build_object('entry_id',case when p_action='save' then entry else old_entry.id end,'no_jurnal',number,'modal',v_modal);
 insert into public.opening_balance_requests(actor_id,request_key,payload,result) values(actor.id,p_request_key,payload,result);
 return result;
end$$;
revoke all on function public.mutate_opening_balance(text,uuid,text,date,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.mutate_opening_balance(text,uuid,text,date,jsonb,text) to authenticated;

create function public.get_opening_balance_result(p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;r public.opening_balance_requests%rowtype;
begin
 select * into actor from public.profiles where id=auth.uid() for share;
 if not found or not actor.is_active or actor.role not in ('OWNER','ADMIN','FINANCE') or not public.has_role_capability('all_branches') then raise exception 'Akses saldo awal ditolak' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='buku-besar') then raise exception 'Akses Buku Besar diperlukan' using errcode='42501';end if;
 if length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(p_request_key)>120 then raise exception 'Identitas saldo awal tidak valid';end if;
 select * into r from public.opening_balance_requests where actor_id=actor.id and request_key=p_request_key;
 if not found then return null;end if;
 if ((r.payload->>'expected') is not null or r.payload->>'action'='void') and actor.role<>'OWNER' then raise exception 'Akses koreksi saldo awal ditolak' using errcode='42501';end if;
 return r.result;
end$$;
revoke all on function public.get_opening_balance_result(text) from public,anon,authenticated,service_role;
grant execute on function public.get_opening_balance_result(text) to authenticated;
