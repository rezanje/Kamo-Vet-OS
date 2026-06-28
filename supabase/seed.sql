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
