-- Koreksi nilai saldo awal per faktur (hutang FB / piutang FJ hasil impor saldo awal) dari layar
-- Keuangan → Saldo Awal per Faktur, menggantikan migrasi koreksi satu-satu
-- (20261121300000, 20261124200000, 20261124210000).
--
-- Aturan:
--  * hanya OWNER aktif, alasan audit 10–1.000 karakter, nilai baru rupiah bulat > 0;
--  * nilai baru tidak boleh lebih kecil dari yang sudah dibayar/diterima (sisa tagihan tidak minus);
--  * nilai lama yang dilihat di layar harus sama dengan nilai sekarang (tidak menimpa perubahan lain);
--  * faktur batal/void atau sudah diganti faktur lain ditolak; periode tertutup ditolak;
--  * jurnal batch asli TIDAK diubah: selisih dibukukan sebagai jurnal koreksi baru bertanggal saldo
--    awal batch (source 'opening-invoice', jadi ikut dilindungi guard_opening_invoice_journal):
--      hutang naik  : D 410001 Modal Pemilik / K 311001 Utang Supplier   (turun: kebalikannya)
--      piutang naik : D 150001 Piutang Usaha / K 410001 Modal Pemilik    (turun: kebalikannya)
--  * faktur (total; status piutang lunas/berjalan), baris impor (sisa) dan total batch ikut disesuaikan;
--  * riwayat di opening_invoice_corrections; permintaan idempoten per (pengguna, kunci permintaan).

create table public.opening_invoice_corrections (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.opening_invoice_lines(id) on delete restrict,
  batch_id uuid not null references public.opening_invoice_batches(id) on delete restrict,
  jenis text not null check (jenis in ('HUTANG','PIUTANG')),
  purchase_invoice_id uuid references public.purchase_invoices(id) on delete restrict,
  sales_invoice_id uuid references public.sales_invoices(id) on delete restrict,
  old_total numeric not null check (old_total > 0),
  new_total numeric not null check (new_total > 0 and new_total = round(new_total)),
  delta numeric not null check (delta <> 0 and delta = new_total - old_total),
  paid_at_correction numeric not null check (paid_at_correction >= 0 and paid_at_correction <= new_total),
  journal_id uuid not null unique references public.journal_entries(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check ((jenis = 'HUTANG' and purchase_invoice_id is not null and sales_invoice_id is null)
      or (jenis = 'PIUTANG' and sales_invoice_id is not null and purchase_invoice_id is null))
);
create index opening_invoice_corrections_line_idx on public.opening_invoice_corrections(line_id, created_at);
alter table public.opening_invoice_corrections enable row level security;
revoke all on public.opening_invoice_corrections from public, anon, authenticated, service_role;
grant select on public.opening_invoice_corrections to authenticated;
create policy opening_invoice_correction_read on public.opening_invoice_corrections for select to authenticated using (
  exists(select 1 from public.opening_invoice_batches b where b.id = batch_id));

create table public.opening_invoice_correction_requests (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_key text not null check (length(request_key) between 1 and 120),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, request_key)
);
alter table public.opening_invoice_correction_requests enable row level security;
revoke all on public.opening_invoice_correction_requests from public, anon, authenticated, service_role;

-- Penjaga faktur saldo awal: sama seperti sebelumnya, ditambah satu jalur resmi — selama
-- correct_opening_invoice berjalan (setelan transaksi = id faktur) hanya total/status/revision boleh berubah.
create or replace function public.guard_opening_invoice() returns trigger
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
 if current_user not in ('authenticated','anon','service_role')
  and current_setting('vetos.opening_invoice_correction',true) = old.id::text
  and new.opening_batch_id is not distinct from old.opening_batch_id
  and (to_jsonb(new)-'status'-'revision'-'total') is not distinct from (to_jsonb(old)-'status'-'revision'-'total')
  and coalesce(to_jsonb(new)->>'status','') <> 'batal' then
  return new;
 end if;
 if current_user in ('authenticated','anon','service_role') or new.opening_batch_id is distinct from old.opening_batch_id
  or (to_jsonb(new)-'status'-'revision') is distinct from (to_jsonb(old)-'status'-'revision')
  or coalesce(to_jsonb(new)->>'status','')='batal' then
  raise exception 'Faktur saldo awal hanya berubah lewat pembayaran, penerimaan, atau Koreksi Saldo Awal per Faktur (Owner)' using errcode='42501';
 end if;
 return new;
end$$;
revoke all on function public.guard_opening_invoice() from public,anon,authenticated,service_role;

-- Yang sudah dibayar/diterima atas satu faktur saldo awal, dengan rumus yang sama dengan alur bayar:
-- hutang = jumlah semua baris purchase_invoice_payments (pembatalan dicatat sebagai baris negatif);
-- piutang = carried_paid + returned_ar + jumlah sales_receipts.
create function public.opening_invoice_paid(p_jenis text, p_invoice_id uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select case p_jenis
  when 'HUTANG' then (select coalesce(sum(amount),0) from public.purchase_invoice_payments where invoice_id=p_invoice_id)
  when 'PIUTANG' then (select si.carried_paid+si.returned_ar+coalesce((select sum(jumlah) from public.sales_receipts where invoice_id=si.id),0)
                         from public.sales_invoices si where si.id=p_invoice_id)
 end
$$;
revoke all on function public.opening_invoice_paid(text,uuid) from public,anon,authenticated,service_role;

-- Daftar faktur saldo awal untuk layar koreksi (OWNER/ADMIN/FINANCE dapat melihat; hanya OWNER mengoreksi).
create function public.opening_invoice_correction_rows() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype;v_closed date;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if not found or actor.role not in ('OWNER','ADMIN','FINANCE') then raise exception 'Akses saldo awal ditolak' using errcode='42501';end if;
 select closed_until into v_closed from public.accounting_locks where id;
 return coalesce((select jsonb_agg(x order by x->>'jenis', x->>'no_faktur') from (
  select jsonb_build_object(
   'line_id',l.id,'jenis',l.jenis,'batch_id',b.id,'as_of',b.as_of,
   'invoice_id',coalesce(l.purchase_invoice_id,l.sales_invoice_id),
   'no_faktur',coalesce(pi.no_faktur,si.no_faktur),'no_asal',l.source_no,
   'pihak',coalesce(sp.nama::text,cu.name::text,l.party_name),
   'total',coalesce(pi.total,si.total),
   'dibayar',public.opening_invoice_paid(l.jenis,coalesce(l.purchase_invoice_id,l.sales_invoice_id)),
   'batal',(pi.voided_at is not null or si.status='batal'),
   'periode_tutup',(v_closed is not null and b.as_of<=v_closed),
   'jumlah_koreksi',(select count(*) from public.opening_invoice_corrections c where c.line_id=l.id)) x
  from public.opening_invoice_lines l
  join public.opening_invoice_batches b on b.id=l.batch_id
  left join public.purchase_invoices pi on pi.id=l.purchase_invoice_id
  left join public.sales_invoices si on si.id=l.sales_invoice_id
  left join public.suppliers sp on sp.id=l.supplier_id
  left join public.customers cu on cu.id=l.customer_id
  where public.user_can_access_branch(b.branch_id)) t),'[]'::jsonb);
end$$;
revoke all on function public.opening_invoice_correction_rows() from public,anon,authenticated,service_role;
grant execute on function public.opening_invoice_correction_rows() to authenticated;

create function public.correct_opening_invoice(
 p_line_id uuid, p_expected_total numeric, p_new_total numeric, p_reason text, p_request_key text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 actor public.profiles%rowtype;prior public.opening_invoice_correction_requests%rowtype;
 line public.opening_invoice_lines%rowtype;batch public.opening_invoice_batches%rowtype;
 pinv public.purchase_invoices%rowtype;sinv public.sales_invoices%rowtype;
 payload jsonb;v_result jsonb;v_invoice uuid;v_no text;v_old numeric;v_paid numeric;v_delta numeric;v_abs numeric;
 v_closed date;v_lines jsonb;v_journal uuid;v_id uuid:=gen_random_uuid();v_reason text:=btrim(coalesce(p_reason,''));
 v_fmt_old text;v_fmt_new text;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active for share;
 if not found or actor.role<>'OWNER' then raise exception 'Hanya OWNER aktif yang dapat mengoreksi saldo awal per faktur' using errcode='42501';end if;
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 then raise exception 'Identitas permintaan tidak valid. Muat ulang halaman' using errcode='22023';end if;
 payload:=jsonb_build_object('line_id',p_line_id,'expected_total',p_expected_total,'new_total',p_new_total,'reason',v_reason);
 perform pg_advisory_xact_lock(hashtextextended('vetos:opening-invoice-correction:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.opening_invoice_correction_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas permintaan dipakai untuk isian berbeda. Muat ulang halaman' using errcode='22023';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;

 if length(v_reason) not between 10 and 1000 then raise exception 'Isi alasan koreksi 10 sampai 1.000 karakter' using errcode='22023';end if;
 if p_new_total is null or p_new_total<=0 or p_new_total<>round(p_new_total) or p_new_total>9999999999999 then
  raise exception 'Nilai baru harus rupiah bulat lebih dari 0' using errcode='22023';end if;
 if p_expected_total is null then raise exception 'Nilai lama belum terbaca. Muat ulang halaman' using errcode='22023';end if;

 -- Sama dengan impor: satu pengubah saldo awal per faktur pada satu waktu.
 perform pg_advisory_xact_lock(hashtextextended('vetos:opening-invoices',0));
 select * into line from public.opening_invoice_lines where id=p_line_id;
 if not found then raise exception 'Faktur saldo awal tidak ditemukan' using errcode='22023';end if;
 select * into batch from public.opening_invoice_batches where id=line.batch_id for update;
 if not public.user_can_access_branch(batch.branch_id) then raise exception 'Cabang faktur tidak dapat diakses' using errcode='42501';end if;

 if line.jenis='HUTANG' then
  select * into pinv from public.purchase_invoices where id=line.purchase_invoice_id for update;
  if not found or pinv.opening_batch_id is distinct from batch.id then raise exception 'Faktur saldo awal tidak cocok dengan batch impor';end if;
  if pinv.voided_at is not null then raise exception 'Faktur % sudah dibatalkan; tidak dapat dikoreksi',pinv.no_faktur using errcode='22023';end if;
  if exists(select 1 from public.purchase_invoices where replaces_invoice_id=pinv.id) then raise exception 'Faktur % sudah diganti faktur lain',pinv.no_faktur using errcode='22023';end if;
  v_invoice:=pinv.id;v_no:=pinv.no_faktur;v_old:=pinv.total;
 else
  select * into sinv from public.sales_invoices where id=line.sales_invoice_id for update;
  if not found or sinv.opening_batch_id is distinct from batch.id then raise exception 'Faktur saldo awal tidak cocok dengan batch impor';end if;
  if sinv.status='batal' then raise exception 'Faktur % sudah dibatalkan; tidak dapat dikoreksi',sinv.no_faktur using errcode='22023';end if;
  if exists(select 1 from public.sales_invoices where replaces_invoice_id=sinv.id) then raise exception 'Faktur % sudah diganti faktur lain',sinv.no_faktur using errcode='22023';end if;
  v_invoice:=sinv.id;v_no:=sinv.no_faktur;v_old:=sinv.total;
 end if;
 select * into line from public.opening_invoice_lines where id=p_line_id for update;

 if v_old<>p_expected_total then
  raise exception 'Nilai faktur % sudah berubah menjadi % sejak halaman dibuka. Muat ulang lalu periksa lagi',v_no,replace(to_char(v_old,'FM999,999,999,999,990'),',','.') using errcode='22023';end if;
 if p_new_total=v_old then raise exception 'Nilai baru sama dengan nilai sekarang' using errcode='22023';end if;
 v_paid:=public.opening_invoice_paid(line.jenis,v_invoice);
 if p_new_total<v_paid then
  raise exception 'Nilai baru % lebih kecil dari yang sudah % (%). Batalkan dulu pembayarannya bila memang salah',
   replace(to_char(p_new_total,'FM999,999,999,999,990'),',','.'),case line.jenis when 'HUTANG' then 'dibayar' else 'diterima' end,replace(to_char(v_paid,'FM999,999,999,999,990'),',','.') using errcode='22023';end if;
 select closed_until into v_closed from public.accounting_locks where id;
 if v_closed is not null and batch.as_of<=v_closed then
  raise exception 'Periode sampai % sudah ditutup; saldo awal tanggal % tidak dapat dikoreksi',to_char(v_closed,'DD-MM-YYYY'),to_char(batch.as_of,'DD-MM-YYYY') using errcode='22023';end if;

 v_delta:=p_new_total-v_old;v_abs:=abs(v_delta);
 v_lines:=case
  when line.jenis='HUTANG' and v_delta>0 then jsonb_build_array(jsonb_build_object('code','410001','debit',v_abs,'credit',0),jsonb_build_object('code','311001','debit',0,'credit',v_abs))
  when line.jenis='HUTANG' then jsonb_build_array(jsonb_build_object('code','311001','debit',v_abs,'credit',0),jsonb_build_object('code','410001','debit',0,'credit',v_abs))
  when v_delta>0 then jsonb_build_array(jsonb_build_object('code','150001','debit',v_abs,'credit',0),jsonb_build_object('code','410001','debit',0,'credit',v_abs))
  else jsonb_build_array(jsonb_build_object('code','410001','debit',v_abs,'credit',0),jsonb_build_object('code','150001','debit',0,'credit',v_abs)) end;
 v_fmt_old:=replace(to_char(v_old,'FM999,999,999,999,990'),',','.');
 v_fmt_new:=replace(to_char(p_new_total,'FM999,999,999,999,990'),',','.');
 v_journal:=public.clinic_write_journal(batch.as_of,left('Koreksi saldo awal '||v_no||' ('||line.source_no||'): '||v_fmt_old||' → '||v_fmt_new,500),
  'opening-invoice',v_id::text,batch.branch_id,v_lines);
 if v_journal is null then raise exception 'Jurnal koreksi belum tersimpan';end if;

 perform set_config('vetos.opening_invoice_correction',v_invoice::text,true);
 if line.jenis='HUTANG' then
  update public.purchase_invoices set total=p_new_total where id=v_invoice;
 else
  update public.sales_invoices set total=p_new_total,status=case when v_paid>=p_new_total then 'lunas' else 'berjalan' end,
   revision=revision+1 where id=v_invoice;
 end if;
 perform set_config('vetos.opening_invoice_correction','',true);

 update public.opening_invoice_lines set outstanding=p_new_total,
  original_total=case when original_total is null then null when original_total=v_old or original_total<p_new_total then p_new_total else original_total end,
  keterangan=left(concat_ws(' · ',nullif(keterangan,''),'Koreksi '||to_char((now() at time zone 'Asia/Jakarta')::date,'DD-MM-YYYY')||': '||v_fmt_old||' → '||v_fmt_new),1000)
  where id=line.id;
 if line.jenis='HUTANG' then
  update public.opening_invoice_batches set ap_total=ap_total+v_delta,
   result=case when result ? 'hutang' then jsonb_set(result,'{hutang,total}',to_jsonb((result#>>'{hutang,total}')::numeric+v_delta)) else result end
   where id=batch.id;
 else
  update public.opening_invoice_batches set ar_total=ar_total+v_delta,
   result=case when result ? 'piutang' then jsonb_set(result,'{piutang,total}',to_jsonb((result#>>'{piutang,total}')::numeric+v_delta)) else result end
   where id=batch.id;
 end if;

 insert into public.opening_invoice_corrections(id,line_id,batch_id,jenis,purchase_invoice_id,sales_invoice_id,old_total,new_total,delta,paid_at_correction,journal_id,reason,created_by)
 values(v_id,line.id,batch.id,line.jenis,line.purchase_invoice_id,line.sales_invoice_id,v_old,p_new_total,v_delta,v_paid,v_journal,v_reason,auth.uid());

 v_result:=jsonb_build_object('correction_id',v_id,'journal_id',v_journal,'no_jurnal',(select no_jurnal from public.journal_entries where id=v_journal),
  'no_faktur',v_no,'jenis',line.jenis,'old_total',v_old,'new_total',p_new_total,'delta',v_delta,'dibayar',v_paid,'sisa',p_new_total-v_paid);
 insert into public.opening_invoice_correction_requests(actor_id,request_key,payload,result) values(auth.uid(),p_request_key,payload,v_result);
 return v_result||jsonb_build_object('replayed',false);
end$$;
revoke all on function public.correct_opening_invoice(uuid,numeric,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_opening_invoice(uuid,numeric,numeric,text,text) to authenticated;
