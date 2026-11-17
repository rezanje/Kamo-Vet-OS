-- "Batalkan penerimaan" untuk tagihan hasil Void & Terbitkan Ulang (Andri 17 Nov 2026, opsi B; kasus INV-202611-1285 pengganti INV-202611-1263).
--
-- Masalah: tagihan hasil terbit ulang membawa uang dari tagihan lama sebagai baris invoice_payments.transferred_from; Batalkan penerimaan menolaknya
-- (KOREKSI_BERJALAN / TERBIT_ULANG / PINDAHAN), sedangkan koreksi menolak total di bawah uang diterima. Jadi Owner tidak punya jalan untuk menurunkan
-- nilai nota (mis. diskon 50%) setelah terbit ulang.
--
-- Perbaikan (tanpa tabel/kolom/index baru; jejak tetap clinic_receipt_cancellations): baris pindahan dibalik dengan jalur pembayaran bertabel yang SUDAH ada
-- (baris minus reversal_of + jurnal 'klinik-ar' Dr 150001 / Cr rekening ASAL baris itu), sesudah pemeriksaan keselamatan yang menolak dengan bahasa biasa
-- semua bentuk yang belum didukung. Siapa yang boleh, urutan kunci, kunci idempotensi, tanggal efektif, periode terkunci, shift: TIDAK berubah (fungsi yang sama).
-- Stok, HPP, jurnal penjualan, poin loyalti, komisi: tidak disentuh.
--
-- Apply sebagai SATU transaksi (tanpa begin/commit sendiri). Tambalan berjangkar eksak atas definisi HIDUP, gagal tertutup bila berbeda; pemilik, ACL,
-- SECURITY DEFINER, search_path, lock_timeout tidak berubah (diperiksa).

create function clinic_private.cancel_receipt_transfer_check(p_invoice_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_chain uuid[]; v_nos text[]; v_asal text; v_bad record;
begin
  -- rantai asal: nota ini lalu nota yang di-void untuk menerbitkannya, dan seterusnya (terbit ulang berlapis).
  with recursive c(id, depth) as (
    select i.id, 0 from public.invoices i where i.id = p_invoice_id
    union all
    select i.reissued_from, c.depth + 1 from c join public.invoices i on i.id = c.id where i.reissued_from is not null and c.depth < 50)
  select array_agg(c.id order by c.depth), array_agg(i.invoice_no order by c.depth) into v_chain, v_nos
  from c join public.invoices i on i.id = c.id;

  if exists (select 1 from public.invoice_payments p where p.invoice_id = p_invoice_id and p.transferred_from is not null
             and (p.amount < 0 or p.reversal_of is not null)) then
    return jsonb_build_object('code', 'PINDAHAN_RIWAYAT', 'message',
      'Riwayat uang tagihan lama yang dipindahkan ke tagihan ini memuat pembatalan atau pengembalian; netonya tidak bisa dipastikan dari sini, jadi tidak ada yang diubah. Hubungi tim pengembang.');
  end if;
  if exists (select 1 from public.invoice_payments p where p.invoice_id = p_invoice_id and p.transferred_from is not null and p.receipt_id is not null) then
    return jsonb_build_object('code', 'PINDAHAN_KWITANSI', 'message',
      'Sebagian uang tagihan ini berasal dari kwitansi pada tagihan lama (pindahan terbit ulang); pembatalannya belum didukung dari sini. Hubungi tim pengembang.');
  end if;
  if exists (select 1 from public.invoice_payments p where p.invoice_id = p_invoice_id and p.transferred_from is not null and p.metode = 'Uang Muka') then
    return jsonb_build_object('code', 'PINDAHAN_UANG_MUKA', 'message',
      'Sebagian pembayaran tagihan ini berasal dari pemakaian uang muka pada tagihan lama (pindahan terbit ulang); pembatalannya belum didukung dari sini. Hubungi tim pengembang.');
  end if;
  select i.invoice_no into v_asal from public.invoices i
  where i.id = any (v_chain) and i.id <> p_invoice_id
    and (exists (select 1 from public.clinic_refunds r where r.invoice_id = i.id)
         or exists (select 1 from public.clinic_refund_requests q where q.invoice_id = i.id and q.status in ('pending', 'diproses')))
  order by i.invoice_no limit 1;
  if v_asal is not null then
    return jsonb_build_object('code', 'SUDAH_REFUND_ASAL', 'message',
      format('Tagihan asal %s sudah/sedang direfund, jadi uangnya tidak bisa dibatalkan dari tagihan pengganti ini. Selesaikan atau batalkan refund-nya dulu.', v_asal));
  end if;
  if exists (select 1 from public.clinic_payment_corrections k where k.invoice_id = any (v_chain)) then
    return jsonb_build_object('code', 'PINDAHAN_DIKOREKSI', 'message',
      'Metode bayar uang pada tagihan ini atau tagihan asalnya pernah dikoreksi; belum bisa dibatalkan dari sini. Hubungi tim pengembang.');
  end if;
  -- Rekening: saldo bersih tiap rekening uang di SELURUH jurnal rantai harus sama dengan jumlah baris pembayaran tagihan ini per rekening.
  -- Tidak sama = rekening penerimaan awal tidak bisa dipastikan; tidak menebak.
  select x.code into v_bad from (
    select coalesce(j.code, p.code) as code, coalesce(j.net, 0) as jn, coalesce(p.amt, 0) as pn
    from (select a.code::text as code, sum(l.debit - l.credit) as net
          from public.journal_entries e join public.journal_lines l on l.entry_id = e.id join public.coa_accounts a on a.id = l.account_id
          where e.voided_at is null and e.source_ref = any (v_nos)
            and e.source in ('klinik', 'klinik-void', 'klinik-reissue', 'klinik-edit', 'klinik-koreksi-bayar', 'klinik-ar')
            and a.code in (select p2.kas_code from public.invoice_payments p2 where p2.invoice_id = p_invoice_id and p2.kas_code is not null)
          group by a.code) j
    full join (select coalesce(p3.kas_code, '?')::text as code, sum(p3.amount) as amt from public.invoice_payments p3
               where p3.invoice_id = p_invoice_id group by coalesce(p3.kas_code, '?')) p on p.code = j.code) x
  where x.jn is distinct from x.pn limit 1;
  if found then
    return jsonb_build_object('code', 'REKENING_PINDAHAN', 'message',
      'Rekening penerimaan awal uang pindahan tagihan ini tidak bisa dipastikan dari jurnalnya (rekening ' || v_bad.code || '). Tidak ada yang diubah; hubungi tim pengembang.');
  end if;
  return null;
end $$;
revoke all on function clinic_private.cancel_receipt_transfer_check(uuid) from public, anon, authenticated, service_role;

create temp table bt_patch(n serial primary key, sig text not null, old_text text not null, new_text text not null, times integer not null default 1) on commit drop;
insert into bt_patch(sig, old_text, new_text, times) values
-- ============================== scan ==============================
('clinic_private.cancel_receipt_scan(uuid)',
 $old$  v_refuse jsonb := null; v_seen uuid[] := array[]::uuid[];
  v_out jsonb;
begin$old$,
 $new$  v_refuse jsonb := null; v_seen uuid[] := array[]::uuid[];
  v_out jsonb; v_recv numeric := 0; v_tc jsonb;
begin$new$, 1),
('clinic_private.cancel_receipt_scan(uuid)',
 $old$  elsif v_inv.correction_pending then$old$,
 $new$  -- BATAL_TERBIT_ULANG: nota hasil terbit ulang (correction_pending) boleh dibatalkan penerimaannya; sisanya tetap ditolak.
  elsif v_inv.correction_pending and v_inv.reissued_from is null then$new$, 1),
('clinic_private.cancel_receipt_scan(uuid)',
 $old$  elsif v_inv.reissued_from is not null then
    v_refuse := jsonb_build_object('code', 'TERBIT_ULANG', 'message', 'Tagihan ini hasil Void & Terbitkan Ulang; uangnya berasal dari tagihan lama sehingga belum bisa dibatalkan dari sini. Hubungi tim pengembang.');
$old$,
 $new$$new$, 1),
('clinic_private.cancel_receipt_scan(uuid)',
 $old$  elsif exists (select 1 from public.invoice_payments where invoice_id = v_inv.id and transferred_from is not null) then
    v_refuse := jsonb_build_object('code', 'PINDAHAN', 'message', 'Sebagian pembayaran tagihan ini berasal dari tagihan lama (pindahan terbit ulang); belum bisa dibatalkan dari sini.');
  end if;$old$,
 $new$  elsif clinic_private.invoice_received(v_inv.id) > 0
     and exists (select 1 from public.invoice_payments where invoice_id = v_inv.id and transferred_from is not null)
     and clinic_private.cancel_receipt_transfer_check(v_inv.id) is not null then
    v_refuse := clinic_private.cancel_receipt_transfer_check(v_inv.id);
  end if;
  v_recv := clinic_private.invoice_received(v_inv.id);$new$, 1),
('clinic_private.cancel_receipt_scan(uuid)',
 $old$    select * into v_app from public.clinic_advance_applications a where a.payment_id = v_p.id and a.released_at is null;
    if found then$old$,
 $new$    -- BATAL_TERBIT_ULANG: uang pindahan dari tagihan lama (hasil terbit ulang) dibalik seperti pembayaran bertabel biasa. Bila neto uang tagihan ini nol
    -- (salinan riwayat yang sudah saling meniadakan, mis. terbit ulang berlapis) TIDAK ada yang dibalik, supaya tidak pernah membalik dua kali.
    if v_p.transferred_from is not null then
      if v_recv > 0 then
        v_pays := v_pays || jsonb_build_array(jsonb_build_object('id', v_p.id, 'amount', v_p.amount, 'metode', v_p.metode,
          'kas_code', v_p.kas_code, 'checkout', v_p.checkout_payment, 'receipt_id', null, 'transferred', true,
          'transferred_from', v_p.transferred_from, 'transferred_from_no', (select i.invoice_no from public.invoices i where i.id = v_p.transferred_from)));
      end if;
      continue;
    end if;
    select * into v_app from public.clinic_advance_applications a where a.payment_id = v_p.id and a.released_at is null;
    if found then$new$, 1),
-- ============================== pratinjau ==============================
('public.clinic_cancel_invoice_receipt_preview(uuid,date)',
 $old$                where e ->> 'metode' = 'Tunai' and (e ->> 'checkout')::boolean), 0);$old$,
 $new$                where e ->> 'metode' = 'Tunai' and ((e ->> 'checkout')::boolean or coalesce((e ->> 'transferred')::boolean, false))), 0);  -- BATAL_TERBIT_ULANG$new$, 1),
-- ============================== eksekutor ==============================
('public.clinic_cancel_invoice_receipt(uuid,text,text,date)',
 $old$                where e ->> 'metode' = 'Tunai' and (e ->> 'checkout')::boolean), 0))::numeric(15,2);$old$,
 $new$                where e ->> 'metode' = 'Tunai' and ((e ->> 'checkout')::boolean or coalesce((e ->> 'transferred')::boolean, false))), 0))::numeric(15,2);  -- BATAL_TERBIT_ULANG$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text,date)',
 $old$    v_journal := public.clinic_write_journal(v_eff, 'Pembatalan penerimaan ' || v_inv.invoice_no, 'klinik-ar', v_inv.invoice_no, v_branch,
      jsonb_build_array(jsonb_build_object('code', '150001', 'debit', (v_el ->> 'amount')::numeric, 'credit', 0),$old$,
 $new$    v_journal := public.clinic_write_journal(v_eff, 'Pembatalan penerimaan ' || v_inv.invoice_no
        || case when coalesce((v_el ->> 'transferred')::boolean, false) then ' (pindahan dari ' || (v_el ->> 'transferred_from_no') || ')' else '' end,
      'klinik-ar', v_inv.invoice_no, v_branch,
      jsonb_build_array(jsonb_build_object('code', '150001', 'debit', (v_el ->> 'amount')::numeric, 'credit', 0),$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text,date)',
 $old$      'metode', v_el ->> 'metode', 'amount', (v_el ->> 'amount')::numeric, 'kas_code', v_el ->> 'kas_code')));
  end loop;$old$,
 $new$      'metode', v_el ->> 'metode', 'amount', (v_el ->> 'amount')::numeric, 'kas_code', v_el ->> 'kas_code')
      || case when coalesce((v_el ->> 'transferred')::boolean, false)
              then jsonb_build_object('payment_id', v_el ->> 'id', 'transferred', true, 'transferred_from', v_el ->> 'transferred_from',
                     'transferred_from_no', v_el ->> 'transferred_from_no') else '{}'::jsonb end));
  end loop;
  -- BATAL_TERBIT_ULANG: uang Tunai pindahan yang dibawa nota ini (shift_cash_carry) ikut berkurang bila shift asal masih terbuka, supaya hitungan
  -- laci shift terbuka tidak menghitung uang yang sudah dibatalkan. Shift asal yang sudah tutup TIDAK diubah (efek tercatat di shift pelaku).
  if v_mode = 'shift_asal_terbuka' and v_inv.metode_bayar = 'Tunai' then
    update public.invoices set shift_cash_carry = greatest(coalesce(shift_cash_carry, 0)
        - coalesce((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(v_scan -> 'payments') e
                    where e ->> 'metode' = 'Tunai' and coalesce((e ->> 'transferred')::boolean, false) and not (e ->> 'checkout')::boolean), 0), 0)
     where id = v_inv.id and shift_cash_carry is not null;
  end if;$new$, 1);

do $bt$
declare
  p record; q record; definition text; pre text; n_found integer;
begin
  for p in select distinct sig from bt_patch order by sig loop
    definition := pg_get_functiondef(p.sig::regprocedure);
    if position('BATAL_TERBIT_ULANG' in definition) > 0 then
      raise exception 'BATAL_TERBIT_ULANG already applied to %; inspect before re-running', p.sig;
    end if;
    pre := (select format('%s|%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype, provolatile) from pg_proc where oid = p.sig::regprocedure);
    for q in select * from bt_patch where sig = p.sig order by n loop
      n_found := (length(definition) - length(replace(definition, q.old_text, ''))) / length(q.old_text);
      if n_found <> q.times then
        raise exception 'BATAL_TERBIT_ULANG_DRIFT: % changed (anchor % found % times, expected %); review before release', p.sig, q.n, n_found, q.times;
      end if;
      definition := replace(definition, q.old_text, q.new_text);
    end loop;
    execute definition;
    if pre is distinct from (select format('%s|%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype, provolatile) from pg_proc where oid = p.sig::regprocedure) then
      raise exception 'BATAL_TERBIT_ULANG: pemilik/ACL/definer/config % berubah setelah ditambal', p.sig;
    end if;
    if position('BATAL_TERBIT_ULANG' in pg_get_functiondef(p.sig::regprocedure)) = 0 then
      raise exception 'BATAL_TERBIT_ULANG: definisi % tidak sesuai setelah ditambal', p.sig;
    end if;
  end loop;
end $bt$;
