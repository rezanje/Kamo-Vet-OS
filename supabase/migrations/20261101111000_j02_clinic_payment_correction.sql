-- J02 lanjutan (keputusan Owner 29 Okt): koreksi metode pembayaran invoice klinik
-- Tunai <-> Transfer oleh OWNER atau FINANCE, juga sesudah shift kasir ditutup.
--
-- Yang dikoreksi satu "bagian pembayaran" utuh:
--  * baris invoice_payments (bagian split saat checkout / pelunasan piutang), atau
--  * pembayaran langsung invoice (lunas sekali bayar, atau uang muka/DP) yang
--    tercatat di jurnal pendapatan 'klinik' (p_payment_id = null).
-- Nominal tidak berubah, tidak ada baris pembayaran / struk baru, baris split tetap
-- menempel pada invoice & checkout yang sama (id, invoice_id, checkout_payment,
-- request_key, request_hash tidak diubah supaya retry pelunasan lama tetap idempoten).
--
-- Akuntansi: satu jurnal koreksi bertanggal hari koreksi (WIB), source
-- 'klinik-koreksi-bayar', source_ref = nomor invoice:
--   Dr rekening metode baru (peta payment_account_map cabang, lalu global)
--   Cr rekening asal yang benar-benar didebit jurnal sumber.
-- Jurnal pendapatan/pelunasan asal tidak diubah. Shift kasir tidak dibuka ulang;
-- angka penutupan shift tidak disentuh (status shift dicatat di jejak koreksi).
-- Ditolak bila: tanggal sumber atau tanggal koreksi di periode tertutup, rekonsiliasi
-- bank mencakup rekening asal/tujuan sejak tanggal sumber, revisi basi, invoice
-- void/terbit ulang/pending koreksi, ada refund/permintaan refund aktif, bagian
-- pindahan (transferred_from), metode bukan Tunai/Transfer, peta akun belum lengkap,
-- atau saldo kas/bank invoice di buku besar tidak cocok dengan pembayaran tercatat.

create table public.clinic_payment_corrections (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id) on delete restrict,
 invoice_payment_id uuid references public.invoice_payments(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 revision integer not null check(revision>0),
 amount numeric(15,2) not null check(amount>0),
 from_method text not null check(from_method in('Tunai','Transfer')),
 to_method text not null check(to_method in('Tunai','Transfer')),
 from_code text not null,
 to_code text not null,
 reason text not null,
 source_shift_id uuid,
 source_shift_status text,
 before_snapshot jsonb not null,
 after_snapshot jsonb not null,
 journal_id uuid not null unique references public.journal_entries(id) on delete restrict,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 unique(invoice_id,revision),
 check(from_method<>to_method and from_code<>to_code)
);
create index clinic_payment_corrections_invoice_idx on public.clinic_payment_corrections(invoice_id,revision desc);
alter table public.clinic_payment_corrections enable row level security;
revoke all on public.clinic_payment_corrections from public,anon,authenticated,service_role;
grant select on public.clinic_payment_corrections to authenticated;
create policy clinic_payment_corrections_finance_read on public.clinic_payment_corrections for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in('OWNER','FINANCE'))
 and public.user_can_access_branch(branch_id)
);

create table public.clinic_payment_correction_requests (
 actor_id uuid not null references public.profiles(id) on delete restrict,
 request_key text not null,
 invoice_id uuid not null references public.invoices(id) on delete restrict,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_key)
);
alter table public.clinic_payment_correction_requests enable row level security;
revoke all on public.clinic_payment_correction_requests from public,anon,authenticated,service_role;

-- Void/terbit ulang/edit invoice membaca rekening kas dari jurnal sumber 'klinik'.
-- Setelah koreksi, jalur itu akan memindahkan kas ke rekening lama. Fail closed
-- sampai jalur pembatalan merekonsiliasi rantai koreksi (pola sama dengan POS).
create function public.guard_clinic_payment_corrected_invoice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.clinic_payment_corrections where invoice_id=old.id) and (
  new.voided_at is distinct from old.voided_at or new.visit_id is distinct from old.visit_id
  or new.invoice_no is distinct from old.invoice_no or new.subtotal is distinct from old.subtotal
  or new.discount is distinct from old.discount or new.tax is distinct from old.tax
  or new.total is distinct from old.total or new.dp_amount is distinct from old.dp_amount
  or new.reissued_from is distinct from old.reissued_from
  or new.correction_pending is distinct from old.correction_pending) then
  raise exception using errcode='P0001',
   message='PAYMENT_CORRECTED: invoice dengan koreksi metode pembayaran perlu rekonsiliasi sebelum dikoreksi atau dibatalkan';
 end if;
 return new;
end $$;
revoke all on function public.guard_clinic_payment_corrected_invoice() from public,anon,authenticated,service_role;
create trigger clinic_payment_corrected_invoice_guard before update on public.invoices for each row
 execute function public.guard_clinic_payment_corrected_invoice();

create function public.correct_clinic_invoice_payment(
 p_invoice_id uuid,p_payment_id uuid,p_expected_revision integer,p_request_key text,p_reason text,p_new_method text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid();vis public.visits%rowtype;inv public.invoices%rowtype;pay public.invoice_payments%rowtype;
 prior public.clinic_payment_correction_requests%rowtype;last_direct public.clinic_payment_corrections%rowtype;
 to_account public.cash_accounts%rowtype;
 payload jsonb;result jsonb;before_snapshot jsonb;after_snapshot jsonb;
 current_revision integer;amount numeric;old_method text;from_code text;to_code text;
 direct numeric:=0;direct_code text;direct_debit numeric;line_count integer;journal_count integer;
 source_date date;closed date;today date:=(now() at time zone 'Asia/Jakarta')::date;
 shift_status text;ledger numeric;expected numeric;journal uuid;audit uuid:=gen_random_uuid();
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_invoice_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
  or p_new_method is null or p_new_method not in('Tunai','Transfer') then
  raise exception 'Identitas, alasan atau metode koreksi tidak valid' using errcode='22023';end if;

 -- Visit lalu invoice: urutan kunci sama dengan posting, pelunasan dan void/reissue.
 select v.* into vis from public.visits v join public.invoices x on x.visit_id=v.id where x.id=p_invoice_id;
 if not found then raise exception 'Invoice tidak ditemukan' using errcode='42501';end if;
 perform 1 from public.visits where id=vis.id for update;
 select * into inv from public.invoices where id=p_invoice_id for update;
 perform 1 from public.profiles where id=actor and is_active and role in('OWNER','FINANCE') for share;
 if not found then raise exception 'Hanya Owner atau Finance aktif dapat mengoreksi metode pembayaran' using errcode='42501';end if;
 if not public.user_can_access_branch(vis.branch_id) then raise exception 'Invoice tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
 perform 1 from public.branches where id=vis.branch_id and is_active for share;
 if not found then raise exception 'Cabang sumber tidak aktif' using errcode='42501';end if;

 payload:=jsonb_build_object('invoice_id',p_invoice_id,'payment_id',p_payment_id,'revision',p_expected_revision,
  'reason',btrim(p_reason),'method',p_new_method);
 perform pg_advisory_xact_lock(hashtextextended('vetos:clinic-payment-correction:'||actor::text||':'||p_request_key,0));
 select * into prior from public.clinic_payment_correction_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas simpan sudah dipakai untuk rincian berbeda';end if;
  return prior.result;
 end if;

 select count(*) into current_revision from public.clinic_payment_corrections where invoice_id=inv.id;
 if current_revision<>p_expected_revision then raise exception 'Invoice sudah berubah. Muat ulang sebelum koreksi';end if;
 if inv.voided_at is not null or inv.request_key is null or inv.invoice_no is null or inv.correction_pending then
  raise exception 'Invoice belum memenuhi syarat koreksi metode; invoice batal, terbit ulang tertunda atau sumber legacy memerlukan rekonsiliasi';end if;
 if exists(select 1 from public.clinic_refunds where invoice_id=inv.id)
  or exists(select 1 from public.clinic_refund_requests where invoice_id=inv.id and status in('pending','diproses')) then
  raise exception 'Invoice sudah memiliki refund atau permintaan refund; rekonsiliasi sumber diperlukan';end if;

 -- Pembayaran langsung (lunas sekali bayar / DP) tercatat di jurnal 'klinik'.
 if inv.reissued_from is null then
  direct:=case when inv.paid_status='Lunas' and not exists(select 1 from public.invoice_payments where invoice_id=inv.id)
   then inv.total else coalesce(inv.dp_amount,0) end;
 end if;
 select count(*) into journal_count from public.journal_entries
  where source='klinik' and source_ref=inv.invoice_no and voided_at is null;
 if direct>0 then
  if journal_count<>1 then raise exception 'Jurnal pendapatan invoice tidak tunggal; rekonsiliasi diperlukan';end if;
  select * into last_direct from public.clinic_payment_corrections
   where invoice_id=inv.id and invoice_payment_id is null order by revision desc limit 1;
  if found then direct_code:=last_direct.to_code;
  else
   select count(*),min(a.code),min(l.debit) into line_count,direct_code,direct_debit
    from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
    join public.coa_accounts a on a.id=l.account_id
    where e.source='klinik' and e.source_ref=inv.invoice_no and e.voided_at is null
     and l.debit>0 and a.code not in('1201','4102');
   if line_count<>1 or direct_debit is distinct from direct then
    raise exception 'Rekening pembayaran awal invoice tidak ditemukan atau tidak tunggal';end if;
  end if;
 end if;

 if p_payment_id is null then
  if direct<=0 then raise exception 'Invoice ini tidak memiliki pembayaran langsung; pilih bagian pembayarannya';end if;
  amount:=direct;old_method:=inv.metode_bayar;from_code:=direct_code;
  select tanggal into source_date from public.journal_entries
   where source='klinik' and source_ref=inv.invoice_no and voided_at is null;
 else
  select * into pay from public.invoice_payments where id=p_payment_id and invoice_id=inv.id for update;
  if not found then raise exception 'Bagian pembayaran tidak ditemukan pada invoice ini';end if;
  if pay.transferred_from is not null or pay.kas_code is null or pay.amount is null or pay.amount<=0 then
   raise exception 'Bagian pembayaran pindahan atau tanpa rekening memerlukan rekonsiliasi';end if;
  amount:=pay.amount;old_method:=pay.metode;from_code:=pay.kas_code;source_date:=pay.tanggal;
 end if;
 if old_method is null or old_method not in('Tunai','Transfer') then
  raise exception 'Hanya pembayaran Tunai atau Transfer yang dapat dikoreksi';end if;
 if old_method=p_new_method then raise exception 'Koreksi tidak mengubah metode pembayaran';end if;
 if amount<>round(amount,2) then raise exception 'Nominal sumber tidak valid';end if;

 select closed_until into closed from public.accounting_locks where id for share;
 if source_date is null or source_date>today or (closed is not null and (source_date<=closed or today<=closed)) then
  raise exception 'Periode sumber atau koreksi telah ditutup atau tanggal sumber tidak valid';end if;

 -- Shift sumber hanya dikunci (serialisasi dengan tutup shift) dan dicatat; tidak dibuka ulang.
 if inv.shift_id is not null then
  select status into shift_status from public.cashier_shifts where id=inv.shift_id for update;
 end if;

 select ca.* into to_account from public.payment_account_map m join public.cash_accounts ca on ca.id=m.cash_account_id
  where m.metode=p_new_method and (m.branch_id=vis.branch_id or m.branch_id is null)
  order by m.branch_id nulls last limit 1;
 if not found or not to_account.is_active or (to_account.branch_id is not null and to_account.branch_id<>vis.branch_id) then
  raise exception 'Rekening % belum dipetakan atau tidak aktif untuk cabang ini',p_new_method;end if;
 to_code:=to_account.coa_code;
 if to_code is null or to_code=from_code then raise exception 'Rekening asal dan tujuan sama; periksa peta akun Tunai dan Transfer';end if;
 perform 1 from public.coa_accounts where code in(from_code,to_code) and is_active and not is_header
  and type='ASET' and normal_balance='D' for share;
 if (select count(*) from public.coa_accounts where code in(from_code,to_code) and is_active and not is_header
  and type='ASET' and normal_balance='D')<>2 then raise exception 'Akun asal/tujuan bukan aset detail aktif';end if;

 -- Serialisasi snapshot buku besar dengan rekonsiliasi bank dan koreksi lain.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=source_date
   and (c.id is null or c.code in(from_code,to_code))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening sumber atau tujuan; koreksi rekonsiliasi dahulu';end if;

 -- Saldo rekening asal milik invoice ini harus sama dengan pembayaran yang tercatat di rekening itu.
 select coalesce(sum(l.debit-l.credit),0) into ledger
  from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
  join public.coa_accounts a on a.id=l.account_id
  where e.source_ref=inv.invoice_no and e.voided_at is null and e.branch_id=vis.branch_id
   and e.source in('klinik','klinik-ar','klinik-edit','klinik-reissue','klinik-koreksi-bayar') and a.code=from_code;
 expected:=coalesce((select sum(p.amount) from public.invoice_payments p
   where p.invoice_id=inv.id and p.transferred_from is null and p.kas_code=from_code),0)
  +case when direct>0 and direct_code=from_code then direct else 0 end;
 if ledger<>expected or ledger<amount then
  raise exception 'Jurnal kas/bank invoice tidak cocok dengan pembayaran tercatat; rekonsiliasi diperlukan';end if;

 before_snapshot:=jsonb_build_object('invoice',to_jsonb(inv),'payment',case when p_payment_id is null then null else to_jsonb(pay) end,
  'method',old_method,'code',from_code,'amount',amount);
 journal:=public.clinic_write_journal(today,'Koreksi metode pembayaran '||inv.invoice_no||' ('||old_method||' ke '||p_new_method||')',
  'klinik-koreksi-bayar',inv.invoice_no,vis.branch_id,jsonb_build_array(
   jsonb_build_object('code',to_code,'debit',amount,'credit',0),
   jsonb_build_object('code',from_code,'debit',0,'credit',amount)));
 if journal is null or (select count(*) from public.journal_lines where entry_id=journal)<>2
  or (select coalesce(sum(debit-credit),0) from public.journal_lines where entry_id=journal)<>0 then
  raise exception 'Jurnal koreksi tidak lengkap atau tidak seimbang';end if;

 if p_payment_id is null then
  update public.invoices set metode_bayar=p_new_method where id=inv.id;
  after_snapshot:=jsonb_build_object('invoice',(select to_jsonb(x) from public.invoices x where x.id=inv.id),'payment',null,
   'method',p_new_method,'code',to_code,'amount',amount);
 else
  update public.invoice_payments set metode=p_new_method,kas_code=to_code where id=pay.id;
  after_snapshot:=jsonb_build_object('invoice',to_jsonb(inv),'payment',(select to_jsonb(x) from public.invoice_payments x where x.id=pay.id),
   'method',p_new_method,'code',to_code,'amount',amount);
 end if;

 insert into public.clinic_payment_corrections(id,invoice_id,invoice_payment_id,branch_id,revision,amount,from_method,to_method,
  from_code,to_code,reason,source_shift_id,source_shift_status,before_snapshot,after_snapshot,journal_id,created_by)
  values(audit,inv.id,p_payment_id,vis.branch_id,current_revision+1,amount,old_method,p_new_method,from_code,to_code,
   btrim(p_reason),inv.shift_id,shift_status,before_snapshot,after_snapshot,journal,actor);
 result:=jsonb_build_object('invoice_id',inv.id,'payment_id',p_payment_id,'audit_id',audit,'revision',current_revision+1,
  'journal_id',journal,'method',p_new_method,'amount',amount,'source_shift_status',shift_status);
 insert into public.clinic_payment_correction_requests(actor_id,request_key,invoice_id,payload,result)
  values(actor,p_request_key,inv.id,payload,result);
 return result;
end $$;
revoke all on function public.correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text) to authenticated;

-- Jurnal koreksi klinik sama tetapnya dengan jurnal koreksi POS: tidak dapat
-- dihapus, diubah atau dibatalkan lewat API biasa. Memperluas penanda yang dipakai
-- trigger pos_sale_protect_journal_header/lines yang sudah ada.
do $$ begin
 if to_regprocedure('public.pos_sale_journal_protected(uuid)') is null
  or to_regprocedure('public.pos_sale_protect_journal()') is null then
  raise exception 'J02_CLINIC_GUARD_SOURCE_CHANGED: review journal protection contract';end if;
end $$;
create or replace function public.pos_sale_journal_protected(p_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pos_sale_postings where revenue_journal_id=p_entry or hpp_journal_id=p_entry)
 or exists(select 1 from public.journal_entries e where e.id=p_entry and e.source in('sale','sale-hpp','sale-online','sale-online-hpp','sale-void','sale-void-hpp','sale-payment-reversal','sale-payment-repost','klinik-koreksi-bayar'))
 or exists(select 1 from public.sale_payment_corrections c where c.reversal_journal_id=p_entry or c.replacement_journal_id=p_entry)
 or exists(select 1 from public.clinic_payment_corrections c where c.journal_id=p_entry)
$$;
