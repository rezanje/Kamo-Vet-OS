-- K03 + J01 APPLY — WRITES. Satu transaksi; galat apa pun (termasuk tunggu kunci > 5 dtk, tubuh wholesale_access
-- berbeda dari versi yang ditinjau, atau bukan role postgres) membatalkan semuanya.
-- 20261029120000_k03_racikan_recipe_required.sql sha256 ef68f556845da44ad1b4b72c4294803ef887fc44e8c1311fcf204ca5563b2ba9
-- 20261029121000_j01_finance_wholesale_correction.sql sha256 060b7ffd8b31b269d1a247133a69d109dce911000c68b752cf7622c6f89894f5
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'apply must run as postgres (current role: %); nothing was applied', current_user;
  end if;
end $$;

-- ===== K03 (verbatim) =====
-- K03 (keputusan pemilik 28 Okt 2026): obat racik di rekam medis dan tagihan klinik WAJIB
-- punya komposisi (resep racikan). Kasir petshop tidak terdampak (tabelnya lain).
--
-- "SKU obat racik" memakai aturan yang sama dengan bind_compound_formula_sale_item
-- (20261007111500): barang Persediaan, bukan bahan racik, nama "Obat Racik …"/"Obat Racikan …"
-- atau kategori OBAT RACIK / OBAT RACIKAN / RACIKAN. Status aktif sengaja tidak dipakai:
-- SKU racik yang dinonaktifkan tetap racikan.
--
-- Hanya baris baru/berubah yang diperiksa. Baris lama yang sudah ada tidak disentuh
-- (production punya satu baris resep lama seperti itu).
--
-- 1) prescription_items (rawat jalan, catatan harian rawat inap, koreksi rekam medis, dst.):
--    tolak item_id = SKU racik tanpa compound_recipe_id. Jalur racik master menulis baris
--    item_id NULL + compound_recipe_id, jadi tetap lolos.
-- 2) invoice_items (tagihan klinik; tabel ini khusus klinik, invoices.visit_id NOT NULL):
--    tolak baris manual (tanpa prescription_item_id) bertipe SKU racik tanpa compound_recipe_id.
--    Baris yang berasal dari resep tetap mengikuti hasil pemeriksaan di prescription_items,
--    sehingga baris resep lama tetap dapat ditagih.
-- Nama trigger diawali zz_ agar berjalan paling akhir (setelah zz_grooming_requirement).
-- Idempoten: create or replace + drop trigger if exists.

create schema if not exists clinic_private;

create or replace function clinic_private.is_racikan_sku(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_item_id is not null and exists (
    select 1 from public.items i
    where i.id = p_item_id
      and i.item_type = 'Persediaan' and not i.is_compound_material
      and (i.name ilike 'Obat Racik %' or i.name ilike 'Obat Racikan %' or exists (
        select 1 from public.item_categories c where c.id = i.category_id
          and upper(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) in ('OBAT RACIK', 'OBAT RACIKAN', 'RACIKAN')
      ))
  );
$$;
revoke all on function clinic_private.is_racikan_sku(uuid) from public, anon, authenticated, service_role;

create or replace function clinic_private.k03_prescription_recipe_required()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.compound_recipe_id is null and new.item_id is not null
     and (tg_op = 'INSERT' or new.item_id is distinct from old.item_id)
     and clinic_private.is_racikan_sku(new.item_id) then
    raise exception using errcode = 'P0001',
      message = format('RECIPE_REQUIRED: %s', left(coalesce(new.nama_obat, 'obat racik'), 90));
  end if;
  return new;
end $$;
revoke all on function clinic_private.k03_prescription_recipe_required() from public, anon, authenticated, service_role;

create or replace function clinic_private.k03_invoice_recipe_required()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.compound_recipe_id is null and new.prescription_item_id is null and new.item_id is not null
     and (tg_op = 'INSERT' or new.item_id is distinct from old.item_id)
     and clinic_private.is_racikan_sku(new.item_id) then
    raise exception using errcode = 'P0001',
      message = format('RECIPE_REQUIRED: %s', left(coalesce(new.deskripsi, 'obat racik'), 90));
  end if;
  return new;
end $$;
revoke all on function clinic_private.k03_invoice_recipe_required() from public, anon, authenticated, service_role;

drop trigger if exists zz_racikan_recipe_required on public.prescription_items;
create trigger zz_racikan_recipe_required before insert or update of item_id on public.prescription_items
  for each row execute function clinic_private.k03_prescription_recipe_required();

drop trigger if exists zz_racikan_recipe_required on public.invoice_items;
create trigger zz_racikan_recipe_required before insert or update of item_id on public.invoice_items
  for each row execute function clinic_private.k03_invoice_recipe_required();

-- ===== J01 (verbatim) =====
-- J01 (keputusan pemilik 28 Okt 2026): koreksi faktur penjualan B2B/grosir yang sudah dibayar
-- boleh dilakukan OWNER dan FINANCE (sebelumnya hanya OWNER). Pembayaran yang sudah diterima
-- tetap tercatat; kelebihan bayar menjadi kredit pelanggan (perilaku correct_wholesale_invoice
-- yang sudah ada, tidak diubah). Struk kasir dan tagihan klinik tidak terdampak.
--
-- Satu-satunya perubahan: helper wholesale_access(p_branch, p_owner=true) yang hanya dipakai
-- jalur koreksi (correct_wholesale_invoice dan get_wholesale_operation kind='correction')
-- kini menerima OWNER atau FINANCE aktif. Jalur penerimaan (p_owner=false) tetap
-- OWNER/ADMIN/FINANCE. Cek cabang/modul (sales_assert_access) tidak berubah.
--
-- Hash guard: tubuh fungsi harus persis versi 20261021073000 (md5 prosrc
-- 6b15f97c64b813e269a7b2f3bfcbc8c1, sama dengan production per 28 Okt 2026) atau sudah versi J01.
-- Selain itu migrasi berhenti tanpa mengubah apa pun. Idempoten.
do $j01$
declare
  v_src text;
  v_old constant text := '6b15f97c64b813e269a7b2f3bfcbc8c1';
  v_new_body constant text := $body$
begin
 perform 1 from public.profiles where id=auth.uid() and is_active
  and (role in ('OWNER','FINANCE') or (not p_owner and role='ADMIN')) for share;
 if not found then raise exception 'Koreksi grosir hanya oleh OWNER/FINANCE; penerimaan oleh OWNER/ADMIN/FINANCE aktif' using errcode='42501';end if;
 perform public.sales_assert_access(p_branch);
 if p_branch is not null then
  perform 1 from public.branches where id=p_branch and is_active for share;
  if not found then raise exception 'Cabang grosir tidak aktif' using errcode='42501';end if;
 end if;
end$body$;
begin
  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.wholesale_access(uuid,boolean)');
  if v_src is null then
    raise exception 'J01: public.wholesale_access(uuid,boolean) tidak ada; terapkan 20261021073000 dahulu';
  end if;
  if v_src = v_new_body then
    return;
  end if;
  if md5(v_src) <> v_old then
    raise exception 'J01: tubuh wholesale_access berbeda dari versi yang ditinjau (md5 %); periksa production sebelum apply', md5(v_src);
  end if;
  execute 'create or replace function public.wholesale_access(p_branch uuid,p_owner boolean default false) returns void'
    || ' language plpgsql security definer set search_path='''' as $fn$' || v_new_body || '$fn$';
  revoke all on function public.wholesale_access(uuid,boolean) from public,anon,authenticated,service_role;
end
$j01$;

insert into supabase_migrations.schema_migrations(version, name) values ('20261029120000', 'k03_racikan_recipe_required') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version, name) values ('20261029121000', 'j01_finance_wholesale_correction') on conflict (version) do nothing;
commit;
