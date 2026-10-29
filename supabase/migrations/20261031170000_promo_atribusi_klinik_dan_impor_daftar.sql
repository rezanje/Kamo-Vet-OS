-- Promo: atribusi per program di tagihan klinik + impor daftar promo dari Excel.
--
-- 1. Tagihan klinik menyimpan SIAPA yang memberi potongan, bukan satu angka
--    `discount` gabungan:
--      * invoice_items.promo_id / promo_discount  — persis seperti sale_items
--        di kasir petshop sejak #312;
--      * invoices.voucher_discount / diskon_kategori — potongan voucher dan
--        diskon golongan pelanggan, terpisah dari diskon manual kasir dan poin;
--      * invoices.campaign_code sudah ada sejak C05 dan tidak diubah di sini.
--    Kolomnya NULLABLE dengan sengaja: tagihan lama tidak punya rinciannya, dan
--    NULL berarti "tidak tercatat per program" — bukan "nol rupiah". Tidak ada
--    tebakan yang diisikan mundur ke data lama.
--
-- 2. Koreksi tagihan (S-4) MEMPERTAHANKAN atribusi itu: baris koreksi membawa
--    promo baris asalnya, dibatasi nilai baris yang baru, dan seluruh atribusi
--    dikecilkan proporsional bila diskon barunya lebih kecil. Terbit ulang
--    (void + reissue) menyalin atribusi apa adanya.
--
-- 3. import_promo_master(): satu berkas Excel "Daftar Promo" berisi beberapa
--    promo diskon produk, masing-masing dengan banyak SKU. Nama promo yang sudah
--    ada DIPERBARUI (bukan digandakan) beserta daftar barangnya. Hanya OWNER/
--    ADMIN aktif (assert_promo_manager) yang boleh memanggilnya.
--
-- Semua perubahan pada RPC yang sudah berjalan memakai jangkar eksak di atas
-- definisi berjalan (pg_get_functiondef + replace), gagal tertutup bila
-- definisinya sudah berubah, dan seluruh tambalan satu fungsi dikompilasi SEKALI.
--
-- BELUM DITERAPKAN ke Production. Terapkan bersama rilis berikutnya.

-- ---------------------------------------------------------------------------
-- 1. Kolom atribusi
-- ---------------------------------------------------------------------------
alter table public.invoice_items
  add column if not exists promo_id uuid references public.promos(id) on delete set null,
  add column if not exists promo_discount numeric(15,2);
alter table public.invoice_items drop constraint if exists invoice_items_promo_discount_wajar;
alter table public.invoice_items add constraint invoice_items_promo_discount_wajar
  check (promo_discount is null or (promo_discount >= 0 and (promo_discount = 0 or promo_id is not null)));
create index if not exists invoice_items_promo_id_idx on public.invoice_items (promo_id) where promo_id is not null;
comment on column public.invoice_items.promo_id is
  'Promo yang memotong baris ini. NULL pada baris tanpa promo dan pada tagihan sebelum rilis atribusi klinik.';
comment on column public.invoice_items.promo_discount is
  'Rupiah potongan promo untuk seluruh baris ini. NULL = tagihan lama, rinciannya tidak tercatat per program.';

alter table public.invoices
  add column if not exists voucher_discount numeric(15,2),
  add column if not exists diskon_kategori numeric(15,2);
alter table public.invoices drop constraint if exists invoices_potongan_program_wajar;
alter table public.invoices add constraint invoices_potongan_program_wajar
  check ((voucher_discount is null or voucher_discount >= 0)
     and (diskon_kategori is null or diskon_kategori >= 0));
comment on column public.invoices.voucher_discount is
  'Bagian diskon yang berasal dari voucher (termasuk voucher yang dipanggil kode kampanye). NULL = tidak tercatat.';
comment on column public.invoices.diskon_kategori is
  'Bagian diskon yang berasal dari golongan pelanggan. NULL = tidak tercatat.';

-- ---------------------------------------------------------------------------
-- 2. Posting, koreksi, dan terbit ulang tagihan klinik
-- ---------------------------------------------------------------------------
do $patch$
-- Semua tambalan satu fungsi diterapkan pada teksnya dulu, baru dikompilasi SEKALI.
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text;
begin
 for p in select * from (values
  -- variabel atribusi program
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'  v_job_order_cost numeric(15,2);\nbegin',
   E'  v_job_order_cost numeric(15,2);\n  v_promo_id uuid;\n  v_promo_discount numeric(15,2);\n  v_attributed numeric(15,2);\nbegin'),
  -- kolom potongan tingkat invoice
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code',
   E'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version, campaign_code,\n    voucher_discount, diskon_kategori'),
  -- nilai potongan tingkat invoice
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint, nullif(p_invoice->>''campaign_code'','''')',
   E'v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint, nullif(p_invoice->>''campaign_code'',''''),\n    nullif(p_invoice->>''voucher_discount'','''')::numeric(15,2), nullif(p_invoice->>''diskon_kategori'','''')::numeric(15,2)'),
  -- baca atribusi promo per baris
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'    v_unit := nullif(btrim(v_line.value ->> ''unit''), '''');\n',
   E'    v_unit := nullif(btrim(v_line.value ->> ''unit''), '''');\n    v_promo_id := nullif(v_line.value ->> ''promo_id'', '''')::uuid;\n    v_promo_discount := coalesce(nullif(v_line.value ->> ''promo_discount'', '''')::numeric, 0)::numeric(15,2);\n'),
  -- potongan promo baris tidak boleh melebihi barisnya
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'    v_line_amount := round(v_qty * v_price * (1 - v_discount_percent / 100), 2)::numeric(15,2);\n    insert into public.invoice_items (',
   E'    v_line_amount := round(v_qty * v_price * (1 - v_discount_percent / 100), 2)::numeric(15,2);\n    if v_promo_discount < 0 or v_promo_discount > v_line_amount\n       or (v_promo_discount > 0 and v_promo_id is null)\n       or (v_promo_id is not null and not exists (select 1 from public.promos p where p.id = v_promo_id)) then\n      raise exception using errcode = ''P0001'', message = ''LINE_INVALID: potongan promo baris tidak valid'';\n    end if;\n    insert into public.invoice_items ('),
  -- kolom atribusi promo baris
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'      compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components, salesperson_id, package_item_id, package_qty\n    ) values (',
   E'      compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components, salesperson_id, package_item_id, package_qty,\n      promo_id, promo_discount\n    ) values ('),
  -- nilai atribusi promo baris
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'      nullif(v_line.value->>''package_item_id'','''')::uuid, nullif(v_line.value->>''package_qty'','''')::numeric\n    ) returning id into v_account_id;',
   E'      nullif(v_line.value->>''package_item_id'','''')::uuid, nullif(v_line.value->>''package_qty'','''')::numeric,\n      case when v_promo_discount > 0 then v_promo_id else null end, v_promo_discount\n    ) returning id into v_account_id;'),
  -- jumlah atribusi dijaga terhadap diskon invoice
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'  select round(coalesce(sum(ii.hpp), 0), 2)::numeric(15,2)\n    into v_total_hpp from public.invoice_items ii where ii.invoice_id = v_invoice_id;',
   E'  -- Atribusi per program tidak boleh melebihi diskon yang benar-benar diberikan.\n  select round(coalesce(sum(ii.promo_discount), 0), 2)::numeric(15,2)\n    into v_attributed from public.invoice_items ii where ii.invoice_id = v_invoice_id;\n  v_attributed := v_attributed\n    + coalesce(nullif(p_invoice->>''voucher_discount'','''')::numeric, 0)\n    + coalesce(nullif(p_invoice->>''diskon_kategori'','''')::numeric, 0);\n  if v_attributed < 0 or v_attributed > v_discount then\n    raise exception using errcode = ''P0001'', message = ''INVOICE_INVALID: rincian potongan melebihi diskon invoice'';\n  end if;\n  select round(coalesce(sum(ii.hpp), 0), 2)::numeric(15,2)\n    into v_total_hpp from public.invoice_items ii where ii.invoice_id = v_invoice_id;'),
  -- variabel atribusi koreksi
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'  v_credit numeric;\nbegin',
   E'  v_credit numeric;\n  v_promo_old jsonb;\n  v_attributed numeric(15,2);\n  v_promo_scale numeric := 1;\nbegin'),
  -- bawa atribusi lama dan kecilkan bila melebihi diskon baru
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'  select coalesce(array_agg(id),array[]::uuid[]) into v_service_old_ids from public.invoice_items where invoice_id=p_invoice_id;',
   E'  select coalesce(array_agg(id),array[]::uuid[]) into v_service_old_ids from public.invoice_items where invoice_id=p_invoice_id;\n  -- S-4: koreksi mempertahankan atribusi program dari baris asalnya.\n  select coalesce(jsonb_object_agg(id::text,jsonb_build_object(''promo_id'',promo_id,''promo_discount'',promo_discount)),''{}''::jsonb)\n    into v_promo_old from public.invoice_items where invoice_id=p_invoice_id;\n  select coalesce(sum(case when v_promo_old->nullif(x.value->>''source_invoice_item_id'','''')->>''promo_discount'' is null then 0\n    else least((v_promo_old->nullif(x.value->>''source_invoice_item_id'','''')->>''promo_discount'')::numeric,\n      round((x.value->>''qty'')::numeric*(x.value->>''price'')::numeric*(1-coalesce((x.value->>''discount_percent'')::numeric,0)/100),2)) end),0)\n    into v_attributed from jsonb_array_elements(p_lines) x;\n  v_attributed := v_attributed+coalesce(v_invoice.voucher_discount,0)+coalesce(v_invoice.diskon_kategori,0);\n  if v_attributed>v_discount and v_attributed>0 then v_promo_scale := v_discount/v_attributed; end if;'),
  -- kolom atribusi promo baris koreksi
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'      item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id,bmhp_components,salesperson_id)',
   E'      item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id,bmhp_components,salesperson_id,\n      promo_id,promo_discount)'),
  -- nilai atribusi promo baris koreksi
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'      v_bmhp_map->nullif(v_line->>''prescription_item_id'',''''),nullif(v_line->>''salesperson_id'','''')::uuid);',
   E'      v_bmhp_map->nullif(v_line->>''prescription_item_id'',''''),nullif(v_line->>''salesperson_id'','''')::uuid,\n      nullif(v_promo_old->nullif(v_line->>''source_invoice_item_id'','''')->>''promo_id'','''')::uuid,\n      case when v_promo_old->nullif(v_line->>''source_invoice_item_id'','''')->>''promo_discount'' is null then null\n        else round(least((v_promo_old->nullif(v_line->>''source_invoice_item_id'','''')->>''promo_discount'')::numeric,\n          round((v_line->>''qty'')::numeric*(v_line->>''price'')::numeric*(1-coalesce((v_line->>''discount_percent'')::numeric,0)/100),2))*v_promo_scale,2) end);'),
  -- potongan program ikut dikecilkan bersama barisnya
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'    correction_pending=false,\n    voucher_code=nullif(p_invoice->>''voucher_code'','''') where id=p_invoice_id;',
   E'    correction_pending=false,\n    voucher_discount=case when voucher_discount is null then null else round(voucher_discount*v_promo_scale,2) end,\n    diskon_kategori=case when diskon_kategori is null then null else round(diskon_kategori*v_promo_scale,2) end,\n    voucher_code=nullif(p_invoice->>''voucher_code'','''') where id=p_invoice_id;'),
  -- kolom potongan program pada terbit ulang
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'    reissued_from,request_key,request_hash,correction_pending,shift_cash_carry,service_pricing_version)',
   E'    reissued_from,request_key,request_hash,correction_pending,shift_cash_carry,service_pricing_version,\n    voucher_discount,diskon_kategori)'),
  -- nilai potongan program pada terbit ulang
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'v_invoice.voucher_code,v_invoice.salesperson_id,p_invoice_id,v_key,v_hash,true,v_shift_cash,v_invoice.service_pricing_version)',
   E'v_invoice.voucher_code,v_invoice.salesperson_id,p_invoice_id,v_key,v_hash,true,v_shift_cash,v_invoice.service_pricing_version,\n    v_invoice.voucher_discount,v_invoice.diskon_kategori)'),
  -- kolom atribusi baris pada terbit ulang
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'    item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id,bmhp_components)',
   E'    item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id,bmhp_components,\n    promo_id,promo_discount)'),
  -- nilai atribusi baris pada terbit ulang
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'    prescription_item_id,satuan,faktor,service_performers,id,bmhp_components from public.invoice_items where invoice_id=p_invoice_id;',
   E'    prescription_item_id,satuan,faktor,service_performers,id,bmhp_components,\n    promo_id,promo_discount from public.invoice_items where invoice_id=p_invoice_id;')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Atribusi promo klinik: RPC wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Atribusi promo klinik: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);
  end if;
  pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending->>k;
 end loop;
end $patch$;

-- ---------------------------------------------------------------------------
-- 3. Impor daftar promo dari Excel (satu berkas = beberapa promo diskon produk)
-- ---------------------------------------------------------------------------
-- Bedanya dengan import_promo_excel_batch (C03, satu baris = satu promo per SKU):
-- di sini SATU promo memiliki BANYAK SKU, dan mengunggah ulang nama yang sama
-- MEMPERBARUI promo itu beserta daftar barangnya. Karena bentuknya deklaratif
-- (hasil akhir = isi berkas), mengunggah berkas yang sama dua kali tidak
-- menggandakan apa pun dan tidak memerlukan kunci idempotensi.
create or replace function public.import_promo_master(p_promos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_entry jsonb;
  v_count integer;
  v_items_total integer := 0;
  v_name text;
  v_key text;
  v_suggest text;
  v_branch_ids uuid[];
  v_item_ids uuid[];
  v_existing public.promos%rowtype;
  v_duplicates integer;
  v_rule jsonb;
  v_min_subtotal numeric;
  v_discount_value numeric;
  v_min_qty numeric;
  v_max_qty numeric;
  v_promo_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_seen text[] := '{}';
begin
  perform public.assert_promo_manager();
  if jsonb_typeof(p_promos) is distinct from 'array' then
    raise exception 'Data impor promo tidak valid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_promos);
  if v_count not between 1 and 50 then
    raise exception 'Impor daftar promo harus berisi 1 sampai 50 promo' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_promos) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_entry) k where k not in
           ('name','discount_type','discount_value','auto_apply','branch_ids','valid_from','valid_until',
            'min_qty','max_qty','kelipatan','min_subtotal','suggest','item_ids')) > 0 then
      raise exception 'Kolom promo tidak lengkap atau tidak diizinkan' using errcode = '22023';
    end if;
    v_name := btrim(v_entry ->> 'name');
    if v_name is null or length(v_name) not between 1 and 120 then
      raise exception 'Nama promo wajib 1-120 karakter' using errcode = '22023';
    end if;
    if lower(v_name) = any(v_seen) then
      raise exception 'Nama promo muncul dua kali dalam satu berkas: %', v_name using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, lower(v_name));
    v_suggest := btrim(coalesce(nullif(v_entry ->> 'suggest', ''), v_name));
    if length(v_suggest) > 160 then
      raise exception 'Teks saran promo % terlalu panjang', v_name using errcode = '22023';
    end if;

    if coalesce(v_entry ->> 'discount_type', '') not in ('percent','nominal') then
      raise exception 'Jenis diskon promo % harus Persen atau Nominal', v_name using errcode = '22023';
    end if;
    if jsonb_typeof(v_entry -> 'discount_value') is distinct from 'number'
       or jsonb_typeof(v_entry -> 'auto_apply') is distinct from 'boolean'
       or jsonb_typeof(v_entry -> 'kelipatan') is distinct from 'boolean' then
      raise exception 'Nilai atau pilihan Ya/Tidak promo % tidak valid', v_name using errcode = '22023';
    end if;
    v_discount_value := (v_entry ->> 'discount_value')::numeric;
    if v_discount_value is null or v_discount_value <= 0
       or v_discount_value::text in ('NaN','Infinity','-Infinity')
       or round(v_discount_value, 2) <> v_discount_value
       or (v_entry ->> 'discount_type' = 'percent' and v_discount_value > 100) then
      raise exception 'Nilai diskon promo % tidak valid', v_name using errcode = '22023';
    end if;
    if coalesce(v_entry ->> 'valid_from', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_entry ->> 'valid_until', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or (v_entry ->> 'valid_until')::date < (v_entry ->> 'valid_from')::date then
      raise exception 'Tanggal promo % tidak valid', v_name using errcode = '22023';
    end if;
    foreach v_key in array array['min_qty','max_qty','min_subtotal'] loop
      if jsonb_typeof(v_entry -> v_key) not in ('null','number') then
        raise exception 'Angka promo % tidak valid', v_name using errcode = '22023';
      end if;
    end loop;
    v_min_qty := (v_entry ->> 'min_qty')::numeric;
    v_max_qty := (v_entry ->> 'max_qty')::numeric;
    v_min_subtotal := (v_entry ->> 'min_subtotal')::numeric;
    if v_min_qty <= 0 or v_max_qty <= 0 or v_max_qty < v_min_qty or v_min_subtotal < 0 then
      raise exception 'Syarat jumlah atau belanja promo % tidak valid', v_name using errcode = '22023';
    end if;
    if (v_entry ->> 'auto_apply')::boolean and (v_entry ->> 'kelipatan')::boolean and v_min_qty is null then
      raise exception 'Kelipatan pada promo % memerlukan min. qty terisi', v_name using errcode = '22023';
    end if;

    if jsonb_typeof(v_entry -> 'branch_ids') not in ('array','null') then
      raise exception 'Daftar cabang promo % tidak valid', v_name using errcode = '22023';
    end if;
    select array_agg(distinct x::uuid order by x::uuid) into v_branch_ids
    from jsonb_array_elements_text(coalesce(v_entry -> 'branch_ids', '[]'::jsonb)) x;
    if v_branch_ids is not null then
      perform id from public.branches where id = any(v_branch_ids) order by id for share;
      if (select count(*) from public.branches b where b.id = any(v_branch_ids) and b.is_active
          and public.user_can_access_branch(b.id)) <> cardinality(v_branch_ids) then
        raise exception 'Cabang promo % tidak tersedia atau tidak dapat diakses', v_name using errcode = '42501';
      end if;
    end if;

    if jsonb_typeof(v_entry -> 'item_ids') is distinct from 'array'
       or jsonb_array_length(v_entry -> 'item_ids') < 1 then
      raise exception 'Promo % harus menyebut sedikitnya satu barang', v_name using errcode = '22023';
    end if;
    select array_agg(distinct x::uuid order by x::uuid) into v_item_ids
    from jsonb_array_elements_text(v_entry -> 'item_ids') x;
    v_items_total := v_items_total + cardinality(v_item_ids);
    if v_items_total > 500 then
      raise exception 'Maksimal 500 baris barang per berkas' using errcode = '22023';
    end if;
    perform id from public.items where id = any(v_item_ids) order by id for share;
    if (select count(*) from public.items i where i.id = any(v_item_ids) and i.is_active) <> cardinality(v_item_ids) then
      raise exception 'Ada barang promo % yang tidak dikenal atau nonaktif', v_name using errcode = '22023';
    end if;

    -- Serialize dua unggahan yang menyebut nama promo yang sama.
    perform pg_advisory_xact_lock(hashtextextended('vetos:promo-master:' || lower(v_name), 0));
    select count(*) into v_duplicates from public.promos p where lower(btrim(p.name)) = lower(v_name);
    if v_duplicates > 1 then
      raise exception 'Nama % dipakai lebih dari satu promo; rapikan dulu di layar promo', v_name using errcode = '22023';
    end if;
    v_existing := null;
    select * into v_existing from public.promos p where lower(btrim(p.name)) = lower(v_name) for update;

    v_rule := jsonb_build_object('suggest', v_suggest);
    if v_min_subtotal is not null then v_rule := v_rule || jsonb_build_object('min_subtotal', v_min_subtotal); end if;

    if v_existing.id is not null then
      if v_existing.promo_type <> 'diskon_produk' then
        raise exception 'Nama % sudah dipakai promo jenis %; ganti nama promo', v_name, v_existing.promo_type using errcode = '22023';
      end if;
      if coalesce(v_existing.rule ->> 'discount_mode', 'per_unit') <> 'per_unit' then
        raise exception 'Promo % memakai perhitungan total per paket; ubah lewat layar promo', v_name using errcode = '22023';
      end if;
      if exists (select 1 from public.promo_import_targets t where t.promo_id = v_existing.id) then
        raise exception 'Promo % berasal dari impor per-SKU dan targetnya dikunci; pakai nama baru', v_name using errcode = '22023';
      end if;
      update public.promos set
        name = v_name,
        rule = (coalesce(v_existing.rule, '{}'::jsonb) - 'suggest' - 'min_subtotal') || v_rule,
        min_qty = v_min_qty, max_qty = v_max_qty,
        kelipatan = (v_entry ->> 'kelipatan')::boolean,
        auto_apply = (v_entry ->> 'auto_apply')::boolean,
        discount_type = v_entry ->> 'discount_type',
        discount_value = v_discount_value,
        branch_ids = v_branch_ids,
        valid_from = (v_entry ->> 'valid_from')::date,
        valid_until = (v_entry ->> 'valid_until')::date,
        is_active = true
      where id = v_existing.id;
      delete from public.promo_items pi where pi.promo_id = v_existing.id and not (pi.item_id = any(v_item_ids));
      insert into public.promo_items(promo_id, item_id)
      select v_existing.id, candidate.id from unnest(v_item_ids) candidate(id)
      where not exists (select 1 from public.promo_items pi where pi.promo_id = v_existing.id and pi.item_id = candidate.id);
      v_updated := v_updated + 1;
    else
      insert into public.promos(name, promo_type, rule, is_active, branch_ids, valid_from, valid_until,
        auto_apply, discount_type, discount_value, min_qty, max_qty, kelipatan)
      values (v_name, 'diskon_produk', v_rule, true, v_branch_ids,
        (v_entry ->> 'valid_from')::date, (v_entry ->> 'valid_until')::date,
        (v_entry ->> 'auto_apply')::boolean, v_entry ->> 'discount_type', v_discount_value,
        v_min_qty, v_max_qty, (v_entry ->> 'kelipatan')::boolean)
      returning id into v_promo_id;
      insert into public.promo_items(promo_id, item_id)
      select v_promo_id, candidate.id from unnest(v_item_ids) candidate(id);
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated);
end $$;
revoke all on function public.import_promo_master(jsonb) from public, anon, service_role;
grant execute on function public.import_promo_master(jsonb) to authenticated;
comment on function public.import_promo_master(jsonb) is
  'Impor daftar promo diskon produk dari Excel: satu promo banyak SKU, nama yang sudah ada diperbarui. OWNER/ADMIN saja.';

-- ---------------------------------------------------------------------------
-- 4. Pemeriksaan akhir: tolak pemasangan bila hasilnya tidak seperti yang ditinjau
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
  d := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  if position('promo_id, promo_discount' in d) = 0
     or position('voucher_discount, diskon_kategori' in d) = 0
     or position('INVOICE_INVALID: rincian potongan melebihi diskon invoice' in d) = 0 then
    raise exception 'Atribusi promo klinik: posting tagihan belum menyimpan rincian per program';
  end if;
  d := pg_get_functiondef('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure);
  if position('v_promo_old' in d) = 0 or position('v_promo_scale' in d) = 0 then
    raise exception 'Atribusi promo klinik: koreksi tagihan menghapus rincian per program';
  end if;
  d := pg_get_functiondef('public.clinic_void_reissue_invoice_core(uuid,text,text)'::regprocedure);
  if position('promo_id,promo_discount' in d) = 0 or position('v_invoice.voucher_discount' in d) = 0 then
    raise exception 'Atribusi promo klinik: terbit ulang tidak menyalin rincian per program';
  end if;
  if to_regprocedure('public.import_promo_master(jsonb)') is null then
    raise exception 'Impor daftar promo: RPC tidak terpasang';
  end if;
end $check$;
