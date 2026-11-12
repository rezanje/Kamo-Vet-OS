-- Mitigasi temuan audit integrasi + review "musuh" 11 Nov 2026 atas PR #496-#500 (Andri: "coba tes dan mitigasi dulu, ada yang kelewat apa tidak").
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri). Semua tambalan berjangkar eksak dan GAGAL TERTUTUP bila fungsi hidup
-- sudah berbeda dari teks yang ditinjau. Tidak ada baris data yang disentuh; aturan di bawah HPP TIDAK dilonggarkan; Owner tidak pernah dikunci.
--
--  F1  clinic_edit_invoice_core: Owner terhalang PRICE_BELOW_HPP setelah batal penerimaan nota ber-promo (GROOM11: Grooming 90.000 promo 45.000
--      + Anthel 18.000). Penyebab: edit hanya mewarisi promo_discount untuk baris yang TIDAK berubah dan mengabaikan nilai klien.
--      Kini (a) baris promo yang BERUBAH (harga/qty/diskon baris) membawa promonya sebanding nilai baris (dari database, bukan dari klien),
--      dibatasi nilai baris dan sisa diskon invoice; (b) klien boleh mengirim promo_discount per baris seperti clinic_post_invoice
--      (>= 0, <= 2 desimal, <= nilai baris, jumlah <= diskon invoice) sehingga nota tanpa promo (bentuk INV-0777) bisa diberi promo pada
--      baris yang benar. Lantai tetap nol-jumlah: assert_invoice_price_floor tidak diubah dan dijalankan setelahnya.
--  F2  Tutup shift KLINIK memakai angka basi (dibaca sebelum Owner membatalkan penerimaan Tunai). Trigger tutup-shift hanya menghitung ulang
--      shift petshop. Kini shift klinik yang tersentuh pembatalan penerimaan dihitung ulang (rumus yang sama dengan src/lib/tutup-shift.ts)
--      setelah kunci UPDATE didapat; expected_cash basi ditolak "Hitung ulang sebelum menutup shift". Shift yang tidak tersentuh
--      pembatalan, dan penutupan tanpa angka (expected_cash kosong), tidak berubah perilakunya.
--  R1  purchase_cancel_allowed juga mensyaratkan role_action_allowed (modul dicabut = ditolak; Owner tetap lolos lebih dulu);
--      preview_goods_receipt_cancellation memeriksa izin (sebelumnya membocorkan total bayar faktur); cancel_purchase_payment memeriksa izin
--      SEBELUM mengunci baris; tiga RPC petshop memeriksa izin SEBELUM mengunci baris penjualan.
--  R2  Petshop: bila shift asal sudah tutup, efek batal/terima ulang jatuh ke shift TERBUKA MILIK PELAKU (bukan shift kasir lain). Pelaku
--      tanpa shift terbuka: tetap boleh (Owner tidak dikunci) dan ditandai shift_mode 'tanpa_shift' untuk Finance; tidak menyentuh laci siapa pun.
--  R3  Klinik: kwitansi Tunai dibatalkan tanpa shift terbuka ditandai 'tanpa_shift' dengan cash_amount yang benar (sebelumnya 'nonkas', 0).
--      Jurnal tidak berubah.

set local lock_timeout = '5s';

-- ───────────────────────── F2: hitung ulang kas shift klinik (sama dengan src/lib/tutup-shift.ts, bagian klinik) ─────────────────────────
create function clinic_private.klinik_shift_expected_cash(p_shift uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(
    sh.opening_balance
    -- bagian pembayaran "checkout" invoice (campuran metode) di shift ini
    + coalesce((select sum(p.amount) from public.invoice_payments p join public.invoices i on i.id = p.invoice_id
                where i.shift_id = sh.id and i.voided_at is null and p.checkout_payment and coalesce(p.metode, 'Tunai') = 'Tunai'), 0)
    -- uang di meja saat invoice terbit (bukan status bayar sekarang), tanpa invoice campuran
    + coalesce((select sum(case when i.shift_cash_carry is not null then i.shift_cash_carry
                                when i.paid_status = 'Lunas' and coalesce(sp.paid, 0) = 0 then i.total
                                else coalesce(i.dp_amount, 0) end)
                from public.invoices i
                left join lateral (select sum(p.amount) as paid from public.invoice_payments p
                                   where p.invoice_id = i.id and not coalesce(p.checkout_payment, false)) sp on true
                where i.shift_id = sh.id and i.voided_at is null and coalesce(i.metode_bayar, 'Tunai') = 'Tunai'
                  and not exists (select 1 from public.invoice_payments p where p.invoice_id = i.id and p.checkout_payment)), 0)
    -- kwitansi: bagian diterima di shift ini menambah, bagian dibatalkan di shift ini mengurangi
    + coalesce((select sum(case when r.shift_id = sh.id then pt.amount else 0 end - case when r.void_shift_id = sh.id then pt.amount else 0 end)
                from public.clinic_payment_receipts r join public.clinic_payment_receipt_parts pt on pt.receipt_id = r.id
                where (r.shift_id = sh.id or r.void_shift_id = sh.id) and pt.metode = 'Tunai'), 0)
    -- batalkan penerimaan yang jatuh di shift berjalan ini
    - coalesce((select sum(c.cash_amount) from public.clinic_receipt_cancellations c
                where c.cancel_shift_id = sh.id and c.shift_mode = 'shift_berjalan' and c.cash_amount > 0), 0)
    -- pengeluaran tunai
    - coalesce((select sum(e.jumlah) from public.expenses e where e.shift_id = sh.id and e.metode_bayar = 'Tunai'), 0)
  , 2)
  from public.cashier_shifts sh where sh.id = p_shift
$$;
revoke all on function clinic_private.klinik_shift_expected_cash(uuid) from public, anon, authenticated, service_role;

-- ───────────────────────── R2: kolom penanda mode shift pada catatan pembatalan petshop (tabel baru dari #499, kosong) ─────────────────────────
alter table public.pos_receipt_cancellations add column shift_mode text;
alter table public.pos_receipt_cancellations add constraint pos_receipt_cancellations_shift_mode_check
  check (shift_mode is null or shift_mode in ('nonkas', 'shift_asal_terbuka', 'shift_pelaku', 'tanpa_shift'));
comment on column public.pos_receipt_cancellations.shift_mode is
  'Ke mana efek laci jatuh: shift_asal_terbuka (shift struk masih terbuka), shift_pelaku (shift terbuka milik yang membatalkan), tanpa_shift (ada uang tunai, pelaku tanpa shift terbuka: tidak menyentuh laci siapa pun, untuk Finance), nonkas.';

-- ───────────────────────── Tambalan berjangkar ─────────────────────────
create temp table mt_patch(n serial primary key, sig text not null, old_text text not null, new_text text not null, times integer not null default 1) on commit drop;
insert into mt_patch(sig, old_text, new_text, times) values
-- ============================== F1 clinic_edit_invoice_core ==============================
('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
 $old$    raise exception using errcode='P0001', message='INVOICE_INVALID: subtotal berbeda dari rincian';
  end if;
$old$,
 $new$    raise exception using errcode='P0001', message='INVOICE_INVALID: subtotal berbeda dari rincian';
  end if;
  -- MITIGASI_1111 F1: potongan promo per baris dari klien (opsional, sama aturannya dengan clinic_post_invoice).
  if exists(select 1 from jsonb_array_elements(p_lines) x
      where nullif(x.value->>'promo_discount','') is not null
        and ((x.value->>'promo_discount')::numeric<0
          or (x.value->>'promo_discount')::numeric<>round((x.value->>'promo_discount')::numeric,2)
          or (x.value->>'promo_discount')::numeric>round((x.value->>'qty')::numeric*(x.value->>'price')::numeric*(1-coalesce((x.value->>'discount_percent')::numeric,0)/100),2)))
     or (select coalesce(sum(nullif(x.value->>'promo_discount','')::numeric),0) from jsonb_array_elements(p_lines) x)>v_discount then
    raise exception using errcode='P0001', message='LINE_INVALID: potongan promo baris tidak valid, melebihi nilai baris, atau jumlahnya melebihi diskon invoice';
  end if;
$new$, 1),
('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
 $old$      coalesce((select least(o.promo_discount,$old$,
 $new$      coalesce(nullif(v_line->>'promo_discount','')::numeric,(select least(o.promo_discount,$new$, 1),
('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
 $old$          and o.item_id is not distinct from v_item),0));
  end loop;
$old$,
 $new$          and o.item_id is not distinct from v_item),null));
  end loop;
  -- MITIGASI_1111 F1: baris promo yang BERUBAH membawa promonya sebanding nilai baris (dari baris asal di database), dibatasi nilai baris dan
  -- sisa diskon invoice. Nilai NULL = belum diputuskan (bukan dari klien, bukan baris tak berubah); semua NULL diputuskan di sini.
  with new_rows as (
    select n.id, n.service_source_line_id as sid, round(n.qty*n.harga*(1-coalesce(n.diskon_persen,0)/100),2) as nv
    from public.invoice_items n
    where n.invoice_id=p_invoice_id and n.id<>all(v_service_old_ids) and n.promo_discount is null),
  cand as (
    select r.id, least(r.nv, round(o.promo_discount*r.nv/ov.v,2)) as want
    from new_rows r
    join public.invoice_items o on o.id=r.sid and o.invoice_id=p_invoice_id and o.id=any(v_service_old_ids) and o.promo_discount>0
    cross join lateral (select round(o.qty*o.harga*(1-coalesce(o.diskon_persen,0)/100),2) as v) ov
    where ov.v>0),
  budget as (
    select greatest(v_discount-coalesce((select sum(i2.promo_discount) from public.invoice_items i2
      where i2.invoice_id=p_invoice_id and i2.id<>all(v_service_old_ids) and i2.promo_discount is not null),0),0) as b),
  alloc as (
    select c.id, greatest(least(c.want,(select b from budget)-(sum(c.want) over (order by c.id)-c.want)),0) as amt from cand c)
  update public.invoice_items i set promo_discount=coalesce((select a.amt from alloc a where a.id=i.id),0)
  where i.invoice_id=p_invoice_id and i.id<>all(v_service_old_ids) and i.promo_discount is null;
$new$, 1),
-- ============================== F2 trigger tutup shift ==============================
('public.pos_shift_pending_checkout_guard()',
 $old$   raise exception 'Pembayaran shift berubah. Hitung ulang sebelum menutup shift.';
  end if;
 end if;
 return new;$old$,
 $new$   raise exception 'Pembayaran shift berubah. Hitung ulang sebelum menutup shift.';
  end if;
 end if;
 -- MITIGASI_1111 F2: shift KLINIK yang tersentuh "Batalkan penerimaan" dihitung ulang setelah kunci UPDATE didapat (pembatalan memegang kunci
 -- baris shift sampai commit). Angka tutup yang dibaca sebelum pembatalan itu ditolak. Penutupan tanpa angka (expected_cash kosong) tidak diperiksa.
 if old.shift_type='klinik' and new.status='closed' and new.expected_cash is not null
  and (exists(select 1 from public.clinic_receipt_cancellations c where c.source_shift_id=old.id or c.cancel_shift_id=old.id)
    or exists(select 1 from public.clinic_receipt_cancellations c, jsonb_array_elements(c.detail->'receipts') e where (e->>'void_shift_id')=old.id::text)) then
  if new.expected_cash is distinct from clinic_private.klinik_shift_expected_cash(old.id) then
   raise exception 'Pembayaran shift berubah. Hitung ulang sebelum menutup shift.';
  end if;
 end if;
 return new;$new$, 1),
-- ============================== R1 izin pembelian ==============================
('public.purchase_cancel_allowed(text)',
 $old$ return found and p_action=any(v_allowed);$old$,
 $new$ -- MITIGASI_1111 R1: modul yang dicabut juga menolak (role_action_allowed = gerbang modul/epoch); Owner sudah dijawab true di atas.
 return found and p_action=any(v_allowed) and coalesce(public.role_action_allowed(p_action),false);$new$, 1),
('public.preview_goods_receipt_cancellation(uuid,date)',
 $old$ if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 select * into gr from public.goods_receipts where id=p_receipt_id;$old$,
 $new$ if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 -- MITIGASI_1111 R1: pratinjau memuat total bayar faktur; hanya yang boleh membatalkan penerimaan.
 if not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then
  raise exception 'Pratinjau pembatalan penerimaan hanya untuk Owner atau peran yang diberi izin Batalkan penerimaan di Akses Grup' using errcode='42501'; end if;
 select * into gr from public.goods_receipts where id=p_receipt_id;$new$, 1),
('public.cancel_purchase_payment(uuid,integer,text,text)',
 $old$ payload:=jsonb_build_object('payment_id',p_payment_id,'revision',p_expected_revision,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-payment-cancel:'||auth.uid()::text||':'||p_request_key,0));$old$,
 $new$ -- MITIGASI_1111 R1: izin diperiksa SEBELUM kunci apa pun (pemeriksaan yang sama diulang setelah kunci, tetap ada).
 if not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat membatalkan pembayaran' using errcode='42501';end if;
 payload:=jsonb_build_object('payment_id',p_payment_id,'revision',p_expected_revision,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-payment-cancel:'||auth.uid()::text||':'||p_request_key,0));$new$, 1),
-- ============================== R1/R2 petshop: izin sebelum kunci baris ==============================
('public.cancel_pos_sale_receipt(uuid,integer,text,text)',
 $old$ select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then$old$,
 $new$ -- MITIGASI_1111 R1: izin diperiksa SEBELUM mengunci baris penjualan.
 select * into s from public.sales where id=p_sale_id;
 if found and not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan penerimaan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then$new$, 1),
('public.receive_pos_sale_payment(uuid,integer,text,jsonb)',
 $old$ select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then$old$,
 $new$ -- MITIGASI_1111 R1: izin diperiksa SEBELUM mengunci baris penjualan.
 select * into s from public.sales where id=p_sale_id;
 if found and not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan menerima pembayaran ulang struk ini. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then$new$, 1),
('public.cancel_online_disbursement(uuid,integer,text,text)',
 $old$ select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then$old$,
 $new$ -- MITIGASI_1111 R1: izin diperiksa SEBELUM mengunci baris penjualan.
 select * into s from public.sales where id=p_sale_id;
 if found and not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan membatalkan pencairan. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then$new$, 1),
-- ============================== R2 petshop: efek laci ke shift PELAKU ==============================
('public.cancel_pos_sale_receipt(uuid,integer,text,text)',
 $old$ before_payments jsonb; n_pay integer; sum_pay numeric; sum_fee numeric; cash_total numeric; codes text[]; lines jsonb;
begin$old$,
 $new$ before_payments jsonb; n_pay integer; sum_pay numeric; sum_fee numeric; cash_total numeric; codes text[]; lines jsonb; shift_mode text;
begin$new$, 1),
('public.cancel_pos_sale_receipt(uuid,integer,text,text)',
 $old$ else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop'
   order by (opened_by=actor) desc,opened_at desc,id limit 1 for update;
 end if;
 if eff is null and cash_total>0 then
  raise exception 'Struk ini dibayar tunai dan tidak ada shift kasir petshop yang terbuka di cabang ini. Buka shift dulu supaya uang tunai yang dikembalikan tercatat di laci, lalu ulangi.'; end if;$old$,
 $new$ -- MITIGASI_1111 R2: shift asal sudah tutup -> hanya shift terbuka MILIK PELAKU; tanpa itu, tidak menyentuh laci siapa pun (ditandai 'tanpa_shift').
 else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop' and opened_by=actor
   order by opened_at desc,id limit 1 for update;
 end if;
 shift_mode:=case when eff is null then case when cash_total>0 then 'tanpa_shift' else 'nonkas' end when eff is not distinct from s.shift_id then 'shift_asal_terbuka' else 'shift_pelaku' end;$new$, 1),
('public.cancel_pos_sale_receipt(uuid,integer,text,text)',
 $old$ insert into public.pos_receipt_cancellations(id,sale_id,branch_id,reason,before_sale,before_payments,reversal_journal_id,source_shift_id,source_shift_status,effect_shift_id,created_by)
  values(audit,s.id,s.branch_id,reason,to_jsonb(s),before_payments,jid,s.shift_id,src_status,eff,actor);$old$,
 $new$ insert into public.pos_receipt_cancellations(id,sale_id,branch_id,reason,before_sale,before_payments,reversal_journal_id,source_shift_id,source_shift_status,effect_shift_id,created_by,shift_mode)
  values(audit,s.id,s.branch_id,reason,to_jsonb(s),before_payments,jid,s.shift_id,src_status,eff,actor,shift_mode);$new$, 1),
('public.cancel_pos_sale_receipt(uuid,integer,text,text)',
 $old$  'source_shift_status',src_status,'effect_in_other_shift',eff is distinct from s.shift_id);$old$,
 $new$  'source_shift_status',src_status,'effect_in_other_shift',(eff is not null and eff is distinct from s.shift_id),'shift_mode',shift_mode);$new$, 1),
('public.receive_pos_sale_payment(uuid,integer,text,jsonb)',
 $old$ codes text[]:='{}'; cash_new numeric:=0; changed boolean; after_pay jsonb; new_plan jsonb;
begin$old$,
 $new$ codes text[]:='{}'; cash_new numeric:=0; changed boolean; after_pay jsonb; new_plan jsonb; shift_mode text;
begin$new$, 1),
('public.receive_pos_sale_payment(uuid,integer,text,jsonb)',
 $old$ else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop'
   order by (opened_by=actor) desc,opened_at desc,id limit 1 for update;
 end if;
 if eff is null and cash_new>0 then
  raise exception 'Pembayaran memuat tunai dan tidak ada shift kasir petshop yang terbuka di cabang ini. Buka shift dulu agar uang tunai masuk laci, lalu ulangi.'; end if;$old$,
 $new$ -- MITIGASI_1111 R2: shift asal sudah tutup -> hanya shift terbuka MILIK PELAKU; tanpa itu ditandai 'tanpa_shift' (tidak menyentuh laci siapa pun).
 else select id into eff from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop' and opened_by=actor
   order by opened_at desc,id limit 1 for update;
 end if;
 shift_mode:=case when eff is null then case when cash_new>0 then 'tanpa_shift' else 'nonkas' end when eff is not distinct from s.shift_id then 'shift_asal_terbuka' else 'shift_pelaku' end;$new$, 1),
('public.receive_pos_sale_payment(uuid,integer,text,jsonb)',
 $old$  'revision',s.revision+case when changed then 1 else 0 end,'effect_shift_id',eff);$old$,
 $new$  'revision',s.revision+case when changed then 1 else 0 end,'effect_shift_id',eff,'shift_mode',shift_mode);$new$, 1),
-- ============================== R3 klinik: kwitansi Tunai tanpa shift ==============================
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$  v_cash numeric(15,2) := 0; v_mode text; v_cancel_shift uuid; v_src_status text;$old$,
 $new$  v_cash numeric(15,2) := 0; v_mode text; v_cancel_shift uuid; v_src_status text;
  v_rc numeric(15,2) := 0; v_rc_unplaced numeric(15,2) := 0;$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$    select * into v_adv from public.clinic_customer_advances where receipt_id = v_rec.id and status = 'aktif' for update;
    if found and v_adv.applied > 0 then$old$,
 $new$    -- MITIGASI_1111 R3: bagian TUNAI kwitansi yang tidak jatuh ke laci mana pun dicatat (ditandai tanpa_shift di bawah).
    v_rc := coalesce((select sum(pt.amount) from public.clinic_payment_receipt_parts pt where pt.receipt_id = v_rec.id and pt.metode = 'Tunai'), 0);
    if v_void_shift is null then v_rc_unplaced := v_rc_unplaced + v_rc; end if;
    select * into v_adv from public.clinic_customer_advances where receipt_id = v_rec.id and status = 'aktif' for update;
    if found and v_adv.applied > 0 then$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$  -- (D) penerimaan langsung di kepala tagihan: piutang kembali, rekening asal dikeluarkan.$old$,
 $new$  -- MITIGASI_1111 R3: hanya kwitansi Tunai tanpa laci (mis. pelaku tanpa shift terbuka): mode 'tanpa_shift' dan jumlahnya tercatat. Jumlah ini
  -- SENGAJA tidak dihitung ke shift berjalan (tutup shift hanya menghitung mode 'shift_berjalan'), jadi tidak ada hitungan ganda.
  if v_rc_unplaced > 0 and v_cash <= 0 then
    v_mode := 'tanpa_shift'; v_cash := v_rc_unplaced; v_cancel_shift := null;
  end if;
  if v_rc_unplaced > 0 then
    v_detail := v_detail || jsonb_build_object('kwitansi_tunai_tanpa_shift', v_rc_unplaced);
  end if;
  -- (D) penerimaan langsung di kepala tagihan: piutang kembali, rekening asal dikeluarkan.$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$    'cancel_shift_id', v_cancel_shift, 'receipts', to_jsonb(v_rcpt_nos),$old$,
 $new$    'cancel_shift_id', v_cancel_shift, 'kwitansi_tunai_tanpa_shift', v_rc_unplaced, 'receipts', to_jsonb(v_rcpt_nos),$new$, 1),
('public.clinic_cancel_invoice_receipt_preview(uuid)',
 $old$  v_mode := case when v_cash <= 0 then 'nonkas' when v_src_open then 'shift_asal_terbuka' when v_open then 'shift_berjalan' else 'tanpa_shift' end;
  return v_scan || jsonb_build_object('actor', v_actor, 'cash_amount', v_cash, 'shift_mode', v_mode, 'today', (now() at time zone 'Asia/Jakarta')::date);$old$,
 $new$  v_mode := case when v_cash <= 0 then 'nonkas' when v_src_open then 'shift_asal_terbuka' when v_open then 'shift_berjalan' else 'tanpa_shift' end;
  -- MITIGASI_1111 R3: kwitansi Tunai yang tidak punya laci (shift asal tutup dan pelaku tanpa shift terbuka) ditandai tanpa_shift.
  select coalesce(sum((pt ->> 'amount')::numeric), 0) into v_rc
  from jsonb_array_elements(coalesce(v_scan -> 'receipts', '[]'::jsonb)) rc cross join lateral jsonb_array_elements(coalesce(rc -> 'parts', '[]'::jsonb)) pt
  where pt ->> 'metode' = 'Tunai' and not v_open
    and not exists (select 1 from public.cashier_shifts s where s.id = nullif(rc ->> 'shift_id', '')::uuid and s.status = 'open');
  if v_rc > 0 and v_cash <= 0 then v_mode := 'tanpa_shift'; v_cash := v_rc; end if;
  return v_scan || jsonb_build_object('actor', v_actor, 'cash_amount', v_cash, 'shift_mode', v_mode, 'kwitansi_tunai_tanpa_shift', v_rc, 'today', (now() at time zone 'Asia/Jakarta')::date);$new$, 1),
('public.clinic_cancel_invoice_receipt_preview(uuid)',
 $old$  v_cash numeric := 0; v_mode text; v_el jsonb;
begin$old$,
 $new$  v_cash numeric := 0; v_mode text; v_el jsonb; v_rc numeric := 0;
begin$new$, 1);

do $mitigasi$
declare
  p record;
  q record;
  definition text;
  pre text;
  n_found integer;
begin
  for p in select distinct sig from mt_patch order by sig loop
    definition := pg_get_functiondef(p.sig::regprocedure);
    if position('MITIGASI_1111' in definition) > 0 then
      raise exception 'MITIGASI_1111 already applied to %; inspect before re-running', p.sig;
    end if;
    pre := (select format('%s|%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype, provolatile)
      from pg_proc where oid = p.sig::regprocedure);
    for q in select * from mt_patch where sig = p.sig order by n loop
      n_found := (length(definition) - length(replace(definition, q.old_text, ''))) / length(q.old_text);
      if n_found <> q.times then
        raise exception 'MITIGASI_1111_DRIFT: % changed (anchor % found % times, expected %); review before release', p.sig, q.n, n_found, q.times;
      end if;
      definition := replace(definition, q.old_text, q.new_text);
    end loop;
    execute definition;
    if pre is distinct from (select format('%s|%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype, provolatile)
      from pg_proc where oid = p.sig::regprocedure) then
      raise exception 'MITIGASI_1111: pemilik/ACL/definer/config % berubah setelah ditambal', p.sig;
    end if;
    if position('MITIGASI_1111' in pg_get_functiondef(p.sig::regprocedure)) = 0 then
      raise exception 'MITIGASI_1111: definisi % tidak sesuai setelah ditambal', p.sig;
    end if;
  end loop;
end $mitigasi$;
