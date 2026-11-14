-- B2 (meeting 12 Nov 2026, keputusan Reza: pilihan A) — tutup kunjungan lunas, "Batalkan tagihan" klinik (void murni), arsip paksa
-- yang aman untuk racikan, dan alasan arsip di Log Aktifitas. Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
-- Lihat docs/meeting-2026-11-12/USULAN-B2.md (bagian "Implementasi") untuk ringkasan bahasa bisnis.
--
-- RANCANGAN
--  1. TUTUP KUNJUNGAN (Owner/Admin): public.clinic_close_settled_visit(p_visit_id) memanggil aturan yang SUDAH ADA
--     clinic_private.close_settled_visit (semua tagihan aktif Lunas, tidak ada koreksi berjalan, tidak ada rawat inap berjalan, tidak
--     ada baris rekam medis yang belum ditagih). Penolakan dijelaskan dalam bahasa biasa. Hanya status kunjungan yang berubah
--     (perubahan status sudah tercatat di Log Aktifitas lewat sumber "visits"). Tanpa jurnal/stok.
--  2. BATALKAN TAGIHAN (void murni, tanpa tagihan pengganti) untuk tagihan klinik Belum Lunas / DP:
--     * Siapa: OWNER selalu; peran lain HANYA bila izin Akses Grup 'klinik.batalkan_tagihan' dicentang (izin khusus, bawaan MATI;
--       pola clinic_private.cancel_receipt_actor). Cabang tagihan harus bisa diakses. Alasan wajib (3-500 huruf), kunci permintaan wajib
--       (idempoten; kunci sama + isi beda = ditolak).
--     * Pratinjau baca-saja public.clinic_void_invoice_preview: daftar efek + penolakan dalam bahasa biasa (kode yang sama dipakai eksekusi).
--     * Ditolak (bahasa biasa): tagihan Lunas (batalkan penerimaan dulu), masih ada uang yang diterima lewat kasir/kwitansi/pelunasan
--       (batalkan penerimaan dulu), dibayar dari saldo uang muka (batalkan penerimaan dulu: uang kembali ke saldo uang muka), rawat inap
--       (tagihan tahap, rawat inap berjalan maupun sudah pulang: di luar cakupan), hasil terbit ulang / koreksi berjalan, refund, DEMO,
--       kode kampanye/rombongan, koreksi metode bayar, uang tagihan masih tercatat di shift kasir yang sedang buka (hitungan laci tutup
--       shift membaca tagihan yang tidak dibatalkan; tunggu shift ditutup), metode persediaan rata-rata, periode akuntansi tertutup pada
--       tanggal tagihan asli, periode persediaan tertutup pada HARI INI, penggajian bulan tagihan sudah dibuat, poin dari tagihan ini sudah
--       terpakai, kartu stok/HPP tidak cocok.
--     * Tanggal (aturan "2A" keputusan B3 A, sama dengan 20261116300000 Ubah transaksi dan 20261114141422 B3): jurnal pembalik pendapatan
--       'klinik-void' (pendapatan, diskon, pajak, piutang, DP -> uang muka) dibukukan di TANGGAL TAGIHAN ASLI (tanggal jurnal penjualan
--       pertama); jurnal pembalik HPP 'klinik-hpp-void' dan SEMUA pengembalian stok bertanggal HARI INI (current_date, seperti kode klinik
--       lain; stok fisik kembali hari ini). Pagar periode akuntansi dan penggajian dibaca pada tanggal asli (bagian pendapatan); pagar periode
--       persediaan pada hari ini. Keduanya = kebalikan bersih jurnal tagihan itu (sumber klinik/klinik-reissue/klinik-edit dan
--       klinik-hpp/klinik-hpp-edit), sama dengan cara "Void & terbitkan ulang". Baris kas/bank TIDAK dibalik (jadi tidak ada pagar
--       rekonsiliasi bank yang relevan: tidak ada baris rekening kas/bank di jurnal pembatalan).
--     * DP di kepala tagihan (dp_amount): uangnya tetap di rekening penerimaannya dan menjadi SALDO UANG MUKA pelanggan (UMK baru, visit_id =
--       kunjungan ini, tanpa kwitansi) dengan Cr 314001 di jurnal 'klinik-void'. Pengembalian ke pelanggan lewat jalur yang sudah ada
--       ("Kembalikan saldo uang muka"). Kolom dp_amount tagihan dibiarkan (riwayat laci shift tidak berubah).
--     * Stok dikembalikan bertanggal HARI INI: obat/BMHP = mutasi bersih kartu stok tagihan (klinik, klinik-bmhp, pesanan-selesai,
--       klinik-edit) per gudang+barang masuk lagi sebagai lapisan baru pada biaya tercatat (stock_in_fifo, sumber 'klinik-void'; mutasi
--       klinik tidak menyimpan rincian lapisan asal, jadi lapisan asal tidak bisa dipulihkan — sama dengan "Tarik baris"). Racikan = bukti
--       pengeluaran compound_issues: kembali ke LAPISAN ASAL (stock_layer_id) bila lapisan itu masih cocok (gudang, barang, biaya fisik, muat),
--       kalau tidak sebagai lapisan baru dengan tanggal kedaluwarsa dan biaya fisik yang sama (pola clinic_void_compound); restored_at diisi.
--       Nilai stok yang kembali wajib sama dengan HPP yang dibalik (toleransi Rp1), kalau tidak ditolak (tidak menebak).
--     * Poin loyalti: total poin bersih tagihan ini (point_ledger.ref = nomor tagihan) dibalik dengan satu baris 'adjustment'; saldo tidak
--       pernah minus (poin sudah terpakai = ditolak).
--     * Komisi/insentif dan laporan membaca baris tagihan Lunas yang tidak dibatalkan (voided_at is null), jadi tagihan ini otomatis keluar.
--     * Baris rekam medis yang ditagih ditarik dari penagihan (billing_withdrawn_*) supaya kasir tidak menagihnya lagi; isi rekam medis utuh.
--     * invoices.voided_at diisi; alasan, pelaku, waktu, rincian efek ada di jejak tetap public.clinic_invoice_voids (tidak bisa diubah/
--       dihapus) + invoice_edit_log + Log Aktifitas (sumber baru clinic_invoice_voids, label berisi nomor tagihan dan alasan).
--     * Jendela tanggal efektif "Batalkan penerimaan" yang masih terbuka untuk tagihan ini ditutup ('dilepas').
--     * Tidak ada jurnal ke rekening kas/bank, jadi rekonsiliasi bank tidak terpengaruh (tidak perlu pagar rekonsiliasi).
--  3. ARSIP SESUDAH BATAL: clinic_private.visit_archive_classify ditambal berjangkar: tagihan yang dibatalkan lewat jalur ini, pembayarannya
--     (bersih nol), kwitansi yang sudah dibatalkan untuk tagihan itu, uang muka hasil DP yang sudah habis dikembalikan/terpakai, dan penjualan
--     racikan yang bahannya sudah kembali TIDAK lagi menjadi penghalang KERAS. Sisanya tetap (isi rekam medis = penghalang lunak, perlu
--     "Paksa arsip"). Saldo DP yang belum dikembalikan tetap penghalang keras dengan pesan sendiri.
--  4. PAKSA ARSIP + RACIKAN: kunjungan yang racikannya sudah memotong stok (compound_issues belum dipulihkan) sekarang DITOLAK keras dengan
--     pesan "kembalikan bahan racikan dulu atau tagihkan" (dipilih yang lebih aman daripada membatalkan racikan diam-diam di dalam arsip:
--     racikan yang sudah diserahkan ke pasien tidak boleh dikembalikan ke stok, dan arsip tetap tidak menggerakkan stok/jurnal).
--  5. LOG AKTIFITAS: visit_archive_events (arsip/pulihkan) didaftarkan sebagai sumber dengan label berisi alasan + tanda PAKSA (kolom
--     turunan log_label); nilai 'forced' ikut tercatat.
--
-- DAMPAK: hanya objek baru + satu tambalan berjangkar pada visit_archive_classify + kolom turunan pada visit_archive_events (tabel kecil,
-- ditulis ulang sekali). Tidak ada backfill, tidak ada data lama yang diubah. Arsip PAKSA yang dulu bisa melewati racikan terpotong kini ditolak.
-- ROLLBACK (manual, bila perlu, sebelum ada tagihan yang dibatalkan): drop function public.clinic_void_invoice(uuid,text,text),
-- public.clinic_void_invoice_preview(uuid), public.clinic_invoice_void_allowed(), public.clinic_close_settled_visit(uuid) dan fungsi
-- clinic_private.invoice_void_*; kembalikan visit_archive_classify dari 20261107220000; hapus baris activity_log_sources 'clinic_invoice_voids'
-- dan 'visit_archive_events' + trigger a01_*; drop kolom visit_archive_events.log_label; hapus baris katalog 'klinik.batalkan_tagihan'.
-- Setelah ada tagihan yang dibatalkan, jangan drop public.clinic_invoice_voids (jejak + penanda arsip).
set local lock_timeout = '5s';

do $guard$
declare d text;
begin
  if to_regclass('public.clinic_invoice_voids') is not null
     or to_regprocedure('public.clinic_void_invoice(uuid,text,text)') is not null
     or to_regprocedure('public.clinic_close_settled_visit(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'visit_archive_events' and column_name = 'log_label')
     or exists (select 1 from public.activity_log_sources where entity in ('clinic_invoice_voids', 'visit_archive_events')) then
    raise exception 'B2_PRECONDITION: objek B2 sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('clinic_private.close_settled_visit(uuid)') is null
     or to_regprocedure('clinic_private.visit_archive_classify(uuid)') is null
     or to_regprocedure('clinic_private.billing_lock(text[])') is null
     or to_regprocedure('clinic_private.billing_keys_invoice(uuid)') is null
     or to_regprocedure('clinic_private.next_no(text,text,integer,date,regclass,text)') is null
     or to_regprocedure('clinic_private.backdate_window_close(uuid,text,uuid,text)') is null
     or to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.clinic_reverse_journal_lines(text,text[])') is null
     or to_regprocedure('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)') is null
     or to_regprocedure('public.inventory_is_average()') is null
     or to_regprocedure('public.role_action_allowed(text)') is null
     or to_regprocedure('public.user_can_access_branch(uuid)') is null
     or to_regprocedure('public.capture_activity_log()') is null
     or to_regclass('clinic_private.record_edit_permits') is null
     or to_regclass('public.compound_issues') is null
     or to_regclass('public.clinic_customer_advances') is null
     or to_regclass('public.clinic_demo_invoice_snapshots') is null
     or to_regclass('public.clinic_payment_corrections') is null
     or to_regclass('public.payrolls') is null
     or to_regclass('public.cashier_shifts') is null
     or to_regclass('public.clinic_receipt_cancellations') is null
     or to_regclass('public.inventory_costing_settings') is null
     or to_regclass('public.visit_archive_events') is null then
    raise exception 'B2_PRECONDITION: prasyarat tidak lengkap; periksa urutan migrasi';
  end if;
  -- Aturan penutupan yang dipakai "Tutup kunjungan" harus persis aturan yang ditinjau (20261106530000).
  d := pg_get_functiondef('clinic_private.close_settled_visit(uuid)'::regprocedure);
  if position('i.paid_status <> ''Lunas'' or i.correction_pending' in d) = 0 or position('r.discharged_at is null' in d) = 0
     or position('pi.billing_withdrawn_at is null' in d) = 0 or position('v.archived_at is null' in d) = 0 then
    raise exception 'B2_PRECONDITION: close_settled_visit tidak seperti yang ditinjau';
  end if;
end $guard$;

-- ───────────────────────── 1. Izin Akses Grup (izin khusus, bawaan MATI) ─────────────────────────
insert into role_settings_private.action_catalog(id, label, "group", enforced)
values ('klinik.batalkan_tagihan', 'Batalkan tagihan klinik (belum lunas/DP) — jurnal, stok, DP dan poin dibalik; bawaan hanya Owner', 'Klinik', true)
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id)
values ('klinik.batalkan_tagihan', 'klinik')
on conflict (id) do nothing;

create function clinic_private.invoice_void_actor() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.user_role; v_ok boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return null; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null then return null; end if;
  -- Owner tidak pernah dikunci oleh tabel kebijakan.
  if v_role = 'OWNER' then return 'OWNER'; end if;
  begin
    v_ok := exists (select 1 from role_settings_private.action_policies a
                    where a.role = v_role and 'klinik.batalkan_tagihan' = any (a.allowed))
            and public.role_action_allowed('klinik.batalkan_tagihan');
  exception when others then
    v_ok := false;
  end;
  return case when v_ok then 'GRANT' else null end;
end $$;
revoke all on function clinic_private.invoice_void_actor() from public, anon, authenticated, service_role;

create function public.clinic_invoice_void_allowed() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  return clinic_private.invoice_void_actor() is not null;
end $$;
comment on function public.clinic_invoice_void_allowed() is 'Untuk layar: boleh menampilkan tombol "Batalkan tagihan" klinik? OWNER selalu; peran lain hanya bila izin klinik.batalkan_tagihan dicentang. Bukan otorisasi.';
revoke all on function public.clinic_invoice_void_allowed() from public, anon, service_role;
grant execute on function public.clinic_invoice_void_allowed() to authenticated;

-- ───────────────────────── 2. Jejak tetap ─────────────────────────
create table public.clinic_invoice_voids (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (length(request_key) between 1 and 100),
  request_hash text not null,
  actor_id uuid not null,
  actor_role text not null,
  invoice_id uuid not null unique references public.invoices(id),
  invoice_no text not null,
  visit_id uuid not null,
  branch_id uuid not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  original_date date not null,
  tanggal date not null,
  total numeric(15,2) not null,
  dp_converted numeric(15,2) not null default 0 check (dp_converted >= 0),
  advance_id uuid,
  advance_no text,
  stock_value numeric(15,2) not null default 0,
  hpp_reversed numeric(15,2) not null default 0,
  points_delta integer not null default 0,
  stock_effects jsonb not null default '[]'::jsonb,
  journal_ids uuid[] not null default '{}',
  withdrawn_items uuid[] not null default '{}',
  before_invoice jsonb not null,
  result jsonb not null,
  log_label text generated always as ('Batalkan tagihan ' || invoice_no || ' — alasan: ' || reason) stored,
  created_at timestamptz not null default clock_timestamp(),
  constraint clinic_invoice_voids_dp check ((dp_converted > 0) = (advance_id is not null))
);
create index clinic_invoice_voids_visit on public.clinic_invoice_voids (visit_id);
create index clinic_invoice_voids_advance on public.clinic_invoice_voids (advance_id) where advance_id is not null;
alter table public.clinic_invoice_voids enable row level security;
create policy clinic_invoice_voids_read on public.clinic_invoice_voids for select to authenticated
  using (public.user_can_access_branch(branch_id));
revoke all on public.clinic_invoice_voids from public, anon, authenticated, service_role;
grant select on public.clinic_invoice_voids to authenticated;
comment on table public.clinic_invoice_voids is 'B2: jejak tetap "Batalkan tagihan" klinik (void murni). Satu baris per tagihan; juga penanda bagi aturan arsip kunjungan.';

create function clinic_private.invoice_void_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'AUDIT_IMMUTABLE: jejak batalkan tagihan tidak dapat diubah atau dihapus';
end $$;
revoke all on function clinic_private.invoice_void_immutable() from public, anon, authenticated, service_role;
create trigger clinic_invoice_voids_immutable before update or delete on public.clinic_invoice_voids
  for each row execute function clinic_private.invoice_void_immutable();
create trigger clinic_invoice_voids_no_truncate before truncate on public.clinic_invoice_voids
  for each statement execute function clinic_private.invoice_void_immutable();

-- ───────────────────────── 3. Pemeriksaan baca-saja (satu sumber untuk pratinjau dan eksekusi) ─────────────────────────
-- Mengembalikan jsonb: refuse null|{code,message}; invoice{...}; original_date; dp; customer_id; points_net; stock[]; stock_value;
-- racik[]; racik_value; hpp_reversed; rx_ids[]. Tidak mengubah apa pun.
create function clinic_private.invoice_void_scan(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inv public.invoices%rowtype; v_vis public.visits%rowtype;
  v_refuse jsonb := null; v_orig date; v_acc date; v_invlock date;
  v_paid numeric := 0; v_money numeric := 0; v_hpp numeric := 0; v_points integer := 0; v_cust_points integer;
  v_stock jsonb := '[]'::jsonb; v_stock_value numeric := 0; v_racik jsonb := '[]'::jsonb; v_racik_value numeric := 0;
  v_bad_stock text; v_rx uuid[]; v_info jsonb;
  c_cost_tolerance constant numeric := 1;   -- selisih nilai stok kembali vs HPP dibalik yang masih diterima (pembulatan per baris)
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('refuse', jsonb_build_object('code', 'TAGIHAN', 'message', 'Tagihan tidak ditemukan.'));
  end if;
  select * into v_vis from public.visits where id = v_inv.visit_id;
  v_info := jsonb_build_object('id', v_inv.id, 'no', v_inv.invoice_no, 'total', v_inv.total, 'paid_status', v_inv.paid_status,
    'dp_amount', coalesce(v_inv.dp_amount, 0), 'visit_id', v_inv.visit_id, 'branch_id', v_vis.branch_id, 'customer_id', v_vis.customer_id,
    'voided_at', v_inv.voided_at);
  v_orig := coalesce((select min(e.tanggal) from public.journal_entries e
                      where e.source in ('klinik', 'klinik-reissue') and e.source_ref = v_inv.invoice_no and e.voided_at is null),
                     (v_inv.created_at at time zone 'Asia/Jakarta')::date);
  select coalesce(sum(p.amount), 0) into v_paid from public.invoice_payments p where p.invoice_id = v_inv.id;

  if v_inv.voided_at is not null then
    v_refuse := jsonb_build_object('code', 'SUDAH_BATAL', 'message', case when exists (select 1 from public.clinic_invoice_voids w where w.invoice_id = v_inv.id)
      then 'Tagihan ini sudah dibatalkan.' else 'Tagihan ini sudah dibatalkan lewat Void & Terbitkan Ulang; tagihan penggantinya yang dipakai.' end);
  elsif v_inv.request_key is null or v_inv.invoice_no is null then
    v_refuse := jsonb_build_object('code', 'BELUM_TERBIT', 'message', 'Tagihan belum selesai tersimpan.');
  elsif v_inv.paid_status = 'Lunas' then
    v_refuse := jsonb_build_object('code', 'LUNAS', 'message', 'Tagihan ini sudah Lunas. Batalkan penerimaannya dulu (tombol "Batalkan penerimaan"), lalu batalkan tagihannya.');
  elsif v_inv.paid_status not in ('Belum Lunas', 'DP') then
    v_refuse := jsonb_build_object('code', 'STATUS', 'message', 'Status bayar tagihan ini tidak dikenal; tidak ada yang diubah.');
  elsif v_inv.stage_billing or exists (select 1 from public.inpatient_records r where r.visit_id = v_inv.visit_id)
     or exists (select 1 from public.clinic_inpatient_billable_entries e where e.visit_id = v_inv.visit_id) then
    v_refuse := jsonb_build_object('code', 'RAWAT_INAP', 'message', 'Tagihan rawat inap (tahap, masih dirawat, maupun sudah pulang) belum bisa dibatalkan dari sini. Gunakan koreksi tagihan rawat inap yang sudah ada.');
  elsif v_vis.archived_at is not null then
    v_refuse := jsonb_build_object('code', 'DIARSIPKAN', 'message', 'Kunjungan ini sudah diarsipkan. Pulihkan dulu dari tab Diarsipkan.');
  elsif v_inv.correction_pending then
    v_refuse := jsonb_build_object('code', 'KOREKSI_BERJALAN', 'message', 'Tagihan ini sedang dalam koreksi (hasil Void & Terbitkan Ulang). Selesaikan koreksinya dulu.');
  elsif v_inv.reissued_from is not null or exists (select 1 from public.invoice_payments p where p.invoice_id = v_inv.id and p.transferred_from is not null) then
    v_refuse := jsonb_build_object('code', 'TERBIT_ULANG', 'message', 'Tagihan ini hasil Void & Terbitkan Ulang; belum bisa dibatalkan dari sini. Hubungi tim pengembang.');
  elsif exists (select 1 from public.clinic_refunds f where f.invoice_id = v_inv.id)
     or exists (select 1 from public.clinic_refund_requests f where f.invoice_id = v_inv.id) then
    v_refuse := jsonb_build_object('code', 'REFUND', 'message', 'Tagihan ini punya refund atau permintaan refund; tidak bisa dibatalkan.');
  elsif exists (select 1 from public.clinic_demo_invoice_snapshots s where s.invoice_id = v_inv.id) then
    v_refuse := jsonb_build_object('code', 'DEMO', 'message', 'Tagihan DEMO terkunci; tidak bisa dibatalkan dari sini.');
  elsif v_inv.campaign_code is not null or v_inv.campaign_carrier_id is not null
     or exists (select 1 from public.invoices o where o.campaign_carrier_id = v_inv.id) then
    v_refuse := jsonb_build_object('code', 'KAMPANYE', 'message', 'Tagihan ini memakai kode kampanye / nota rombongan; belum bisa dibatalkan dari sini.');
  elsif exists (select 1 from public.clinic_payment_corrections c where c.invoice_id = v_inv.id) then
    v_refuse := jsonb_build_object('code', 'METODE_DIKOREKSI', 'message', 'Metode bayar tagihan ini pernah dikoreksi; belum bisa dibatalkan dari sini. Hubungi tim pengembang.');
  elsif exists (select 1 from public.clinic_advance_applications a where a.invoice_id = v_inv.id and a.released_at is null) then
    v_refuse := jsonb_build_object('code', 'UANG_MUKA_DIPAKAI', 'message', 'Tagihan ini dibayar dari saldo uang muka. Batalkan penerimaannya dulu (uangnya kembali ke saldo uang muka pelanggan), lalu batalkan tagihannya.');
  elsif v_paid <> 0 then
    v_refuse := jsonb_build_object('code', 'ADA_PENERIMAAN', 'message', 'Tagihan ini sudah menerima pembayaran lewat kasir (kwitansi/pelunasan). Batalkan penerimaannya dulu (tombol "Batalkan penerimaan"), lalu batalkan tagihannya.');
  elsif exists (select 1 from public.cashier_shifts s where s.id = v_inv.shift_id and s.status = 'open')
     and (coalesce(v_inv.dp_amount, 0) > 0 or exists (select 1 from public.invoice_payments p where p.invoice_id = v_inv.id)
          or exists (select 1 from public.clinic_receipt_cancellations c where c.invoice_id = v_inv.id)) then
    -- Hitungan laci tutup shift klinik membaca tagihan yang TIDAK dibatalkan: membatalkan tagihan yang uangnya masih tercatat di shift
    -- yang sedang buka akan menggeser target kas laci itu. Tunggu shift ditutup (rekaman shift yang sudah tutup tidak berubah).
    v_refuse := jsonb_build_object('code', 'SHIFT_BUKA', 'message', 'Uang tagihan ini masih tercatat di shift kasir yang sedang buka. Tutup shift itu dulu, lalu batalkan tagihannya (supaya hitungan laci tidak berubah).');
  elsif public.inventory_is_average() then
    v_refuse := jsonb_build_object('code', 'RATA_RATA', 'message', 'Metode persediaan rata-rata belum didukung untuk batalkan tagihan.');
  elsif coalesce(v_inv.dp_amount, 0) > 0 and v_vis.customer_id is null then
    v_refuse := jsonb_build_object('code', 'TANPA_PEMILIK', 'message', 'DP tagihan ini tidak bisa disimpan sebagai saldo uang muka karena kunjungan tanpa data pemilik.');
  elsif not exists (select 1 from public.journal_entries e where e.source in ('klinik', 'klinik-reissue') and e.source_ref = v_inv.invoice_no) then
    v_refuse := jsonb_build_object('code', 'JURNAL', 'message', 'Jurnal penjualan tagihan ini tidak ditemukan; tidak ada yang diubah. Hubungi tim pengembang.');
  end if;

  if v_refuse is null then
    -- Pagar: periode akuntansi + penggajian pada TANGGAL TAGIHAN ASLI (jurnal pendapatan dibukukan di sana; periode yang mencakup hari ini
    -- otomatis ikut tertutup karena tanggal asli <= hari ini); periode persediaan pada HARI INI (HPP dan stok kembali hari ini, aturan 2A).
    select l.closed_until into v_acc from public.accounting_locks l where l.id;
    select s.closed_through into v_invlock from public.inventory_costing_settings s where s.id;
    if v_acc is not null and v_orig <= v_acc then
      v_refuse := jsonb_build_object('code', 'PERIODE_TERKUNCI', 'message', format('Periode akuntansi sampai %s sudah ditutup, jadi tagihan bertanggal %s tidak bisa dibatalkan. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku.', v_acc, v_orig));
    elsif v_invlock is not null and current_date <= v_invlock then
      v_refuse := jsonb_build_object('code', 'PERSEDIAAN_TERKUNCI', 'message', format('Periode persediaan sampai %s sudah ditutup, jadi stok tagihan tidak bisa dikembalikan hari ini (%s). Owner perlu membuka kembali periode persediaan.', v_invlock, current_date));
    elsif exists (select 1 from public.payrolls pr where pr.periode = to_char(v_orig, 'YYYY-MM')) then
      v_refuse := jsonb_build_object('code', 'GAJI_SUDAH_DIBUAT', 'message', format('Penggajian bulan %s sudah dibuat, jadi tagihan bulan itu tidak bisa dibatalkan sekarang. Hitung ulang/hapus penggajiannya lebih dulu.', to_char(v_orig, 'YYYY-MM')));
    end if;
  end if;

  if v_refuse is null then
    -- Uang yang tercatat di jurnal tagihan pada rekening kas/bank (bukan piutang/persediaan) harus tepat sebesar DP di kepala tagihan.
    select coalesce(sum(l.debit - l.credit), 0) into v_money
    from public.journal_entries e join public.journal_lines l on l.entry_id = e.id join public.coa_accounts a on a.id = l.account_id
    where e.source_ref = v_inv.invoice_no and e.source in ('klinik', 'klinik-reissue', 'klinik-edit') and e.voided_at is null
      and a.type = 'ASET' and a.code not in ('150001', '170001');
    if v_money is distinct from coalesce(v_inv.dp_amount, 0) then
      v_refuse := jsonb_build_object('code', 'REKENING', 'message', 'Uang di jurnal tagihan ini tidak sama dengan DP-nya; tidak ada yang diubah. Hubungi tim pengembang.');
    end if;
  end if;

  if v_refuse is null then
    -- Stok obat/BMHP: mutasi bersih kartu stok tagihan per gudang+barang.
    select coalesce(jsonb_agg(jsonb_build_object('warehouse_id', s.warehouse_id, 'item_id', s.item_id, 'qty', s.qty, 'cost', round(s.cost, 2))
             order by s.item_id, s.warehouse_id) filter (where s.qty > 0), '[]'::jsonb),
           coalesce(sum(round(s.cost, 2)) filter (where s.qty > 0), 0),
           string_agg(s.item_id::text, ',') filter (where s.qty < 0 or (s.qty = 0 and abs(s.cost) > c_cost_tolerance))
      into v_stock, v_stock_value, v_bad_stock
    from (select m.warehouse_id, m.item_id, -sum(m.qty) as qty, -sum(m.qty * m.unit_cost) as cost
          from public.stock_moves m
          where m.source_ref = v_inv.invoice_no and m.source in ('klinik', 'klinik-bmhp', 'pesanan-selesai', 'klinik-edit')
          group by m.warehouse_id, m.item_id) s;
    -- Racikan: bukti pengeluaran bahan per baris racikan tagihan ini.
    select coalesce(jsonb_agg(jsonb_build_object('id', ci.id, 'recipe_id', ci.recipe_id, 'warehouse_id', ci.warehouse_id, 'item_id', ci.item_id,
             'layer_id', ci.stock_layer_id, 'qty', ci.qty, 'unit_cost', ci.unit_cost, 'physical_unit_cost', coalesce(ci.physical_unit_cost, ci.unit_cost),
             'exp_date', ci.exp_date) order by ci.item_id, ci.id), '[]'::jsonb),
           coalesce(round(sum(ci.qty * ci.unit_cost), 2), 0)
      into v_racik, v_racik_value
    from public.compound_issues ci join public.invoice_items ii on ii.id = ci.posted_invoice_item_id
    where ii.invoice_id = v_inv.id and ci.restored_at is null;
    select coalesce(sum(l.debit - l.credit), 0) into v_hpp
    from public.journal_entries e join public.journal_lines l on l.entry_id = e.id join public.coa_accounts a on a.id = l.account_id
    where e.source_ref = v_inv.invoice_no and e.source in ('klinik-hpp', 'klinik-hpp-edit') and a.code = '600001';
    if v_bad_stock is not null then
      v_refuse := jsonb_build_object('code', 'STOK', 'message', 'Kartu stok tagihan ini tidak bisa dibalik dengan pasti; tidak ada yang diubah. Hubungi tim pengembang.');
    elsif exists (select 1 from public.compound_issues ci join public.invoice_items ii on ii.id = ci.posted_invoice_item_id
                  where ii.invoice_id = v_inv.id and ci.restored_at is not null) then
      v_refuse := jsonb_build_object('code', 'RACIKAN', 'message', 'Bahan sebagian racikan tagihan ini sudah dikembalikan sebelumnya; tidak ada yang diubah. Hubungi tim pengembang.');
    elsif abs((v_stock_value + v_racik_value) - v_hpp) > c_cost_tolerance then
      v_refuse := jsonb_build_object('code', 'HPP', 'message', format('Nilai stok yang akan kembali (Rp %s) tidak sama dengan HPP tagihan (Rp %s); tidak ada yang diubah. Hubungi tim pengembang.',
        round(v_stock_value + v_racik_value, 2), round(v_hpp, 2)));
    end if;
  end if;

  if v_refuse is null and v_vis.customer_id is not null then
    select coalesce(sum(l.delta), 0) into v_points from public.point_ledger l where l.customer_id = v_vis.customer_id and l.ref = v_inv.invoice_no;
    select coalesce(c.points, 0) into v_cust_points from public.customers c where c.id = v_vis.customer_id;
    if v_points > 0 and coalesce(v_cust_points, 0) < v_points then
      v_refuse := jsonb_build_object('code', 'POIN_TERPAKAI', 'message', format('Poin dari tagihan ini (%s poin) sebagian sudah dipakai pelanggan (saldo sekarang %s poin), jadi tagihan tidak bisa dibatalkan tanpa membuat poin minus. Sesuaikan poin pelanggan dulu.', v_points, coalesce(v_cust_points, 0)));
    end if;
  end if;

  select coalesce(array_agg(distinct ii.prescription_item_id) filter (where ii.prescription_item_id is not null), '{}') into v_rx
  from public.invoice_items ii join public.prescription_items pi on pi.id = ii.prescription_item_id
  where ii.invoice_id = v_inv.id and pi.billing_withdrawn_at is null;

  return jsonb_build_object('refuse', v_refuse, 'invoice', v_info, 'original_date', v_orig, 'stock_date', current_date,
    'today', (now() at time zone 'Asia/Jakarta')::date, 'dp', coalesce(v_inv.dp_amount, 0), 'customer_id', v_vis.customer_id,
    'points_net', v_points, 'stock', v_stock, 'stock_value', round(v_stock_value, 2), 'racik', v_racik, 'racik_value', v_racik_value,
    'hpp_reversed', round(v_hpp, 2), 'rx_ids', to_jsonb(v_rx), 'line_count', (select count(*) from public.invoice_items ii where ii.invoice_id = v_inv.id));
end $$;
revoke all on function clinic_private.invoice_void_scan(uuid) from public, anon, authenticated, service_role;

create function public.clinic_void_invoice_preview(p_invoice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor text := clinic_private.invoice_void_actor(); v_scan jsonb; v_branch uuid;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya Owner (atau peran yang diberi izin "Batalkan tagihan" di Akses Grup) yang boleh membatalkan tagihan';
  end if;
  v_scan := clinic_private.invoice_void_scan(p_invoice_id);
  v_branch := nullif(v_scan #>> '{invoice,branch_id}', '')::uuid;
  if v_branch is null or not public.user_can_access_branch(v_branch) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: tagihan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  return (v_scan - 'rx_ids' - 'racik' - 'stock') || jsonb_build_object('actor', v_actor,
    'stock_lines', jsonb_array_length(coalesce(v_scan -> 'stock', '[]'::jsonb)), 'racik_lines', jsonb_array_length(coalesce(v_scan -> 'racik', '[]'::jsonb)),
    'withdraw_count', jsonb_array_length(coalesce(v_scan -> 'rx_ids', '[]'::jsonb)));
end $$;
revoke all on function public.clinic_void_invoice_preview(uuid) from public, anon, service_role;
grant execute on function public.clinic_void_invoice_preview(uuid) to authenticated;

-- ───────────────────────── 4. Eksekusi atomik ─────────────────────────
create function public.clinic_void_invoice(p_invoice_id uuid, p_request_key text, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_user uuid := auth.uid();
  v_actor text := clinic_private.invoice_void_actor();
  v_role text; v_key text := nullif(btrim(p_request_key), ''); v_reason text := nullif(btrim(p_reason), ''); v_hash text;
  v_prior public.clinic_invoice_voids%rowtype; v_vis public.visits%rowtype; v_inv public.invoices%rowtype;
  v_scan jsonb; v_orig date; v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_lines jsonb; v_dp numeric(15,2); v_jid uuid; v_journals uuid[] := array[]::uuid[];
  v_adv_id uuid; v_adv_no text; v_el jsonb; v_layer public.stock_layers%rowtype; v_effects jsonb := '[]'::jsonb; v_name text;
  v_points integer := 0; v_balance integer; v_rx uuid[]; v_check numeric; v_audit uuid := gen_random_uuid(); v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya Owner (atau peran yang diberi izin "Batalkan tagihan" di Akses Grup) yang boleh membatalkan tagihan';
  end if;
  if p_invoice_id is null or v_key is null or length(v_key) > 100 or v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'BATAL_TAGIHAN_INVALID: alasan pembatalan wajib diisi (3 sampai 500 huruf)';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = v_user;
  v_hash := md5(jsonb_build_object('invoice', p_invoice_id, 'reason', v_reason)::text);

  -- Urutan kunci sama dengan Batalkan penerimaan: baca cabang tanpa kunci, koordinator tagihan, kunci idempotensi, baru baris.
  select v.* into v_vis from public.visits v join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  if not found or not public.user_can_access_branch(v_vis.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: tagihan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_invoice(p_invoice_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-void:' || v_key, 0));
  select * into v_prior from public.clinic_invoice_voids where request_key = v_key;
  if found then
    if v_prior.invoice_id is distinct from p_invoice_id or v_prior.request_hash is distinct from v_hash or v_prior.actor_id is distinct from v_user then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci pembatalan dipakai untuk permintaan berbeda';
    end if;
    return v_prior.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_vis from public.visits where id = v_vis.id for update;
  select * into v_inv from public.invoices where id = p_invoice_id for update;

  v_scan := clinic_private.invoice_void_scan(p_invoice_id);
  if jsonb_typeof(v_scan -> 'refuse') = 'object' then
    raise exception using errcode = 'P0001', message = 'BATAL_TAGIHAN_' || (v_scan #>> '{refuse,code}') || ': ' || (v_scan #>> '{refuse,message}');
  end if;
  v_orig := (v_scan ->> 'original_date')::date;
  v_dp := coalesce(v_inv.dp_amount, 0);
  perform public.inventory_assert_open_date(current_date);   -- HPP dan stok kembali hari ini (aturan 2A)

  -- (A) Pendapatan/diskon/pajak/piutang: kebalikan bersih jurnal tagihan, TANPA baris kas/bank; DP menjadi uang muka (Cr 314001).
  select coalesce(jsonb_agg(e.value order by e.value ->> 'code'), '[]'::jsonb) into v_lines
  from jsonb_array_elements(public.clinic_reverse_journal_lines(v_inv.invoice_no, array['klinik', 'klinik-reissue', 'klinik-edit'])) e
  where not exists (select 1 from public.coa_accounts a where a.code = e.value ->> 'code' and a.type = 'ASET' and a.code not in ('150001', '170001'));
  if v_dp > 0 then
    v_adv_no := clinic_private.next_no('UMK', 'UMK-{YYYY}{MM}-', 4, v_orig, 'public.clinic_customer_advances'::regclass, 'no_uang_muka');
    insert into public.clinic_customer_advances(no_uang_muka, receipt_id, customer_id, branch_id, visit_id, tanggal, amount, shift_id, created_by)
    values (v_adv_no, null, v_vis.customer_id, v_vis.branch_id, v_vis.id, v_orig, v_dp, null, v_user)
    returning id into v_adv_id;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '314001', 'debit', 0, 'credit', v_dp));
  end if;
  v_jid := public.clinic_write_journal(v_orig, 'Batalkan tagihan ' || v_inv.invoice_no || case when v_dp > 0 then ' (DP jadi uang muka ' || v_adv_no || ')' else '' end,
    'klinik-void', v_inv.invoice_no, v_vis.branch_id, v_lines);
  if v_jid is not null then v_journals := v_journals || v_jid; end if;

  -- (B) HPP/persediaan: kebalikan bersih jurnal HPP tagihan, HARI INI (aturan 2A: stok fisik kembali hari ini).
  v_jid := public.clinic_write_journal(current_date, 'Batalkan tagihan ' || v_inv.invoice_no || ': pembalikan HPP', 'klinik-hpp-void', v_inv.invoice_no, v_vis.branch_id,
    public.clinic_reverse_journal_lines(v_inv.invoice_no, array['klinik-hpp', 'klinik-hpp-edit']));
  if v_jid is not null then v_journals := v_journals || v_jid; end if;

  -- (C) Stok obat/BMHP: kunci saldo urut barang, lalu lapisan baru pada biaya tercatat.
  for v_el in select value from jsonb_array_elements(v_scan -> 'stock') order by value ->> 'item_id', value ->> 'warehouse_id' loop
    perform 1 from public.stock s where s.warehouse_id = (v_el ->> 'warehouse_id')::uuid and s.item_id = (v_el ->> 'item_id')::uuid for update;
  end loop;
  for v_el in select value from jsonb_array_elements(v_scan -> 'stock') order by value ->> 'item_id', value ->> 'warehouse_id' loop
    perform public.stock_in_fifo((v_el ->> 'warehouse_id')::uuid, (v_el ->> 'item_id')::uuid, (v_el ->> 'qty')::numeric,
      (v_el ->> 'cost')::numeric / (v_el ->> 'qty')::numeric, 'klinik-void', v_inv.invoice_no, current_date, null);
    select i.name into v_name from public.items i where i.id = (v_el ->> 'item_id')::uuid;
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('item_id', v_el ->> 'item_id', 'name', v_name, 'qty', (v_el ->> 'qty')::numeric,
      'cost', (v_el ->> 'cost')::numeric, 'cara', 'lapisan_baru'));
  end loop;

  -- (D) Racikan: kembali ke lapisan asal bila masih cocok, kalau tidak lapisan baru (kedaluwarsa dan biaya fisik sama).
  for v_el in select value from jsonb_array_elements(v_scan -> 'racik') order by value ->> 'item_id', value ->> 'id' loop
    perform 1 from public.stock s where s.warehouse_id = (v_el ->> 'warehouse_id')::uuid and s.item_id = (v_el ->> 'item_id')::uuid for update;
  end loop;
  for v_el in select value from jsonb_array_elements(v_scan -> 'racik') order by value ->> 'item_id', value ->> 'id' loop
    v_layer := null;
    if v_el ->> 'layer_id' is not null then
      select * into v_layer from public.stock_layers l where l.id = (v_el ->> 'layer_id')::uuid for update;
    end if;
    if v_layer.id is not null and v_layer.warehouse_id = (v_el ->> 'warehouse_id')::uuid and v_layer.item_id = (v_el ->> 'item_id')::uuid
       and v_layer.unit_cost = (v_el ->> 'physical_unit_cost')::numeric and v_layer.qty_left + (v_el ->> 'qty')::numeric <= v_layer.qty_in then
      update public.stock_layers set qty_left = qty_left + (v_el ->> 'qty')::numeric where id = v_layer.id;
    else
      insert into public.stock_layers(warehouse_id, item_id, tanggal, exp_date, qty_in, qty_left, unit_cost, source, source_ref)
      values ((v_el ->> 'warehouse_id')::uuid, (v_el ->> 'item_id')::uuid, current_date, nullif(v_el ->> 'exp_date', '')::date,
        (v_el ->> 'qty')::numeric, (v_el ->> 'qty')::numeric, (v_el ->> 'physical_unit_cost')::numeric, 'racik-kembali', v_el ->> 'recipe_id');
    end if;
    insert into public.stock(warehouse_id, item_id, qty, updated_at)
    values ((v_el ->> 'warehouse_id')::uuid, (v_el ->> 'item_id')::uuid, (v_el ->> 'qty')::numeric, now())
    on conflict (warehouse_id, item_id) do update set qty = public.stock.qty + excluded.qty, updated_at = excluded.updated_at;
    insert into public.stock_moves(tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref)
    values (current_date, (v_el ->> 'warehouse_id')::uuid, (v_el ->> 'item_id')::uuid, (v_el ->> 'qty')::numeric, (v_el ->> 'unit_cost')::numeric,
      'racik-kembali', v_el ->> 'recipe_id');
    update public.compound_issues set restored_at = now() where id = (v_el ->> 'id')::uuid and restored_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'BATAL_TAGIHAN_BERUBAH: bahan racikan berubah saat diproses; muat ulang halaman lalu coba lagi';
    end if;
    select i.name into v_name from public.items i where i.id = (v_el ->> 'item_id')::uuid;
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('item_id', v_el ->> 'item_id', 'name', v_name, 'qty', (v_el ->> 'qty')::numeric,
      'cost', round((v_el ->> 'qty')::numeric * (v_el ->> 'unit_cost')::numeric, 2), 'cara', case when v_layer.id is not null and v_layer.unit_cost = (v_el ->> 'physical_unit_cost')::numeric
        and v_layer.qty_left + (v_el ->> 'qty')::numeric <= v_layer.qty_in then 'lapisan_asal' else 'lapisan_baru' end, 'racikan', v_el ->> 'recipe_id'));
  end loop;

  -- (E) Poin loyalti: satu baris pembalik; saldo tidak boleh minus.
  if v_vis.customer_id is not null then
    select coalesce(c.points, 0) into v_balance from public.customers c where c.id = v_vis.customer_id for update;
    select coalesce(sum(l.delta), 0) into v_points from public.point_ledger l where l.customer_id = v_vis.customer_id and l.ref = v_inv.invoice_no;
    if v_points <> 0 then
      if v_balance - v_points < 0 then
        raise exception using errcode = 'P0001', message = 'BATAL_TAGIHAN_POIN_TERPAKAI: poin dari tagihan ini sudah terpakai pelanggan; sesuaikan poin pelanggan dulu';
      end if;
      v_balance := v_balance - v_points;
      insert into public.point_ledger(customer_id, delta, saldo, ref, description, entry_type)
      values (v_vis.customer_id, -v_points, v_balance, left(v_inv.invoice_no, 50), left('Batalkan tagihan ' || v_inv.invoice_no || ': ' || v_reason, 200), 'adjustment');
      update public.customers set points = v_balance where id = v_vis.customer_id;
    end if;
  end if;

  -- (F) Rekam medis: baris yang ditagih ditarik dari penagihan (isi rekam medis tetap utuh).
  select coalesce(array(select (value #>> '{}')::uuid from jsonb_array_elements(v_scan -> 'rx_ids')), '{}') into v_rx;
  if cardinality(v_rx) > 0 then
    insert into clinic_private.record_edit_permits values (txid_current(), v_user, v_vis.id);
    update public.prescription_items set billing_withdrawn_at = clock_timestamp(), billing_withdrawn_by = v_user,
      billing_withdrawal_reason = left('Tagihan ' || v_inv.invoice_no || ' dibatalkan: ' || v_reason, 1000)
    where id = any (v_rx) and billing_withdrawn_at is null;
    delete from clinic_private.record_edit_permits where transaction_id = txid_current();
  end if;

  -- (G) Tagihan dibatalkan; jendela tanggal efektif yang masih terbuka ditutup.
  update public.invoices set voided_at = now() where id = v_inv.id;
  perform clinic_private.backdate_window_close(v_inv.id, 'dilepas', v_user, 'Tagihan dibatalkan');
  insert into public.invoice_edit_log(invoice_id, edited_by, field_changed, old_value, new_value, reason)
  values (v_inv.id, v_user, 'voided', v_inv.invoice_no, 'DIBATALKAN', left('Batalkan tagihan: ' || v_reason, 500));

  -- (H) Pemeriksaan akhir (gagal = seluruh transaksi batal): pendapatan/diskon/pajak/piutang, HPP/persediaan, dan kartu stok tagihan nol.
  select coalesce(sum(abs(x.net)), 0) into v_check from (
    select a.code, sum(l.debit - l.credit) as net from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
    join public.coa_accounts a on a.id = l.account_id
    where e.source_ref = v_inv.invoice_no and e.source in ('klinik', 'klinik-reissue', 'klinik-edit', 'klinik-ar', 'klinik-void')
      and not (a.type = 'ASET' and a.code not in ('150001', '170001')) and a.code <> '314001'
    group by a.code) x;
  if v_check <> 0 then
    raise exception using errcode = 'P0001', message = 'JOURNAL_UNBALANCED: jurnal tagihan tidak kembali nol; tidak ada yang diubah';
  end if;
  select coalesce(sum(abs(x.net)), 0) into v_check from (
    select a.code, sum(l.debit - l.credit) as net from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
    join public.coa_accounts a on a.id = l.account_id
    where e.source_ref = v_inv.invoice_no and e.source in ('klinik-hpp', 'klinik-hpp-edit', 'klinik-hpp-void') group by a.code) x;
  if v_check <> 0 then
    raise exception using errcode = 'P0001', message = 'JOURNAL_UNBALANCED: jurnal HPP tagihan tidak kembali nol; tidak ada yang diubah';
  end if;
  if exists (select 1 from public.stock_moves m where m.source_ref = v_inv.invoice_no
             and m.source in ('klinik', 'klinik-bmhp', 'pesanan-selesai', 'klinik-edit', 'klinik-void')
             group by m.warehouse_id, m.item_id having sum(m.qty) <> 0) then
    raise exception using errcode = 'P0001', message = 'BATAL_TAGIHAN_STOK: kartu stok tagihan tidak kembali nol; tidak ada yang diubah';
  end if;

  v_result := jsonb_build_object('status', 'VOIDED', 'void_id', v_audit, 'invoice_id', v_inv.id, 'invoice_no', v_inv.invoice_no, 'visit_id', v_vis.id,
    'original_date', v_orig, 'stock_date', current_date, 'tanggal', v_today, 'total', v_inv.total, 'dp_converted', v_dp, 'advance_id', v_adv_id, 'advance_no', v_adv_no,
    'stock_value', (v_scan ->> 'stock_value')::numeric + (v_scan ->> 'racik_value')::numeric, 'hpp_reversed', (v_scan ->> 'hpp_reversed')::numeric,
    'stock', v_effects, 'points_delta', -v_points, 'withdrawn', cardinality(v_rx));
  insert into public.clinic_invoice_voids(id, request_key, request_hash, actor_id, actor_role, invoice_id, invoice_no, visit_id, branch_id, reason,
    original_date, tanggal, total, dp_converted, advance_id, advance_no, stock_value, hpp_reversed, points_delta, stock_effects, journal_ids,
    withdrawn_items, before_invoice, result)
  values (v_audit, v_key, v_hash, v_user, coalesce(v_role, '?'), v_inv.id, v_inv.invoice_no, v_vis.id, v_vis.branch_id, v_reason,
    v_orig, v_today, v_inv.total, v_dp, v_adv_id, v_adv_no, (v_scan ->> 'stock_value')::numeric + (v_scan ->> 'racik_value')::numeric,
    (v_scan ->> 'hpp_reversed')::numeric, -v_points, v_effects, v_journals, v_rx, to_jsonb(v_inv), v_result);
  return v_result;
end $$;
comment on function public.clinic_void_invoice(uuid, text, text) is 'B2: Batalkan tagihan klinik Belum Lunas/DP (void murni). Owner atau izin klinik.batalkan_tagihan. Pendapatan dibalik di tanggal tagihan asli, HPP & stok hari ini (aturan 2A), DP/poin dibalik, jejak tetap.';
revoke all on function public.clinic_void_invoice(uuid, text, text) from public, anon, service_role;
grant execute on function public.clinic_void_invoice(uuid, text, text) to authenticated;

-- ───────────────────────── 5. Tutup kunjungan yang semua tagihannya Lunas ─────────────────────────
create function clinic_private.close_visit_reasons(p_visit uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v public.visits%rowtype; b text[] := '{}';
begin
  select * into v from public.visits where id = p_visit;
  if not found then return array['kunjungan tidak ditemukan']; end if;
  if v.archived_at is not null then b := b || 'kunjungan sudah diarsipkan'::text; end if;
  if exists (select 1 from public.inpatient_records r where r.visit_id = p_visit and r.discharged_at is null) then
    b := b || 'pasien masih dirawat inap (kunjungan tertutup sendiri saat pasien pulang dan tagihannya lunas)'::text; end if;
  if not exists (select 1 from public.invoices i where i.visit_id = p_visit and i.voided_at is null) then
    b := b || 'belum ada tagihan aktif'::text;
  elsif exists (select 1 from public.invoices i where i.visit_id = p_visit and i.voided_at is null and i.paid_status <> 'Lunas') then
    b := b || 'masih ada tagihan yang belum lunas'::text;
  elsif exists (select 1 from public.invoices i where i.visit_id = p_visit and i.voided_at is null and i.correction_pending) then
    b := b || 'ada tagihan yang sedang dikoreksi'::text;
  end if;
  if exists (select 1 from public.prescription_items pi join public.medical_records mr on mr.id = pi.medical_record_id
             where mr.visit_id = p_visit and pi.billing_withdrawn_at is null
               and not exists (select 1 from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                               where ii.prescription_item_id = pi.id and i.voided_at is null)) then
    b := b || 'masih ada obat/layanan di rekam medis yang belum ditagih'::text; end if;
  return b;
end $$;
revoke all on function clinic_private.close_visit_reasons(uuid) from public, anon, authenticated, service_role;

create function public.clinic_close_settled_visit(p_visit_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $$
declare v public.visits%rowtype; v_reasons text[];
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null
     or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER', 'ADMIN')) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya pemilik atau admin yang aktif yang boleh menutup kunjungan';
  end if;
  select * into v from public.visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v.branch_id) then
    raise exception using errcode = 'P0001', message = 'CLOSE_NOT_FOUND: kunjungan tidak ditemukan atau cabang tidak dapat diakses';
  end if;
  if v.status::text = 'Selesai' then
    return jsonb_build_object('visit_id', p_visit_id, 'closed', false, 'already', true);
  end if;
  v_reasons := clinic_private.close_visit_reasons(p_visit_id);
  if cardinality(v_reasons) > 0 then
    raise exception using errcode = 'P0001', message = 'CLOSE_BLOCKED: kunjungan belum bisa ditutup karena ' || array_to_string(v_reasons, '; ') || '.';
  end if;
  if not clinic_private.close_settled_visit(p_visit_id) then
    raise exception using errcode = 'P0001', message = 'CLOSE_BLOCKED: kunjungan belum bisa ditutup; muat ulang antrian lalu coba lagi.';
  end if;
  return jsonb_build_object('visit_id', p_visit_id, 'closed', true, 'already', false);
end $$;
comment on function public.clinic_close_settled_visit(uuid) is 'B2: Owner/Admin menutup kunjungan (status Selesai) bila semua tagihan aktif Lunas; aturan = clinic_private.close_settled_visit. Tanpa jurnal/stok.';
revoke all on function public.clinic_close_settled_visit(uuid) from public, anon, service_role;
grant execute on function public.clinic_close_settled_visit(uuid) to authenticated;

-- ───────────────────────── 6. Aturan arsip sesudah batalkan tagihan + racikan terpotong ─────────────────────────
-- Kwitansi yang sudah dibatalkan dan SEMUA alokasinya ada di tagihan yang dibatalkan lewat jalur B2: tidak ada uang tersisa.
create function clinic_private.invoice_void_receipt_cleared(p_receipt uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinic_payment_receipts r where r.id = p_receipt and r.status = 'batal')
     and exists (select 1 from public.invoice_payments p where p.receipt_id = p_receipt)
     and not exists (select 1 from public.invoice_payments p where p.receipt_id = p_receipt
                     and not exists (select 1 from public.clinic_invoice_voids w where w.invoice_id = p.invoice_id))
     and not exists (select 1 from public.clinic_customer_advances a where a.receipt_id = p_receipt and a.status <> 'batal')
$$;
revoke all on function clinic_private.invoice_void_receipt_cleared(uuid) from public, anon, authenticated, service_role;

-- Uang muka yang tidak lagi menyimpan uang: dibatalkan bersama kwitansi di atas, atau UMK hasil DP tagihan B2 yang sudah habis
-- dikembalikan/terpakai (tanpa pengembalian yang masih diproses).
create function clinic_private.invoice_void_advance_cleared(p_advance uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinic_customer_advances a where a.id = p_advance and (
           (a.status = 'batal' and a.receipt_id is not null and clinic_private.invoice_void_receipt_cleared(a.receipt_id))
        or (a.status = 'aktif' and a.amount - a.applied <= 0 and coalesce(a.refund_reserved, 0) = 0
            and exists (select 1 from public.clinic_invoice_voids w where w.advance_id = a.id))))
$$;
revoke all on function clinic_private.invoice_void_advance_cleared(uuid) from public, anon, authenticated, service_role;

-- Penjualan racikan yang bahannya sudah kembali (dibatalkan lewat tagihan B2, atau "Kembalikan bahan" sebelum ditagih) dan tidak pernah
-- ada di tagihan yang masih berlaku: tidak ada uang/stok yang tersisa.
create function clinic_private.invoice_void_compound_cleared(p_recipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.compound_issues ci where ci.recipe_id = p_recipe and ci.restored_at is null)
     and (exists (select 1 from public.invoice_items ii join public.clinic_invoice_voids w on w.invoice_id = ii.invoice_id where ii.compound_recipe_id = p_recipe)
          or exists (select 1 from public.compounding_recipes c where c.id = p_recipe and c.status = 'void'))
     and not exists (select 1 from public.invoice_items ii where ii.compound_recipe_id = p_recipe
                     and not exists (select 1 from public.clinic_invoice_voids w where w.invoice_id = ii.invoice_id))
$$;
revoke all on function clinic_private.invoice_void_compound_cleared(uuid) from public, anon, authenticated, service_role;

do $classify$
declare
  d text; p record;
begin
  d := pg_get_functiondef('clinic_private.visit_archive_classify(uuid)'::regprocedure);
  if position('B2_BATAL_TAGIHAN' in d) > 0 then
    raise exception 'B2_PRECONDITION: visit_archive_classify sudah ditambal';
  end if;
  for p in select * from (values
    (1, $old$ if exists(select 1 from public.invoices i where i.visit_id=p_visit) then hard:=hard||'sudah ada tagihan/invoice (termasuk yang dibatalkan)'::text; end if;$old$,
        $new$ -- B2_BATAL_TAGIHAN: tagihan yang dibatalkan lewat "Batalkan tagihan" (jurnal/stok/DP/poin sudah dibalik) tidak lagi menghalangi.
 if exists(select 1 from public.invoices i where i.visit_id=p_visit and not exists(select 1 from public.clinic_invoice_voids w where w.invoice_id=i.id)) then hard:=hard||'sudah ada tagihan/invoice (termasuk yang dibatalkan)'::text; end if;$new$),
    (2, $old$ if exists(select 1 from public.invoice_payments ip join public.invoices i on i.id=ip.invoice_id where i.visit_id=p_visit)
  or exists(select 1 from public.clinic_payment_receipts r where r.visit_id=p_visit) then hard:=hard||'sudah ada pembayaran'::text; end if;$old$,
        $new$ if exists(select 1 from public.invoice_payments ip join public.invoices i on i.id=ip.invoice_id where i.visit_id=p_visit
     and not exists(select 1 from public.clinic_invoice_voids w where w.invoice_id=i.id))
  or exists(select 1 from public.clinic_payment_receipts r where r.visit_id=p_visit and not clinic_private.invoice_void_receipt_cleared(r.id)) then hard:=hard||'sudah ada pembayaran'::text; end if;$new$),
    (3, $old$ if exists(select 1 from public.clinic_customer_advances a where a.visit_id=p_visit) then hard:=hard||'sudah ada uang muka/DP'::text; end if;$old$,
        $new$ if exists(select 1 from public.clinic_customer_advances a join public.clinic_invoice_voids w on w.advance_id=a.id where a.visit_id=p_visit
     and not clinic_private.invoice_void_advance_cleared(a.id)) then
  hard:=hard||'saldo DP dari tagihan yang dibatalkan belum dikembalikan ke pelanggan (Kembalikan saldo uang muka)'::text; end if;
 if exists(select 1 from public.clinic_customer_advances a where a.visit_id=p_visit and not exists(select 1 from public.clinic_invoice_voids w where w.advance_id=a.id)
     and not clinic_private.invoice_void_advance_cleared(a.id)) then hard:=hard||'sudah ada uang muka/DP'::text; end if;$new$),
    (4, $old$ if exists(select 1 from public.clinic_compound_sales s where s.visit_id=p_visit) then hard:=hard||'sudah ada penjualan racikan'::text; end if;$old$,
        $new$ if exists(select 1 from public.clinic_compound_sales s where s.visit_id=p_visit and not clinic_private.invoice_void_compound_cleared(s.recipe_id)) then hard:=hard||'sudah ada penjualan racikan'::text; end if;
 -- B2 butir 4: racikan yang bahannya sudah terpotong dari stok tidak pernah ikut tersembunyi (arsip tidak menggerakkan stok).
 if exists(select 1 from public.compound_issues ci join public.compounding_recipes c on c.id=ci.recipe_id join public.medical_records mr on mr.id=c.medical_record_id
     where mr.visit_id=p_visit and ci.restored_at is null) then
  hard:=hard||'ada racikan yang bahannya sudah terpotong dari stok (kembalikan bahan racikannya dulu dari rekam medis, atau tagihkan)'::text; end if;$new$)
  ) as x(n, old_text, new_text) order by n loop
    if (length(d) - length(replace(d, p.old_text, ''))) / length(p.old_text) <> 1 then
      raise exception 'B2_PRECONDITION: visit_archive_classify tidak seperti yang ditinjau (jangkar %)', p.n;
    end if;
    d := replace(d, p.old_text, p.new_text);
  end loop;
  execute d;
end $classify$;
revoke all on function clinic_private.visit_archive_classify(uuid) from public, anon, authenticated, service_role;

-- ───────────────────────── 7. Log Aktifitas: alasan arsip + tanda PAKSA, dan batalkan tagihan ─────────────────────────
alter table public.visit_archive_events add column log_label text generated always as (
  case action when 'archive' then case when forced then 'Arsip PAKSA kunjungan' else 'Arsip kunjungan' end else 'Pulihkan kunjungan' end
  || coalesce(' — alasan: ' || reason, '')
  || case when forced and cardinality(overridden) > 0 then ' (' || cardinality(overridden)::text || ' syarat dilewati)' else '' end) stored;

insert into public.activity_log_sources
 (entity, module_id, label_key, value_keys, scope_kind, parent_entity, parent_key, identity_keys, branch_columns, scope_parents, metadata_only, reader_roles)
values
 ('visit_archive_events', 'klinik', 'log_label', array['forced'], 'refs', null, null, array['id'], array['branch_id'],
  '[{"entity":"visits","key":"visit_id"}]'::jsonb, false, array['OWNER', 'ADMIN']),
 ('clinic_invoice_voids', 'klinik', 'log_label', array['total', 'dp_converted', 'stock_value', 'hpp_reversed', 'points_delta', 'tanggal'], 'refs', null, null,
  array['id'], array['branch_id'], '[{"entity":"invoices","key":"invoice_id"},{"entity":"visits","key":"visit_id"}]'::jsonb, false, array['OWNER', 'ADMIN']);
create trigger a01_activity_change after insert or update on public.visit_archive_events for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on public.visit_archive_events for each row execute function public.capture_activity_log();
create trigger a01_activity_change after insert or update on public.clinic_invoice_voids for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on public.clinic_invoice_voids for each row execute function public.capture_activity_log();

-- ───────────────────────── 8. Pemeriksaan akhir ─────────────────────────
do $check$
declare d text;
begin
  d := pg_get_functiondef('clinic_private.visit_archive_classify(uuid)'::regprocedure);
  if (length(d) - length(replace(d, 'clinic_invoice_voids', ''))) / length('clinic_invoice_voids') <> 4
     or position('invoice_void_receipt_cleared(r.id)' in d) = 0 or position('invoice_void_compound_cleared(s.recipe_id)' in d) = 0
     or position('ci.restored_at is null' in d) = 0 then
    raise exception 'B2_PRECONDITION: tambalan visit_archive_classify tidak lengkap';
  end if;
  if not exists (select 1 from role_settings_private.action_catalog where id = 'klinik.batalkan_tagihan' and enforced) then
    raise exception 'B2_PRECONDITION: izin klinik.batalkan_tagihan tidak terpasang';
  end if;
end $check$;
