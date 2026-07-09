-- Rekam medis diperkaya sesuai desain dokter poli (referensi): tanda vital & catatan
-- pemeriksaan lengkap + resep dengan harga (POS obat & jasa) supaya prefill pembayaran
-- bawa harga, bukan cuma nama/qty.

alter table medical_records
  add column suhu            numeric(5,2),   -- suhu badan °C
  add column gejala_klinis   text,
  add column hasil_penunjang text,           -- hasil pemeriksaan penunjang (lab/rontgen)
  add column follow_up       text,           -- rencana kontrol berikutnya
  add column berat           numeric(6,2),   -- snapshot berat saat periksa
  add column catatan_resep   text;           -- CATATAN RESEP global (aturan pakai gabungan)

alter table prescription_items
  add column harga  numeric(15,2) not null default 0,   -- harga jual saat diresepkan (POS)
  add column satuan varchar(20) not null default 'pcs';
