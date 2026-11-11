-- Tenaga penjual di Faktur Penjualan langsung (grosir/backoffice). Permintaan user Cimanggu lewat Reza, 11 Nov 2026.
--
-- Sebelumnya penjual faktur grosir selalu dianggap pembuat faktur (sales_invoices.created_by). Sekarang
-- pesanan dasarnya menyimpan karyawan yang dipilih. Laporan penjual dan komisi memakai pesanan.salesperson_id,
-- dan jatuh kembali ke pembuat faktur bila kosong (dokumen lama tetap terbaca sama persis).
--
-- Disimpan di sales_orders karena faktur langsung membuat pesanan, pengiriman, dan faktur sekaligus;
-- faktur (termasuk faktur pengganti) menunjuk pesanannya lewat order_id. Setelah pesanan punya pengiriman atau
-- faktur, guard_wholesale_document melindungi barisnya, sehingga penjual tidak bisa diganti diam-diam dari browser.
alter table public.sales_orders
  add column if not exists salesperson_id uuid references public.employees(id) on delete restrict;
create index if not exists sales_orders_salesperson_id_idx on public.sales_orders(salesperson_id);

-- Penjual harus karyawan aktif yang tidak dibuang. Cabang tidak dibatasi: tenaga dari cabang lain
-- (mis. dokter klinik) boleh tercatat sebagai penjual faktur DC.
create or replace function public.guard_sales_order_salesperson() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.salesperson_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.salesperson_id is not distinct from old.salesperson_id then return new; end if;
  if not exists(select 1 from public.employees e
                 where e.id = new.salesperson_id and e.status = 'Aktif' and e.trashed_at is null) then
    raise exception using errcode = 'P0001', message = 'Tenaga penjual harus karyawan aktif';
  end if;
  return new;
end $$;
revoke all on function public.guard_sales_order_salesperson() from public, anon, authenticated, service_role;

drop trigger if exists sales_order_salesperson on public.sales_orders;
create trigger sales_order_salesperson before insert or update of salesperson_id on public.sales_orders
  for each row execute function public.guard_sales_order_salesperson();

do $check$
begin
  if not exists(select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'sales_orders' and column_name = 'salesperson_id') then
    raise exception 'Kolom tenaga penjual pesanan belum ada';
  end if;
  if not exists(select 1 from pg_trigger where tgname = 'sales_order_salesperson'
                 and tgrelid = 'public.sales_orders'::regclass and not tgisinternal) then
    raise exception 'Penjaga tenaga penjual pesanan belum terpasang';
  end if;
end $check$;
