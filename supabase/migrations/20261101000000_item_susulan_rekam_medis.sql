-- Item susulan masuk rekam medis (Andri 29 Okt, opsi B: "Semua harus masuk ke rekam medis juga").
--
-- Dua lubang yang ditutup:
--  1. Rawat jalan yang rekam medisnya sudah tersimpan tapi belum ditagih tidak punya
--     jalur menambah obat/jasa/tindakan ke rekam medis. Koreksi rekam medis
--     (clinic_correct_unpaid_record) hanya menerima catatan klinis.
--  2. Baris yang ditambah kasir di layar Pembayaran masuk invoice_items tapi tidak
--     pernah menjadi prescription_items, jadi hilang dari rekam medis & resep cetak.
--
-- Semuanya aditif: kolom nullable, tabel idempotensi baru, dan RPC baru. Definisi
-- clinic_post_invoice / clinic_post_split_invoice / clinic_post_demo_invoice /
-- clinic_edit_invoice TIDAK ditulis ulang — pembungkus memanggilnya apa adanya supaya
-- cabang lain yang sedang menambal posting tetap bisa digabung.
--
-- Stok, HPP, dan jurnal tidak berubah: prescription_items hanyalah catatan. Stok tetap
-- keluar saat posting invoice (racikan saat diracik). Baris resep yang dibuat pembungkus
-- ditautkan ke baris invoice yang SAMA, jadi aturan "satu baris resep = satu tagihan
-- aktif" tetap berlaku dan tidak ada mutasi stok tambahan.

-- ---------------------------------------------------------------------------
-- 1. Penanda "susulan" pada baris resep.
-- ---------------------------------------------------------------------------
-- Kolom biasa tanpa FK kedua. prescription_items sudah punya FK ke employees
-- (salesperson_id); menambah FK kedua ke employees/profiles membuat embed PostgREST
-- jadi ambigu (PGRST201) dan halaman yang memakainya diam-diam kosong. Nama pelaku
-- disimpan sebagai snapshot teks, persis pola salesperson_name.
alter table public.prescription_items
  add column susulan_at timestamptz,
  add column susulan_by uuid,
  add column susulan_by_name text,
  add column susulan_source text;
alter table public.prescription_items
  add constraint prescription_items_susulan_complete check (
    (susulan_at is null and susulan_source is null and susulan_by is null and susulan_by_name is null)
    or (susulan_at is not null and susulan_source in ('dokter','kasir'))
  );
create index prescription_items_susulan_idx on public.prescription_items(medical_record_id)
  where susulan_at is not null;

-- Penanda tidak boleh dikarang dari tulisan langsung lewat PostgREST, dan tidak boleh
-- diubah setelah tersimpan. Nilainya diambil dari setelan transaksi yang hanya dipasang
-- RPC susulan (pola yang sama dengan kamo.clinic_compound_seller).
-- SECURITY INVOKER dengan sengaja (pola guard_posted_clinic_invoice): di dalam RPC
-- susulan yang SECURITY DEFINER, current_user adalah pemilik fungsi; pada tulisan
-- langsung lewat PostgREST current_user tetap 'authenticated' dan penandanya dibuang.
create function public.guard_prescription_susulan() returns trigger
language plpgsql security invoker set search_path = '' as $function$
declare v_mark jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.susulan_at is distinct from old.susulan_at
       or new.susulan_by is distinct from old.susulan_by
       or new.susulan_by_name is distinct from old.susulan_by_name
       or new.susulan_source is distinct from old.susulan_source then
      raise exception using errcode = 'P0001', message = 'SUSULAN_LOCKED: penanda item susulan tidak dapat diubah';
    end if;
    return new;
  end if;
  if current_user in ('authenticated','anon','service_role') then
    new.susulan_at := null; new.susulan_by := null; new.susulan_by_name := null; new.susulan_source := null;
    return new;
  end if;
  begin
    v_mark := nullif(current_setting('kamo.clinic_record_susulan', true), '')::jsonb;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'SUSULAN_INVALID: penanda item susulan tidak valid';
  end;
  if v_mark is null or coalesce(v_mark->>'source','') not in ('dokter','kasir') then
    new.susulan_at := null; new.susulan_by := null; new.susulan_by_name := null; new.susulan_source := null;
    return new;
  end if;
  new.susulan_at := now();
  new.susulan_by := nullif(v_mark->>'by','')::uuid;
  new.susulan_by_name := nullif(btrim(coalesce(v_mark->>'by_name','')), '');
  new.susulan_source := v_mark->>'source';
  return new;
end;
$function$;
revoke all on function public.guard_prescription_susulan() from public, anon, authenticated, service_role;
create trigger clinic_prescription_susulan before insert or update on public.prescription_items
  for each row execute function public.guard_prescription_susulan();

-- Probe kapabilitas untuk aplikasi, pola yang sama dengan clinic_bmhp_supported().
create function public.clinic_record_susulan_supported() returns boolean
language sql immutable set search_path = pg_catalog, public as $$ select true $$;
revoke all on function public.clinic_record_susulan_supported() from public, anon, service_role;
grant execute on function public.clinic_record_susulan_supported() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Buku kunci permintaan: satu kiriman = satu kali tambah baris.
-- ---------------------------------------------------------------------------
-- Tanpa ini, kiriman ulang (respons hilang di jalan) akan membuat baris resep baru,
-- dan p_lines yang berubah membuat hash idempotensi clinic_post_invoice tidak cocok —
-- kasir akan terkunci dengan "kunci invoice telah dipakai untuk data berbeda".
create table public.clinic_record_item_additions (
  request_key text primary key check (length(btrim(request_key)) between 1 and 100),
  visit_id uuid not null references public.visits(id) on delete cascade,
  medical_record_id uuid not null references public.medical_records(id) on delete cascade,
  source text not null check (source in ('dokter','kasir')),
  request_hash text not null,
  prescription_item_ids uuid[] not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index clinic_record_item_additions_record_idx on public.clinic_record_item_additions(medical_record_id);
alter table public.clinic_record_item_additions enable row level security;
-- Tidak ada policy: isinya hanya ditulis & dibaca oleh RPC di bawah (SECURITY DEFINER).
revoke all on public.clinic_record_item_additions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Nama pelaku untuk snapshot penanda susulan.
-- ---------------------------------------------------------------------------
create function clinic_private.susulan_actor_name(p_user uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select e.nama from public.employees e
      where e.profile_id = p_user and e.status = 'Aktif' order by e.created_at, e.id limit 1),
    (select p.full_name from public.profiles p where p.id = p_user));
$$;
revoke all on function clinic_private.susulan_actor_name(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Dokter menambah obat/jasa/tindakan/racikan setelah pemeriksaan tersimpan.
-- ---------------------------------------------------------------------------
-- Bentuk p_items sama persis dengan p_rows milik clinic_save_inpatient_log, dan
-- p_compounds sama dengan p_compounds-nya — satu bentuk muatan untuk semua form klinik.
-- Syarat masuknya memakai clinic_can_correct_record: pemeriksaan sudah tersimpan,
-- kunjungan masih tahap Pembayaran, belum checkout, dan belum pernah punya invoice.
create function public.clinic_add_record_items(
  p_visit_id uuid, p_request_key text, p_items jsonb, p_compounds jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_visit public.visits%rowtype;
  v_existing public.clinic_record_item_additions%rowtype;
  v_record_id uuid;
  v_key text := nullif(btrim(p_request_key), '');
  v_hash text;
  v_row jsonb;
  v_id uuid;
  v_ids uuid[] := array[]::uuid[];
begin
  if coalesce(auth.role(), '') <> 'authenticated' or v_user is null
     or not exists (select 1 from public.profiles where id = v_user and is_active = true) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_compounds) is distinct from 'array'
     or jsonb_array_length(p_items) > 200 or jsonb_array_length(p_compounds) > 50
     or jsonb_array_length(p_items) + jsonb_array_length(p_compounds) = 0 then
    raise exception using errcode = 'P0001', message = 'RECORD_INVALID: item susulan tidak lengkap';
  end if;
  v_hash := md5(jsonb_build_object('visit', p_visit_id, 'items', p_items, 'compounds', p_compounds)::text);

  -- Urutan kunci sama dengan posting tagihan dan simpan pemeriksaan: kunjungan dulu.
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: kunjungan tidak dapat diakses';
  end if;

  select * into v_existing from public.clinic_record_item_additions where request_key = v_key for update;
  if found then
    if v_existing.visit_id is distinct from p_visit_id
       or v_existing.created_by is distinct from v_user
       or v_existing.request_hash is distinct from v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci item susulan dipakai untuk data berbeda';
    end if;
    return v_existing.medical_record_id;
  end if;

  select m.id into v_record_id from public.medical_records m
  where m.visit_id = p_visit_id order by m.created_at desc, m.id desc limit 1;
  if v_record_id is null then
    raise exception using errcode = 'P0001', message = 'RECORD_INVALID: rekam medis belum tersedia untuk kunjungan ini';
  end if;
  if not public.clinic_can_correct_record(v_record_id) then
    raise exception using errcode = 'P0001', message = 'RECORD_LOCKED: tagihan sudah terbit atau kunjungan sudah ditutup; tambah item lewat koreksi tagihan';
  end if;

  perform set_config('kamo.clinic_record_susulan', jsonb_build_object(
    'by', v_user, 'by_name', clinic_private.susulan_actor_name(v_user), 'source', 'dokter')::text, true);

  for v_row in select value from jsonb_array_elements(p_items) as r(value) loop
    insert into public.prescription_items(
      medical_record_id, nama_obat, item_id, qty, satuan, faktor,
      harga, aturan_pakai, jenis, kategori, service_performers, bmhp_components
    ) values (
      v_record_id, v_row->>'nama_obat', nullif(v_row->>'item_id', '')::uuid,
      (v_row->>'qty')::integer, v_row->>'satuan',
      (v_row->>'faktor')::numeric, (v_row->>'harga')::numeric,
      v_row->>'aturan_pakai', v_row->>'jenis', v_row->>'kategori',
      v_row->'service_performers', v_row->'bmhp_components'
    ) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Racikan tetap lewat fungsi peracikan yang sudah ada: bahan keluar saat diracik,
  -- bukan saat ditagih. Pelaksana & penjual dititipkan lewat setelan transaksi,
  -- persis seperti clinic_save_initial_record / clinic_save_inpatient_log.
  for v_row in select value from jsonb_array_elements(p_compounds) as c(value) loop
    perform set_config('kamo.clinic_compound_seller', coalesce(v_row->>'salesperson_id', ''), true);
    perform set_config('kamo.clinic_compound_performers', coalesce(v_row->>'service_performers', ''), true);
    if nullif(v_row->>'sale_item_id', '') is not null then
      perform public.clinic_issue_master_compound(
        v_record_id, p_visit_id, (v_row->>'sale_item_id')::uuid,
        v_row->'recipe', v_row->>'request_key',
        nullif(v_row->>'official_version_id','')::uuid, v_row->>'dosage_instruction');
    elsif nullif(v_row->>'official_version_id', '') is not null then
      perform public.clinic_issue_official_compound(
        v_record_id, p_visit_id, (v_row->>'official_version_id')::uuid,
        v_row->>'request_key', v_row->>'dosage_instruction');
    else
      perform public.clinic_issue_compound(
        v_record_id, p_visit_id, v_row->'recipe', v_row->>'request_key');
    end if;
    perform set_config('kamo.clinic_compound_seller', '', true);
    perform set_config('kamo.clinic_compound_performers', '', true);
  end loop;
  perform set_config('kamo.clinic_record_susulan', '', true);

  insert into public.clinic_record_item_additions(
    request_key, visit_id, medical_record_id, source, request_hash, prescription_item_ids, created_by)
  values (v_key, p_visit_id, v_record_id, 'dokter', v_hash, v_ids, v_user);
  return v_record_id;
end;
$function$;
revoke all on function public.clinic_add_record_items(uuid,text,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.clinic_add_record_items(uuid,text,jsonb,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Baris tambahan kasir dicatat sebagai resep lalu ditautkan ke baris invoice.
-- ---------------------------------------------------------------------------
-- Dipanggil di dalam transaksi pembungkus, SEBELUM RPC posting/koreksi dijalankan.
-- Baris yang sudah punya prescription_item_id / recipe_id / source_invoice_item_id
-- dikembalikan apa adanya: itu baris resep dokter, racikan, atau warisan koreksi.
--
-- Satuan baris ikut dinormalkan supaya cocok dengan pemeriksaan clinic_post_invoice
-- ("satuan baris resep berubah"): baris obat ketikan bebas yang dulu tersimpan tanpa
-- satuan kini tersimpan sebagai satuan dasarnya. Tidak ada perubahan harga/stok.
--
-- kategori sengaja TIDAK diisi untuk baris kasir. Kategori tindakan adalah dasar
-- gerbang form persetujuan (§6.3); mengisinya di tengah transaksi bisa mengunci kasir
-- saat melanjutkan pembayaran tagihan yang sudah terbit. Aturan lama tetap: baris tanpa
-- kategori dianggap tidak berisiko (sama seperti baris lama sebelum fitur kategori).
create function clinic_private.link_unrecorded_lines(
  p_visit_id uuid, p_request_key text, p_lines jsonb, p_source text
) returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_existing public.clinic_record_item_additions%rowtype;
  v_record_id uuid;
  v_key text := nullif(btrim(p_request_key), '');
  v_hash text;
  v_replay boolean := false;
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_kind text;
  v_item uuid;
  v_unit text;
  v_base_unit text;
  v_factor numeric(15,4);
  v_index integer := 0;
  v_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_pending jsonb;
begin
  select m.id into v_record_id from public.medical_records m
  where m.visit_id = p_visit_id order by m.created_at desc, m.id desc limit 1;
  -- Kunjungan tanpa rekam medis tetap ditagih seperti sebelumnya: tidak ada tempat
  -- untuk mencatat barisnya, dan pembayaran tidak boleh gagal karenanya.
  if v_record_id is null then return p_lines; end if;

  v_pending := (
    select coalesce(jsonb_agg(jsonb_build_object(
      'i', x.ordinality, 'd', x.value->>'description', 'k', x.value->>'kind',
      'it', x.value->>'item_id', 'q', x.value->>'qty', 'u', x.value->>'unit') order by x.ordinality), '[]'::jsonb)
    from jsonb_array_elements(p_lines) with ordinality x(value, ordinality)
    where nullif(x.value->>'prescription_item_id', '') is null
      and nullif(x.value->>'recipe_id', '') is null
      and nullif(x.value->>'source_invoice_item_id', '') is null);
  if jsonb_array_length(v_pending) = 0 then return p_lines; end if;
  v_hash := md5(jsonb_build_object('visit', p_visit_id, 'record', v_record_id, 'lines', v_pending)::text);

  select * into v_existing from public.clinic_record_item_additions where request_key = v_key for update;
  if found then
    v_replay := true;
    if v_existing.visit_id is distinct from p_visit_id
       or v_existing.medical_record_id is distinct from v_record_id
       or v_existing.request_hash is distinct from v_hash
       or coalesce(cardinality(v_existing.prescription_item_ids), 0) <> jsonb_array_length(v_pending) then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci tagihan dipakai untuk rincian berbeda';
    end if;
  else
    perform set_config('kamo.clinic_record_susulan', jsonb_build_object(
      'by', v_user, 'by_name', clinic_private.susulan_actor_name(v_user), 'source', p_source)::text, true);
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if nullif(v_line->>'prescription_item_id', '') is not null
       or nullif(v_line->>'recipe_id', '') is not null
       or nullif(v_line->>'source_invoice_item_id', '') is not null then
      v_out := v_out || jsonb_build_array(v_line);
      continue;
    end if;
    v_index := v_index + 1;
    v_kind := coalesce(nullif(v_line->>'kind', ''), 'obat');
    v_item := nullif(v_line->>'item_id', '')::uuid;
    if v_replay then
      v_id := v_existing.prescription_item_ids[v_index];
      select pi.satuan into v_unit from public.prescription_items pi where pi.id = v_id;
      if v_unit is null then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: baris resep susulan tidak dapat dibaca ulang';
      end if;
      v_out := v_out || jsonb_build_array(v_line || jsonb_build_object('prescription_item_id', v_id, 'unit', v_unit));
      continue;
    end if;
    v_unit := nullif(btrim(v_line->>'unit'), '');
    v_base_unit := null;
    v_factor := 1;
    if v_item is not null then
      select i.unit into v_base_unit from public.items i where i.id = v_item for share;
    end if;
    if v_kind = 'jasa' then
      -- clinic_post_invoice menulis coalesce(unit,'jasa') untuk baris jasa.
      v_unit := coalesce(v_unit, 'jasa');
    else
      v_unit := coalesce(v_unit, v_base_unit, 'pcs');
      if v_item is not null and v_unit is distinct from v_base_unit then
        select iu.factor into v_factor from public.item_units iu
        where iu.item_id = v_item and iu.unit = v_unit;
        if v_factor is null or v_factor <= 0 then
          raise exception using errcode = 'P0001', message = 'UNIT_INVALID: satuan barang tidak ditemukan';
        end if;
      end if;
    end if;
    insert into public.prescription_items(
      medical_record_id, nama_obat, item_id, qty, satuan, faktor, harga, aturan_pakai, jenis, service_performers
    ) values (
      v_record_id, left(btrim(coalesce(v_line->>'description', '')), 120), v_item,
      (v_line->>'qty')::integer, v_unit, v_factor,
      coalesce(nullif(v_line->>'price', '')::numeric, 0), null,
      case when v_kind = 'jasa' then 'jasa' else 'obat' end,
      v_line->'service_performers'
    ) returning id into v_id;
    v_ids := v_ids || v_id;
    v_out := v_out || jsonb_build_array(v_line || jsonb_build_object('prescription_item_id', v_id, 'unit', v_unit));
  end loop;

  if not v_replay then
    perform set_config('kamo.clinic_record_susulan', '', true);
    insert into public.clinic_record_item_additions(
      request_key, visit_id, medical_record_id, source, request_hash, prescription_item_ids, created_by)
    values (v_key, p_visit_id, v_record_id, p_source, v_hash, v_ids, v_user);
  end if;
  return v_out;
end;
$function$;
revoke all on function clinic_private.link_unrecorded_lines(uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Pembungkus posting tagihan — satu transaksi, badan RPC lama tidak diubah.
-- ---------------------------------------------------------------------------
create function public.clinic_post_invoice_with_record(
  p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb,
  p_payments jsonb default null, p_policy_id uuid default null, p_employee_ids uuid[] default null
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_key text := nullif(btrim(p_request_key), ''); v_lines jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_invoice) is distinct from 'object'
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: data invoice tidak lengkap';
  end if;
  -- PR343 acquires the billing coordinator BEFORE request/visit locks. This new
  -- wrapper must follow the same order or race with an original public posting
  -- can deadlock (full-schema deterministic regression L1).
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-request:' || v_key, 0));
  perform 1 from public.visits where id = p_visit_id for update;
  v_lines := clinic_private.link_unrecorded_lines(p_visit_id, v_key, p_lines, 'kasir');
  if p_policy_id is not null then
    return public.clinic_post_demo_invoice(p_visit_id, v_key, p_invoice, v_lines, p_policy_id, p_payments, p_employee_ids);
  elsif p_payments is not null then
    return public.clinic_post_split_invoice(p_visit_id, v_key, p_invoice, v_lines, p_payments);
  end if;
  return public.clinic_post_invoice(p_visit_id, v_key, p_invoice, v_lines);
end;
$function$;
revoke all on function public.clinic_post_invoice_with_record(uuid,text,jsonb,jsonb,jsonb,uuid,uuid[])
  from public, anon, service_role;
grant execute on function public.clinic_post_invoice_with_record(uuid,text,jsonb,jsonb,jsonb,uuid,uuid[])
  to authenticated;

-- Koreksi tagihan: baris yang BARU ditambahkan kasir saat koreksi ikut tercatat.
-- Baris warisan (source_invoice_item_id) sengaja dibiarkan apa adanya supaya atribusi
-- pelaksana dan identitas baris tagihan lama tidak berubah artinya.
create function public.clinic_edit_invoice_with_record(
  p_invoice_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_key text := nullif(btrim(p_request_key), ''); v_visit uuid; v_lines jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_invoice) is distinct from 'object'
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: koreksi dan alasan wajib diisi';
  end if;
  -- Match PR343 before reading correction eligibility or taking visit/request locks.
  perform clinic_private.billing_lock(clinic_private.billing_keys_invoice(p_invoice_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-operation:' || v_key, 0));
  select i.visit_id into v_visit from public.invoices i where i.id = p_invoice_id;
  if v_visit is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: tagihan tidak ditemukan';
  end if;
  if not public.user_can_access_branch((select v.branch_id from public.visits v where v.id = v_visit)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tidak diizinkan';
  end if;
  perform 1 from public.visits where id = v_visit for update;
  v_lines := clinic_private.link_unrecorded_lines(v_visit, v_key, p_lines, 'kasir');
  return public.clinic_edit_invoice(p_invoice_id, v_key, p_invoice, v_lines);
end;
$function$;
revoke all on function public.clinic_edit_invoice_with_record(uuid,text,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.clinic_edit_invoice_with_record(uuid,text,jsonb,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Pemeriksaan akhir: RPC lama tetap seperti aslinya, pembungkus memanggilnya.
-- ---------------------------------------------------------------------------
do $check$
declare p record;
begin
  for p in select * from (values
    ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'),
    ('public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb)'),
    ('public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[])'),
    ('public.clinic_edit_invoice(uuid,text,jsonb,jsonb)'),
    ('public.clinic_can_correct_record(uuid)'),
    ('public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text)'),
    ('public.clinic_issue_official_compound(uuid,uuid,uuid,text,text)'),
    ('public.clinic_issue_compound(uuid,uuid,jsonb,text)')
  ) as needed(sig) loop
    if to_regprocedure(p.sig) is null then
      raise exception 'Item susulan: RPC wajib tidak ada: %', p.sig;
    end if;
  end loop;
  if position('link_unrecorded_lines' in pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)) > 0 then
    raise exception 'Item susulan: clinic_post_invoice tidak boleh ditulis ulang oleh migrasi ini';
  end if;
  for p in select * from (values
    ('public.clinic_post_invoice_with_record(uuid,text,jsonb,jsonb,jsonb,uuid,uuid[])', 'clinic_post_invoice('),
    ('public.clinic_edit_invoice_with_record(uuid,text,jsonb,jsonb)', 'clinic_edit_invoice(')
  ) as wrappers(sig, call) loop
    if position(p.call in pg_get_functiondef(p.sig::regprocedure)) = 0 then
      raise exception 'Item susulan: pembungkus % tidak memanggil %', p.sig, p.call;
    end if;
  end loop;
end
$check$;
