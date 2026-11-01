-- Tutup paksa supervisor ikut membuang transaksi kasir yang terputus sebelum final.
--
-- Insiden 1 Nov 2026 (docs/2026-11-01-insiden-tutup-shift-tertahan.md): checkout yang mati di
-- antara "simpan kepala struk" dan "finalisasi atomik" meninggalkan penjualan dengan
-- payment_plan terisi tetapi payments_finalized_at kosong. pos_shift_pending_checkout_guard
-- lalu menolak setiap penutupan laci itu. Pembersihan aplikasi (src/lib/transaksi-terputus.ts)
-- hanya jalan untuk kasir pemilik struk, karena pos_sale_cancel_pending mewajibkan
-- auth.uid() = cashier_id. Laci kasir yang tidak bisa masuk lagi (resign, akun nonaktif)
-- menjadi tidak bisa ditutup sama sekali, termasuk lewat tutup paksa supervisor.
--
-- Perubahan:
-- 1. cashier_shift_supervisor_close, sesudah semua pemeriksaan lamanya (peran, cabang,
--    laci > 24 jam, alasan) dan kunci baris laci, memeriksa setiap penjualan belum-final di
--    laci itu. Yang dibuang hanya yang berumur >= 10 menit DAN tanpa jejak efek: tanpa
--    jurnal, tanpa mutasi stok, dan tanpa dokumen turunan (pembatalan, retur, refund,
--    koreksi, efek staf, harga baris). Bila ada yang masih baru atau sudah berefek, tutup
--    paksa ditolak UTUH dengan pesan SHIFT_SUPERVISOR_DENIED yang jelas — tidak ada yang
--    dibuang. Struk yang dibuang dicatat (beserta barangnya) di jejak tutup paksa.
-- 2. pos_sale_cancel_pending menerima penghapusan oleh bukan-kasir HANYA bila penanda
--    transaksi-lokal kamo.supervisor_pending_cleanup = shift_id struk itu (dipasang fungsi
--    di atas dengan set_config(..., true); klien PostgREST tidak bisa memasang GUC bebas),
--    dan pelakunya Owner/Admin aktif yang memegang cabang struk itu. Penolakan jurnal tetap.
--    RLS dan pemicu tidak dilonggarkan untuk Owner/Admin secara umum.
--
-- Pemeriksaan stok dan jurnal memakai nomor struk tanpa saringan sumber, jadi lebih ketat
-- daripada pembersihan aplikasi (stock_moves source sale/sale-group): jejak apa pun dengan
-- nomor struk itu membuat struk tidak dibuang otomatis.

alter table public.cashier_shift_supervisor_closures
  add column if not exists removed_pending_sales jsonb not null default '[]'::jsonb;
comment on column public.cashier_shift_supervisor_closures.removed_pending_sales is
  'Penjualan belum-final (checkout terputus) yang dibuang tutup paksa ini: id, no_struk, kasir, total, rencana bayar, barang.';

create or replace function public.pos_sale_cancel_pending() returns trigger
language plpgsql security definer set search_path='' as $$
declare posting public.pos_sale_postings%rowtype;
begin
 if old.payment_plan is null or old.payments_finalized_at is not null then return old;end if;
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
  or not public.user_can_access_branch(old.branch_id) then raise exception 'Akses pembatalan POS ditolak' using errcode='42501';end if;
 if old.cashier_id is distinct from auth.uid() then
  -- Bukan kasir pemilik: hanya pembersihan oleh cashier_shift_supervisor_close untuk laci ini.
  if old.shift_id is null
   or current_setting('kamo.supervisor_pending_cleanup',true) is distinct from old.shift_id::text
   or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in('OWNER','ADMIN')) then
   raise exception 'Akses pembatalan POS ditolak' using errcode='42501';
  end if;
 end if;
 select * into posting from public.pos_sale_postings where sale_id=old.id for update;
 if found then
  if posting.revenue_journal_id is not null or posting.hpp_journal_id is not null then raise exception 'Jurnal penjualan sudah diposting';end if;
  delete from public.pos_sale_postings where sale_id=old.id;
 end if;
 return old;
end $$;
revoke all on function public.pos_sale_cancel_pending() from public,anon,authenticated,service_role;

create or replace function public.cashier_shift_supervisor_close(
  p_shift_id uuid, p_reason text, p_expected numeric, p_breakdown jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_shift public.cashier_shifts%rowtype;
  v_sale public.sales%rowtype;
  v_label text;
  v_recent text[] := '{}';
  v_blocked text[] := '{}';
  v_ids uuid[] := '{}';
  v_labels text[] := '{}';
  v_removed jsonb := '[]'::jsonb;
  v_previous text;
  v_deleted integer;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: sesi tidak valid';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_actor and p.is_active;
  if v_role is null or v_role not in ('OWNER', 'ADMIN') then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: hanya Owner/Admin cabang yang bisa tutup paksa laci';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'SHIFT_SUPERVISOR_DENIED: alasan tutup paksa wajib diisi (10-500 karakter)';
  end if;
  if p_expected is null or p_expected in ('NaN'::numeric, 'Infinity'::numeric) or p_expected < 0
     or jsonb_typeof(coalesce(p_breakdown, 'null'::jsonb)) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'SHIFT_SUPERVISOR_DENIED: target kas laci tidak valid; muat ulang';
  end if;
  select * into v_shift from public.cashier_shifts where id = p_shift_id for update;
  if not found or not public.user_can_access_branch(v_shift.branch_id) then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: laci tidak ditemukan di cabang Anda';
  end if;
  if v_shift.status is distinct from 'open' then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: laci sudah ditutup';
  end if;
  if v_shift.opened_by is not distinct from v_actor then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: laci sendiri ditutup lewat Selesai Shift biasa';
  end if;
  if v_shift.opened_at > now() - interval '24 hours' then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: tutup paksa hanya untuk laci yang terbuka lebih dari 24 jam';
  end if;

  -- Transaksi kasir yang terputus sebelum final. Kepala struk baru dan finalisasi mengunci
  -- baris laci ini (pos_sale_assert_actor), jadi selama kunci di atas dipegang tidak ada
  -- penjualan belum-final baru yang muncul dan tidak ada yang mendadak final.
  for v_sale in
    select s.* from public.sales s
     where s.shift_id = v_shift.id and s.payment_plan is not null and s.payments_finalized_at is null
     order by s.created_at, s.id
     for update
  loop
    v_label := coalesce(v_sale.no_struk, v_sale.id::text);
    if v_sale.created_at > now() - interval '10 minutes' then
      -- Checkout yang masih berjalan selesai dalam hitungan detik; jangan dipotong.
      v_recent := v_recent || v_label;
    elsif v_sale.no_struk is null  -- tanpa nomor struk jejak stok/jurnal tidak bisa dipastikan
      or exists(select 1 from public.journal_entries j where j.source_ref = v_sale.no_struk)
      or exists(select 1 from public.pos_sale_postings p where p.sale_id = v_sale.id
                 and (p.revenue_journal_id is not null or p.hpp_journal_id is not null))
      or exists(select 1 from public.stock_moves m where m.source_ref = v_sale.no_struk)
      or exists(select 1 from public.stock_moves m join public.sale_items i on i.id = m.sale_line_id
                 where i.sale_id = v_sale.id)
      or exists(select 1 from public.sale_line_pricing x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sale_staff_effects x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sale_cancellations x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sale_cancellation_requests x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sales_returns x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sales_return_items x join public.sale_items i on i.id = x.source_line_id
                 where i.sale_id = v_sale.id)
      or exists(select 1 from public.sales_refund_requests x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sales_refund_payouts x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sale_payment_refunds x join public.sale_payments p on p.id = x.sale_payment_id
                 where p.sale_id = v_sale.id)
      or exists(select 1 from public.sale_payment_correction_gate x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sale_payment_correction_requests x where x.sale_id = v_sale.id)
      or exists(select 1 from public.sale_payment_corrections x where x.sale_id = v_sale.id)
    then
      v_blocked := v_blocked || v_label;
    else
      v_ids := v_ids || v_sale.id;
      v_labels := v_labels || v_label;
      v_removed := v_removed || jsonb_build_array(jsonb_build_object(
        'sale_id', v_sale.id, 'no_struk', v_sale.no_struk, 'created_at', v_sale.created_at,
        'cashier_id', v_sale.cashier_id, 'total', v_sale.total, 'metode_bayar', v_sale.metode_bayar,
        'payment_plan', v_sale.payment_plan,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', i.item_id, 'nama', i.nama, 'qty', i.qty,
                    'satuan', i.satuan, 'harga', i.harga) order by i.source_position nulls last, i.created_at, i.id), '[]'::jsonb)
                  from public.sale_items i where i.sale_id = v_sale.id)));
    end if;
  end loop;

  if cardinality(v_blocked) > 0 then
    raise exception using errcode = '55000',
      message = 'SHIFT_SUPERVISOR_DENIED: transaksi ' || array_to_string(v_blocked, ', ')
        || ' terputus sebelum selesai, tetapi stok atau pembukuannya sudah sempat tercatat, jadi tidak dibuang otomatis. '
        || 'Laporkan nomor struk ini ke tim teknis KAMO untuk dicocokkan dulu, baru laci bisa ditutup paksa';
  end if;
  if cardinality(v_recent) > 0 then
    raise exception using errcode = '55000',
      message = 'SHIFT_SUPERVISOR_DENIED: transaksi ' || array_to_string(v_recent, ', ')
        || ' di laci ini masih diproses (belum 10 menit). Tunggu 10 menit lalu tutup paksa lagi';
  end if;

  if cardinality(v_ids) > 0 then
    -- Penanda transaksi-lokal yang dibaca pos_sale_cancel_pending; dipulihkan sesudahnya.
    v_previous := current_setting('kamo.supervisor_pending_cleanup', true);
    perform set_config('kamo.supervisor_pending_cleanup', v_shift.id::text, true);
    begin
      delete from public.sales
       where id = any(v_ids) and shift_id = v_shift.id and payment_plan is not null and payments_finalized_at is null;
      get diagnostics v_deleted = row_count;
    exception when others then
      raise exception using errcode = '55000',
        message = 'SHIFT_SUPERVISOR_DENIED: transaksi ' || array_to_string(v_labels, ', ')
          || ' yang terputus tidak bisa dibuang otomatis. Laporkan nomor struk ini ke tim teknis KAMO',
        detail = sqlerrm;
    end;
    perform set_config('kamo.supervisor_pending_cleanup', coalesce(v_previous, ''), true);
    if v_deleted is distinct from cardinality(v_ids) then
      raise exception using errcode = '55000',
        message = 'SHIFT_SUPERVISOR_DENIED: transaksi ' || array_to_string(v_labels, ', ')
          || ' yang terputus tidak bisa dibuang otomatis. Laporkan nomor struk ini ke tim teknis KAMO';
    end if;
  end if;

  -- Tanpa hitung fisik: tidak ada kas yang dihitung, jadi selisih 0 dan tanpa jurnal.
  update public.cashier_shifts
     set closing_balance = p_expected, expected_cash = p_expected, selisih = 0,
         closing_breakdown = p_breakdown, closed_at = now(), status = 'closed'
   where id = v_shift.id and status = 'open';
  insert into public.cashier_shift_supervisor_closures
    (shift_id, branch_id, shift_type, drawer_owner, actor_id, actor_role, reason, opened_at, expected_cash, closing_breakdown,
     removed_pending_sales)
  values
    (v_shift.id, v_shift.branch_id, v_shift.shift_type, v_shift.opened_by, v_actor, v_role, v_reason, v_shift.opened_at, p_expected, p_breakdown,
     v_removed);
  return jsonb_build_object('shift_id', v_shift.id, 'status', 'closed', 'expected_cash', p_expected,
    'removed_pending_sales', to_jsonb(v_labels));
end $$;
revoke all on function public.cashier_shift_supervisor_close(uuid, text, numeric, jsonb) from public, anon;
grant execute on function public.cashier_shift_supervisor_close(uuid, text, numeric, jsonb) to authenticated;
