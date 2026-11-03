-- J02 lanjutan (permintaan pemilik toko, 2 Nov 2026: "edit pembayaran, ada yang salah-salah
-- metodenya"). Koreksi metode penjualan POS selama ini hanya bisa memindah uang antara
-- Tunai dan Transfer. Di toko, salah pilih yang nyata adalah Tunai / QRIS / Debit
-- (7 hari terakhir: Tunai 347, QRIS 220, Debit 69, Transfer 10 struk) — koreksi lama tidak
-- bisa dipakai sama sekali untuk itu (belum pernah ada satu koreksi pun tercatat).
--
-- Fungsi baru correct_pos_sale_payment_methods menerima pembagian baru ke SEMUA metode
-- kasir (Tunai, Transfer, Debit, Kredit, QRIS, E-Wallet). Aturannya sama dengan koreksi
-- Tunai<->Transfer yang sudah berjalan (OWNER/FINANCE, juga sesudah shift ditutup, jurnal
-- pembalik + pengganti bertanggal hari koreksi, jejak di sale_payment_corrections, idempoten
-- per request key), dengan perluasan:
--
-- * Yang bisa dibagi ulang = semua bagian pembayaran TANPA fee merchant. Bagian yang kena
--   fee merchant (fee dibayar pelanggan) tetap utuh — mengubahnya mengubah total tagihan.
--   Metode baru tidak boleh sama dengan metode bagian ber-fee yang tetap.
-- * Bagian baru selalu tanpa fee; total tagihan, fee merchant, pendapatan, PPN, diskon,
--   barang dan stok tidak berubah. Hanya akun kas/bank per metode yang dijurnal ulang.
-- * Beberapa metode boleh dipetakan ke rekening yang sama (QRIS, Debit, Transfer semuanya
--   ke bank yang sama di Production). Koreksi antar metode serekening tetap dicatat
--   (pembalik + pengganti) supaya laporan per metode dan jejaknya konsisten.
-- * Bayar/kembali mengikuti aturan J02_KEMBALIAN: masih ada bagian Tunai -> tetap;
--   tidak ada Tunai -> kembali 0, bayar = total.
--
-- Fungsi lama correct_pos_sale_payment(…numeric,numeric) TIDAK diubah atau dihapus (aplikasi
-- versi lama yang masih terbuka tetap bekerja). Kedua fungsi memakai gerbang, jejak dan
-- penjaga header yang sama, sehingga riwayat koreksi dari keduanya saling menyambung.
create or replace function public.correct_pos_sale_payment_methods(
 p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text,p_payments jsonb
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid();s public.sales%rowtype;posting public.pos_sale_postings%rowtype;
 prior public.sale_payment_correction_requests%rowtype;last_change public.sale_payment_corrections%rowtype;
 source_journal public.journal_entries%rowtype;rec record;
 payload jsonb;result jsonb;before_payments jsonb;after_payments jsonb;plan_before jsonb;plan_after jsonb;
 new_parts jsonb;old_movable jsonb;expected_lines jsonb;actual_lines jsonb;nonpayment_lines jsonb;
 involved text[]:='{}';v_code text;source_count integer;pool numeric;new_total numeric;new_cash numeric;
 closed date;source_date date;today date:=(now() at time zone 'Asia/Jakarta')::date;shift_status text;
 audit uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();replacement uuid:=gen_random_uuid();
 methods constant text[]:=array['Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet'];
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
  or p_payments is null or jsonb_typeof(p_payments)<>'array' or jsonb_array_length(p_payments) not between 1 and 6 then
  raise exception 'Identitas, alasan atau rincian koreksi tidak valid' using errcode='22023';end if;
 -- Rincian baru: metode kasir yang dikenal, unik, nominal positif dua desimal.
 for rec in select e from jsonb_array_elements(p_payments) e loop
  if jsonb_typeof(rec.e)<>'object' or (select count(*) from jsonb_object_keys(rec.e))<>2
   or jsonb_typeof(rec.e->'method')<>'string' or jsonb_typeof(rec.e->'amount')<>'number'
   or not ((rec.e->>'method')=any(methods)) then
   raise exception 'Rincian koreksi tidak valid: metode tidak dikenal' using errcode='22023';end if;
  if (rec.e->>'amount')::numeric<=0 or (rec.e->>'amount')::numeric>1000000000000
   or (rec.e->>'amount')::numeric<>round((rec.e->>'amount')::numeric,2) then
   raise exception 'Rincian koreksi tidak valid: nominal harus positif' using errcode='22023';end if;
 end loop;
 if (select count(distinct e->>'method') from jsonb_array_elements(p_payments) e)<>jsonb_array_length(p_payments) then
  raise exception 'Rincian koreksi tidak valid: metode ganda' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('method',e->>'method','amount',(e->>'amount')::numeric) order by e->>'method')
  into new_parts from jsonb_array_elements(p_payments) e;
 select sum((e->>'amount')::numeric),coalesce(sum((e->>'amount')::numeric) filter(where e->>'method'='Tunai'),0)
  into new_total,new_cash from jsonb_array_elements(new_parts) e;

 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan';end if;
 perform 1 from public.profiles where id=actor and is_active and role in('OWNER','FINANCE') for share;
 if not found then raise exception 'Hanya Owner atau Finance aktif dapat mengoreksi metode pembayaran' using errcode='42501';end if;
 if not public.user_can_access_branch(s.branch_id) then
  raise exception 'Dokumen penjualan tidak ditemukan atau tidak dapat diakses.' using errcode='42501';end if;
 perform 1 from public.branches where id=s.branch_id and is_active for share;
 if not found then raise exception 'Cabang sumber tidak aktif' using errcode='42501';end if;
 payload:=jsonb_build_object('sale_id',p_sale_id,'revision',p_expected_revision,'reason',btrim(p_reason),'payments',new_parts);
 perform pg_advisory_xact_lock(hashtextextended('vetos:pos-payment-correction:'||actor::text||':'||p_request_key,0));
 select * into prior from public.sale_payment_correction_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas simpan sudah dipakai untuk rincian berbeda';end if;
  if prior.sale_id is distinct from s.id then raise exception 'Identitas simpan bukan milik penjualan ini';end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang sebelum koreksi';end if;
 if s.channel is not null or s.voided_at is not null or s.payment_plan is null or s.payments_finalized_at is null
  or s.total<=0 then
  raise exception 'Sumber POS belum memenuhi syarat koreksi metode; sumber legacy memerlukan rekonsiliasi';end if;
 if exists(select 1 from public.sales_returns where sale_id=s.id)
  or exists(select 1 from public.sale_payment_refunds r join public.sale_payments p on p.id=r.sale_payment_id where p.sale_id=s.id)
  or exists(select 1 from public.sales_refund_requests where sale_id=s.id) then
  raise exception 'Penjualan sudah memiliki retur atau permintaan refund; rekonsiliasi sumber diperlukan';end if;
 source_date:=(s.created_at at time zone 'Asia/Jakarta')::date;
 select closed_until into closed from public.accounting_locks where id for share;
 if source_date>today or (closed is not null and (source_date<=closed or today<=closed)) then
  raise exception 'Periode sumber atau koreksi telah ditutup atau tanggal sumber tidak valid';end if;
 -- Shift ditutup tidak dibuka ulang; angka penutupannya tidak disentuh (sama dengan J02_AFTER_SHIFT).
 if s.shift_id is not null then
  select status into shift_status from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id for update;
  if not found then raise exception 'Shift kasir sumber tidak ditemukan; rekonsiliasi shift diperlukan';end if;
 end if;
 select * into posting from public.pos_sale_postings where sale_id=s.id for update;
 if not found or posting.revenue_journal_id is null then raise exception 'Jurnal sumber penjualan belum lengkap';end if;
 select * into last_change from public.sale_payment_corrections where sale_id=s.id order by revision desc limit 1 for update;
 if found and last_change.revision<>s.revision then raise exception 'Jejak koreksi dan revisi penjualan tidak cocok';end if;
 if not found and s.revision<>0 then raise exception 'Revisi sumber tanpa jejak koreksi memerlukan rekonsiliasi';end if;
 select * into source_journal from public.journal_entries where id=coalesce(last_change.replacement_journal_id,posting.revenue_journal_id) for share;
 if not found or source_journal.branch_id is distinct from s.branch_id or source_journal.voided_at is not null
  or (last_change.id is null and (source_journal.source<>'sale' or source_journal.source_ref is distinct from s.no_struk))
  or (last_change.id is not null and (source_journal.source<>'sale-payment-repost' or source_journal.source_ref is distinct from last_change.id::text)) then
  raise exception 'Jurnal aktif penjualan tidak sesuai sumber';end if;

 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb) into before_payments
  from public.sale_payments p where p.sale_id=s.id;
 select count(*),coalesce(sum(amount) filter(where fee_amount=0 and fee_percent=0),0)
  into source_count,pool from public.sale_payments where sale_id=s.id;
 if source_count<>jsonb_array_length(s.payment_plan) or source_count not between 1 and 6
  or (select coalesce(sum(amount),0) from public.sale_payments where sale_id=s.id)<>s.total
  or (select coalesce(sum(fee_amount),0) from public.sale_payments where sale_id=s.id)<>s.merchant_fee_total then
  raise exception 'Alokasi sumber tidak lengkap atau total berbeda';end if;
 select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount,
   'fee_percent',coalesce(x.fee_percent,0),'fee_amount',coalesce(x.fee_amount,0)) order by x.method),'[]'::jsonb)
  into plan_before from jsonb_to_recordset(s.payment_plan) x(method text,amount numeric,fee_percent numeric,fee_amount numeric);
 if plan_before is distinct from (select coalesce(jsonb_agg(jsonb_build_object('method',method,'amount',amount,
   'fee_percent',fee_percent,'fee_amount',fee_amount) order by method),'[]'::jsonb) from public.sale_payments where sale_id=s.id) then
  raise exception 'Rencana pembayaran dan alokasi tersimpan berbeda';end if;
 if pool<=0 then raise exception 'Semua pembayaran penjualan ini memakai fee merchant; koreksinya perlu rekonsiliasi terpisah';end if;
 if new_total<>pool then
  raise exception 'Jumlah rincian baru harus sama dengan total yang dibagi ulang (%)',pool using errcode='22023';end if;
 if exists(select 1 from public.sale_payments p where p.sale_id=s.id and (p.fee_amount<>0 or p.fee_percent<>0)
  and p.method in(select e->>'method' from jsonb_array_elements(new_parts) e)) then
  raise exception 'Metode yang memakai fee merchant tidak bisa dipakai lagi pada pembagian baru' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('method',method,'amount',amount) order by method),'[]'::jsonb) into old_movable
  from public.sale_payments where sale_id=s.id and fee_amount=0 and fee_percent=0;
 if old_movable=new_parts then raise exception 'Koreksi tidak mengubah metode pembayaran';end if;

 -- Setiap metode lama yang dibagi ulang dan metode baru wajib punya rekening yang jelas.
 for rec in select distinct m from(
   select method m from public.sale_payments where sale_id=s.id and fee_amount=0 and fee_percent=0
   union select e->>'method' from jsonb_array_elements(new_parts) e) z loop
  v_code:=public.unit_posting_cash(rec.m,s.branch_id);
  if v_code is null then raise exception 'Peta akun metode % belum lengkap',rec.m;end if;
  if (select count(*) from public.cash_accounts where coa_code=v_code and is_active
   and (branch_id is null or branch_id=s.branch_id))<>1 then
   raise exception 'Rekening metode % tidak unik atau tidak aktif',rec.m;end if;
  perform 1 from public.coa_accounts c where c.code=v_code and is_active and not is_header
   and type='ASET' and normal_balance='D' for share;
  if not found then raise exception 'Akun metode % bukan aset detail aktif',rec.m;end if;
  involved:=array_append(involved,v_code);
 end loop;
 for rec in select * from public.sale_payments where sale_id=s.id and fee_amount=0 and fee_percent=0 order by method,id for share loop
  v_code:=public.unit_posting_cash(rec.method,s.branch_id);
  if rec.coa_code is distinct from v_code
   or (rec.account_snapshot->>'code') is distinct from rec.coa_code
   or (rec.account_snapshot->>'cash_account_id') is distinct from
     (select a.id::text from public.cash_accounts a where a.coa_code=v_code and a.is_active
      and (a.branch_id is null or a.branch_id=s.branch_id)) then
   raise exception 'Akun sumber berubah dari peta rekening; cocokkan sebelum koreksi';end if;
 end loop;
 -- Serializes the as-of ledger snapshot with bank reconciliation and other corrections.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=source_date
   and (c.id is null or c.code=any(involved))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening sumber atau tujuan; koreksi rekonsiliasi dahulu';end if;
 -- Jurnal aktif = baris non-kas sumber + satu debit per alokasi efektif; tidak ada baris lain.
 select coalesce(jsonb_agg(jsonb_build_object('code',x.code,'debit',x.debit,'credit',x.credit)
  order by x.code,x.debit,x.credit),'[]'::jsonb) into nonpayment_lines
 from jsonb_to_recordset(posting.expected_lines) x(code text,debit numeric,credit numeric)
 join public.coa_accounts a on a.code=x.code where a.type<>'ASET';
 select coalesce(jsonb_agg(jsonb_build_object('code',z.code,'debit',z.debit,'credit',z.credit)
  order by z.code,z.debit,z.credit),'[]'::jsonb) into expected_lines from(
   select x.code,x.debit,x.credit from jsonb_to_recordset(nonpayment_lines) x(code text,debit numeric,credit numeric)
   union all select p.coa_code,p.amount,0::numeric from public.sale_payments p where p.sale_id=s.id
  ) z;
 select coalesce(jsonb_agg(jsonb_build_object('code',a.code,'debit',l.debit,'credit',l.credit)
  order by a.code,l.debit,l.credit),'[]'::jsonb) into actual_lines
  from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=source_journal.id;
 if actual_lines is distinct from expected_lines or jsonb_array_length(nonpayment_lines)=0
  or (select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=source_journal.id)<>0
  or exists(select 1 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
   where l.entry_id=source_journal.id and (not a.is_active or a.is_header)) then
  raise exception 'Jurnal aktif tidak sama dengan alokasi dan pendapatan sumber';end if;

 -- Rencana baru: bagian ber-fee tetap + bagian baru tanpa fee. 'code' hanya untuk jurnal.
 select coalesce(jsonb_agg(jsonb_build_object('method',z.method,'amount',z.amount,
  'fee_percent',z.fee_percent,'fee_amount',z.fee_amount,'code',z.code) order by z.method),'[]'::jsonb) into plan_after from(
   select p.method,p.amount,p.fee_percent,p.fee_amount,p.coa_code code from public.sale_payments p
    where p.sale_id=s.id and (p.fee_amount<>0 or p.fee_percent<>0)
   union all select e->>'method',(e->>'amount')::numeric,0::numeric,0::numeric,
    public.unit_posting_cash(e->>'method',s.branch_id) from jsonb_array_elements(new_parts) e
  ) z;
 if jsonb_array_length(plan_after) not between 1 and 6 then raise exception 'Rincian hasil koreksi tidak valid';end if;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
  values(reversal,public.sales_next_number('JRN',today),today,'Pembalik metode pembayaran '||s.no_struk,
   'sale-payment-reversal',audit::text,s.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit)
  select reversal,account_id,credit,debit from public.journal_lines where entry_id=source_journal.id;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
  values(replacement,public.sales_next_number('JRN',today),today,'Metode pembayaran terkoreksi '||s.no_struk,
   'sale-payment-repost',audit::text,s.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit)
  select replacement,l.account_id,l.debit,l.credit from public.journal_lines l
   join public.coa_accounts a on a.id=l.account_id where l.entry_id=source_journal.id and a.type<>'ASET';
 insert into public.journal_lines(entry_id,account_id,debit,credit)
  select replacement,a.id,z.amount,0 from jsonb_to_recordset(plan_after) z(method text,amount numeric,code text)
   join public.coa_accounts a on a.code=z.code
   where a.is_active and not a.is_header and a.type='ASET' and a.normal_balance='D';
 if (select count(*) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  where l.entry_id=replacement and a.type='ASET' and l.debit>0)=jsonb_array_length(plan_after)
  and (select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=replacement)=0
  and (select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=reversal)=0 then null;
 else raise exception 'Jurnal pengganti atau pembalik tidak lengkap/seimbang';end if;

 insert into public.sale_payment_correction_gate(transaction_id,backend_pid,sale_id)
  values(txid_current(),pg_backend_pid(),s.id);
 delete from public.sale_payments where sale_id=s.id and fee_amount=0 and fee_percent=0;
 insert into public.sale_payments(sale_id,method,amount,fee_percent,fee_amount,coa_code,account_snapshot)
  select s.id,z.method,z.amount,0,0,a.code,
   jsonb_build_object('coa_id',a.id,'code',a.code,'name',a.name,'cash_account_id',ca.id,'cash_account_name',ca.nama)
  from jsonb_to_recordset(new_parts) z(method text,amount numeric)
  join public.coa_accounts a on a.code=public.unit_posting_cash(z.method,s.branch_id)
  join public.cash_accounts ca on ca.coa_code=a.code and ca.is_active and (ca.branch_id is null or ca.branch_id=s.branch_id);
 update public.sales set payment_plan=(select jsonb_agg(e-'code' order by e->>'method') from jsonb_array_elements(plan_after) e),
  metode_bayar=case when jsonb_array_length(plan_after)>1 then 'Split' else plan_after->0->>'method' end,
  revision=revision+1,
  -- J02_KEMBALIAN: tanpa uang tunai tidak ada kembalian; selisih bayar-kembali tetap = total.
  bayar=case when new_cash>0 then bayar else total end,
  kembali=case when new_cash>0 then kembali else 0 end where id=s.id;
 delete from public.sale_payment_correction_gate where transaction_id=txid_current()
  and backend_pid=pg_backend_pid() and sale_id=s.id;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb) into after_payments
  from public.sale_payments p where p.sale_id=s.id;
 if jsonb_array_length(after_payments)<>jsonb_array_length(plan_after)
  or (select coalesce(sum(amount),0) from public.sale_payments where sale_id=s.id)<>s.total
  or (select coalesce(sum(fee_amount),0) from public.sale_payments where sale_id=s.id)<>s.merchant_fee_total then
  raise exception 'Alokasi hasil koreksi tidak sama dengan sumber';end if;
 insert into public.sale_payment_corrections(id,sale_id,branch_id,revision,reason,before_sale,before_payments,
  after_payments,original_journal_id,reversal_journal_id,replacement_journal_id,created_by,source_shift_status)
  values(audit,s.id,s.branch_id,s.revision+1,btrim(p_reason),to_jsonb(s),before_payments,after_payments,
   source_journal.id,reversal,replacement,actor,shift_status);
 result:=jsonb_build_object('sale_id',s.id,'audit_id',audit,'revision',s.revision+1,
  'reversal_journal_id',reversal,'replacement_journal_id',replacement,'source_shift_status',shift_status);
 insert into public.sale_payment_correction_requests(actor_id,request_key,sale_id,payload,result)
  values(actor,p_request_key,s.id,payload,result);
 return result;
end $$;
revoke all on function public.correct_pos_sale_payment_methods(uuid,integer,text,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_pos_sale_payment_methods(uuid,integer,text,text,jsonb) to authenticated;
