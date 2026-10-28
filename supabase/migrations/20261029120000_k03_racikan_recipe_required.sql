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
