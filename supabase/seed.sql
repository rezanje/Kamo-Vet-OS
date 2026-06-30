-- VetOS Fase 1 seed — from Accurate audit (Dokumen/daftar cabang.pdf, daftar gudang.pdf)
-- 22 branches, 27 warehouses (26 active; WH VET RE non-aktif).

insert into branches (code, name, type, is_active) values
  ('DC',       'DC',                        'DC',      true),
  ('B2C',      'B2C',                       'ONLINE',  true),
  ('BTKM',     'Kamo Petshop Bantarkemang', 'PETSHOP', true),
  ('CIAW',     'Kamo Petshop Ciawi',        'PETSHOP', true),
  ('CMGG',     'Kamo Petshop Cimanggu',     'PETSHOP', true),
  ('CMS',      'Kamo Petshop Ciomas',       'PETSHOP', true),
  ('GRND',     'Kamo Petshop Granada',      'PETSHOP', true),
  ('LOJI',     'Kamo Petshop Loji',         'PETSHOP', true),
  ('MUAR',     'Kamo Petshop Muara',        'PETSHOP', true),
  ('OFFICE',   'Office',                    'OFFICE',  true),
  ('PDRY',     'Kamo Petshop Panduraya',    'PETSHOP', true),
  ('SRKN',     'Kamo Petshop Surken',       'PETSHOP', true),
  ('TKI',      'Kamo Petshop TKI/Kopo',     'PETSHOP', true),
  ('VET_CIAW', 'Kamo Pets Clinic Ciawi',    'KLINIK',  true),
  ('VET_CMGG', 'Kamo Klinik Cimanggu',      'KLINIK',  true),
  ('VET_CMS',  'Pets Klinik Ciomas',        'KLINIK',  true),
  ('VET_GRDA', 'HPY Garuda',                'KLINIK',  true),
  ('VET_GRLG', 'HPY Pets Clinic Gerlong',   'KLINIK',  true),
  ('VET_PDRY', 'Klinik Panduraya',          'KLINIK',  true),
  ('VET_RE',   'VET RE',                    'KLINIK',  false),
  ('VET_SRKN', 'Pet Clinic Surken',         'KLINIK',  true),
  ('VET_TKI',  'Kamo Klinik TKI',           'KLINIK',  true);

-- warehouses; branch_id resolved by branch code.
-- ponytail: system warehouses (Transit, Expired) have no single owning branch in Accurate;
-- parked under OFFICE so branch_id stays NOT NULL. revisit if they need their own scope.
insert into warehouses (branch_id, code, name, type, is_active)
select b.id, w.code, w.name, w.type::warehouse_type, w.is_active
from (values
  ('DC',       'DC_LOJI',        'DC LOJI',                'DC',       true),
  ('DC',       'DC_TKI',         'DC TKI',                 'DC',       true),
  ('DC',       'DC_VET_CMGG',    'DC VET CMGG',            'DC',       true),
  ('OFFICE',   'TRANSIT_AOL',    'Transit (AOL System)',   'TRANSIT',  true),
  ('OFFICE',   'WH_EXPIRED',     'WH EXPIRED',             'EXPIRED',  true),
  ('B2C',      'WH_B2C',         'WH B2C',                 'ONLINE',   true),
  ('BTKM',     'WH_BTKM',        'WH BTKM',                'RETAIL',   true),
  ('CIAW',     'WH_CIAW',        'WH CIAW',                'RETAIL',   true),
  ('CMGG',     'WH_CMGG',        'WH CMGG',                'RETAIL',   true),
  ('CMS',      'WH_CMS',         'WH CMS',                 'RETAIL',   true),
  ('GRND',     'WH_GRND',        'WH GRND',                'RETAIL',   true),
  ('LOJI',     'WH_LOJI',        'WH LOJI',                'RETAIL',   true),
  ('MUAR',     'WH_MUAR',        'WH MUAR',                'RETAIL',   true),
  ('PDRY',     'WH_ONLINE_PDRY', 'WH ONLINE PDRY',         'ONLINE',   true),
  ('TKI',      'WH_ONLINE_TKI',  'WH ONLINE TKI',          'ONLINE',   true),
  ('PDRY',     'WH_PDRY',        'WH PDRY',                'RETAIL',   true),
  ('SRKN',     'WH_SRKN',        'WH SRKN',                'RETAIL',   true),
  ('TKI',      'WH_TKI',         'WH TKI',                 'RETAIL',   true),
  ('VET_CIAW', 'WH_VET_CIAW',    'WH VET CIAW',            'VET',      true),
  ('VET_CMGG', 'WH_VET_CMGG',    'WH VET CMGG',            'VET',      true),
  ('VET_CMS',  'WH_VET_CMS',     'WH VET CMS',             'VET',      true),
  ('VET_GRDA', 'WH_VET_GRDA',    'WH VET GRDA',            'VET',      true),
  ('VET_GRLG', 'WH_VET_GRLG',    'WH VET GRLG',            'VET',      true),
  ('VET_PDRY', 'WH_VET_PDRY',    'WH VET PDRY',            'VET',      true),
  ('VET_RE',   'WH_VET_RE',      'WH VET RE (NON AKTIF)',  'VET',      false),
  ('VET_SRKN', 'WH_VET_SRKN',    'WH VET SRKN',            'VET',      true),
  ('VET_TKI',  'WH_VET_TKI',     'WH VET TKI',             'VET',      true)
) as w(branch_code, code, name, type, is_active)
join branches b on b.code = w.branch_code;

-- product categories (PRD §07.3)
insert into item_categories (name, track_expiry, track_batch) values
  ('Makanan / Pakan',   true,  false),
  ('Obat & Suplemen',   true,  true),
  ('Aksesoris',         false, false),
  ('Grooming Supplies', false, false),
  ('Kupon / Voucher',   false, false),
  ('Jasa',              false, false);

-- CRM demo pelanggan + anabul (idempotent by phone / name).
insert into customers (name, phone, email, dob, address, tier, keanggotaan, points, total_spending, pekerjaan, sumber_info, catatan)
select * from (values
  ('Maria Cahyani','0812-3456-7890','maria.cahyani@email.com',date '1990-05-12','Jl. Cimanggu No. 4, Bogor','Platinum','Member',12560,12400000,'Dokter','Instagram','VIP — anabul banyak. Rutin vaksin tepat waktu. Aktif di promo member.'),
  ('Dewi Sandra','0812-9876-5432','dewi.s@gmail.com',date '1988-09-03','Jl. Pajajaran No. 21, Bogor','Gold','Member',7850,7850000,'Wiraswasta','Teman','Loyal, beli produk kucing premium. Prefer dihubungi via WhatsApp.'),
  ('Andi Rahman','0857-1234-5678','andi.r@gmail.com',date '1995-02-18','Jl. Tajur No. 9, Bogor','Silver','Member',3250,3250000,'Karyawan Swasta','Google Maps',null),
  ('Nadia Tania','0821-9999-8888','nadia.t@gmail.com',date '1999-11-27','Jl. Baranangsiang No. 12, Bogor','Bronze','Member',1560,1560000,'Mahasiswa','Instagram',null),
  ('Budi Santoso','0878-5555-4444','budi.s@yahoo.com',date '1985-07-01','Jl. Warung Jambu No. 3, Bogor','New','Non Member',0,980000,'PNS','Walk-in','Baru daftar, belum pernah pakai layanan klinik.')
) as v(name,phone,email,dob,address,tier,keanggotaan,points,total_spending,pekerjaan,sumber_info,catatan)
where not exists (select 1 from customers c where c.phone = v.phone);

insert into pets (customer_id, name, species, breed, gender, dob, weight, warna, sterilisasi, golongan_darah, status)
select c.id, p.name, p.species, p.breed, p.gender, p.dob, p.weight, p.warna, p.sterilisasi, p.gol, 'Aktif'
from (values
  ('0812-3456-7890','Milo','Kucing','British Shorthair','Jantan',date '2024-03-20',4.2,'Abu-abu','Steril','A'),
  ('0812-3456-7890','Max','Anjing','Golden Retriever','Jantan',date '2023-05-20',28.0,'Golden','Utuh','DEA 1.1'),
  ('0812-3456-7890','Luna','Kelinci','Holland Lop','Betina',date '2024-12-05',1.6,'Putih-coklat','Utuh',null),
  ('0812-3456-7890','Kiwi','Burung','Lovebird','Jantan',date '2025-10-10',0.05,'Hijau',null,null),
  ('0812-9876-5432','Rocky','Anjing','Labrador','Jantan',date '2023-01-12',30.5,'Hitam','Steril','DEA 1.1'),
  ('0812-9876-5432','Whiskers','Kucing','Persia','Betina',date '2024-03-15',3.8,'Putih','Steril','B'),
  ('0857-1234-5678','Boni','Anjing','Shih Tzu','Jantan',date '2024-03-05',5.4,'Coklat','Utuh',null),
  ('0857-1234-5678','Luna','Kucing','Domestik','Betina',date '2025-07-10',3.1,'Calico','Utuh',null),
  ('0821-9999-8888','Putih','Kelinci','Angora','Betina',date '2025-12-18',1.2,'Putih','Utuh',null),
  ('0878-5555-4444','Coco','Kucing','Domestik','Betina',date '2025-04-02',2.9,'Oranye','Utuh',null)
) as p(phone,name,species,breed,gender,dob,weight,warna,sterilisasi,gol)
join customers c on c.phone = p.phone
where not exists (select 1 from pets x where x.customer_id = c.id and x.name = p.name);

-- POS demo produk (target_species §1.3).
insert into items (code, name, category_id, unit, sell_price, buy_price, target_species)
select v.code, v.name, c.id, 'pcs', v.sell, v.buy, v.species
from (values
  ('ITM-001','Royal Canin Kitten 2kg','Makanan / Pakan',285000,210000,'Kucing'),
  ('ITM-002','Royal Canin Mini Adult 4kg','Makanan / Pakan',320000,240000,'Anjing'),
  ('ITM-003','Whiskas Tuna 1.2kg','Makanan / Pakan',70000,52000,'Kucing'),
  ('ITM-004','Pedigree Adult 3kg','Makanan / Pakan',120000,90000,'Anjing'),
  ('ITM-005','Pasir Toffu 7L','Aksesoris',95000,70000,'Kucing'),
  ('ITM-006','Vetflox 100ml','Obat & Suplemen',45000,30000,'Universal'),
  ('ITM-007','Ivermectin 10ml','Obat & Suplemen',28000,18000,'Universal'),
  ('ITM-008','Probiotik Kucing 30gr','Obat & Suplemen',85000,60000,'Kucing'),
  ('ITM-009','Grooming Shampoo 250ml','Grooming Supplies',75000,50000,'Universal'),
  ('ITM-010','Vitamin Kulit & Bulu 60ml','Obat & Suplemen',120000,85000,'Universal'),
  ('ITM-011','Collar Kucing S','Aksesoris',35000,20000,'Kucing'),
  ('ITM-012','Leash Anjing M','Aksesoris',55000,35000,'Anjing')
) as v(code,name,cat,sell,buy,species)
join item_categories c on c.name = v.cat
where not exists (select 1 from items i where i.code = v.code);

-- POS demo transaksi (riwayat beli §1.3 + poin ledger §1.4). Saldo ledger berakhir = customers.points.
insert into sales(branch_id,customer_id,pet_id,no_struk,subtotal,total,metode_bayar,bayar,kembali,poin_earned,created_at)
select b.id, c.id, p.id, v.no, v.total, v.total, 'Tunai', v.total, 0, v.poin, v.ts::timestamptz
from (values
  ('POS-SEED-MC1','0812-3456-7890','Milo',370000,370,'2026-06-25 10:15'),
  ('POS-SEED-MC2','0812-3456-7890','Milo',120000,120,'2026-06-18 14:20'),
  ('POS-SEED-MC3','0812-3456-7890','Milo',140000,140,'2026-06-10 09:30'),
  ('POS-SEED-DW1','0812-9876-5432','Whiskers',195000,195,'2026-06-20 16:05')
) as v(no,phone,petname,total,poin,ts)
join customers c on c.phone=v.phone
join branches b on b.code='VET_CMGG'
left join pets p on p.customer_id=c.id and p.name=v.petname
where not exists (select 1 from sales s where s.no_struk=v.no);

insert into sale_items(sale_id,nama,qty,harga,target_species)
select s.id, x.nama, x.qty, x.harga, x.sp
from (values
  ('POS-SEED-MC1','Royal Canin Kitten 2kg',1,285000,'Kucing'),
  ('POS-SEED-MC1','Probiotik Kucing 30gr',1,85000,'Kucing'),
  ('POS-SEED-MC2','Vitamin Kulit & Bulu 60ml',1,120000,'Universal'),
  ('POS-SEED-MC3','Whiskas Tuna 1.2kg',2,70000,'Kucing'),
  ('POS-SEED-DW1','Grooming Shampoo 250ml',1,75000,'Universal'),
  ('POS-SEED-DW1','Pedigree Adult 3kg',1,120000,'Anjing')
) as x(no,nama,qty,harga,sp)
join sales s on s.no_struk=x.no
where not exists (select 1 from sale_items si where si.sale_id=s.id and si.nama=x.nama);

insert into point_ledger(customer_id,delta,saldo,ref,description,created_at)
select c.id, v.delta, v.saldo, v.ref, v.descr, v.ts::timestamptz
from (values
  ('0812-3456-7890',370,12560,'POS-SEED-MC1','Transaksi POS-SEED-MC1','2026-06-25 10:15'),
  ('0812-3456-7890',120,12190,'POS-SEED-MC2','Transaksi POS-SEED-MC2','2026-06-18 14:20'),
  ('0812-3456-7890',140,12070,'POS-SEED-MC3','Transaksi POS-SEED-MC3','2026-06-10 09:30'),
  ('0812-9876-5432',195,7850,'POS-SEED-DW1','Transaksi POS-SEED-DW1','2026-06-20 16:05')
) as v(phone,delta,saldo,ref,descr,ts)
join customers c on c.phone=v.phone
where not exists (select 1 from point_ledger pl where pl.ref=v.ref);

-- POS Fase 3 demo: stok, pengeluaran, permintaan barang.
insert into stock(warehouse_id, item_id, qty)
select w.id, i.id, v.qty from (values
 ('WH_BTKM','ITM-001',24),('WH_BTKM','ITM-003',40),('WH_BTKM','ITM-005',15),
 ('WH_BTKM','ITM-006',30),('WH_BTKM','ITM-009',18),('WH_BTKM','ITM-011',50),
 ('WH_BTKM','ITM-004',12),('WH_BTKM','ITM-007',60)
) v(wh,code,qty)
join warehouses w on w.code=v.wh join items i on i.code=v.code
where not exists (select 1 from stock s where s.warehouse_id=w.id and s.item_id=i.id);

insert into expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar)
select b.id, v.tgl::date, v.kat, v.descr, v.jml, 'Tunai' from (values
 ('BTKM','2026-06-30','Listrik & Air','Token listrik bulanan',350000),
 ('BTKM','2026-06-28','Perlengkapan','Plastik & kemasan toko',120000),
 ('BTKM','2026-07-01','Operasional','Galon & ATK',85000)
) v(code,tgl,kat,descr,jml)
join branches b on b.code=v.code
where not exists (select 1 from expenses e where e.branch_id=b.id and e.deskripsi=v.descr);

with r as (
  insert into stock_requests(no_request,from_branch_id,to_warehouse_id,status,catatan)
  select 'PRM-20260701-0001', b.id, w.id, 'Menunggu Persetujuan', 'Restok mingguan cabang'
  from branches b, warehouses w where b.code='BTKM' and w.code='DC_LOJI'
  and not exists (select 1 from stock_requests x where x.no_request='PRM-20260701-0001')
  returning id
)
insert into stock_request_items(request_id,nama,qty_diminta)
  select id,'Royal Canin Kitten 2kg',12 from r
  union all select id,'Whiskas Tuna 1.2kg',24 from r;
