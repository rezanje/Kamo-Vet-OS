-- Rollback 20261107100000_pelanggan_nonaktif — HANYA bila diputuskan mundur.
-- Jalankan BERSAMA rollback aplikasi ke versi sebelum fitur ini (kode lama tidak membaca kolom baru).
-- Satu transaksi. Tidak menyentuh transaksi, riwayat, atau data pelanggan lain.
--
-- 1. Penjaga dicabut: transaksi baru atas pelanggan yang tadinya nonaktif kembali diterima.
-- 2. Kolom status pelanggan TIDAK dihapus bila masih ada pelanggan nonaktif (jejak siapa/kapan/alasan
--    disimpan); kode lama mengabaikan kolom ini. Hapus permanen hanya bila owner menjalankan dulu
--    `select set_config('vetos.rollback_drop_data', 'yes', false);` di sesi yang sama.
begin;

do $$
declare t text;
begin
  foreach t in array array['sales','visits','sales_quotations','sales_orders','sales_invoices','sales_advances'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists customer_active_guard on public.%I', t);
    end if;
  end loop;
end $$;
drop trigger if exists customers_status_guard on public.customers;
drop function if exists public.guard_new_transaction_customer_active();
drop function if exists public.guard_customer_status();
drop function if exists public.customer_status_manager();
drop index if exists public.customers_nonaktif_idx;

do $$
declare v_nonaktif bigint := 0;
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='is_active') then
    execute 'select count(*) from public.customers where not is_active' into v_nonaktif;
  end if;
  if v_nonaktif = 0 or current_setting('vetos.rollback_drop_data', true) = 'yes' then
    alter table public.customers
      drop column if exists deactivation_reason,
      drop column if exists deactivated_by,
      drop column if exists deactivated_at,
      drop column if exists is_active;
    raise notice 'ROLLBACK_PELANGGAN_NONAKTIF: kolom status dihapus (% pelanggan nonaktif)', v_nonaktif;
  else
    raise notice 'ROLLBACK_PELANGGAN_NONAKTIF: % pelanggan nonaktif — kolom status DISIMPAN (penjaga sudah dicabut)', v_nonaktif;
  end if;
end $$;

commit;
