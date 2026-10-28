-- "Tindakan & Racikan" gaya pekerjaan pesanan (Accurate), khusus KLINIK.
-- Keputusan pemilik lewat Andri, 28 Oktober 2026:
--   * Tindakan dari kategori TINDAKAN boleh berjenis Persediaan dan tetap membawa BMHP.
--     Jenis item tidak dikonversi; hanya penjaga BMHP yang dilonggarkan untuk pohon TINDAKAN.
--   * Saat tagihan klinik diposting, satu baris tindakan persediaan ber-BMHP dikerjakan
--     dalam satu transaksi: bahan BMHP keluar ('klinik-bmhp'), hasil tindakan diterima ke
--     gudang yang sama senilai total BMHP ('pesanan-selesai'), lalu dijual seperti stok biasa
--     ('klinik'). Stok bersih barang tindakan tidak berubah dan HPP barisnya = biaya BMHP,
--     jadi jurnal tetap persediaan bahan -> persediaan tindakan -> HPP tanpa dihitung dua kali.
--   * Racikan: tombol Void diganti "Ubah komposisi" (hanya selisihnya yang menggerakkan stok)
--     dan "Kembalikan bahan". Keduanya wajib beralasan dan hanya selama racikan belum
--     diserahkan dan tagihannya belum dibayar — ditegakkan di database, bukan hanya di layar.
--
-- Semua perubahan pada RPC yang sudah berjalan memakai jangkar eksak di atas definisi
-- berjalan (pg_get_functiondef + replace) dan gagal tertutup bila definisinya sudah berubah.
-- Migrasi lama tidak diubah.

-- ---------------------------------------------------------------------------
-- 1. Penolong bersama
-- ---------------------------------------------------------------------------

-- Pohon kategori TINDAKAN, aturan sama persis dengan splitClinicItems di aplikasi:
-- telusuri induk kategori; ketemu JASA lebih dulu berarti bukan tindakan klinik.
create function clinic_private.item_under_tindakan(p_item_id uuid) returns boolean
language plpgsql stable set search_path = '' as $$
declare v_id uuid; v_name text; v_parent uuid; v_depth integer := 0; v_seen uuid[] := array[]::uuid[];
begin
  if p_item_id is null then return false; end if;
  select i.category_id into v_id from public.items i where i.id = p_item_id;
  while v_id is not null and v_depth < 20 and not (v_id = any(v_seen)) loop
    v_seen := v_seen || v_id;
    select upper(btrim(c.name)), c.parent_id into v_name, v_parent
    from public.item_categories c where c.id = v_id;
    if not found then return false; end if;
    if v_name = 'TINDAKAN' then return true; end if;
    if v_name = 'JASA' then return false; end if;
    v_id := v_parent; v_depth := v_depth + 1;
  end loop;
  return false;
end $$;
revoke all on function clinic_private.item_under_tindakan(uuid) from public, anon, authenticated, service_role;

-- Penyelesaian pesanan satu baris tindakan: terima hasilnya senilai biaya BMHP lalu
-- keluarkan lagi lewat rutinitas persediaan yang sudah ada, sehingga lapisan biaya
-- (FIFO maupun moving average) dan kartu stok terbentuk seperti dokumen lain.
create function clinic_private.job_order_complete(
  p_warehouse_id uuid, p_item_id uuid, p_qty numeric, p_cost numeric, p_ref text, p_date date
) returns numeric language plpgsql set search_path = '' as $$
declare v_out record;
begin
  if p_warehouse_id is null or p_qty is null or p_qty <= 0 or p_cost is null or p_cost <= 0
     or p_cost::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception using errcode = 'P0001', message = 'COST_MISSING: biaya BMHP tindakan tidak tersedia';
  end if;
  perform public.stock_in_fifo(p_warehouse_id, p_item_id, p_qty, p_cost / p_qty,
    'pesanan-selesai', p_ref, p_date, null);
  select * into v_out from public.stock_out_fifo(p_warehouse_id, p_item_id, p_qty, 'klinik', p_ref, p_date);
  if v_out.shortfall > 0 or v_out.cost is null or v_out.cost <= 0 then
    raise exception using errcode = 'P0001', message = 'STOCK_SHORT: hasil tindakan tidak dapat dikeluarkan';
  end if;
  return round(v_out.cost, 2);
end $$;
revoke all on function clinic_private.job_order_complete(uuid, uuid, numeric, numeric, text, date)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Penjaga BMHP: izinkan barang persediaan di pohon TINDAKAN
-- ---------------------------------------------------------------------------
-- guard_invoice_item_bmhp tidak memeriksa jenis item sama sekali (hanya siapa yang boleh
-- menulis snapshot), jadi tidak ada yang perlu dilonggarkan di sana.
do $patch$
declare p record; definition text; signature regprocedure;
begin
 for p in select * from (values
  ('public.guard_prescription_bmhp()',
   E'  if new.jenis is distinct from ''jasa'' or new.item_id is null or v_type is distinct from ''Jasa'' then\n    raise exception using errcode = ''P0001'', message = ''BMHP_INVALID: BMHP hanya untuk baris tindakan/jasa dari master'';\n  end if;',
   E'  -- Tindakan boleh jasa, atau barang persediaan di pohon kategori TINDAKAN (pekerjaan pesanan).\n  if new.item_id is null or not (\n       (new.jenis is not distinct from ''jasa'' and v_type is not distinct from ''Jasa'')\n    or (new.jenis is not distinct from ''obat'' and v_type is not distinct from ''Persediaan''\n        and clinic_private.item_under_tindakan(new.item_id))) then\n    raise exception using errcode = ''P0001'', message = ''BMHP_INVALID: BMHP hanya untuk baris tindakan/jasa dari master'';\n  end if;')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Pesanan tindakan: RPC wajib tidak ada: %', p.sig; end if;
  definition := pg_get_functiondef(signature);
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Pesanan tindakan: jangkar harus muncul tepat sekali di %; periksa definisi sebelum menerapkan', p.sig;
  end if;
  execute replace(definition, p.old_text, p.new_text);
 end loop;
end $patch$;
revoke all on function public.guard_prescription_bmhp() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Posting tagihan klinik: pekerjaan pesanan untuk tindakan persediaan ber-BMHP
-- ---------------------------------------------------------------------------
do $patch$
declare p record; definition text; signature regprocedure;
begin
 for p in select * from (values
  -- Biaya pesanan baris berjalan.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'  v_bmhp jsonb;',
   E'  v_bmhp jsonb;\n  v_job_order_cost numeric(15,2);'),
  -- Kunci stok BMHP untuk SEMUA baris beresep, bukan hanya baris jasa.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'      where e.value ->> ''kind'' = ''jasa''\n    ) x order by x.item_id',
   E'    ) x order by x.item_id'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'    v_bmhp := null;',
   E'    v_bmhp := null;\n    v_job_order_cost := null;'),
  -- Baris barang beresep: keluarkan BMHP-nya lalu selesaikan pesanannya; baris tanpa BMHP
  -- tetap lewat pemeriksaan stok dan lapisan FIFO/average yang lama, tanpa perubahan.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'      v_base_qty := v_qty * v_factor;\n      if v_warehouse_id is null then\n        raise exception using errcode = ''P0001'', message = ''WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan'';\n      end if;\n      select s.qty into v_stock_qty from public.stock s',
   E'      v_base_qty := v_qty * v_factor;\n      if v_warehouse_id is null then\n        raise exception using errcode = ''P0001'', message = ''WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan'';\n      end if;\n      if v_prescription_item_id is not null then\n        v_bmhp := clinic_private.bmhp_issue(v_prescription_item_id, v_warehouse_id, v_invoice_no, v_tanggal);\n      end if;\n      if v_bmhp is not null then\n        -- PESANAN_TINDAKAN: bahan keluar, hasil tindakan masuk senilai bahan, lalu dijual.\n        v_job_order_cost := (v_bmhp ->> ''cost'')::numeric(15,2);\n        v_line_hpp := clinic_private.job_order_complete(v_warehouse_id, v_item_id, v_base_qty,\n          v_job_order_cost, v_invoice_no, v_tanggal);\n      else\n      select s.qty into v_stock_qty from public.stock s'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'      insert into public.stock_moves (tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref)\n      values (v_tanggal, v_warehouse_id, v_item_id, -v_base_qty,\n        (case when v_average then v_effective_cost else v_line_hpp / nullif(v_base_qty, 0) end), ''klinik'', v_invoice_no);\n    elsif v_item_id is not null and v_kind = ''jasa'' then',
   E'      insert into public.stock_moves (tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref)\n      values (v_tanggal, v_warehouse_id, v_item_id, -v_base_qty,\n        (case when v_average then v_effective_cost else v_line_hpp / nullif(v_base_qty, 0) end), ''klinik'', v_invoice_no);\n      end if;\n    elsif v_item_id is not null and v_kind = ''jasa'' then'),
  -- Koreksi tagihan: BMHP baris yang dipertahankan dikenali lewat baris resepnya, apa pun jenisnya.
  ('clinic_private.bmhp_edit_plan(uuid,jsonb,uuid,text)',
   E'    if exists (select 1 from jsonb_array_elements(p_lines) x where x.value->>''kind'' = ''jasa''\n      and nullif(x.value->>''prescription_item_id'', '''')::uuid = r.prescription_item_id) then',
   E'    if exists (select 1 from jsonb_array_elements(p_lines) x\n      where nullif(x.value->>''prescription_item_id'', '''')::uuid = r.prescription_item_id) then'),
  -- Koreksi tagihan: baris tindakan ber-BMHP tidak menggerakkan stok hasil tindakan.
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'      v_new_qty := v_qty*v_factor;',
   E'      v_new_qty := v_qty*v_factor;\n      if exists(select 1 from public.invoice_items b where b.invoice_id=p_invoice_id\n        and b.item_id=v_item and b.jenis=''obat'' and b.bmhp_components is not null) then\n        -- Pesanan tindakan sudah netral terhadap stok barang tindakan; jumlahnya mengikuti resep.\n        if v_new_qty<>v_old_qty then\n          raise exception using errcode=''P0001'', message=''BMHP_INVALID: jumlah tindakan ber-BMHP tidak dapat diubah lewat koreksi''; end if;\n        v_hpp_map := v_hpp_map || jsonb_build_object(v_item::text,v_old_hpp);\n        continue;\n      end if;'),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'    select item_id,sum(qty*faktor),sum(hpp) from public.invoice_items\n    where invoice_id=p_invoice_id and jenis=''obat'' and item_id is not null',
   E'    select item_id,sum(qty*faktor),sum(hpp) from public.invoice_items\n    where invoice_id=p_invoice_id and jenis=''obat'' and item_id is not null and bmhp_components is null'),
  -- Snapshot BMHP yang dipertahankan ikut baris barang, bukan cuma baris jasa.
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'case when v_kind=''jasa'' then v_bmhp_map->(v_line->>''prescription_item_id'') else null end',
   E'v_bmhp_map->nullif(v_line->>''prescription_item_id'','''')'),
  -- Jejak racikan juga menampilkan mutasi koreksi dan pengembalian bahan.
  ('public.read_compound_trace(uuid)',
   E' where sm.source=''racik'' and sm.source_ref=p_recipe_id::text',
   E' where sm.source in (''racik'',''racik-koreksi'',''racik-kembali'') and sm.source_ref=p_recipe_id::text')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Pesanan tindakan: RPC wajib tidak ada: %', p.sig; end if;
  definition := pg_get_functiondef(signature);
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Pesanan tindakan: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);
  end if;
  execute replace(definition, p.old_text, p.new_text);
 end loop;
end $patch$;

-- ACL/pemilik RPC tidak berubah; kembalikan pembatasan fungsi privat apa adanya.
revoke all on function clinic_private.bmhp_edit_plan(uuid, jsonb, uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Racikan: koreksi komposisi dan pengembalian bahan, keduanya beralasan
-- ---------------------------------------------------------------------------

create table public.compound_adjustments (
  id bigint generated always as identity primary key,
  recipe_id uuid not null references public.compounding_recipes(id) on delete restrict,
  action text not null check (action in ('komposisi', 'kembali')),
  reason text not null check (btrim(reason) <> '' and length(reason) <= 500),
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  before_composition jsonb not null,
  after_composition jsonb not null
);
create index compound_adjustments_recipe_idx on public.compound_adjustments(recipe_id, id desc);
alter table public.compound_adjustments enable row level security;
revoke all on public.compound_adjustments from public, anon, authenticated, service_role;
revoke all on sequence public.compound_adjustments_id_seq from public, anon, authenticated, service_role;

create function clinic_private.compound_composition(p_recipe_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', ci.item_id, 'name', ci.ingredient_name,
    'quantity', ci.quantity, 'unit', ci.unit) order by ci.item_id, ci.id), '[]'::jsonb)
  from public.compounding_ingredients ci where ci.recipe_id = p_recipe_id;
$$;
revoke all on function clinic_private.compound_composition(uuid) from public, anon, authenticated, service_role;

-- Syarat yang sama untuk kedua aksi: belum diserahkan, belum menempel pada tagihan aktif,
-- dan tagihan kunjungannya belum menerima uang. Ditegakkan di database.
create function clinic_private.assert_compound_adjustable(p_recipe_id uuid, p_record_id uuid)
returns void language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select r.status into v_status from public.compounding_recipes r where r.id = p_recipe_id;
  if v_status = 'handed_over' then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: racikan sudah diserahkan';
  end if;
  if exists (select 1 from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
    where ii.compound_recipe_id = p_recipe_id and i.voided_at is null) then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: racikan sudah dipakai pada invoice';
  end if;
  if exists (select 1 from public.invoices i
    join public.medical_records m on m.visit_id = i.visit_id
    where m.id = p_record_id and i.voided_at is null
      and (i.paid_status = 'Lunas' or i.paid_at is not null or coalesce(i.dp_amount, 0) > 0
        or exists (select 1 from public.invoice_payments p where p.invoice_id = i.id))) then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAID: tagihan kunjungan sudah dibayar';
  end if;
end $$;
revoke all on function clinic_private.assert_compound_adjustable(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Ubah komposisi: hanya SELISIHnya yang menggerakkan stok. Bahan yang jumlahnya tetap
-- tidak dikeluarkan dan tidak dikembalikan, jadi lapisan biayanya tidak teraduk ulang.
create function public.clinic_adjust_compound(p_recipe_id uuid, p_ingredients jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_recipe public.compounding_recipes%rowtype;
  v_branch uuid; v_warehouse uuid;
  v_before jsonb; v_after jsonb := '[]'::jsonb;
  v_row jsonb; v_item_id uuid; v_qty numeric; v_seen uuid[] := array[]::uuid[];
  v_item public.items%rowtype;
  v_total numeric := 0;
  v_target record; v_delta numeric; v_stock numeric;
  v_layer record; v_issue record;
  v_take numeric; v_remaining numeric; v_cost numeric;
  v_average boolean; v_effective numeric;
  v_ingredient_id uuid;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none')
  );
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: alasan perubahan komposisi wajib diisi';
  end if;
  if jsonb_typeof(p_ingredients) is distinct from 'array'
     or jsonb_array_length(p_ingredients) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: minimal satu bahan racikan';
  end if;
  perform public.inventory_assert_open_date(current_date);
  v_average := public.inventory_is_average();

  select r.* into v_recipe from public.compounding_recipes r where r.id = p_recipe_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: racikan tidak ditemukan';
  end if;
  select v.branch_id into v_branch
  from public.medical_records m join public.visits v on v.id = m.visit_id
  where m.id = v_recipe.medical_record_id;
  if not found or not public.user_can_access_branch(v_branch) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang racikan tidak diizinkan';
  end if;
  if v_recipe.status not in ('pending', 'ready') then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: racikan tidak dapat diubah lagi';
  end if;
  if exists (select 1 from public.compound_official_usage u where u.recipe_id = p_recipe_id) then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: komposisi resep resmi tidak dapat diubah';
  end if;
  perform clinic_private.assert_compound_adjustable(p_recipe_id, v_recipe.medical_record_id);
  if exists (select 1 from public.compound_issues i where i.recipe_id = p_recipe_id
    and (i.posted_invoice_item_id is not null or i.restored_at is not null)) then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: histori stok racikan tidak konsisten';
  end if;

  select w.id into v_warehouse from public.warehouses w
  where w.branch_id = v_branch and w.type = 'VET' and w.is_active
  order by w.created_at, w.id limit 1 for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
  end if;
  v_before := clinic_private.compound_composition(p_recipe_id);

  -- Harga dan nama bahan selalu dari master; angka dari klien hanya jumlahnya.
  for v_row in select value from jsonb_array_elements(p_ingredients) loop
    begin
      v_item_id := nullif(v_row ->> 'item_id', '')::uuid;
      v_qty := nullif(v_row ->> 'quantity', '')::numeric;
    exception when others then
      raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: bahan racikan tidak valid';
    end;
    if v_item_id is null or v_qty is null or v_qty <= 0 or v_qty > 1000000
       or v_qty::text in ('NaN', 'Infinity', '-Infinity') or v_item_id = any(v_seen) then
      raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: bahan atau jumlah racikan tidak valid';
    end if;
    select * into v_item from public.items
    where id = v_item_id and is_active and item_type = 'Persediaan' and is_compound_material for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'INGREDIENT_INVALID: bahan tidak aktif';
    end if;
    v_seen := v_seen || v_item_id;
    v_after := v_after || jsonb_build_array(jsonb_build_object('item_id', v_item_id::text,
      'name', v_item.name, 'quantity', v_qty, 'unit', v_item.unit,
      'unit_price', coalesce(v_item.sell_price, 0)::numeric(15,2)));
    v_total := v_total + v_qty * coalesce(v_item.sell_price, 0);
  end loop;

  -- Urutan barang yang tetap, sama seperti penerbitan racikan dan posting invoice.
  for v_target in
    select x.item_id,
      coalesce((select sum(ci.quantity) from public.compounding_ingredients ci
        where ci.recipe_id = p_recipe_id and ci.item_id = x.item_id), 0) as current_qty,
      coalesce((select (e.value ->> 'quantity')::numeric from jsonb_array_elements(v_after) e
        where (e.value ->> 'item_id')::uuid = x.item_id), 0) as target_qty,
      (select e.value from jsonb_array_elements(v_after) e
        where (e.value ->> 'item_id')::uuid = x.item_id) as target
    from (
      select ci.item_id from public.compounding_ingredients ci
      where ci.recipe_id = p_recipe_id and ci.item_id is not null
      union
      select (e.value ->> 'item_id')::uuid from jsonb_array_elements(v_after) e
    ) x
    order by x.item_id
  loop
    select i.name into v_item.name from public.items i where i.id = v_target.item_id;
    v_delta := v_target.target_qty - v_target.current_qty;
    select ci.id into v_ingredient_id from public.compounding_ingredients ci
    where ci.recipe_id = p_recipe_id and ci.item_id = v_target.item_id order by ci.id limit 1 for update;
    if v_target.target_qty > 0 then
      if v_ingredient_id is null then
        insert into public.compounding_ingredients (recipe_id, ingredient_name, item_id, quantity, unit, unit_price)
        values (p_recipe_id, v_target.target ->> 'name', v_target.item_id,
          (v_target.target ->> 'quantity')::numeric, v_target.target ->> 'unit',
          (v_target.target ->> 'unit_price')::numeric)
        returning id into v_ingredient_id;
      else
        update public.compounding_ingredients
        set quantity = (v_target.target ->> 'quantity')::numeric,
            unit = v_target.target ->> 'unit',
            unit_price = (v_target.target ->> 'unit_price')::numeric
        where id = v_ingredient_id;
      end if;
    end if;

    perform 1 from public.stock s
    where s.warehouse_id = v_warehouse and s.item_id = v_target.item_id for update;

    if v_delta > 0 then
      select s.qty into v_stock from public.stock s
      where s.warehouse_id = v_warehouse and s.item_id = v_target.item_id;
      if coalesce(v_stock, 0) < v_delta then
        raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s', coalesce(v_item.name, 'bahan racikan'));
      end if;
      v_remaining := v_delta; v_cost := 0; v_effective := null;
      if v_average then
        v_effective := public.inventory_effective_unit_cost(v_warehouse, v_target.item_id);
        if v_effective is null or v_effective <= 0 or v_effective::text in ('NaN', 'Infinity', '-Infinity') then
          raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_item.name, 'bahan racikan'));
        end if;
      end if;
      for v_layer in
        select l.id, l.qty_left, l.unit_cost, l.exp_date from public.stock_layers l
        where l.warehouse_id = v_warehouse and l.item_id = v_target.item_id and l.qty_left > 0
        order by (l.exp_date is null), l.exp_date nulls last, l.tanggal, l.created_at, l.id
        for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_layer.qty_left, v_remaining);
        if v_take <= 0 then continue; end if;
        if not v_average and (v_layer.unit_cost is null or v_layer.unit_cost <= 0) then
          raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_item.name, 'bahan racikan'));
        end if;
        update public.stock_layers set qty_left = qty_left - v_take where id = v_layer.id;
        insert into public.compound_issues (recipe_id, ingredient_id, warehouse_id, item_id,
          stock_layer_id, qty, unit_cost, physical_unit_cost, exp_date)
        values (p_recipe_id, v_ingredient_id, v_warehouse, v_target.item_id, v_layer.id, v_take,
          coalesce(v_effective, v_layer.unit_cost), v_layer.unit_cost, v_layer.exp_date)
        on conflict (ingredient_id, stock_layer_id) do update
          set qty = public.compound_issues.qty + excluded.qty,
              unit_cost = (public.compound_issues.qty * public.compound_issues.unit_cost
                + excluded.qty * excluded.unit_cost) / (public.compound_issues.qty + excluded.qty);
        v_cost := v_cost + v_take * coalesce(v_effective, v_layer.unit_cost);
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        raise exception using errcode = 'P0001', message = format('LAYER_SHORT: %s', coalesce(v_item.name, 'bahan racikan'));
      end if;
      update public.stock set qty = qty - v_delta, updated_at = now()
      where warehouse_id = v_warehouse and item_id = v_target.item_id;
      insert into public.stock_moves (warehouse_id, item_id, qty, unit_cost, source, source_ref)
      values (v_warehouse, v_target.item_id, -v_delta, v_cost / v_delta, 'racik-koreksi', p_recipe_id::text);
    elsif v_delta < 0 then
      v_remaining := -v_delta; v_cost := 0;
      for v_issue in
        select i.id, i.qty, i.unit_cost, i.physical_unit_cost, i.exp_date
        from public.compound_issues i
        where i.recipe_id = p_recipe_id and i.item_id = v_target.item_id and i.restored_at is null
        order by i.stock_layer_id desc, i.id desc
        for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_issue.qty, v_remaining);
        if v_take <= 0 then continue; end if;
        insert into public.stock_layers (warehouse_id, item_id, tanggal, exp_date, qty_in, qty_left,
          unit_cost, source, source_ref)
        values (v_warehouse, v_target.item_id, current_date, v_issue.exp_date, v_take, v_take,
          v_issue.physical_unit_cost, 'racik-koreksi', p_recipe_id::text);
        if v_take >= v_issue.qty then
          delete from public.compound_issues where id = v_issue.id;
        else
          update public.compound_issues set qty = qty - v_take where id = v_issue.id;
        end if;
        v_cost := v_cost + v_take * v_issue.unit_cost;
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        raise exception using errcode = 'P0001', message = 'COST_MISSING: histori stok racikan tidak lengkap';
      end if;
      insert into public.stock (warehouse_id, item_id, qty, updated_at)
      values (v_warehouse, v_target.item_id, -v_delta, now())
      on conflict (warehouse_id, item_id) do update
        set qty = public.stock.qty + excluded.qty, updated_at = excluded.updated_at;
      insert into public.stock_moves (warehouse_id, item_id, qty, unit_cost, source, source_ref)
      values (v_warehouse, v_target.item_id, -v_delta, v_cost / (-v_delta), 'racik-koreksi', p_recipe_id::text);
    end if;

    if v_target.target_qty = 0 and v_ingredient_id is not null then
      delete from public.compound_issues where ingredient_id = v_ingredient_id;
      delete from public.compounding_ingredients where id = v_ingredient_id;
    end if;
  end loop;

  update public.compounding_recipes set total_price = round(v_total, 2)::numeric(15,2) where id = p_recipe_id;
  -- SKU induk racikan punya harga jualnya sendiri dan disegel snapshot penjualan;
  -- hanya racikan tanpa induk yang harga tagihannya mengikuti komposisi.
  if not exists (select 1 from public.clinic_compound_sales s where s.recipe_id = p_recipe_id) then
    update public.prescription_items set harga = round(v_total, 2)::numeric(15,2)
    where compound_recipe_id = p_recipe_id;
  end if;
  insert into public.compound_adjustments (recipe_id, action, reason, actor_id, before_composition, after_composition)
  values (p_recipe_id, 'komposisi', btrim(p_reason), v_user, v_before,
    clinic_private.compound_composition(p_recipe_id));
end;
$function$;
revoke all on function public.clinic_adjust_compound(uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.clinic_adjust_compound(uuid, jsonb, text) to authenticated;

-- Kembalikan bahan: semantik clinic_void_compound yang sedang berjalan (termasuk perbaikan
-- average dan peran), hanya sumber mutasinya 'racik-kembali' dan alasannya wajib.
do $patch$
declare body text; signature regprocedure := 'public.clinic_void_compound(uuid)'::regprocedure;
  header text := 'public.clinic_void_compound(p_recipe_id uuid)';
  move_anchor text := E'''racik'', p_recipe_id::text';
  void_anchor text := E'  if v_recipe.status = ''void'' then return; end if;';
  status_anchor text := E'  update public.compounding_recipes set status = ''void'' where id = p_recipe_id;';
begin
  body := pg_get_functiondef(signature);
  if (length(body) - length(replace(body, header, ''))) / length(header) <> 1
     or (length(body) - length(replace(body, move_anchor, ''))) / length(move_anchor) <> 2
     or (length(body) - length(replace(body, void_anchor, ''))) / length(void_anchor) <> 1
     or (length(body) - length(replace(body, status_anchor, ''))) / length(status_anchor) <> 1 then
    raise exception 'Pengembalian bahan racikan: definisi clinic_void_compound tidak seperti yang ditinjau';
  end if;
  body := replace(body, header, 'public.clinic_return_compound(p_recipe_id uuid, p_reason text)');
  body := replace(body, move_anchor, E'''racik-kembali'', p_recipe_id::text');
  body := replace(body, void_anchor,
    E'  if nullif(btrim(p_reason),'''') is null or length(btrim(p_reason))>500 then\n'
    || E'    raise exception using errcode = ''P0001'', message = ''REASON_REQUIRED: alasan pengembalian bahan wajib diisi'';\n'
    || E'  end if;\n'
    || void_anchor || E'\n  perform clinic_private.assert_compound_adjustable(p_recipe_id, v_recipe.medical_record_id);');
  body := replace(body, status_anchor,
    E'  insert into public.compound_adjustments(recipe_id,action,reason,actor_id,before_composition,after_composition)\n'
    || E'  values (p_recipe_id,''kembali'',btrim(p_reason),v_user_id,clinic_private.compound_composition(p_recipe_id),''[]''::jsonb);\n'
    || status_anchor);
  execute body;
end $patch$;
revoke all on function public.clinic_return_compound(uuid, text) from public, anon, service_role;
grant execute on function public.clinic_return_compound(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pemeriksaan akhir: tolak pemasangan bila hasilnya tidak seperti yang ditinjau
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
  d := pg_get_functiondef('public.guard_prescription_bmhp()'::regprocedure);
  if position('clinic_private.item_under_tindakan' in d) = 0
     or position(E'new.jenis is distinct from ''jasa'' or new.item_id is null' in d) > 0 then
    raise exception 'Pesanan tindakan: penjaga BMHP belum menerima barang persediaan tindakan';
  end if;
  d := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  if position('PESANAN_TINDAKAN' in d) = 0
     or position('clinic_private.job_order_complete' in d) = 0
     or (length(d) - length(replace(d, 'clinic_private.bmhp_issue', ''))) / length('clinic_private.bmhp_issue') <> 2 then
    raise exception 'Pesanan tindakan: posting invoice belum mengerjakan pesanan tindakan';
  end if;
  d := pg_get_functiondef('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure);
  if position('BMHP_INVALID: jumlah tindakan ber-BMHP' in d) = 0
     or position('and bmhp_components is null' in d) = 0 then
    raise exception 'Pesanan tindakan: koreksi tagihan masih menggerakkan stok hasil tindakan';
  end if;
  if to_regprocedure('public.clinic_return_compound(uuid,text)') is null
     or to_regprocedure('public.clinic_adjust_compound(uuid,jsonb,text)') is null then
    raise exception 'Racikan: RPC koreksi/pengembalian bahan tidak terpasang';
  end if;
  d := pg_get_functiondef('public.clinic_return_compound(uuid,text)'::regprocedure);
  if position('racik-kembali' in d) = 0 or position('REASON_REQUIRED' in d) = 0
     or position('assert_compound_adjustable' in d) = 0 then
    raise exception 'Racikan: pengembalian bahan belum memakai sumber dan alasan baru';
  end if;
end $check$;
