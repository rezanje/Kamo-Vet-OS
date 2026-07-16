-- Racikan obat ala BOM (spec 2026-07-15):
-- 1) flag bahan baku racikan di master barang
-- 2) compounding_recipes: field instruksi jadi opsional + simpan total harga
-- 3) compounding_ingredients: snapshot harga bahan saat racik

alter table items
  add column is_compound_material boolean not null default false;

alter table compounding_recipes
  alter column dosage_instruction drop not null,
  alter column total_volume       drop not null,
  alter column dosage_form         drop not null,
  alter column compounding_steps   drop not null,
  add column total_price numeric(15,2) not null default 0;

alter table compounding_ingredients
  add column unit_price numeric(15,2) not null default 0;
