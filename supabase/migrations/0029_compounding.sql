-- Addendum §2: racik obat (compounding) — resep racikan terpisah dari resep obat jadi.
create table compounding_recipes (
  id uuid primary key default gen_random_uuid(),
  medical_record_id uuid not null references medical_records(id) on delete cascade,
  recipe_name text not null,
  dosage_instruction text not null,          -- e.g. "2x sehari 1 sendok"
  total_volume text not null,                -- e.g. "60 ml"
  dosage_form text not null check (dosage_form in ('sirup','nebul','salep','puyer','kapsul','lainnya')),
  compounding_steps text not null,           -- langkah bernomor, satu langkah per baris
  prepared_by uuid references profiles(id) on delete set null,
  prepared_at timestamptz,
  status text not null default 'pending' check (status in ('pending','ready','handed_over','void')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on compounding_recipes(medical_record_id);

create table compounding_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references compounding_recipes(id) on delete cascade,
  ingredient_name text not null,
  item_id uuid references items(id) on delete set null,
  quantity numeric not null,
  unit text not null
);
create index on compounding_ingredients(recipe_id);

alter table compounding_recipes enable row level security;
alter table compounding_ingredients enable row level security;
-- gate lewat medical_records -> visits.branch_id (pola 0006).
create policy cr_all on compounding_recipes for all to authenticated
  using (exists (select 1 from medical_records m join visits v on v.id = m.visit_id
                 where m.id = compounding_recipes.medical_record_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from medical_records m join visits v on v.id = m.visit_id
                 where m.id = compounding_recipes.medical_record_id and public.user_can_access_branch(v.branch_id)));
create policy ci_all on compounding_ingredients for all to authenticated
  using (exists (select 1 from compounding_recipes r join medical_records m on m.id = r.medical_record_id
                 join visits v on v.id = m.visit_id
                 where r.id = compounding_ingredients.recipe_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from compounding_recipes r join medical_records m on m.id = r.medical_record_id
                 join visits v on v.id = m.visit_id
                 where r.id = compounding_ingredients.recipe_id and public.user_can_access_branch(v.branch_id)));
