-- Insentif dokter dari transaksi klinik.
-- Lanjutan migrasi 0091 — komisi baru menjangkau penjualan kasir, padahal separuh
-- omzet lahir di klinik dan orang yang mengerjakannya adalah dokter, bukan kasir.
--
-- Penghalangnya: `visits.dokter` cuma teks bebas yang diketik ulang tiap registrasi,
-- jadi tidak ada cara memastikan "Drh. Rena" itu karyawan yang mana.

alter table visits add column doctor_id uuid references employees(id) on delete set null;
create index on visits(doctor_id);

comment on column visits.doctor_id is
  'Dokter penanggung jawab kunjungan, dipakai menghitung insentif klinik. Kolom `dokter` tetap menyimpan namanya untuk resep & dokumen cetak.';

-- Backfill kunjungan lama: cocokkan nama yang sudah terlanjur diketik dengan
-- daftar karyawan. Yang namanya tidak persis sama dibiarkan kosong — lebih baik
-- tidak tercatat daripada salah orang yang dibayar.
update visits v
set doctor_id = e.id
from employees e
where v.doctor_id is null
  and v.dokter is not null
  and lower(btrim(v.dokter)) = lower(btrim(e.nama));

-- ── Aturan komisi per sumber transaksi ─────────────────────────────────────────
-- Tanpa ini, aturan "dokter dapat sekian persen" ikut membayar penjualan petshop
-- kalau dokternya kebetulan pernah menutup struk kasir.
alter table commission_rules
  add column sumber varchar(6) not null default 'semua'
    check (sumber in ('semua', 'kasir', 'klinik'));

comment on column commission_rules.sumber is
  'kasir = struk POS & penjualan online; klinik = tagihan kunjungan yang sudah lunas; semua = keduanya.';
