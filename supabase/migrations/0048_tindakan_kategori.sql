-- Kategori tindakan (PRD §6.3) supaya sistem tahu mana yang wajib form persetujuan.
-- Nullable & tanpa default: baris lama tetap null dan sengaja diperlakukan sebagai
-- tidak berisiko, supaya kunjungan yang sudah ada tidak mendadak terblokir.
alter table prescription_items add column kategori varchar(20);
