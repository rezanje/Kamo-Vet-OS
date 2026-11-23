-- Kategori pengeluaran rinci → akun beban masing-masing (permintaan tim keuangan, 23 Nov 2026).
-- Dulu sebagian besar pengeluaran toko/klinik diinput sebagai "Operasional"/"Lain-lain" sehingga menumpuk di
-- 760003 Beban Operasional Lain. Kategori baru langsung dijurnal ke akun bebannya. Kategori lama tetap dikenali
-- (data lama, koreksi, dan pengulangan permintaan yang sama) dengan akun yang sama seperti sebelumnya.
-- Satu-satunya pemetaan kategori→akun ada di fungsi ini; post_expense_atomic dan revise_expense_atomic
-- memanggilnya, jadi keduanya ikut tanpa perlu diubah. Cermin di aplikasi: src/lib/kategori-pengeluaran.ts.
do $cek$
declare missing text;
begin
 select string_agg(c.code, ', ') into missing
 from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005',
                   '720006','720009','740002','740014','740013','740022','740012','760003']) as c(code)
 where not exists (select 1 from public.coa_accounts a where a.code=c.code and a.is_active and not a.is_header);
 if missing is not null then raise exception 'Akun beban untuk kategori pengeluaran belum ada/aktif: %', missing; end if;
end $cek$;

create or replace function public.expense_account_code(p_category text) returns text
language plpgsql immutable set search_path='' as $$
begin
 return case p_category
   -- Kategori rinci (input baru)
   when 'Listrik' then '720002'
   when 'Air' then '720003'
   when 'Internet' then '720004'
   when 'Tips Ongkir' then '740017'
   when 'Bensin, Parkir & Toll' then '740005'
   when 'Perawatan Peralatan' then '720008'
   when 'Uang Makan' then '740021'
   when 'Kebutuhan RT' then '740016'
   when 'Marketing' then '730002'
   when 'Kebersihan' then '720005'
   when 'Keamanan' then '720006'
   when 'IPL' then '720009'
   when 'ATK' then '740002'
   when 'Print dan FC' then '740014'
   when 'Kebutuhan Grooming' then '740013'
   when 'Kresek dan Thermal' then '740022'
   when 'Ekspedisi' then '740012'
   when 'Lain-lain' then '760003'
   -- Kategori lama (tidak ditawarkan lagi di form; tetap sah untuk data lama)
   when 'Listrik & Air' then '720002' when 'Perlengkapan' then '740001'
   when 'Transportasi' then '740003' when 'Perawatan' then '740007' when 'Perawatan Aset' then '740007'
   when 'Sewa Gedung' then '760003' when 'Operasional' then '760003'
   else null end;
end $$;
revoke all on function public.expense_account_code(text) from public,anon,authenticated,service_role;
