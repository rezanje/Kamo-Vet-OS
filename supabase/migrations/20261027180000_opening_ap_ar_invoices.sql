-- M05: opening supplier payables and customer receivables imported per invoice (Accurate cutover).
-- Opening invoices live in purchase_invoices / sales_invoices so the existing payment flows
-- (Hutang → pay_purchase_invoice_atomic, Faktur Penjualan → receive_wholesale_payment) allocate
-- against them. They carry no lines, no stock, no PPN and no revenue/purchase journal: one
-- balanced journal per batch moves the outstanding amounts between 3101 and 2101/1201.

create function public.opening_invoice_norm(p_text text) returns text
language sql immutable set search_path='' as $$select lower(regexp_replace(btrim(coalesce(p_text,'')),'\s+',' ','g'))$$;
revoke all on function public.opening_invoice_norm(text) from public,anon,authenticated,service_role;

create table public.opening_invoice_batches (
  id uuid primary key default gen_random_uuid(),
  source_hash text not null unique check (source_hash ~ '^[0-9a-f]{64}$'),
  source_name text not null check (length(btrim(source_name)) between 1 and 200),
  as_of date not null,
  branch_id uuid not null references public.branches(id),
  journal_id uuid not null unique references public.journal_entries(id),
  ap_count integer not null check (ap_count>=0),
  ap_total numeric not null check (ap_total>=0),
  ar_count integer not null check (ar_count>=0),
  ar_total numeric not null check (ar_total>=0),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  result jsonb not null default '{}'::jsonb,
  check (ap_count+ar_count>0)
);

alter table public.purchase_invoices add column opening_batch_id uuid references public.opening_invoice_batches(id);
alter table public.sales_invoices add column opening_batch_id uuid references public.opening_invoice_batches(id);
create index purchase_invoices_opening_batch_idx on public.purchase_invoices(opening_batch_id) where opening_batch_id is not null;
create index sales_invoices_opening_batch_idx on public.sales_invoices(opening_batch_id) where opening_batch_id is not null;
-- An opening payable has neither PO nor receiving warehouse.
alter table public.purchase_invoices drop constraint purchase_invoices_asal_check;
alter table public.purchase_invoices add constraint purchase_invoices_asal_check check (po_id is not null or warehouse_id is not null or opening_batch_id is not null);

create table public.opening_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.opening_invoice_batches(id),
  row_no integer not null check (row_no>0),
  jenis text not null check (jenis in ('HUTANG','PIUTANG')),
  supplier_id uuid references public.suppliers(id),
  customer_id uuid references public.customers(id),
  purchase_invoice_id uuid unique references public.purchase_invoices(id),
  sales_invoice_id uuid unique references public.sales_invoices(id),
  source_no text not null check (length(source_no) between 1 and 60),
  source_no_norm text not null,
  party_code text,
  party_name text not null,
  matched_by text not null check (matched_by in ('nama')),
  tanggal date not null,
  jatuh_tempo date not null check (jatuh_tempo>=tanggal),
  outstanding numeric not null check (outstanding>0 and outstanding=round(outstanding)),
  original_total numeric check (original_total is null or original_total>=outstanding),
  keterangan text,
  unique (batch_id,row_no),
  check ((jenis='HUTANG' and supplier_id is not null and purchase_invoice_id is not null and customer_id is null and sales_invoice_id is null)
      or (jenis='PIUTANG' and customer_id is not null and sales_invoice_id is not null and supplier_id is null and purchase_invoice_id is null))
);
-- Supplier invoice numbers repeat across suppliers; our own sales invoice numbers do not.
create unique index opening_invoice_lines_ap_no on public.opening_invoice_lines(supplier_id,source_no_norm) where jenis='HUTANG';
create unique index opening_invoice_lines_ar_no on public.opening_invoice_lines(source_no_norm) where jenis='PIUTANG';

alter table public.opening_invoice_batches enable row level security;
alter table public.opening_invoice_lines enable row level security;
revoke all on public.opening_invoice_batches,public.opening_invoice_lines from public,anon,authenticated,service_role;
grant select on public.opening_invoice_batches,public.opening_invoice_lines to authenticated;
create policy opening_invoice_batch_read on public.opening_invoice_batches for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN','FINANCE'))
  and public.user_can_access_branch(branch_id));
create policy opening_invoice_line_read on public.opening_invoice_lines for select to authenticated using (
  exists(select 1 from public.opening_invoice_batches b where b.id=batch_id));

-- Opening invoices change only through payments/receipts (status + revision). No lines, no void,
-- no edit, no delete; inserts only from post_opening_invoices for its own batch.
create function public.guard_opening_invoice() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='purchase_invoice_items' then
  if exists(select 1 from public.purchase_invoices where id in(new.invoice_id,old.invoice_id) and opening_batch_id is not null) then
   raise exception 'Faktur saldo awal tidak memiliki baris barang' using errcode='42501';end if;
  return coalesce(new,old);
 elsif tg_table_name='sales_invoice_items' then
  if exists(select 1 from public.sales_invoices where id in(new.invoice_id,old.invoice_id) and opening_batch_id is not null) then
   raise exception 'Faktur saldo awal tidak memiliki baris barang' using errcode='42501';end if;
  return coalesce(new,old);
 end if;
 if tg_op='INSERT' then
  if new.opening_batch_id is not null and (current_user in ('authenticated','anon','service_role')
   or current_setting('vetos.opening_invoice_batch',true) is distinct from new.opening_batch_id::text) then
   raise exception 'Faktur saldo awal hanya dibuat lewat impor saldo awal per faktur' using errcode='42501';end if;
  return new;
 end if;
 if old.opening_batch_id is null and (tg_op='DELETE' or new.opening_batch_id is null) then return coalesce(new,old);end if;
 if tg_op='DELETE' then raise exception 'Faktur saldo awal tidak dapat dihapus' using errcode='42501';end if;
 if current_user in ('authenticated','anon','service_role') or new.opening_batch_id is distinct from old.opening_batch_id
  or (to_jsonb(new)-'status'-'revision') is distinct from (to_jsonb(old)-'status'-'revision')
  or coalesce(to_jsonb(new)->>'status','')='batal' then
  raise exception 'Faktur saldo awal hanya berubah lewat pembayaran atau penerimaan. Pembatalan dan koreksi belum didukung' using errcode='42501';
 end if;
 return new;
end$$;
revoke all on function public.guard_opening_invoice() from public,anon,authenticated,service_role;
create trigger opening_invoice_guard before insert or update or delete on public.purchase_invoices for each row execute function public.guard_opening_invoice();
create trigger opening_invoice_guard before insert or update or delete on public.sales_invoices for each row execute function public.guard_opening_invoice();
create trigger opening_invoice_guard before insert or update or delete on public.purchase_invoice_items for each row execute function public.guard_opening_invoice();
create trigger opening_invoice_guard before insert or update or delete on public.sales_invoice_items for each row execute function public.guard_opening_invoice();

create function public.guard_opening_invoice_journal() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then protected:=new.source='opening-invoice' or old.source='opening-invoice';
  else select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source='opening-invoice') into protected;end if;
  if protected then raise exception 'Jurnal saldo awal per faktur dilindungi' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_opening_invoice_journal() from public,anon,authenticated,service_role;
create trigger opening_invoice_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_opening_invoice_journal();
create trigger opening_invoice_journal_lines_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_opening_invoice_journal();

-- No double counting: once payables/receivables exist per invoice, the account-level opening
-- journal (create_opening_balance_atomic, source 'saldo-awal') may not carry 2101/1201.
create function public.guard_saldo_awal_opening_invoices() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_code text;begin
 if not exists(select 1 from public.opening_invoice_batches) then return new;end if;
 if not exists(select 1 from public.journal_entries where id=new.entry_id and source='saldo-awal') then return new;end if;
 select code into v_code from public.coa_accounts where id=new.account_id;
 if (v_code='2101' and exists(select 1 from public.opening_invoice_batches where ap_total>0))
  or (v_code='1201' and exists(select 1 from public.opening_invoice_batches where ar_total>0)) then
  raise exception 'Akun % sudah diisi per faktur lewat Saldo Awal per Faktur. Hapus baris akun ini supaya hutang/piutang tidak tercatat ganda', v_code using errcode='23514';
 end if;
 return new;
end$$;
revoke all on function public.guard_saldo_awal_opening_invoices() from public,anon,authenticated,service_role;
create trigger opening_invoice_saldo_awal_guard before insert or update on public.journal_lines for each row execute function public.guard_saldo_awal_opening_invoices();

-- Shared validation for preview and post. Everything is recomputed from the payload; nothing the
-- client reports about matching, duplicates or totals is trusted.
create function public.opening_invoice_review(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_rows jsonb;v_source text;v_as_of date;v_branch uuid;v_branch_name text;v_closed date;
 v_ctrl_ap numeric;v_ctrl_ar numeric;v_ctrl jsonb;v_blockers text[]:='{}';v_hash text;
 v_checked jsonb;v_parties jsonb;v_ap_count integer;v_ap_total numeric;v_ar_count integer;v_ar_total numeric;v_error_rows integer;
 v_batch public.opening_invoice_batches%rowtype;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Data impor tidak valid' using errcode='22023';end if;
 v_rows:=p_payload->'rows';
 if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_array_length(v_rows) not between 1 and 2000 then
  raise exception 'File harus berisi 1 sampai 2.000 baris faktur' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(v_rows) r where jsonb_typeof(r) is distinct from 'object') then raise exception 'Baris faktur tidak valid' using errcode='22023';end if;
 v_source:=btrim(coalesce(p_payload->>'source_name',''));
 if length(v_source) not between 1 and 200 then raise exception 'Nama file tidak valid' using errcode='22023';end if;
 if coalesce(p_payload->>'as_of','')!~'^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(p_payload->>'as_of','date') then raise exception 'Tanggal saldo awal tidak valid' using errcode='22023';end if;
 v_as_of:=(p_payload->>'as_of')::date;
 if coalesce(p_payload->>'branch_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Pilih cabang' using errcode='22023';end if;
 v_branch:=(p_payload->>'branch_id')::uuid;
 select name into v_branch_name from public.branches where id=v_branch and is_active;
 if not found or not public.user_can_access_branch(v_branch) then raise exception 'Cabang tidak aktif atau tidak dapat diakses' using errcode='42501';end if;
 v_ctrl:=coalesce(p_payload->'control','{}'::jsonb);
 if jsonb_typeof(v_ctrl) is distinct from 'object'
  or (v_ctrl ? 'hutang' and jsonb_typeof(v_ctrl->'hutang')<>'null' and coalesce(v_ctrl->>'hutang','')!~'^[0-9]{1,13}$')
  or (v_ctrl ? 'piutang' and jsonb_typeof(v_ctrl->'piutang')<>'null' and coalesce(v_ctrl->>'piutang','')!~'^[0-9]{1,13}$') then
  raise exception 'Total kontrol harus rupiah bulat' using errcode='22023';end if;
 v_ctrl_ap:=(v_ctrl->>'hutang')::numeric;v_ctrl_ar:=(v_ctrl->>'piutang')::numeric;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('as_of',v_as_of,'branch_id',v_branch,'rows',v_rows)::text,'UTF8')),'hex');

 with src as (
  select x.ord::integer ord,
   case when coalesce(x.r->>'baris','')~'^[0-9]{1,7}$' then (x.r->>'baris')::integer else x.ord::integer end baris,
   upper(btrim(coalesce(x.r->>'jenis',''))) jenis,
   nullif(btrim(coalesce(x.r->>'kode_pihak','')),'') kode,
   btrim(coalesce(x.r->>'nama_pihak','')) nama,
   btrim(coalesce(x.r->>'no_faktur','')) no,
   btrim(coalesce(x.r->>'tanggal','')) tgl_txt,btrim(coalesce(x.r->>'jatuh_tempo','')) due_txt,
   btrim(coalesce(x.r->>'sisa','')) sisa_txt,nullif(btrim(coalesce(x.r->>'total_asli','')),'') asli_txt,
   nullif(btrim(coalesce(x.r->>'keterangan','')),'') ket
  from jsonb_array_elements(v_rows) with ordinality x(r,ord)
 ), typed as (
  select s.*,public.opening_invoice_norm(s.nama) nama_norm,upper(regexp_replace(s.no,'\s+',' ','g')) no_norm,
   case when s.tgl_txt~'^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(s.tgl_txt,'date') then s.tgl_txt::date end tgl,
   case when s.due_txt~'^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(s.due_txt,'date') then s.due_txt::date end due,
   case when s.sisa_txt~'^[0-9]{1,13}$' then s.sisa_txt::numeric end sisa,
   case when s.asli_txt~'^[0-9]{1,13}$' then s.asli_txt::numeric end asli
  from src s
 ), names as (select distinct jenis,nama_norm from typed where nama_norm<>''),
 sup as (
  select n.nama_norm,count(p.id) cnt,(array_agg(p.id order by p.id))[1] id,(array_agg(p.nama::text order by p.id))[1] nm
  from names n join public.suppliers p on public.opening_invoice_norm(p.nama)=n.nama_norm and p.is_active and p.trashed_at is null
  where n.jenis='HUTANG' group by n.nama_norm
 ), cus as (
  select n.nama_norm,count(c.id) cnt,(array_agg(c.id order by c.id))[1] id,(array_agg(c.name::text order by c.id))[1] nm
  from names n join public.customers c on public.opening_invoice_norm(c.name)=n.nama_norm
  where n.jenis='PIUTANG' group by n.nama_norm
 ), matched as (
  select t.*,
   case t.jenis when 'HUTANG' then coalesce(sp.cnt,0) when 'PIUTANG' then coalesce(cs.cnt,0) end party_count,
   case t.jenis when 'HUTANG' then case when sp.cnt=1 then sp.id end when 'PIUTANG' then case when cs.cnt=1 then cs.id end end party_id,
   case t.jenis when 'HUTANG' then case when sp.cnt=1 then sp.nm end when 'PIUTANG' then case when cs.cnt=1 then cs.nm end end party_name
  from typed t left join sup sp on t.jenis='HUTANG' and sp.nama_norm=t.nama_norm left join cus cs on t.jenis='PIUTANG' and cs.nama_norm=t.nama_norm
 ), dup as (
  select m.*,count(*) over (partition by m.jenis,case when m.jenis='HUTANG' then coalesce(m.party_id::text,m.nama_norm) else '' end,m.no_norm) file_dup,
   case when m.jenis='HUTANG' and m.party_id is not null then
     (select min(pi.no_faktur::text) from public.purchase_invoices pi where pi.supplier_id=m.party_id and pi.voided_at is null and m.no_norm<>''
       and upper(regexp_replace(btrim(coalesce(pi.no_faktur_pemasok,'')),'\s+',' ','g'))=m.no_norm)
    when m.jenis='PIUTANG' then
     (select min(si.no_faktur::text) from public.opening_invoice_lines l join public.sales_invoices si on si.id=l.sales_invoice_id where l.jenis='PIUTANG' and l.source_no_norm=m.no_norm)
   end db_dup
  from matched m
 ), checked as (
  select d.*,array_remove(array[
   case when d.jenis not in ('HUTANG','PIUTANG') then 'Jenis harus HUTANG atau PIUTANG' end,
   case when d.nama='' then 'Nama pihak wajib diisi' when length(d.nama)>200 then 'Nama pihak maksimal 200 karakter' end,
   case when length(coalesce(d.kode,''))>60 then 'Kode pihak maksimal 60 karakter' end,
   case when d.no='' then 'No faktur wajib diisi' when length(d.no)>60 then 'No faktur maksimal 60 karakter' end,
   case when d.tgl is null then 'Tanggal faktur tidak valid' when d.tgl>v_as_of then 'Tanggal faktur sesudah tanggal saldo awal' end,
   case when d.due is null then 'Jatuh tempo tidak valid' when d.tgl is not null and d.due<d.tgl then 'Jatuh tempo sebelum tanggal faktur' end,
   case when d.sisa is null or d.sisa<=0 then 'Sisa tagihan harus rupiah bulat lebih dari 0' end,
   case when d.asli_txt is not null and (d.asli is null or (d.sisa is not null and d.asli<d.sisa)) then 'Total faktur asli harus rupiah bulat dan tidak lebih kecil dari sisa tagihan' end,
   case when length(coalesce(d.ket,''))>500 then 'Keterangan maksimal 500 karakter' end,
   case when d.jenis in ('HUTANG','PIUTANG') and d.nama<>'' and d.party_count=0 then
     case d.jenis when 'HUTANG' then 'Pemasok belum ada di master VetOS (atau nonaktif). Buat dulu di master pemasok' else 'Pelanggan belum ada di master VetOS. Buat dulu di master pelanggan' end end,
   case when d.party_count>1 then 'Nama pihak cocok dengan '||d.party_count||' data master. Rapikan nama di master dulu' end,
   case when d.no<>'' and d.jenis in ('HUTANG','PIUTANG') and d.file_dup>1 then 'No faktur muncul lebih dari sekali di file ini' end,
   case when d.db_dup is not null then 'Faktur ini sudah tercatat di VetOS ('||d.db_dup||')' end
  ],null) errors
  from dup d
 )
 select coalesce(jsonb_agg(jsonb_build_object('baris',c.baris,'jenis',c.jenis,'kode_pihak',c.kode,'nama_pihak',c.nama,
   'party_id',c.party_id,'party_name',c.party_name,'matched_by',case when c.party_id is not null then 'nama' end,
   'no_faktur',c.no,'no_norm',c.no_norm,'tanggal',c.tgl,'jatuh_tempo',c.due,'sisa',c.sisa,'total_asli',c.asli,'keterangan',c.ket,
   'errors',to_jsonb(c.errors)) order by c.ord),'[]'::jsonb)
 into v_checked from checked c;
 if (select count(distinct r->>'baris') from jsonb_array_elements(v_checked) r)<>jsonb_array_length(v_checked) then raise exception 'Nomor baris file ganda' using errcode='22023';end if;

 select count(*) filter (where r->>'jenis'='HUTANG' and r->'sisa'<>'null'),coalesce(sum((r->>'sisa')::numeric) filter (where r->>'jenis'='HUTANG'),0),
        count(*) filter (where r->>'jenis'='PIUTANG' and r->'sisa'<>'null'),coalesce(sum((r->>'sisa')::numeric) filter (where r->>'jenis'='PIUTANG'),0),
        count(*) filter (where jsonb_array_length(r->'errors')>0)
 into v_ap_count,v_ap_total,v_ar_count,v_ar_total,v_error_rows from jsonb_array_elements(v_checked) r;
 select coalesce(jsonb_agg(p order by p->>'jenis',p->>'nama'),'[]'::jsonb) into v_parties from (
  select jsonb_build_object('jenis',r->>'jenis','party_id',r->>'party_id','nama',coalesce(r->>'party_name',min(r->>'nama_pihak')),
   'jumlah_faktur',count(*),'total',coalesce(sum((r->>'sisa')::numeric),0)) p
  from jsonb_array_elements(v_checked) r where r->>'jenis' in ('HUTANG','PIUTANG')
  group by r->>'jenis',r->>'party_id',r->>'party_name',case when r->>'party_id' is null then public.opening_invoice_norm(r->>'nama_pihak') end) x;

 if v_as_of>(now() at time zone 'Asia/Jakarta')::date then v_blockers:=v_blockers||'Tanggal saldo awal tidak boleh di masa depan.'::text;end if;
 select closed_until into v_closed from public.accounting_locks where id;
 if not found then v_blockers:=v_blockers||'Pengaturan periode akuntansi belum tersedia.'::text;
 elsif v_closed is not null and v_as_of<=v_closed then v_blockers:=v_blockers||('Periode sampai '||v_closed||' sudah ditutup.');end if;
 if v_ap_count>0 and v_ctrl_ap is null then v_blockers:=v_blockers||'Isi total kontrol hutang dari laporan Accurate.'::text;
 elsif coalesce(v_ctrl_ap,0)<>v_ap_total then v_blockers:=v_blockers||('Total kontrol hutang '||coalesce(v_ctrl_ap,0)||' tidak sama dengan jumlah file '||v_ap_total||'.');end if;
 if v_ar_count>0 and v_ctrl_ar is null then v_blockers:=v_blockers||'Isi total kontrol piutang dari laporan Accurate.'::text;
 elsif coalesce(v_ctrl_ar,0)<>v_ar_total then v_blockers:=v_blockers||('Total kontrol piutang '||coalesce(v_ctrl_ar,0)||' tidak sama dengan jumlah file '||v_ar_total||'.');end if;
 if v_ap_count>0 and exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id join public.coa_accounts a on a.id=l.account_id where e.source='saldo-awal' and a.code='2101') then
  v_blockers:=v_blockers||'Hutang Usaha (2101) sudah diisi sebagai satu total di Saldo Awal. Impor per faktur ditolak supaya hutang tidak tercatat ganda.'::text;end if;
 if v_ar_count>0 and exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id join public.coa_accounts a on a.id=l.account_id where e.source='saldo-awal' and a.code='1201') then
  v_blockers:=v_blockers||'Piutang Usaha (1201) sudah diisi sebagai satu total di Saldo Awal. Impor per faktur ditolak supaya piutang tidak tercatat ganda.'::text;end if;
 if (select count(*) from public.coa_accounts where code in ('2101','1201','3101') and is_active and not is_header)<>3 then
  v_blockers:=v_blockers||'Akun 2101, 1201, atau 3101 belum aktif di daftar akun.'::text;end if;

 select * into v_batch from public.opening_invoice_batches where source_hash=v_hash;
 return jsonb_build_object('source_hash',v_hash,'source_name',v_source,'as_of',v_as_of,'branch_id',v_branch,'branch_name',v_branch_name,
  'status',case when v_batch.id is not null then 'posted' else 'previewed' end,'receipt',case when v_batch.id is not null then v_batch.result end,
  'rows',v_checked,'parties',v_parties,'error_rows',v_error_rows,'blockers',to_jsonb(v_blockers),
  'totals',jsonb_build_object('hutang',jsonb_build_object('jumlah_faktur',v_ap_count,'total',v_ap_total,'kontrol',v_ctrl_ap),
   'piutang',jsonb_build_object('jumlah_faktur',v_ar_count,'total',v_ar_total,'kontrol',v_ctrl_ar)),
  'can_post',v_batch.id is null and v_error_rows=0 and cardinality(v_blockers)=0);
end$$;
revoke all on function public.opening_invoice_review(jsonb) from public,anon,authenticated,service_role;

create function public.preview_opening_invoices(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;begin
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if not found or actor.role not in ('OWNER','ADMIN','FINANCE') or not public.has_role_capability('all_branches') then raise exception 'Akses saldo awal ditolak' using errcode='42501';end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='buku-besar') then raise exception 'Akses Buku Besar diperlukan' using errcode='42501';end if;
 return public.opening_invoice_review(p_payload);
end$$;
revoke all on function public.preview_opening_invoices(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_opening_invoices(jsonb) to authenticated;

create function public.post_opening_invoices(p_payload jsonb,p_expected_hash text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 actor public.profiles%rowtype;report jsonb;r jsonb;v_batch uuid:=gen_random_uuid();v_journal uuid;v_as_of date;v_branch uuid;
 v_ap numeric;v_ar numeric;v_lines jsonb:='[]';v_prefix text;v_digits integer;v_seq bigint;v_number text;v_invoice uuid;
 v_result jsonb;v_invoices jsonb:='[]';v_ket text;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active for share;
 if not found or actor.role<>'OWNER' then raise exception 'Hanya OWNER aktif yang dapat memposting saldo awal per faktur' using errcode='42501';end if;
 if p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then raise exception 'Isi alasan audit 10 sampai 1.000 karakter' using errcode='22023';end if;
 if coalesce(p_expected_hash,'')!~'^[0-9a-f]{64}$' then raise exception 'Periksa file sebelum memposting' using errcode='22023';end if;
 -- One poster at a time; the ledger lock serializes with create_opening_balance_atomic's saldo-awal check.
 perform pg_advisory_xact_lock(hashtextextended('vetos:opening-invoices',0));
 perform 1 from public.coa_accounts where code in ('2101','1201','3101') order by id for share;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 report:=public.opening_invoice_review(p_payload);
 if report->>'source_hash'<>p_expected_hash then raise exception 'Isi file berubah sejak diperiksa. Periksa ulang sebelum memposting' using errcode='22023';end if;
 if report->>'status'='posted' then return (report->'receipt')||jsonb_build_object('replayed',true);end if;
 if not (report->>'can_post')::boolean then
  raise exception 'Batch belum dapat diposting: %',coalesce(report->'blockers'->>0,(report->>'error_rows')||' baris masih bermasalah') using errcode='22023';end if;
 v_as_of:=(report->>'as_of')::date;v_branch:=(report->>'branch_id')::uuid;
 v_ap:=(report->'totals'->'hutang'->>'total')::numeric;v_ar:=(report->'totals'->'piutang'->>'total')::numeric;
 if v_ap>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','3101','debit',v_ap,'credit',0),jsonb_build_object('code','2101','debit',0,'credit',v_ap));end if;
 if v_ar>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1201','debit',v_ar,'credit',0),jsonb_build_object('code','3101','debit',0,'credit',v_ar));end if;
 v_journal:=public.clinic_write_journal(v_as_of,'Saldo awal hutang/piutang per faktur · '||(report->>'source_name'),'opening-invoice',v_batch::text,v_branch,v_lines);
 if v_journal is null then raise exception 'Jurnal saldo awal belum tersimpan';end if;
 insert into public.opening_invoice_batches(id,source_hash,source_name,as_of,branch_id,journal_id,ap_count,ap_total,ar_count,ar_total,reason,created_by)
 values(v_batch,report->>'source_hash',report->>'source_name',v_as_of,v_branch,v_journal,
  (report->'totals'->'hutang'->>'jumlah_faktur')::integer,v_ap,(report->'totals'->'piutang'->>'jumlah_faktur')::integer,v_ar,btrim(p_reason),auth.uid());
 perform set_config('vetos.opening_invoice_batch',v_batch::text,true);

 -- Purchase invoice numbers follow create_direct_purchase_invoice (FB series, highest+1 under its lock).
 if v_ap>0 then
  select pola,digit into v_prefix,v_digits from public.document_numbering where jenis='FB';
  v_prefix:=coalesce(v_prefix,'FB.{YYYY}.{MM}.');v_digits:=coalesce(v_digits,5);
  v_prefix:=replace(replace(replace(replace(v_prefix,'{YYYY}',to_char(v_as_of,'YYYY')),'{YY}',to_char(v_as_of,'YY')),'{MM}',to_char(v_as_of,'MM')),'{DD}',to_char(v_as_of,'DD'));
  if v_digits not between 1 and 8 or length(v_prefix)+v_digits>30 then raise exception 'Format nomor faktur tidak valid';end if;
  perform pg_advisory_xact_lock(hashtext('vetos:purchase-invoice:'||v_prefix)::bigint);
  select coalesce(max(substring(no_faktur,length(v_prefix)+1)::bigint),0)+1 into v_seq from public.purchase_invoices
   where left(no_faktur,length(v_prefix))=v_prefix and substring(no_faktur,length(v_prefix)+1)~'^[0-9]+$';
 end if;
 for r in select x from jsonb_array_elements(report->'rows') x order by (x->>'baris')::integer loop
  v_invoice:=gen_random_uuid();
  if r->>'jenis'='HUTANG' then
   if length(v_seq::text)>v_digits then raise exception 'Nomor faktur pembelian sudah penuh';end if;
   v_number:=v_prefix||lpad(v_seq::text,v_digits,'0');v_seq:=v_seq+1;
   v_ket:=left('Saldo awal per faktur'||coalesce(' · '||(r->>'keterangan'),''),600);
   insert into public.purchase_invoices(id,no_faktur,no_faktur_pemasok,supplier_id,branch_id,tanggal,jatuh_tempo,total,keterangan,created_by,opening_batch_id)
   values(v_invoice,v_number,r->>'no_faktur',(r->>'party_id')::uuid,v_branch,(r->>'tanggal')::date,(r->>'jatuh_tempo')::date,(r->>'sisa')::numeric,v_ket,auth.uid(),v_batch);
  else
   v_number:=public.sales_next_number('FJ',v_as_of);
   v_ket:=left('Saldo awal Accurate · No. '||(r->>'no_faktur')||coalesce(' · '||(r->>'keterangan'),''),600);
   insert into public.sales_invoices(id,no_faktur,customer_id,branch_id,tanggal,jatuh_tempo,dpp,ppn,total,status,catatan,created_by,opening_batch_id)
   values(v_invoice,v_number,(r->>'party_id')::uuid,v_branch,(r->>'tanggal')::date,(r->>'jatuh_tempo')::date,0,0,(r->>'sisa')::numeric,'berjalan',v_ket,auth.uid(),v_batch);
  end if;
  insert into public.opening_invoice_lines(batch_id,row_no,jenis,supplier_id,customer_id,purchase_invoice_id,sales_invoice_id,source_no,source_no_norm,party_code,party_name,matched_by,
   tanggal,jatuh_tempo,outstanding,original_total,keterangan)
  values(v_batch,(r->>'baris')::integer,r->>'jenis',
   case when r->>'jenis'='HUTANG' then (r->>'party_id')::uuid end,case when r->>'jenis'='PIUTANG' then (r->>'party_id')::uuid end,
   case when r->>'jenis'='HUTANG' then v_invoice end,case when r->>'jenis'='PIUTANG' then v_invoice end,
   r->>'no_faktur',r->>'no_norm',r->>'kode_pihak',r->>'party_name',r->>'matched_by',(r->>'tanggal')::date,(r->>'jatuh_tempo')::date,
   (r->>'sisa')::numeric,(r->>'total_asli')::numeric,r->>'keterangan');
  v_invoices:=v_invoices||jsonb_build_array(jsonb_build_object('baris',(r->>'baris')::integer,'jenis',r->>'jenis','id',v_invoice,'no_faktur',v_number,'no_asal',r->>'no_faktur'));
 end loop;
 perform set_config('vetos.opening_invoice_batch','',true);
 v_result:=jsonb_build_object('batch_id',v_batch,'journal_id',v_journal,'no_jurnal',(select no_jurnal from public.journal_entries where id=v_journal),
  'as_of',v_as_of,'branch_id',v_branch,'source_hash',report->>'source_hash',
  'hutang',jsonb_build_object('jumlah_faktur',(report->'totals'->'hutang'->>'jumlah_faktur')::integer,'total',v_ap),
  'piutang',jsonb_build_object('jumlah_faktur',(report->'totals'->'piutang'->>'jumlah_faktur')::integer,'total',v_ar),
  'invoices',v_invoices);
 update public.opening_invoice_batches set result=v_result where id=v_batch;
 return v_result||jsonb_build_object('replayed',false);
end$$;
revoke all on function public.post_opening_invoices(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.post_opening_invoices(jsonb,text,text) to authenticated;
