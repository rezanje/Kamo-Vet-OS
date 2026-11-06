-- Grup bertingkat (paket di dalam paket) — permintaan Andri, 6 Nov 2026.
--
-- Admin sekarang boleh memasukkan Grup lain sebagai isi Grup. Susunan yang diketik
-- admin disimpan di item_group_recipe (boleh berisi Grup). item_group_components
-- tetap menjadi resep "terbuka" yang hanya berisi barang Persediaan/Jasa/
-- Non-Persediaan, dihitung ulang otomatis dari item_group_recipe.
--
-- Karena kasir, checkout, struk, retur, HPP, klinik (H05) dan guard database
-- seluruhnya membaca item_group_components, semua jalur itu tetap bekerja tanpa
-- perubahan: Grup luar langsung memotong stok barang isi Grup dalam.
--
-- "Ikut berubah otomatis": setiap kali resep sebuah Grup diganti, Grup itu dan
-- semua Grup yang memuatnya (langsung atau tidak langsung) dihitung ulang dalam
-- transaksi yang sama. Penjualan lama tidak berubah karena memakai snapshot.

create table public.item_group_recipe (
  id uuid primary key default gen_random_uuid(),
  group_item_id uuid not null references public.items(id) on delete cascade,
  component_item_id uuid not null references public.items(id) on delete restrict,
  qty numeric(15,4) not null check (qty > 0),
  unit varchar(20) not null,
  factor numeric(15,4) not null check (factor > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_item_id, component_item_id, unit),
  check (group_item_id <> component_item_id)
);

create index item_group_recipe_group_idx on public.item_group_recipe(group_item_id, sort_order);
create index item_group_recipe_component_idx on public.item_group_recipe(component_item_id);

-- Semua resep yang sudah ada belum bertingkat: susunan admin = resep terbuka.
-- Trigger validasi dipasang SETELAH salin supaya komponen lama yang kini nonaktif
-- tidak menggagalkan migrasi (perilaku lama untuk resep itu tetap sama).
insert into public.item_group_recipe (group_item_id, component_item_id, qty, unit, factor, sort_order, created_at, updated_at)
select group_item_id, component_item_id, qty, unit, factor, sort_order, created_at, updated_at
from public.item_group_components;

create or replace function public.validate_item_group_recipe()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  group_type text;
  component_type text;
  component_base_unit text;
  official_factor numeric;
begin
  select item_type into group_type from public.items where id = new.group_item_id;
  select item_type, unit into component_type, component_base_unit
  from public.items where id = new.component_item_id and is_active = true;

  if group_type is distinct from 'Grup' then
    raise exception 'group_item_id bukan Grup';
  end if;
  if component_type is null then
    raise exception 'komponen harus item aktif';
  end if;

  if lower(new.unit) = lower(component_base_unit) then
    official_factor := 1;
  else
    select factor into official_factor from public.item_units
    where item_id = new.component_item_id and lower(unit) = lower(new.unit);
  end if;
  if official_factor is null or official_factor <> new.factor then
    raise exception 'satuan/faktor komponen tidak cocok master';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_item_group_recipe() from public, anon, authenticated;

create trigger item_group_recipe_validate
before insert or update on public.item_group_recipe
for each row execute function public.validate_item_group_recipe();

create trigger item_group_recipe_touch
before update on public.item_group_recipe
for each row execute function public.touch_item_group_component();

alter table public.item_group_recipe enable row level security;
revoke all on table public.item_group_recipe from anon, authenticated;
grant select, insert, update, delete on table public.item_group_recipe to authenticated;

create policy item_group_recipe_select on public.item_group_recipe
  for select to authenticated using (true);
create policy item_group_recipe_insert on public.item_group_recipe
  for insert to authenticated with check ((select public.is_admin()));
create policy item_group_recipe_update on public.item_group_recipe
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy item_group_recipe_delete on public.item_group_recipe
  for delete to authenticated using ((select public.is_admin()));

-- Pengganti replace-all lama dengan tanda tangan, ACL, dan payload yang sama.
-- Satu transaksi: ganti susunan admin, tolak lingkaran/kedalaman berlebih, lalu
-- hitung ulang resep terbuka Grup ini dan semua Grup yang memuatnya.
create or replace function public.replace_item_group_components(
  p_group_item_id uuid,
  p_components jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  max_depth constant integer := 5;
  target uuid;
  flat jsonb;
  current_flat jsonb;
  bad_name text;
begin
  if not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengubah rincian Grup'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_components) is distinct from 'array' then
    raise exception 'Rincian Grup tidak valid';
  end if;

  -- Penyuntingan resep jarang terjadi; serialkan supaya dua admin tidak membuat
  -- lingkaran A→B dan B→A secara bersamaan.
  perform pg_advisory_xact_lock(hashtext('public.item_group_recipe'));

  delete from public.item_group_recipe where group_item_id = p_group_item_id;

  insert into public.item_group_recipe (
    group_item_id, component_item_id, qty, unit, factor, sort_order
  )
  select p_group_item_id, component_item_id, qty, unit, factor, sort_order
  from jsonb_to_recordset(p_components) as x(
    component_item_id uuid,
    qty numeric,
    unit text,
    factor numeric,
    sort_order integer
  );

  -- Tolak lingkaran: Grup ini tidak boleh muncul lagi di dalam isinya sendiri.
  -- path = Grup-Grup di atas baris ini; berhenti menelusuri begitu ketemu ulang.
  with recursive walk(component_item_id, parent_id, path, depth) as (
    select r.component_item_id, p_group_item_id, array[p_group_item_id], 1
    from public.item_group_recipe r
    where r.group_item_id = p_group_item_id
    union all
    select r.component_item_id, w.component_item_id, w.path || w.component_item_id, w.depth + 1
    from walk w
    join public.item_group_recipe r on r.group_item_id = w.component_item_id
    where w.depth <= max_depth and not (w.component_item_id = any(w.path))
  )
  select g.name into bad_name
  from walk w join public.items g on g.id = w.parent_id
  where w.component_item_id = p_group_item_id
  limit 1;
  if found then
    raise exception 'GRUP_LINGKARAN: paket ini sudah menjadi isi dari "%". Paket tidak boleh berisi dirinya sendiri.', bad_name
      using errcode = 'P0001';
  end if;

  -- Hitung ulang Grup ini dan semua Grup yang memuatnya (UNION menghentikan rekursi).
  for target in
    with recursive ancestors(id) as (
      select p_group_item_id
      union
      select r.group_item_id from public.item_group_recipe r join ancestors a on r.component_item_id = a.id
    )
    select id from ancestors
  loop
    -- Kedalaman diukur dari Grup yang sedang dihitung, termasuk Grup luar.
    if exists (
      with recursive depth_walk(component_item_id, depth) as (
        select r.component_item_id, 1 from public.item_group_recipe r where r.group_item_id = target
        union all
        select r.component_item_id, d.depth + 1
        from depth_walk d
        join public.items g on g.id = d.component_item_id and g.item_type = 'Grup'
        join public.item_group_recipe r on r.group_item_id = d.component_item_id
        where d.depth <= max_depth
      )
      select 1 from depth_walk where depth > max_depth
    ) then
      select name into bad_name from public.items where id = target;
      raise exception 'GRUP_TERLALU_DALAM: paket "%" bertumpuk lebih dari % tingkat.', bad_name, max_depth
        using errcode = 'P0001';
    end if;

    -- Resep terbuka: barang non-Grup saja. Qty barang dari Grup dalam dikalikan
    -- jumlah Grup dalam (dalam satuan dasar Grup itu). Satuan barang dipertahankan.
    with recursive walk(component_item_id, qty, unit, factor, ord, depth) as (
      select r.component_item_id, r.qty::numeric, r.unit::text, r.factor::numeric, array[r.sort_order], 1
      from public.item_group_recipe r
      where r.group_item_id = target
      union all
      select r.component_item_id, w.qty * w.factor * r.qty, r.unit::text, r.factor::numeric,
             w.ord || r.sort_order, w.depth + 1
      from walk w
      join public.items g on g.id = w.component_item_id and g.item_type = 'Grup'
      join public.item_group_recipe r on r.group_item_id = w.component_item_id
      where w.depth <= max_depth
    ), leaves as (
      select w.component_item_id, w.unit, w.factor, sum(w.qty) as qty, min(w.ord) as ord
      from walk w
      join public.items i on i.id = w.component_item_id and i.item_type <> 'Grup'
      group by w.component_item_id, w.unit, w.factor
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'component_item_id', component_item_id,
             'qty', qty,
             'unit', unit,
             'factor', factor,
             'sort_order', sort_order) order by sort_order), '[]'::jsonb)
    into flat
    from (
      select component_item_id, qty, unit, factor,
             (row_number() over (order by ord, component_item_id, unit) - 1)::integer as sort_order
      from leaves
    ) numbered;

    if exists (
      select 1 from jsonb_to_recordset(flat) as x(qty numeric)
      where x.qty <> round(x.qty, 4) or round(x.qty, 4) <= 0 or x.qty >= 100000000000
    ) then
      select name into bad_name from public.items where id = target;
      raise exception 'GRUP_QTY: jumlah isi paket "%" terlalu kecil atau terlalu besar setelah digabung.', bad_name
        using errcode = 'P0001';
    end if;

    -- Satu barang dengan satuan sama bisa datang dari dua jalur dengan faktor
    -- berbeda hanya bila master berubah di tengah; tolak daripada menebak.
    if (select count(*) from jsonb_to_recordset(flat) as x(component_item_id uuid, unit text)
        group by x.component_item_id, lower(x.unit) order by 1 desc limit 1) > 1 then
      select name into bad_name from public.items where id = target;
      raise exception 'GRUP_SATUAN: satuan isi paket "%" tidak konsisten. Simpan ulang paket isinya dulu.', bad_name
        using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'component_item_id', c.component_item_id,
             'qty', c.qty,
             'unit', c.unit,
             'factor', c.factor,
             'sort_order', c.sort_order) order by c.sort_order), '[]'::jsonb)
    into current_flat
    from public.item_group_components c
    where c.group_item_id = target;

    -- Tidak berubah = tidak ditulis (tidak ada jejak audit kosong).
    if current_flat is distinct from flat then
      -- Pesan jelas bila paket masih memuat barang yang sudah dinonaktifkan.
      select i.name into bad_name
      from jsonb_to_recordset(flat) as x(component_item_id uuid)
      join public.items i on i.id = x.component_item_id
      where not i.is_active
      limit 1;
      if found then
        raise exception 'GRUP_NONAKTIF: paket "%" berisi "%" yang sudah nonaktif. Ganti isi paket itu dulu.',
          (select name from public.items where id = target), bad_name
          using errcode = 'P0001';
      end if;
      delete from public.item_group_components where group_item_id = target;
      insert into public.item_group_components (group_item_id, component_item_id, qty, unit, factor, sort_order)
      select target, component_item_id, qty, unit, factor, sort_order
      from jsonb_to_recordset(flat) as x(
        component_item_id uuid,
        qty numeric,
        unit text,
        factor numeric,
        sort_order integer
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.replace_item_group_components(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_item_group_components(uuid, jsonb) to authenticated;

-- Reset simulasi: susunan admin ikut dibersihkan sebelum master barang dihapus.
do $patch$
declare d text;
  old_text constant text := 'delete from public.item_group_components where ctid is not null;';
begin
  d := pg_get_functiondef('public.reset_simulasi_barang_dan_stok(text)'::regprocedure);
  if (length(d) - length(replace(d, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'Grup bertingkat: anchor reset_simulasi_barang_dan_stok berubah';
  end if;
  execute replace(d, old_text, 'delete from public.item_group_recipe where ctid is not null;' || chr(10) || '  ' || old_text);
end $patch$;

-- Jejak aktivitas: susunan admin dicatat seperti resep terbuka.
insert into public.activity_log_sources
 (entity,module_id,label_key,value_keys,scope_kind,parent_entity,parent_key,identity_keys,branch_columns,scope_parents,metadata_only,reader_roles)
values
 ('item_group_recipe','pos',null,array['qty','factor','sort_order'],'refs','items','group_item_id',array['id'],'{}',
  '[{"entity":"items","key":"group_item_id"},{"entity":"items","key":"component_item_id"}]',false,array['OWNER','ADMIN']);

create trigger a01_activity_change after insert or update on public.item_group_recipe
  for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on public.item_group_recipe
  for each row execute function public.capture_activity_log();

comment on table public.item_group_recipe is
  'Susunan Grup yang diisi admin. Boleh berisi Grup lain (maks 5 tingkat, tanpa lingkaran).';
comment on table public.item_group_components is
  'Resep terbuka produk Grup, dihitung otomatis dari item_group_recipe. Hanya Persediaan, Jasa, atau Non-Persediaan.';
