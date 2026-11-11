-- Batalkan penerimaan — PENJUALAN PETSHOP (kasir/POS + marketplace), gaya Accurate.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Permintaan Andri (11 Nov 2026, grup): "bisa batalkan dengan gaya Accurate ... Owner dapat akses penuh untuk ubah2.
-- Jangan ada yang ngunci dan ga bisa melakukan action untuk akun owner." Gaya Accurate = hapus penerimaan -> uangnya hilang
-- dari bank/kas juga -> struk menjadi BELUM DIBAYAR -> ubah -> terima pembayaran lagi. Tidak ada saldo kredit.
--
-- Struk POS tidak punya status "belum dibayar": satu jurnal 'sale' = Dr kas/bank / Cr pendapatan. Rancangan ini:
--  * cancel_pos_sale_receipt: SATU transaksi. Jurnal 'sale-receipt-cancel' (Dr Piutang Usaha 150001 / Cr akun kas-bank tiap metode),
--    catatan pembatalan (tidak ada baris dihapus) berisi alasan/pelaku/waktu/kunci idempotensi/foto penerimaan lama, efek ke laci
--    shift (tabel sale_receipt_shift_effects). Stok, HPP, jurnal penjualan, poin, komisi TIDAK disentuh. Struk 'belum dibayar'
--    = ada catatan pembatalan yang belum ditutup (indeks unik parsial: satu per struk). Header struk tidak diubah.
--    Split (payment_plan) dibatalkan SEBAGAI SATU SET (semua bagian sekaligus), bukan per bagian.
--  * receive_pos_sale_payment: terima pembayaran lagi (semua metode, 1-6 bagian, jumlah = total struk). Jurnal 'sale-receipt-repost'
--    (Dr kas/bank / Cr Piutang Usaha). Bila rencana berubah, alokasi + metode ikut berubah lewat gerbang koreksi yang sudah ada.
--  * Mengubah ISI struk (harga, qty, barang, voucher) = jalur yang sudah ada: struk belum dibayar boleh dibatalkan (cancel_posted_sale
--    ditambal: shift tertutup tidak lagi menghalangi karena uangnya sudah dikembalikan; jurnal penerimaan ikut dibalik) lalu
--    "pengganti" lewat kasir yang memeriksa ulang lantai harga/HPP seperti biasa. Aturan di bawah HPP TIDAK dilonggarkan.
--  * cancel_online_disbursement: pencairan marketplace dibalik (Dr Piutang Marketplace / Cr bank + komisi), struk kembali 'piutang'.
--  * Shift: shift terbuka -> laci diperbaiki di shift itu; shift tertutup -> angka tutupnya TIDAK disentuh, koreksi dicatat di shift
--    terbuka cabang itu (dilaporkan), tunai tanpa shift terbuka ditolak dengan petunjuk jelas.
--  * Hak: OWNER aktif selalu (tanpa membaca kebijakan: tidak bisa terkunci); ADMIN/FINANCE hanya bila Owner mencentang tindakan
--    'penjualan.pos_penerimaan.batalkan' di Akses Grup (bawaan mati, gagal tertutup bila kebijakan tidak terbaca).
-- Tambalan fungsi berjalan memakai jangkar eksak dan gagal tertutup.

set local lock_timeout = '5s';

-- ───────────────────────── 1. Skema ─────────────────────────
create table public.pos_receipt_cancellations(
 id uuid primary key,
 sale_id uuid not null references public.sales(id),
 branch_id uuid not null references public.branches(id),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 before_sale jsonb not null,
 before_payments jsonb not null,
 reversal_journal_id uuid not null references public.journal_entries(id),
 source_shift_id uuid references public.cashier_shifts(id),
 source_shift_status text,
 effect_shift_id uuid references public.cashier_shifts(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 closed_at timestamptz,
 closed_by uuid references public.profiles(id),
 closed_kind text check(closed_kind in('diterima-ulang','penjualan-dibatalkan')),
 receive_journal_id uuid references public.journal_entries(id),
 after_payments jsonb,
 receive_effect_shift_id uuid references public.cashier_shifts(id),
 check((closed_at is null)=(closed_kind is null))
);
create unique index pos_receipt_cancellations_open_per_sale on public.pos_receipt_cancellations(sale_id) where closed_at is null;
create index pos_receipt_cancellations_sale on public.pos_receipt_cancellations(sale_id, created_at);
alter table public.pos_receipt_cancellations enable row level security;
revoke all on public.pos_receipt_cancellations from public,anon,authenticated,service_role;
grant select on public.pos_receipt_cancellations to authenticated;
create policy pos_receipt_cancellations_read on public.pos_receipt_cancellations for select to authenticated using(public.user_can_access_branch(branch_id));

create table public.sale_receipt_shift_effects(
 id uuid primary key default gen_random_uuid(),
 cancellation_id uuid not null references public.pos_receipt_cancellations(id),
 sale_id uuid not null references public.sales(id),
 shift_id uuid not null references public.cashier_shifts(id),
 method text not null check(method in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')),
 amount numeric(15,2) not null check(amount<>0),
 kind text not null check(kind in('batal','terima','void')),
 created_at timestamptz not null default now()
);
create index sale_receipt_shift_effects_shift on public.sale_receipt_shift_effects(shift_id);
create index sale_receipt_shift_effects_sale on public.sale_receipt_shift_effects(sale_id);
alter table public.sale_receipt_shift_effects enable row level security;
revoke all on public.sale_receipt_shift_effects from public,anon,authenticated,service_role;
grant select on public.sale_receipt_shift_effects to authenticated;
create policy sale_receipt_shift_effects_read on public.sale_receipt_shift_effects for select to authenticated
 using(exists(select 1 from public.cashier_shifts sh where sh.id=shift_id and public.user_can_access_branch(sh.branch_id)));

create table public.online_disbursement_cancellations(
 id uuid primary key,
 sale_id uuid not null references public.sales(id),
 branch_id uuid not null references public.branches(id),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 before_sale jsonb not null,
 disbursement_journal_id uuid not null references public.journal_entries(id),
 reversal_journal_id uuid not null references public.journal_entries(id),
 bank_code text not null,
 amount_bank numeric(15,2) not null check(amount_bank>=0),
 amount_fee numeric(15,2) not null check(amount_fee>=0),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index online_disbursement_cancellations_sale on public.online_disbursement_cancellations(sale_id);
alter table public.online_disbursement_cancellations enable row level security;
revoke all on public.online_disbursement_cancellations from public,anon,authenticated,service_role;
grant select on public.online_disbursement_cancellations to authenticated;
create policy online_disbursement_cancellations_read on public.online_disbursement_cancellations for select to authenticated using(public.user_can_access_branch(branch_id));

create table public.receipt_cancel_requests(
 actor_id uuid not null references public.profiles(id),
 request_key text not null,
 op text not null check(op in('cancel','receive','online')),
 sale_id uuid not null references public.sales(id),
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table public.receipt_cancel_requests enable row level security;
revoke all on public.receipt_cancel_requests from public,anon,authenticated,service_role;

-- Catatan tidak pernah dihapus/diubah selain penutupannya (diterima ulang / struk dibatalkan).
create function public.guard_receipt_cancel_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.closed_at is null
  and (to_jsonb(new)-array['closed_at','closed_by','closed_kind','receive_journal_id','after_payments','receive_effect_shift_id'])
   is not distinct from (to_jsonb(old)-array['closed_at','closed_by','closed_kind','receive_journal_id','after_payments','receive_effect_shift_id'])
  and new.closed_at is not null then return new; end if;
 raise exception 'Riwayat pembatalan penerimaan tidak dapat diubah atau dihapus';
end $$;
create function public.guard_receipt_history_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Riwayat pembatalan penerimaan tidak dapat diubah atau dihapus'; end $$;
create trigger guard_pos_receipt_cancel_history before update or delete on public.pos_receipt_cancellations for each row execute function public.guard_receipt_cancel_history();
create trigger guard_sale_receipt_effect_history before update or delete on public.sale_receipt_shift_effects for each row execute function public.guard_receipt_history_immutable();
create trigger guard_online_cancel_history before update or delete on public.online_disbursement_cancellations for each row execute function public.guard_receipt_history_immutable();
create trigger guard_receipt_cancel_request_history before update or delete on public.receipt_cancel_requests for each row execute function public.guard_receipt_history_immutable();
revoke all on function public.guard_receipt_cancel_history() from public,anon,authenticated,service_role;
revoke all on function public.guard_receipt_history_immutable() from public,anon,authenticated,service_role;

-- Struk yang penerimaannya dibatalkan tidak boleh diretur / dimintakan refund / dikoreksi metodenya sampai dibayar lagi.
create function public.guard_unpaid_pos_sale() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.pos_receipt_cancellations where sale_id=new.sale_id and closed_at is null) then
  if tg_table_name='sale_payment_corrections' then
   raise exception 'Penerimaan struk ini sedang dibatalkan. Terima pembayaran dulu; untuk mengganti metode bayar pakai Batalkan penerimaan lalu Terima pembayaran.' using errcode='55000';
  end if;
  raise exception 'Penerimaan struk ini sedang dibatalkan (belum dibayar). Terima pembayaran dulu sebelum membuat retur atau permintaan refund.' using errcode='55000';
 end if;
 return new;
end $$;
revoke all on function public.guard_unpaid_pos_sale() from public,anon,authenticated,service_role;
create trigger guard_unpaid_pos_sale before insert on public.sales_returns for each row execute function public.guard_unpaid_pos_sale();
create trigger guard_unpaid_pos_sale before insert on public.sales_refund_requests for each row execute function public.guard_unpaid_pos_sale();
create trigger guard_unpaid_pos_sale before insert on public.sale_payment_corrections for each row execute function public.guard_unpaid_pos_sale();

-- ───────────────────────── 2. Hak (Owner tidak pernah terkunci) ─────────────────────────
insert into role_settings_private.action_catalog(id,label,"group",enforced) values
 ('penjualan.pos_penerimaan.batalkan','Batalkan penerimaan — Penjualan petshop (kasir dan marketplace)','Penjualan',true)
on conflict(id) do nothing;
insert into role_settings_private.action_modules(id,module_id) values('penjualan.pos_penerimaan.batalkan','penjualan') on conflict do nothing;

create function public.pos_receipt_actor_allowed(p_branch uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_role public.user_role;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then return false; end if;
 -- OWNER: tidak membaca tabel kebijakan sama sekali, jadi galat/penguncian kebijakan tidak bisa menolaknya.
 if v_role='OWNER' then return true; end if;
 begin
  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;
  return coalesce(public.role_action_allowed('penjualan.pos_penerimaan.batalkan'),false)
   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penerimaan.batalkan'=any(a.allowed));
 exception when others then return false;
 end;
end $$;
revoke all on function public.pos_receipt_actor_allowed(uuid) from public,anon,service_role;
grant execute on function public.pos_receipt_actor_allowed(uuid) to authenticated;

-- ───────────────────────── 3. Batalkan penerimaan (POS) ─────────────────────────
create function public.cancel_pos_sale_receipt(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid(); s public.sales%rowtype; prior public.receipt_cancel_requests%rowtype;
 payload jsonb; result jsonb; audit uuid:=gen_random_uuid(); jid uuid; reason text:=btrim(coalesce(p_reason,''));
 today date:=(now() at time zone 'Asia/Jakarta')::date; closed date; src_status text; eff uuid;
 before_payments jsonb; n_pay integer; sum_pay numeric; sum_fee numeric; cash_total numeric; codes text[]; lines jsonb;
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(reason) not between 3 and 1000 then
  raise exception 'Identitas atau alasan pembatalan penerimaan tidak valid. Isi alasan minimal 3 huruf.' using errcode='22023'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan penerimaan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 perform 1 from public.branches where id=s.branch_id and is_active for share;
 if not found then raise exception 'Cabang penjualan tidak aktif' using errcode='42501'; end if;
 payload:=jsonb_build_object('op','cancel','sale_id',p_sale_id,'revision',p_expected_revision,'reason',reason);
 perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));
 select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan penerimaan.'; end if;
 if s.voided_at is not null then raise exception 'Penjualan ini sudah dibatalkan; tidak ada penerimaan yang bisa dibatalkan.'; end if;
 if s.channel is not null then raise exception 'Order marketplace: batalkan PENCAIRAN-nya, bukan penerimaan kasir.'; end if;
 if s.payment_plan is null or s.payments_finalized_at is null or s.total<=0 then
  raise exception 'Struk ini belum punya penerimaan yang selesai (atau struk lama tanpa rincian pembayaran). Gunakan Batalkan penjualan atau hubungi finance.'; end if;
 if exists(select 1 from public.pos_receipt_cancellations where sale_id=s.id and closed_at is null) then
  raise exception 'Penerimaan struk ini sudah dibatalkan. Terima pembayaran lagi, atau ubah transaksi lewat Batalkan penjualan.'; end if;
 if s.merchant_fee_total<>0 then
  raise exception 'Struk ini memuat fee merchant (kartu/QRIS berbiaya). Gunakan Batalkan penjualan lalu input ulang di kasir.'; end if;
 if exists(select 1 from public.sales_returns where sale_id=s.id and voided_at is null)
  or exists(select 1 from public.sale_payment_refunds r join public.sale_payments p on p.id=r.sale_payment_id where p.sale_id=s.id)
  or exists(select 1 from public.sales_refund_requests where sale_id=s.id and status in('pending','diproses','selesai')) then
  raise exception 'Sebagian uang struk ini sudah dikembalikan lewat retur/refund, jadi penerimaan tidak bisa dibatalkan begitu saja. Batalkan dulu retur/refund-nya (Penjualan > Retur), atau pakai Batalkan penjualan.'; end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and today<=closed then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini tidak bisa dibukukan.',closed; end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb),count(*),coalesce(sum(p.amount),0),coalesce(sum(p.fee_amount),0),
  coalesce(sum(p.amount) filter(where p.method='Tunai'),0),coalesce(array_agg(distinct p.coa_code),'{}')
  into before_payments,n_pay,sum_pay,sum_fee,cash_total,codes from public.sale_payments p where p.sale_id=s.id;
 if n_pay not between 1 and 6 or n_pay<>jsonb_array_length(s.payment_plan) or sum_pay<>s.total or sum_fee<>0 then
  raise exception 'Alokasi pembayaran struk tidak lengkap atau tidak sama dengan total; perlu rekonsiliasi finance.'; end if;
 -- Laci: shift terbuka -> di shift itu; shift tertutup -> angka tutupnya dibiarkan, koreksi dicatat di shift terbuka cabang ini.
 if s.shift_id is not null then
  select status into src_status from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id for update;
  if not found then raise exception 'Shift struk tidak ditemukan; perlu rekonsiliasi finance.'; end if;
 end if;
 if src_status='open' then eff:=s.shift_id;
 else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop'
   order by (opened_by=actor) desc,opened_at desc,id limit 1 for update;
 end if;
 if eff is null and cash_total>0 then
  raise exception 'Struk ini dibayar tunai dan tidak ada shift kasir petshop yang terbuka di cabang ini. Buka shift dulu supaya uang tunai yang dikembalikan tercatat di laci, lalu ulangi.'; end if;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=today and (c.id is null or c.code=any(codes))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening pembayaran struk ini sampai hari ini. Batalkan rekonsiliasinya dulu.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',x.coa_code,'debit',0,'credit',x.amount) order by x.method,x.id),'[]'::jsonb)
  || jsonb_build_array(jsonb_build_object('code','150001','debit',s.total,'credit',0)) into lines from public.sale_payments x where x.sale_id=s.id;
 perform public.sales_write_journal(today,s.branch_id,'sale-receipt-cancel',audit::text,'Penerimaan dibatalkan '||s.no_struk,lines);
 select id into strict jid from public.journal_entries where source='sale-receipt-cancel' and source_ref=audit::text;
 insert into public.pos_receipt_cancellations(id,sale_id,branch_id,reason,before_sale,before_payments,reversal_journal_id,source_shift_id,source_shift_status,effect_shift_id,created_by)
  values(audit,s.id,s.branch_id,reason,to_jsonb(s),before_payments,jid,s.shift_id,src_status,eff,actor);
 if eff is not null then
  insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)
   select audit,s.id,eff,p.method,-p.amount,'batal' from public.sale_payments p where p.sale_id=s.id;
 end if;
 result:=jsonb_build_object('sale_id',s.id,'cancellation_id',audit,'journal_id',jid,'unpaid',true,'effect_shift_id',eff,
  'source_shift_status',src_status,'effect_in_other_shift',eff is distinct from s.shift_id);
 insert into public.receipt_cancel_requests(actor_id,request_key,op,sale_id,payload,result) values(actor,p_request_key,'cancel',s.id,payload,result);
 return result;
end $$;
revoke all on function public.cancel_pos_sale_receipt(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.cancel_pos_sale_receipt(uuid,integer,text,text) to authenticated;

-- ───────────────────────── 4. Terima pembayaran lagi (POS) ─────────────────────────
create function public.receive_pos_sale_payment(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid(); s public.sales%rowtype; c public.pos_receipt_cancellations%rowtype; prior public.receipt_cancel_requests%rowtype;
 payload jsonb; result jsonb; jid uuid; today date:=(now() at time zone 'Asia/Jakarta')::date; closed date; s0_status text; eff uuid;
 r record; plan_norm jsonb; old_norm jsonb; parts integer; lines jsonb:='[]'; acode text; acc public.coa_accounts%rowtype; cacc public.cash_accounts%rowtype;
 codes text[]:='{}'; cash_new numeric:=0; changed boolean; after_pay jsonb; new_plan jsonb;
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or p_plan is null or jsonb_typeof(p_plan) is distinct from 'array' then
  raise exception 'Identitas atau rincian pembayaran tidak valid' using errcode='22023'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan menerima pembayaran ulang struk ini. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 perform 1 from public.branches where id=s.branch_id and is_active for share;
 if not found then raise exception 'Cabang penjualan tidak aktif' using errcode='42501'; end if;
 -- Normalisasi rencana (urut metode) supaya payload idempoten tidak bergantung urutan kiriman.
 if exists(select 1 from jsonb_array_elements(p_plan) x where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'method') is distinct from 'string' or jsonb_typeof(x->'amount') is distinct from 'number') then
  raise exception 'Rincian pembayaran tidak valid (metode dan jumlah).'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount) order by x.method),'[]'::jsonb),count(*)
  into plan_norm,parts from jsonb_to_recordset(p_plan) as x(method text,amount numeric);
 payload:=jsonb_build_object('op','receive','sale_id',p_sale_id,'revision',p_expected_revision,'plan',plan_norm);
 perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));
 select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum menerima pembayaran.'; end if;
 if s.voided_at is not null then raise exception 'Penjualan ini sudah dibatalkan; tidak ada yang perlu dibayar.'; end if;
 select * into c from public.pos_receipt_cancellations where sale_id=s.id and closed_at is null for update;
 if not found then raise exception 'Struk ini sudah dibayar (penerimaannya tidak sedang dibatalkan).'; end if;
 if parts not between 1 and 6 or exists(select 1 from jsonb_to_recordset(plan_norm) x(method text,amount numeric)
   where method is null or method not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') or amount is null or amount<=0
    or amount>1000000000000 or amount<>round(amount,2))
  or (select count(distinct method) from jsonb_to_recordset(plan_norm) x(method text))<>parts
  or (select coalesce(sum(amount),0) from jsonb_to_recordset(plan_norm) x(amount numeric))<>s.total then
  raise exception 'Rincian pembayaran harus 1 sampai 6 metode berbeda, tiap jumlah positif, dan jumlahnya sama dengan total struk Rp%.',to_char(s.total,'FM999G999G999G999'); end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and today<=closed then raise exception 'Periode akuntansi sampai % sudah ditutup; penerimaan hari ini tidak bisa dibukukan.',closed; end if;
 if s.shift_id is not null then
  select status into s0_status from public.cashier_shifts where id=s.shift_id and branch_id=s.branch_id for update;
  if not found then raise exception 'Shift struk tidak ditemukan; perlu rekonsiliasi finance.'; end if;
 end if;
 select coalesce(sum(amount) filter(where method='Tunai'),0) into cash_new from jsonb_to_recordset(plan_norm) x(method text,amount numeric);
 if s0_status='open' then eff:=s.shift_id;
 else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop'
   order by (opened_by=actor) desc,opened_at desc,id limit 1 for update;
 end if;
 if eff is null and cash_new>0 then
  raise exception 'Pembayaran memuat tunai dan tidak ada shift kasir petshop yang terbuka di cabang ini. Buka shift dulu agar uang tunai masuk laci, lalu ulangi.'; end if;
 -- Akun tiap metode (sama dengan pencatatan kasir).
 for r in select method,amount from jsonb_to_recordset(plan_norm) x(method text,amount numeric) order by method loop
  acode:=public.unit_posting_cash(r.method,s.branch_id);
  select * into acc from public.coa_accounts where coa_accounts.code=acode and is_active and not is_header and type='ASET' and normal_balance='D' for share;
  if not found then raise exception 'Akun pembayaran % tidak tersedia.',acode; end if;
  select * into cacc from public.cash_accounts where coa_code=acode and is_active and (branch_id is null or branch_id=s.branch_id) order by branch_id nulls last,id limit 1 for share;
  if not found then raise exception 'Rekening pembayaran % tidak aktif atau bukan cabang ini.',acode; end if;
  codes:=codes||acode;
  lines:=lines||jsonb_build_array(jsonb_build_object('code',acode,'debit',r.amount,'credit',0));
 end loop;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations rc left join public.cash_accounts a on a.id=rc.cash_account_id
  left join public.coa_accounts cc on cc.code=coalesce(rc.bank_coa_code,a.coa_code)
  where rc.voided_at is null and rc.tanggal>=today and (cc.id is null or cc.code=any(codes))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening pembayaran sampai hari ini. Batalkan rekonsiliasinya dulu.'; end if;
 lines:=lines||jsonb_build_array(jsonb_build_object('code','150001','debit',0,'credit',s.total));
 perform public.sales_write_journal(today,s.branch_id,'sale-receipt-repost',c.id::text,'Penerimaan diterima ulang '||s.no_struk,lines);
 select id into strict jid from public.journal_entries where source='sale-receipt-repost' and source_ref=c.id::text;
 select coalesce(jsonb_agg(jsonb_build_object('method',p->>'method','amount',(p->>'amount')::numeric) order by p->>'method'),'[]'::jsonb) into old_norm
  from jsonb_array_elements(c.before_payments) p;
 changed:=old_norm is distinct from plan_norm;
 if changed then
  new_plan:=(select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount,'fee_percent',0,'fee_amount',0) order by x.method),'[]'::jsonb) from jsonb_to_recordset(plan_norm) x(method text,amount numeric));
  insert into public.sale_payment_correction_gate(transaction_id,backend_pid,sale_id) values(txid_current(),pg_backend_pid(),s.id);
  delete from public.sale_payments where sale_id=s.id;
  for r in select method,amount from jsonb_to_recordset(plan_norm) x(method text,amount numeric) order by method loop
   acode:=public.unit_posting_cash(r.method,s.branch_id);
   select * into acc from public.coa_accounts where coa_accounts.code=acode;
   select * into cacc from public.cash_accounts where coa_code=acode and is_active and (branch_id is null or branch_id=s.branch_id) order by branch_id nulls last,id limit 1;
   insert into public.sale_payments(sale_id,method,amount,fee_percent,fee_amount,coa_code,account_snapshot)
    values(s.id,r.method,r.amount,0,0,acode,jsonb_build_object('coa_id',acc.id,'code',acc.code,'name',acc.name,'cash_account_id',cacc.id,'cash_account_name',cacc.nama));
  end loop;
  update public.sales set payment_plan=new_plan,metode_bayar=case when parts>1 then 'Split' else plan_norm->0->>'method' end,
   revision=revision+1,bayar=total,kembali=0 where id=s.id;
  delete from public.sale_payment_correction_gate where transaction_id=txid_current() and backend_pid=pg_backend_pid() and sale_id=s.id;
 end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.id),'[]'::jsonb) into after_pay from public.sale_payments p where p.sale_id=s.id;
 if (select coalesce(sum(amount),0) from public.sale_payments where sale_id=s.id)<>s.total then raise exception 'Alokasi hasil tidak sama dengan total struk'; end if;
 -- Efek laci. Shift struk masih terbuka: alokasi dasar struk sudah berganti ke rencana baru, jadi batalan lama (-lama) dibatalkan balik (+lama).
 -- Shift struk sudah tertutup (atau tanpa shift): uang baru masuk ke shift terbuka sekarang (+baru).
 if s0_status='open' and eff=s.shift_id then
  insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)
   select c.id,s.id,s.shift_id,x.method,x.amount,'terima' from jsonb_to_recordset(old_norm) x(method text,amount numeric);
 elsif eff is not null then
  insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)
   select c.id,s.id,eff,x.method,x.amount,'terima' from jsonb_to_recordset(plan_norm) x(method text,amount numeric);
 end if;
 update public.pos_receipt_cancellations set closed_at=now(),closed_by=actor,closed_kind='diterima-ulang',receive_journal_id=jid,
  after_payments=after_pay,receive_effect_shift_id=eff where id=c.id;
 result:=jsonb_build_object('sale_id',s.id,'cancellation_id',c.id,'journal_id',jid,'unpaid',false,'changed_methods',changed,
  'revision',s.revision+case when changed then 1 else 0 end,'effect_shift_id',eff);
 insert into public.receipt_cancel_requests(actor_id,request_key,op,sale_id,payload,result) values(actor,p_request_key,'receive',s.id,payload,result);
 return result;
end $$;
revoke all on function public.receive_pos_sale_payment(uuid,integer,text,jsonb) from public,anon,service_role;
grant execute on function public.receive_pos_sale_payment(uuid,integer,text,jsonb) to authenticated;

-- ───────────────────────── 5. Batalkan pencairan marketplace ─────────────────────────
create function public.cancel_online_disbursement(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid(); s public.sales%rowtype; prior public.receipt_cancel_requests%rowtype; payload jsonb; result jsonb;
 audit uuid:=gen_random_uuid(); reason text:=btrim(coalesce(p_reason,'')); today date:=(now() at time zone 'Asia/Jakarta')::date; closed date;
 dj public.journal_entries%rowtype; n_j integer; bank_code text; bank_amount numeric; fee numeric; jid uuid; lines jsonb;
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(reason) not between 3 and 1000 then
  raise exception 'Identitas atau alasan pembatalan pencairan tidak valid. Isi alasan minimal 3 huruf.' using errcode='22023'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan pencairan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 payload:=jsonb_build_object('op','online','sale_id',p_sale_id,'revision',p_expected_revision,'reason',reason);
 perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));
 select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan pencairan.'; end if;
 if s.voided_at is not null then raise exception 'Order ini sudah dibatalkan.'; end if;
 if s.channel is null or s.channel not in('Shopee','Tokopedia','TikTok Shop') then raise exception 'Hanya order marketplace yang punya pencairan.'; end if;
 if s.marketplace_status is distinct from 'cair' or s.disbursed_at is null then raise exception 'Order ini belum dicairkan (sudah berstatus piutang).'; end if;
 if exists(select 1 from public.sales_returns where sale_id=s.id and voided_at is null) then
  raise exception 'Order ini sudah punya retur. Batalkan returnya dulu sebelum membatalkan pencairan.'; end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and today<=closed then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan hari ini tidak bisa dibukukan.',closed; end if;
 -- Jurnal pencairan: satuan (source_ref = no struk) atau gabungan (CAIR-..., dibuat di transaksi yang sama dengan disbursed_at).
 select count(*) into n_j from public.journal_entries e where e.source='sale-online-cair' and e.source_ref=s.no_struk and e.voided_at is null
  and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
 if n_j=1 then
  select e.* into dj from public.journal_entries e where e.source='sale-online-cair' and e.source_ref=s.no_struk and e.voided_at is null
   and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
 elsif n_j=0 then
  select count(*) into n_j from public.journal_entries e where e.source='sale-online-cair' and e.source_ref like 'CAIR-%' and e.branch_id=s.branch_id and e.created_at=s.disbursed_at and e.voided_at is null and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
  if n_j<>1 then raise exception 'Jurnal pencairan order ini tidak dapat dipastikan (pencairan gabungan tidak teridentifikasi). Hubungi finance.'; end if;
  select e.* into dj from public.journal_entries e where e.source='sale-online-cair' and e.source_ref like 'CAIR-%' and e.branch_id=s.branch_id and e.created_at=s.disbursed_at and e.voided_at is null and not exists(select 1 from public.online_disbursement_cancellations d where d.disbursement_journal_id=e.id and d.sale_id=s.id);
 else raise exception 'Jurnal pencairan order ini ganda; perlu rekonsiliasi finance.'; end if;
 fee:=coalesce(s.komisi,0);
 if fee<0 or fee>s.total then raise exception 'Komisi order tidak valid; perlu rekonsiliasi finance.'; end if;
 select a.code into bank_code from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=dj.id and l.debit>0 and a.type='ASET' order by l.debit desc,a.code limit 1;
 if bank_code is null then raise exception 'Akun bank pencairan tidak ditemukan pada jurnal; perlu rekonsiliasi finance.'; end if;
 bank_amount:=s.total-fee;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and r.tanggal>=today and (c.id is null or c.code=bank_code)) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening pencairan sampai hari ini. Batalkan rekonsiliasinya dulu.'; end if;
 lines:=jsonb_build_array(jsonb_build_object('code','130009','debit',s.total,'credit',0));
 if bank_amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code',bank_code,'debit',0,'credit',bank_amount)); end if;
 if fee>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','740020','debit',0,'credit',fee)); end if;
 perform public.sales_write_journal(today,s.branch_id,'sale-online-cair-void',audit::text,'Pencairan dibatalkan '||s.no_struk,lines);
 select id into strict jid from public.journal_entries where source='sale-online-cair-void' and source_ref=audit::text;
 insert into public.online_disbursement_cancellations(id,sale_id,branch_id,reason,before_sale,disbursement_journal_id,reversal_journal_id,bank_code,amount_bank,amount_fee,created_by)
  values(audit,s.id,s.branch_id,reason,to_jsonb(s),dj.id,jid,bank_code,bank_amount,fee,actor);
 update public.sales set marketplace_status='piutang',komisi=0,disbursed_at=null where id=s.id;
 result:=jsonb_build_object('sale_id',s.id,'cancellation_id',audit,'journal_id',jid,'status','piutang');
 insert into public.receipt_cancel_requests(actor_id,request_key,op,sale_id,payload,result) values(actor,p_request_key,'online',s.id,payload,result);
 return result;
end $$;
revoke all on function public.cancel_online_disbursement(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.cancel_online_disbursement(uuid,integer,text,text) to authenticated;

-- ───────────────────────── 6. Tambalan fungsi berjalan (jangkar eksak, gagal tertutup) ─────────────────────────
do $patch$
declare p record; definition text; sig regprocedure; hits integer; body text; old_body text;
begin
 for p in select * from (values
  -- A. Pembatalan penjualan: struk belum dibayar boleh dibatalkan walau shiftnya sudah tertutup (uang sudah dikembalikan lewat pembatalan penerimaan).
  ('public.cancel_posted_sale(uuid,integer,text,text)',1,
   E' v_source text;inventory jsonb;layer public.stock_layers%rowtype;goods numeric;',
   E' v_source text;inventory jsonb;layer public.stock_layers%rowtype;goods numeric;unpaid boolean:=false;'),
  ('public.cancel_posted_sale(uuid,integer,text,text)',1,
   E' if s.payment_plan is not null and s.payments_finalized_at is null then raise exception ''Selesaikan pembayaran sebelum pembatalan'';end if;',
   E' if s.payment_plan is not null and s.payments_finalized_at is null then raise exception ''Selesaikan pembayaran sebelum pembatalan'';end if;\n unpaid:=exists(select 1 from public.pos_receipt_cancellations where sale_id=s.id and closed_at is null);'),
  ('public.cancel_posted_sale(uuid,integer,text,text)',1,
   E' if s.shift_id is not null then\n  perform 1 from public.cashier_shifts where id=s.shift_id and status=''open'' for update;',
   E' if s.shift_id is not null and not unpaid then\n  perform 1 from public.cashier_shifts where id=s.shift_id and status=''open'' for update;'),
  -- B. Pencairan marketplace yang sudah dibatalkan tidak lagi menghalangi pembatalan order.
  ('public.cancel_posted_sale(uuid,integer,text,text)',1,
   E'  or exists(select 1 from public.journal_entries where source=''sale-online-cair'' and source_ref=s.no_struk) then raise exception ''Dana marketplace sudah dicairkan. Rekonsiliasi pencairan diperlukan'';end if;',
   E'  or (select count(*) from public.journal_entries where source=''sale-online-cair'' and source_ref=s.no_struk)>(select count(*) from public.online_disbursement_cancellations where sale_id=s.id) then raise exception ''Dana marketplace sudah dicairkan. Rekonsiliasi pencairan diperlukan'';end if;'),
  -- C. Jurnal penerimaan (batal/terima ulang) ikut dibalik persis; pembalik penjualan sendiri tetap.
  ('public.cancel_posted_sale(uuid,integer,text,text)',1,
   E' for j in select e.* from public.journal_entries e where e.source in(v_source,v_source||''-hpp'') and e.source_ref=s.no_struk order by e.id loop\n  reversal:=gen_random_uuid();',
   E' for j in select e.* from public.journal_entries e where (e.source in(v_source,v_source||''-hpp'') and e.source_ref=s.no_struk)\n   or (e.source in(''sale-receipt-cancel'',''sale-receipt-repost'') and e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=s.id)) order by e.id loop\n  reversal:=gen_random_uuid();'),
  ('public.cancel_posted_sale(uuid,integer,text,text)',1,
   E'case when j.source=v_source then ''sale-void'' else ''sale-void-hpp'' end',
   E'case when j.source=v_source then ''sale-void'' when j.source in(''sale-receipt-cancel'',''sale-receipt-repost'') then ''sale-void-receipt'' else ''sale-void-hpp'' end'),
  -- D. Setelah struk dibatalkan: batalan shift terbuka dinetralkan, catatan ditutup.
  ('public.cancel_posted_sale(uuid,integer,text,text)',1,
   E' update public.sales set revision=revision+1,voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason) where id=s.id;',
   E' update public.sales set revision=revision+1,voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason) where id=s.id;\n if unpaid then\n  insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)\n   select e.cancellation_id,s.id,e.shift_id,e.method,-e.amount,''void'' from public.sale_receipt_shift_effects e\n    join public.pos_receipt_cancellations pc on pc.id=e.cancellation_id\n    where pc.sale_id=s.id and pc.closed_at is null and e.shift_id is not distinct from s.shift_id\n     and exists(select 1 from public.cashier_shifts sh where sh.id=e.shift_id and sh.status=''open'');\n  update public.pos_receipt_cancellations set closed_at=now(),closed_by=auth.uid(),closed_kind=''penjualan-dibatalkan'' where sale_id=s.id and closed_at is null;\n end if;'),
  -- E. Tutup shift: efek penerimaan dibatalkan/diterima ulang ikut dihitung ulang.
  ('public.pos_shift_pending_checkout_guard()',1,
   E' and exists(select 1 from public.sales where shift_id=old.id and payment_plan is not null) then',
   E' and (exists(select 1 from public.sales where shift_id=old.id and payment_plan is not null) or exists(select 1 from public.sale_receipt_shift_effects where shift_id=old.id)) then'),
  ('public.pos_shift_pending_checkout_guard()',1,
   E'where s.voided_at is null and s.shift_id=old.id and s.payment_plan is not null and s.payments_finalized_at is not null\n   ) incoming',
   E'where s.voided_at is null and s.shift_id=old.id and s.payment_plan is not null and s.payments_finalized_at is not null\n    union all\n    select e.method,e.amount from public.sale_receipt_shift_effects e where e.shift_id=old.id\n   ) incoming'),
  -- F. Jurnal penerimaan dilindungi dari tulisan klien seperti jurnal penjualan lain.
  ('public.pos_sale_journal_protected(uuid)',1,
   E'''sale-void-hpp'',''sale-payment-reversal''',
   E'''sale-void-hpp'',''sale-void-receipt'',''sale-receipt-cancel'',''sale-receipt-repost'',''sale-online-cair-void'',''sale-payment-reversal''')
 ) as v(sig,expected,anchor,replacement) loop
  sig:=p.sig::regprocedure;
  select pg_get_functiondef(sig),prosrc into definition,old_body from pg_proc where oid=sig;
  hits:=(length(old_body)-length(replace(old_body,p.anchor,'')))/length(p.anchor);
  if hits<>p.expected then raise exception 'Jangkar tambalan berubah (% hit, diharapkan %) pada %: %',hits,p.expected,p.sig,left(p.anchor,60); end if;
  body:=replace(old_body,p.anchor,p.replacement);
  execute replace(definition,old_body,body);
 end loop;
end $patch$;
