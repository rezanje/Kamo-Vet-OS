-- OWNER mengoreksi bahan racikan yang SUDAH ada di baris tagihan (lunas ATAU belum lunas), 7 Nov 2026
-- (kasus Bella, kunjungan ranap Ciomas: 'Sirup Vitamin' di INV-202611-0089 dan 'Kapsul Antigiardia' di INV-202611-0099).
--
-- Masalah: clinic_owner_correct_compound (20261107120000) sengaja menolak racikan yang sudah masuk baris invoice
-- (RECIPE_LINKED), jadi bahan racikan yang salah catat di tagihan yang sudah terbit tidak bisa dibetulkan, dan HPP baris
-- serta jurnal HPP-nya tetap salah.
--
-- Yang ditambahkan (HANYA objek baru; kedua RPC 120000, clinic_adjust_compound, assert_invoice_price_floor (P03),
-- clinic_post_invoice, clinic_write_journal tidak diganti satu byte pun; dibuktikan dengan digest native):
--  * clinic_private.owner_compound_invoice_corrections: jejak tambah-saja (siapa/kapan/tagihan+baris/status bayar/bahan
--    sebelum-sesudah/HPP sebelum-sesudah-selisih/jurnal/alasan/kunci permintaan/efek stok). Tanpa hak aplikasi.
--  * clinic_owner_correct_compound_invoiced(p_recipe_id, p_ingredients, p_reason, p_request_key) -> jsonb: HANYA OWNER aktif
--    dengan akses cabang, alasan >= 5 huruf bukan-spasi (maks 500), idempoten menurut p_request_key.
--  * clinic_owner_compound_invoiced_correction_quote(p_recipe_id, p_ingredients) -> jsonb: pratinjau baca-saja (kode yang sama
--    di sub-transaksi yang dibatalkan): HPP sebelum/sesudah/selisih, jurnal selisih, efek stok, harga, bendera harga < HPP.
--
-- Perilaku (ditegakkan di database):
--  * stok bergerak HANYA sebesar selisih jumlah per bahan, primitif yang sama dengan koreksi 120000: pengurangan mengembalikan
--    lapisan pada biaya fisik aslinya (urutan kebalikan FIFO), penambahan keluar pada FIFO saat ini; sumber stock_moves 'racik-koreksi';
--  * compound_issues diperbarui konsisten dan SEMUA barisnya tetap/baru tertaut ke baris tagihan itu (posted_invoice_item_id);
--  * invoice_items.hpp baris itu dihitung ulang dari compound_issues (rumus yang sama dengan posting: round(sum(qty*unit_cost),2));
--  * jurnal selisih HPP bertanggal HARI INI lewat clinic_write_journal: HPP naik = Dr 600001 / Cr 170001; HPP turun = Dr 170001 / Cr 600001.
--    Sumber 'klinik-hpp-edit' dengan source_ref nomor invoice: sumber yang sama yang dibalik oleh void/koreksi invoice lama
--    (clinic_reverse_journal_lines(..., array['klinik-hpp','klinik-hpp-edit'])), dan tidak termasuk indeks anti-ganda 'klinik-hpp';
--  * total tagihan, harga jual, diskon, pembayaran, kwitansi, status bayar TIDAK disentuh; harga jual master/prescription_items tidak disentuh;
--  * ditolak bila: bukan Owner / cabang tidak diizinkan; kunjungan bukan rawat inap; kunjungan checkout/arsip/pulang+Selesai; racikan void;
--    baris resep ditarik; resep resmi; racikan BELUM di baris tagihan (NOT_INVOICED: pakai koreksi biasa); invoice void (INVOICE_VOID);
--    invoice menunggu koreksi kasir (INVOICE_PENDING); riwayat HPP tidak konsisten (HPP_INCONSISTENT: baris tagihan <> compound_issues,
--    ada baris issue yang tidak tertaut ke baris itu / sudah restored); periode akuntansi atau persediaan terkunci s/d hari ini;
--    refund (trigger invoice_items yang ada); tanpa perubahan (NO_CHANGE); payload/stok tidak valid (tanpa efek parsial);
--  * P03 TIDAK diubah: aturan lantai harga dinilai saat posting/koreksi dokumen invoice. Bila setelah koreksi HPP baris melebihi harga bersih,
--    pratinjau dan hasil melaporkannya (price_below_hpp_after) tanpa menolak;
--  * komisi/insentif: baris racikan bertanda item_id kosong, dan komisi berbasis laba menghitung baris tanpa item sebagai laba = omzet
--    (src/lib/komisi-data.ts), jadi HPP baru tidak mengubah komisi; poin loyalti tidak bergantung HPP. Total tagihan tetap, jadi tidak berubah.
--
-- Kunci (urutan sama dengan kasir ranap dan posting invoice, jadi tidak bisa balapan atau saling-kunci):
--   peran -> koordinator tagihan kunjungan (billing_lock) -> idempotensi (advisory) -> kunjungan FOR UPDATE -> rawat inap -> baris resep
--   -> racikan -> baris invoice -> invoice -> gudang -> bahan -> stok -> lapisan.
--
-- MEMBACA JEJAK (belum ada layar; hak aplikasi dicabut, baca lewat SQL editor sebagai postgres):
-- BACA_JEJAK_MULAI
--   select c.created_at, p.full_name as diubah_oleh, c.invoice_no, c.paid_status, c.hpp_before, c.hpp_after, c.hpp_delta, c.price, c.reason, c.request_key, c.before_ingredients, c.after_ingredients
--   from clinic_private.owner_compound_invoice_corrections c join public.profiles p on p.id = c.actor_id
--   order by c.created_at desc limit 100;
-- BACA_JEJAK_SELESAI
--
-- Apply as ONE transaction (tanpa begin/commit sendiri). Tidak ada backfill.

do $guard$
begin
  if to_regclass('clinic_private.owner_compound_invoice_corrections') is not null
     or to_regprocedure('public.clinic_owner_correct_compound_invoiced(uuid,jsonb,text,text)') is not null then
    raise exception 'Koreksi racikan bertagihan Owner: objek sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('public.clinic_owner_correct_compound(uuid,jsonb,text,text)') is null
     or to_regprocedure('public.clinic_record_correction_immutable()') is null
     or to_regprocedure('clinic_private.compound_composition(uuid)') is null
     or to_regprocedure('clinic_private.billing_lock(text[])') is null
     or to_regprocedure('clinic_private.billing_keys_visit(uuid)') is null
     or to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.inventory_assert_open_date(date)') is null
     or to_regclass('public.compound_issues') is null or to_regclass('public.compound_official_usage') is null
     or to_regclass('public.invoice_items') is null or to_regclass('public.invoices') is null then
    raise exception 'Koreksi racikan bertagihan Owner: prasyarat tidak ditemukan';
  end if;
end $guard$;

create table clinic_private.owner_compound_invoice_corrections (
  id uuid primary key,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references public.profiles(id),
  visit_id uuid not null references public.visits(id),
  recipe_id uuid not null references public.compounding_recipes(id),
  prescription_item_id uuid not null references public.prescription_items(id),
  invoice_id uuid not null references public.invoices(id),
  invoice_item_id uuid not null references public.invoice_items(id),
  invoice_no text not null,
  paid_status text not null,
  reason text not null check (length(regexp_replace(btrim(reason), '\s', '', 'g')) >= 5 and length(btrim(reason)) <= 500),
  request_key text not null unique check (length(request_key) between 1 and 100),
  request_hash text not null,
  before_ingredients jsonb not null,
  after_ingredients jsonb not null,
  hpp_before numeric(15,2) not null,
  hpp_after numeric(15,2) not null,
  hpp_delta numeric(15,2) not null,
  price numeric(15,2) not null,
  invoice_total numeric(15,2) not null,
  price_below_hpp_before boolean not null,
  price_below_hpp_after boolean not null,
  journal_entry_id uuid references public.journal_entries(id),
  stock_effects jsonb not null,
  result jsonb not null
);
create index owner_compound_invoice_corrections_recipe_idx on clinic_private.owner_compound_invoice_corrections(recipe_id, created_at);
create index owner_compound_invoice_corrections_invoice_idx on clinic_private.owner_compound_invoice_corrections(invoice_id, created_at);
alter table clinic_private.owner_compound_invoice_corrections enable row level security;
revoke all on clinic_private.owner_compound_invoice_corrections from public, anon, authenticated, service_role;
create trigger owner_compound_invoice_corrections_immutable before update or delete on clinic_private.owner_compound_invoice_corrections
  for each row execute function public.clinic_record_correction_immutable();
create trigger owner_compound_invoice_corrections_no_truncate before truncate on clinic_private.owner_compound_invoice_corrections
  for each statement execute function public.clinic_record_correction_immutable();

create function clinic_private.owner_correct_compound_invoiced(p_recipe_id uuid, p_ingredients jsonb, p_reason text, p_request_key text, p_dry boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_visit_id uuid; v_branch uuid; v_visit public.visits%rowtype;
  v_rx public.prescription_items%rowtype;
  v_recipe public.compounding_recipes%rowtype;
  v_line public.invoice_items%rowtype;
  v_inv public.invoices%rowtype;
  v_warehouse uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text := btrim(coalesce(p_request_key, ''));
  v_hash text; v_prior clinic_private.owner_compound_invoice_corrections%rowtype;
  v_before jsonb; v_after jsonb := '[]'::jsonb;
  v_row jsonb; v_item_id uuid; v_qty numeric; v_seen uuid[] := array[]::uuid[];
  v_item public.items%rowtype; v_name text; v_existing_qty numeric;
  v_target record; v_delta numeric; v_stock numeric; v_changes int := 0;
  v_layer record; v_issue record; v_take numeric; v_remaining numeric; v_cost numeric;
  v_average boolean; v_effective numeric; v_ingredient_id uuid;
  v_cost_before numeric; v_cost_after numeric; v_hpp_delta numeric; v_effects jsonb := '[]'::jsonb;
  v_share numeric; v_net numeric; v_below_before boolean; v_below_after boolean;
  v_jlines jsonb := '[]'::jsonb; v_journal_id uuid; v_journal jsonb;
  v_audit_id uuid := gen_random_uuid(); v_result jsonb;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  -- Cek peran SEBELUM mengambil kunci apa pun (bukan-Owner tidak boleh membuat Owner menunggu).
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: koreksi racikan yang sudah ditagih hanya untuk Owner';
  end if;
  if not p_dry and (length(regexp_replace(v_reason, '\s', '', 'g')) < 5 or length(v_reason) > 500) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: alasan koreksi wajib diisi (minimal 5 huruf, maksimal 500)';
  end if;
  if not p_dry and (v_key = '' or length(v_key) > 100) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: kunci permintaan wajib diisi (1-100 karakter)';
  end if;
  if jsonb_typeof(p_ingredients) is distinct from 'array' or jsonb_array_length(p_ingredients) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: minimal satu bahan racikan';
  end if;

  select m.visit_id into v_visit_id from public.compounding_recipes r
    join public.medical_records m on m.id = r.medical_record_id where r.id = p_recipe_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: racikan tidak ditemukan';
  end if;
  -- Koordinator tagihan kunjungan lebih dulu (kunci yang sama dengan kasir ranap, penerimaan pembayaran, void invoice, dan posting invoice).
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(v_visit_id));
  -- Baca ulang peran dan cabang SESUDAH menunggu.
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: koreksi racikan yang sudah ditagih hanya untuk Owner';
  end if;
  select v.branch_id into v_branch from public.visits v where v.id = v_visit_id;
  if v_branch is null or not public.user_can_access_branch(v_branch) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang racikan tidak diizinkan';
  end if;

  -- Idempoten: kunci yang sama dan isi yang sama mengembalikan hasil tersimpan; isi beda ditolak.
  v_hash := md5(jsonb_build_array(p_recipe_id::text, v_reason, (
    select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.qty) order by t.item_id), '[]'::jsonb) from (
      select e.value ->> 'item_id' as item_id, (e.value ->> 'quantity') as qty
      from jsonb_array_elements(p_ingredients) e) t))::text);
  if not p_dry then
    perform pg_advisory_xact_lock(hashtextextended('owner-koreksi-racikan-tagihan:' || v_key, 0));
    select * into v_prior from clinic_private.owner_compound_invoice_corrections where request_key = v_key;
    if found then
      if v_prior.actor_id is distinct from v_user or v_prior.recipe_id is distinct from p_recipe_id or v_prior.request_hash is distinct from v_hash then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci permintaan sudah dipakai untuk koreksi yang berbeda';
      end if;
      return v_prior.result || jsonb_build_object('replayed', true);
    end if;
  end if;

  select * into v_visit from public.visits v where v.id = v_visit_id for update;
  if not exists (select 1 from public.inpatient_records ir where ir.visit_id = v_visit_id) then
    raise exception using errcode = 'P0001', message = 'NOT_INPATIENT: koreksi Owner ini hanya untuk racikan rawat inap; pakai Ubah komposisi biasa';
  end if;
  perform 1 from public.inpatient_records ir where ir.visit_id = v_visit_id order by ir.id for update;
  if v_visit.checked_out_at is not null or v_visit.archived_at is not null
     or (v_visit.status = 'Selesai' and not exists (select 1 from public.inpatient_records ir where ir.visit_id = v_visit_id and ir.discharged_at is null)) then
    raise exception using errcode = 'P0001', message = 'VISIT_CLOSED: kunjungan sudah selesai/checkout, komposisi racikan tidak bisa diubah lagi';
  end if;
  select * into v_rx from public.prescription_items pi where pi.compound_recipe_id = p_recipe_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: baris resep racikan tidak ditemukan';
  end if;
  select * into v_recipe from public.compounding_recipes r where r.id = p_recipe_id for update;
  if v_recipe.status = 'void' then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: racikan sudah dibatalkan (void)';
  end if;
  if v_rx.billing_withdrawn_at is not null then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: baris racikan sudah ditarik dari tagihan';
  end if;
  if exists (select 1 from public.compound_official_usage u where u.recipe_id = p_recipe_id) then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: komposisi resep resmi tidak dapat diubah';
  end if;

  -- Baris tagihan racikan ini (satu racikan hanya bisa duduk di SATU baris invoice sepanjang masa: indeks unik).
  select * into v_line from public.invoice_items ii where ii.compound_recipe_id = p_recipe_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_INVOICED: racikan ini belum masuk baris tagihan; pakai Koreksi komposisi (Owner) biasa';
  end if;
  select * into v_inv from public.invoices i where i.id = v_line.invoice_id for update;
  if not found or v_inv.visit_id is distinct from v_visit_id then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: baris tagihan racikan tidak cocok dengan kunjungan';
  end if;
  if v_inv.voided_at is not null then
    raise exception using errcode = 'P0001', message = 'INVOICE_VOID: tagihan racikan ini sudah dibatalkan (void), HPP-nya tidak dikoreksi';
  end if;
  if v_inv.correction_pending then
    raise exception using errcode = 'P0001', message = 'INVOICE_PENDING: tagihan ini menunggu koreksi kasir; selesaikan koreksi kasir dulu';
  end if;
  -- Riwayat HPP harus utuh: semua baris issue tertaut ke baris tagihan ini, tidak ada yang restored, dan HPP baris = jumlah issue.
  if not exists (select 1 from public.compound_issues i where i.recipe_id = p_recipe_id)
     or exists (select 1 from public.compound_issues i where i.recipe_id = p_recipe_id
                and (i.posted_invoice_item_id is distinct from v_line.id or i.restored_at is not null)) then
    raise exception using errcode = 'P0001', message = 'HPP_INCONSISTENT: histori stok racikan tidak cocok dengan baris tagihan; hubungi Reza sebelum mengubah apa pun';
  end if;
  select coalesce(round(sum(i.qty * i.unit_cost), 2), 0) into v_cost_before from public.compound_issues i where i.recipe_id = p_recipe_id;
  if v_line.hpp is distinct from v_cost_before then
    raise exception using errcode = 'P0001', message = format('HPP_INCONSISTENT: HPP baris tagihan %s tidak sama dengan histori stok racikan %s; hubungi Reza', v_line.hpp, v_cost_before);
  end if;
  -- Periode akuntansi/persediaan: jurnal dan mutasi stok koreksi bertanggal hari ini.
  perform public.inventory_assert_open_date(current_date);
  v_average := public.inventory_is_average();

  select w.id into v_warehouse from public.warehouses w
  where w.branch_id = v_branch and w.type = 'VET' and w.is_active
  order by w.created_at, w.id limit 1 for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
  end if;
  v_before := clinic_private.compound_composition(p_recipe_id);

  -- Nama dan harga bahan baru dari master; angka dari klien hanya jumlahnya.
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
    select coalesce(sum(ci.quantity), 0) into v_existing_qty from public.compounding_ingredients ci
      where ci.recipe_id = p_recipe_id and ci.item_id = v_item_id;
    select * into v_item from public.items where id = v_item_id and item_type = 'Persediaan' for share;
    -- Bahan yang sudah ada boleh tetap/berkurang walau master-nya kini nonaktif; bahan baru atau tambahan wajib aktif dan bahan racikan.
    if not found or ((not v_item.is_active or not v_item.is_compound_material) and v_qty > v_existing_qty) then
      raise exception using errcode = 'P0001', message = 'INGREDIENT_INVALID: bahan tidak aktif atau bukan bahan racikan';
    end if;
    v_seen := v_seen || v_item_id;
    v_after := v_after || jsonb_build_array(jsonb_build_object('item_id', v_item_id::text, 'name', v_item.name,
      'quantity', v_qty, 'unit', v_item.unit, 'unit_price', coalesce(v_item.sell_price, 0)::numeric(15,2)));
  end loop;

  -- Tidak ada perubahan = tolak (tanpa jejak kosong).
  select count(*) into v_changes from (
    select x.item_id,
      coalesce((select sum(ci.quantity) from public.compounding_ingredients ci where ci.recipe_id = p_recipe_id and ci.item_id = x.item_id), 0) as cur,
      coalesce((select (e.value ->> 'quantity')::numeric from jsonb_array_elements(v_after) e where (e.value ->> 'item_id')::uuid = x.item_id), 0) as tgt
    from (select ci.item_id from public.compounding_ingredients ci where ci.recipe_id = p_recipe_id and ci.item_id is not null
          union select (e.value ->> 'item_id')::uuid from jsonb_array_elements(v_after) e) x) d where d.cur is distinct from d.tgt;
  if v_changes = 0 then
    raise exception using errcode = 'P0001', message = 'NO_CHANGE: komposisi sama dengan yang sekarang, tidak ada yang diubah';
  end if;

  -- Urutan barang tetap (item_id), sama seperti koreksi 120000, penerbitan racikan, dan posting invoice.
  for v_target in
    select x.item_id,
      coalesce((select sum(ci.quantity) from public.compounding_ingredients ci
        where ci.recipe_id = p_recipe_id and ci.item_id = x.item_id), 0) as current_qty,
      coalesce((select (e.value ->> 'quantity')::numeric from jsonb_array_elements(v_after) e
        where (e.value ->> 'item_id')::uuid = x.item_id), 0) as target_qty,
      (select e.value from jsonb_array_elements(v_after) e where (e.value ->> 'item_id')::uuid = x.item_id) as target
    from (
      select ci.item_id from public.compounding_ingredients ci
      where ci.recipe_id = p_recipe_id and ci.item_id is not null
      union
      select (e.value ->> 'item_id')::uuid from jsonb_array_elements(v_after) e
    ) x
    order by x.item_id
  loop
    select i.name into v_name from public.items i where i.id = v_target.item_id;
    v_delta := v_target.target_qty - v_target.current_qty;
    select ci.id into v_ingredient_id from public.compounding_ingredients ci
    where ci.recipe_id = p_recipe_id and ci.item_id = v_target.item_id order by ci.id limit 1 for update;
    if v_target.target_qty > 0 then
      if v_ingredient_id is null then
        insert into public.compounding_ingredients (recipe_id, ingredient_name, item_id, quantity, unit, unit_price)
        values (p_recipe_id, v_target.target ->> 'name', v_target.item_id, (v_target.target ->> 'quantity')::numeric,
          v_target.target ->> 'unit', (v_target.target ->> 'unit_price')::numeric)
        returning id into v_ingredient_id;
      elsif v_delta <> 0 then
        -- Hanya jumlahnya; nama, satuan, dan harga snapshot bahan yang sudah ada tidak digeser.
        update public.compounding_ingredients set quantity = (v_target.target ->> 'quantity')::numeric where id = v_ingredient_id;
      end if;
    end if;
    continue when v_delta = 0;

    perform 1 from public.stock s where s.warehouse_id = v_warehouse and s.item_id = v_target.item_id for update;

    if v_delta > 0 then
      select s.qty into v_stock from public.stock s where s.warehouse_id = v_warehouse and s.item_id = v_target.item_id;
      if coalesce(v_stock, 0) < v_delta then
        raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s', coalesce(v_name, 'bahan racikan'));
      end if;
      v_remaining := v_delta; v_cost := 0; v_effective := null;
      if v_average then
        v_effective := public.inventory_effective_unit_cost(v_warehouse, v_target.item_id);
        if v_effective is null or v_effective <= 0 or v_effective::text in ('NaN', 'Infinity', '-Infinity') then
          raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_name, 'bahan racikan'));
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
          raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_name, 'bahan racikan'));
        end if;
        update public.stock_layers set qty_left = qty_left - v_take where id = v_layer.id;
        -- Baris issue baru langsung tertaut ke baris tagihan (posted_invoice_item_id), seperti baris issue asli saat posting.
        insert into public.compound_issues (recipe_id, ingredient_id, warehouse_id, item_id, stock_layer_id, qty, unit_cost, physical_unit_cost, exp_date, posted_invoice_item_id)
        values (p_recipe_id, v_ingredient_id, v_warehouse, v_target.item_id, v_layer.id, v_take,
          coalesce(v_effective, v_layer.unit_cost), v_layer.unit_cost, v_layer.exp_date, v_line.id)
        on conflict (ingredient_id, stock_layer_id) do update
          set qty = public.compound_issues.qty + excluded.qty,
              unit_cost = (public.compound_issues.qty * public.compound_issues.unit_cost
                + excluded.qty * excluded.unit_cost) / (public.compound_issues.qty + excluded.qty);
        v_cost := v_cost + v_take * coalesce(v_effective, v_layer.unit_cost);
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        raise exception using errcode = 'P0001', message = format('LAYER_SHORT: %s', coalesce(v_name, 'bahan racikan'));
      end if;
      update public.stock set qty = qty - v_delta, updated_at = now()
      where warehouse_id = v_warehouse and item_id = v_target.item_id;
      insert into public.stock_moves (warehouse_id, item_id, qty, unit_cost, source, source_ref)
      values (v_warehouse, v_target.item_id, -v_delta, v_cost / v_delta, 'racik-koreksi', p_recipe_id::text);
    else
      v_remaining := -v_delta; v_cost := 0;
      for v_issue in
        select i.id, i.qty, i.unit_cost, i.physical_unit_cost, i.exp_date
        from public.compound_issues i join public.stock_layers l on l.id = i.stock_layer_id
        where i.recipe_id = p_recipe_id and i.item_id = v_target.item_id and i.restored_at is null
        -- kebalikan urutan FIFO pengeluaran: yang paling akhir diambil dikembalikan lebih dulu (deterministik)
        order by (l.exp_date is null) desc, l.exp_date desc nulls first, l.tanggal desc, l.created_at desc, l.id desc, i.id desc
        for update of i
      loop
        exit when v_remaining <= 0;
        v_take := least(v_issue.qty, v_remaining);
        if v_take <= 0 then continue; end if;
        insert into public.stock_layers (warehouse_id, item_id, tanggal, exp_date, qty_in, qty_left, unit_cost, source, source_ref)
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
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('item_id', v_target.item_id::text, 'name', v_name,
      'delta', v_delta, 'cost', round(v_cost, 2), 'direction', case when v_delta > 0 then 'keluar' else 'kembali' end));

    if v_target.target_qty = 0 and v_ingredient_id is not null then
      delete from public.compound_issues where ingredient_id = v_ingredient_id;
      delete from public.compounding_ingredients where id = v_ingredient_id;
    end if;
  end loop;

  -- HPP baris tagihan dihitung ulang dari compound_issues (rumus yang sama dengan posting invoice).
  select coalesce(round(sum(i.qty * i.unit_cost), 2), 0) into v_cost_after from public.compound_issues i where i.recipe_id = p_recipe_id;
  if v_cost_after <= 0 or exists (select 1 from public.compound_issues i where i.recipe_id = p_recipe_id and i.posted_invoice_item_id is distinct from v_line.id) then
    raise exception using errcode = 'P0001', message = 'COST_MISSING: histori HPP racikan tidak tersedia setelah koreksi';
  end if;
  v_hpp_delta := v_cost_after - v_cost_before;
  update public.invoice_items set hpp = v_cost_after where id = v_line.id;

  -- Jurnal selisih HPP bertanggal HARI INI (HPP naik: Dr 600001 / Cr 170001; HPP turun: kebalikannya).
  if v_hpp_delta > 0 then
    v_jlines := jsonb_build_array(jsonb_build_object('code', '600001', 'debit', v_hpp_delta, 'credit', 0),
                                  jsonb_build_object('code', '170001', 'debit', 0, 'credit', v_hpp_delta));
  elsif v_hpp_delta < 0 then
    v_jlines := jsonb_build_array(jsonb_build_object('code', '170001', 'debit', -v_hpp_delta, 'credit', 0),
                                  jsonb_build_object('code', '600001', 'debit', 0, 'credit', -v_hpp_delta));
  end if;
  if v_hpp_delta <> 0 then
    v_journal_id := public.clinic_write_journal(current_date, 'Koreksi HPP racikan (Owner) ' || v_inv.invoice_no,
      'klinik-hpp-edit', v_inv.invoice_no, v_visit.branch_id, v_jlines);
  end if;
  v_journal := jsonb_build_object('date', current_date, 'source', 'klinik-hpp-edit', 'source_ref', v_inv.invoice_no, 'lines', v_jlines);
  if not p_dry then v_journal := v_journal || jsonb_build_object('entry_id', v_journal_id); end if;

  -- Bendera harga < HPP memakai rumus lantai P03 (harga neto baris setelah porsi diskon invoice); hanya dilaporkan, tidak menolak.
  v_share := case when v_inv.subtotal > 0 then (v_inv.subtotal - v_inv.discount) / v_inv.subtotal else 1 end;
  v_net := round(round(v_line.qty * v_line.harga * (1 - coalesce(v_line.diskon_persen, 0) / 100), 2) * v_share, 2);
  v_below_before := v_net < v_cost_before; v_below_after := v_net < v_cost_after;

  v_result := jsonb_build_object('status', 'OK', 'recipe_id', p_recipe_id, 'visit_id', v_visit_id, 'prescription_item_id', v_rx.id,
    'invoice_id', v_inv.id, 'invoice_no', v_inv.invoice_no, 'invoice_item_id', v_line.id, 'paid_status', v_inv.paid_status,
    'invoice_total', v_inv.total, 'price', v_line.harga, 'net_price', v_net,
    'cost_before', v_cost_before, 'cost_after', v_cost_after, 'hpp_delta', v_hpp_delta,
    'price_below_hpp_before', v_below_before, 'price_below_hpp_after', v_below_after,
    'journal', v_journal, 'before', v_before, 'after', clinic_private.compound_composition(p_recipe_id), 'stock', v_effects, 'audit_id', v_audit_id);
  if p_dry then
    -- Pratinjau: seluruh efek di atas (termasuk jurnal) dibatalkan oleh pemanggil (sub-transaksi), hasilnya dibawa lewat DETAIL.
    raise exception using errcode = 'P0Z99', message = 'QUOTE', detail = v_result::text;
  end if;
  insert into clinic_private.owner_compound_invoice_corrections (id, actor_id, visit_id, recipe_id, prescription_item_id, invoice_id, invoice_item_id, invoice_no, paid_status,
    reason, request_key, request_hash, before_ingredients, after_ingredients, hpp_before, hpp_after, hpp_delta, price, invoice_total,
    price_below_hpp_before, price_below_hpp_after, journal_entry_id, stock_effects, result)
  values (v_audit_id, v_user, v_visit_id, p_recipe_id, v_rx.id, v_inv.id, v_line.id, v_inv.invoice_no, v_inv.paid_status,
    v_reason, v_key, v_hash, v_before, clinic_private.compound_composition(p_recipe_id), v_cost_before, v_cost_after, v_hpp_delta, v_line.harga, v_inv.total,
    v_below_before, v_below_after, v_journal_id, v_effects, v_result);
  return v_result;
end;
$function$;
revoke all on function clinic_private.owner_correct_compound_invoiced(uuid, jsonb, text, text, boolean) from public, anon, authenticated, service_role;

create function public.clinic_owner_correct_compound_invoiced(p_recipe_id uuid, p_ingredients jsonb, p_reason text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
begin
  return clinic_private.owner_correct_compound_invoiced(p_recipe_id, p_ingredients, p_reason, p_request_key, false);
end;
$function$;
revoke all on function public.clinic_owner_correct_compound_invoiced(uuid, jsonb, text, text) from public, anon, service_role;
grant execute on function public.clinic_owner_correct_compound_invoiced(uuid, jsonb, text, text) to authenticated;

create function public.clinic_owner_compound_invoiced_correction_quote(p_recipe_id uuid, p_ingredients jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare v_detail text;
begin
  begin
    perform clinic_private.owner_correct_compound_invoiced(p_recipe_id, p_ingredients, null, null, true);
  exception when sqlstate 'P0Z99' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb;
  end;
  raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: pratinjau tidak menghasilkan hasil';
end;
$function$;
revoke all on function public.clinic_owner_compound_invoiced_correction_quote(uuid, jsonb) from public, anon, service_role;
grant execute on function public.clinic_owner_compound_invoiced_correction_quote(uuid, jsonb) to authenticated;

do $check$
declare d text;
begin
  d := pg_get_functiondef('clinic_private.owner_correct_compound_invoiced(uuid,jsonb,text,text,boolean)'::regprocedure);
  if position('billing_lock' in d) = 0 or position('role = ''OWNER''' in d) = 0 or position('owner_compound_invoice_corrections' in d) = 0
     or position('clinic_write_journal' in d) = 0 or position('inventory_assert_open_date' in d) = 0
     or position('update public.prescription_items' in d) > 0 or position('clinic_compound_sales' in d) > 0
     or position('update public.invoices' in d) > 0 or position('invoice_payments' in d) > 0 then
    raise exception 'Koreksi racikan bertagihan Owner: definisi tidak sesuai setelah dipasang';
  end if;
end $check$;
