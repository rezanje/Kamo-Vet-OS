-- Penjual/pelaksana transaksi harus terpisah dari akun kasir yang menerima uang.
alter table sales
  add column if not exists salesperson_id uuid references employees(id) on delete set null;
create index if not exists sales_salesperson_id_idx on sales(salesperson_id);

alter table invoices
  add column if not exists salesperson_id uuid references employees(id) on delete set null;
create index if not exists invoices_salesperson_id_idx on invoices(salesperson_id);

-- Modal per faktur disimpan saat faktur terbit supaya histori tidak berubah ketika
-- ada pengiriman susulan dengan harga modal berbeda.
alter table sales_invoice_items
  add column if not exists hpp numeric(15,2);
comment on column sales_invoice_items.hpp is
  'Modal barang yang dialokasikan ke baris faktur saat faktur diterbitkan.';

-- Bekukan juga modal faktur lama berdasarkan seluruh kiriman yang sudah tercatat.
with biaya_kiriman as (
  select order_item_id, sum(coalesce(hpp, 0)) as total_hpp, sum(qty) as total_qty
  from sales_delivery_items
  where order_item_id is not null
  group by order_item_id
)
update sales_invoice_items i
set hpp = round(i.qty * b.total_hpp / nullif(b.total_qty, 0), 2)
from biaya_kiriman b
where i.order_item_id = b.order_item_id and i.hpp is null;

update sales_invoice_items set hpp = 0 where hpp is null;
alter table sales_invoice_items alter column hpp set default 0;
alter table sales_invoice_items alter column hpp set not null;

-- Data lama: kasir yang sudah terhubung ke karyawan menjadi penjual bawaan.
update sales s
set salesperson_id = e.id
from employees e
where s.salesperson_id is null and e.profile_id = s.cashier_id;

-- Tagihan klinik lama mengikuti dokter/pelaksana kunjungannya.
update invoices i
set salesperson_id = v.doctor_id
from visits v
where i.visit_id = v.id and i.salesperson_id is null and v.doctor_id is not null;

-- Accurate memisahkan diskon penjualan dari pendapatan bruto. Akun ini kontra
-- pendapatan: saldo normal Debit, sehingga tampil sebagai pengurang di Laba Rugi.
alter table coa_accounts drop constraint if exists coa_accounts_laba_rugi_normal_check;
alter table coa_accounts add constraint coa_accounts_laba_rugi_normal_check
  check (
    (type = 'PENDAPATAN' and (normal_balance = 'K' or code = '4102'))
    or (type = 'BEBAN' and normal_balance = 'D')
    or type not in ('PENDAPATAN', 'BEBAN')
  );

insert into coa_accounts (code, name, type, normal_balance)
values ('4102', 'Diskon Penjualan', 'PENDAPATAN', 'D')
on conflict (code) do update
set name = excluded.name, type = excluded.type, normal_balance = excluded.normal_balance;
