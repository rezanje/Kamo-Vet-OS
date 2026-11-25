-- SO-KASBON-NETO (Andri 24 Nov 2026, keputusan 2: beban ke karyawan memakai selisih NETO, bukan kurang kotor).
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
--
-- MASALAH. Sejak SO-SURPLUS-HPP (migrasi 20261209100000) perusahaan membukukan SO campuran NETO: selisih lebih mengurangi beban 720010,
--  tetapi dasar beban karyawan (F2, opname_variance_charge_basis) tetap kurang KOTOR: contoh kurang 10 x (jual 150, HPP 100), lebih 1 x (jual 150, HPP 100):
--  karyawan Rp1.500 sementara perusahaan hanya rugi bersih Rp900 (setelah beban Cr 720010 Rp1.000 saldo 720010 menjadi -Rp100).
--
-- ATURAN BARU (per DOKUMEN opname)
--  1. Nilai beban = max( sum(qty kurang x harga jual cabang) - sum(qty lebih x harga jual cabang), 0 ). Kedua sisi memakai harga jual cabang snapshot
--     saat posting (aturan yang sama dengan F2). Contoh di atas: 1.500 - 150 = Rp1.350. Pembulatan 2 desimal per sisi.
--  2. Pembagian ke karyawan TIDAK berubah (1-10 orang, total pembagian = nilai beban, satu beban aktif per opname, alasan, kunci idempoten).
--  3. Jurnal beban: Dr 182001 nilai beban / Cr 720010 min(nilai beban, beban 720010 yang masih tercatat pada jurnal opname = debit - kredit, termasuk jurnal penyesuaian bersumber 'opname' bernomor hasil sama, mis. penyesuaian data lama; jurnal yang divoid tidak ikut)
--     / Cr 810004 sisanya. Jadi 720010 tidak pernah menjadi kredit karena beban karyawan. Dokumen hanya-kurang: identik dengan sebelumnya.
--  4. Bila lebih menutup seluruh kurang (nilai neto 0): ditolak 'LEBIH_MENUTUPI' (bahasa biasa), tidak ada jurnal/kasbon.
--  5. Jejak tetap opname_variance_charges mendapat dua kolom bukti jual_kurang, jual_lebih (nullable; baris yang sudah ada tidak berubah).
--     read_opname_variance_charge mengembalikan keduanya; opname_variance_charge_basis menambah plus_lines, plus_count, jual_kurang, jual_lebih, hpp_lebih, hpp_neto
--     (jual_total kini = nilai NETO; hpp_total tetap = HPP kurang kotor).
--  6. Tidak ada data lama yang diubah (tidak ada beban karyawan di Production saat ini; tabel jejak kosong). Hak akses, izin, kasbon status Dicatat, pembatalan
--     (jurnal pembalik persis), dan Log Aktifitas tidak berubah. cancel_opname_variance_charge TIDAK diubah.
--
-- ROLLBACK: pasang ulang definisi lama 3 fungsi dari ROLLBACK.sql, lalu
--   alter table public.opname_variance_charges drop constraint opname_variance_charges_neto, drop column jual_kurang, drop column jual_lebih;
--   (hanya bila belum ada baris beban baru yang memakai kolom itu; bila sudah ada, biarkan kolom, pasang ulang fungsi saja.)

do $pre$ begin
 if to_regprocedure('public.opname_variance_charge_basis(uuid)') is null
  or to_regprocedure('public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)') is null
  or to_regprocedure('public.read_opname_variance_charge(uuid)') is null
  or to_regclass('public.opname_variance_charges') is null
  or to_regprocedure('public.opname_posting_journal(date,uuid,text,text,text,jsonb)') is null
  or to_regprocedure('public.opname_surplus_cost(uuid,uuid,numeric)') is null
 then raise exception 'SO_KASBON_NETO_SOURCE_CHANGED: prasyarat F2 / SO-SURPLUS-HPP tidak lengkap'; end if;
 -- Kontrak sumber: tiga fungsi ini harus persis definisi F2 yang ditinjau (sidik md5 sama dengan Production 24 Nov).
 if md5(pg_get_functiondef('public.opname_variance_charge_basis(uuid)'::regprocedure)) is distinct from '93bdca05cb88ff62750675a2903c0c4f'
  or md5(pg_get_functiondef('public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)'::regprocedure)) is distinct from 'fb01726667df78fee4ed79490216583a'
  or md5(pg_get_functiondef('public.read_opname_variance_charge(uuid)'::regprocedure)) is distinct from '0b7618228db2d983664c7c6e4bd98b61'
 then raise exception 'SO_KASBON_NETO_SOURCE_CHANGED: definisi fungsi beban karyawan berbeda dari yang ditinjau'; end if;
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name='opname_variance_charges' and column_name in ('jual_kurang','jual_lebih'))
 then raise exception 'SO_KASBON_NETO_SOURCE_CHANGED: kolom jual_kurang/jual_lebih sudah ada'; end if;
end $pre$;

-- 1. Kolom bukti neto pada jejak tetap (nullable; tabel dilindungi trigger jejak yang hanya mengizinkan kolom pembatalan berubah).
alter table public.opname_variance_charges add column jual_kurang numeric(15,2), add column jual_lebih numeric(15,2);
alter table public.opname_variance_charges add constraint opname_variance_charges_neto check (
  (jual_kurang is null and jual_lebih is null)
  or (jual_kurang is not null and jual_lebih is not null and jual_kurang > 0 and jual_lebih >= 0 and total = greatest(jual_kurang - jual_lebih, 0)));
comment on column public.opname_variance_charges.jual_kurang is 'Nilai jual selisih kurang dokumen opname saat dicatat (neto = jual_kurang - jual_lebih).';
comment on column public.opname_variance_charges.jual_lebih is 'Nilai jual selisih lebih dokumen opname saat dicatat; mengurangi beban (neto).';

-- 2. Dasar hitungan neto (internal; ACL tetap: tidak ada EXECUTE untuk peran klien).
create or replace function public.opname_variance_charge_basis(p_result_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_res public.opname_results%rowtype; v_order public.opname_orders%rowtype; v_wh public.warehouses%rowtype;
  v_rec public.opname_posting_receipts%rowtype; v_rep jsonb; v_lines jsonb := '[]'; v_hpp numeric := 0; v_jual numeric := 0;
  v_count integer := 0; v_missing integer := 0; v_loss numeric; v_journal_loss numeric; v_code text; v_msg text;
  v_closed date; v_today date := (now() at time zone 'Asia/Jakarta')::date; v_total numeric; v_hpp_total numeric; v_hpp_part numeric;
  v_plus jsonb := '[]'; v_jual_plus numeric := 0; v_hpp_plus numeric := 0; v_plus_count integer := 0; v_journal_credit numeric := 0;
  v_hpp_net numeric := 0; v_jual_kurang numeric := 0; v_jual_lebih numeric := 0;
begin
  select * into v_res from public.opname_results where id = p_result_id;
  if not found then return null; end if;
  select * into v_order from public.opname_orders where id = v_res.order_id;
  select * into v_wh from public.warehouses where id = v_order.warehouse_id;
  select * into v_rec from public.opname_posting_receipts where result_id = v_res.id and order_id = v_res.order_id;
  if v_rec.result_id is not null and jsonb_typeof(v_rec.source_snapshot->'price_report'->'rows') = 'array' then
    v_rep := v_rec.source_snapshot->'price_report';
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', e->>'item_id', 'code', e->>'code', 'name', e->>'name', 'unit', e->>'unit',
             'qty', -(e->>'selisih')::numeric,
             'hpp', case when jsonb_typeof(e->'nilai_selisih_modal') = 'string' then -(e->>'nilai_selisih_modal')::numeric end,
             'harga_jual', (e->>'harga_jual_cabang')::numeric,
             'jual', -(e->>'nilai_selisih_jual')::numeric) order by e->>'name', e->>'item_id'), '[]'::jsonb),
           coalesce(sum(-(e->>'nilai_selisih_modal')::numeric) filter (where jsonb_typeof(e->'nilai_selisih_modal') = 'string'), 0),
           coalesce(sum(-(e->>'nilai_selisih_jual')::numeric), 0),
           count(*),
           count(*) filter (where jsonb_typeof(e->'nilai_selisih_modal') is distinct from 'string')
      into v_lines, v_hpp, v_jual, v_count, v_missing
      from jsonb_array_elements(v_rep->'rows') e
     where (e->>'selisih')::numeric < 0;
    -- NETO (keputusan Andri 24 Nov 2026): selisih LEBIH satu dokumen (qty x harga jual cabang, aturan yang sama dengan kurang) mengurangi beban.
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', e->>'item_id', 'code', e->>'code', 'name', e->>'name', 'unit', e->>'unit',
             'qty', (e->>'selisih')::numeric,
             'hpp', case when jsonb_typeof(e->'nilai_selisih_modal') = 'string' then (e->>'nilai_selisih_modal')::numeric end,
             'harga_jual', (e->>'harga_jual_cabang')::numeric,
             'jual', (e->>'nilai_selisih_jual')::numeric) order by e->>'name', e->>'item_id'), '[]'::jsonb),
           coalesce(sum((e->>'nilai_selisih_jual')::numeric), 0),
           coalesce(sum((e->>'nilai_selisih_modal')::numeric) filter (where jsonb_typeof(e->'nilai_selisih_modal') = 'string'), 0),
           count(*)
      into v_plus, v_jual_plus, v_hpp_plus, v_plus_count
      from jsonb_array_elements(v_rep->'rows') e
     where (e->>'selisih')::numeric > 0;
    -- Beban yang masih tercatat di 720010 pada jurnal opname (debit - kredit; jurnal neto sudah mengurangi kurang dengan lebih; jurnal penyesuaian
    -- bersumber 'opname' dengan nomor hasil yang sama, mis. penyesuaian data lama, ikut dihitung; yang divoid tidak).
    select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0) into v_journal_loss, v_journal_credit
      from public.journal_lines l join public.coa_accounts a on a.id = l.account_id
      join public.journal_entries j on j.id = l.entry_id
     where (l.entry_id = any (v_rec.journal_ids) or (j.source = 'opname' and j.source_ref = v_res.no_hasil))
       and a.code = '720010' and j.voided_at is null;
  end if;
  v_jual_kurang := round(v_jual, 2);
  v_jual_lebih := round(v_jual_plus, 2);
  v_total := greatest(v_jual_kurang - v_jual_lebih, 0);
  v_hpp_total := round(v_hpp, 2);
  v_hpp_net := least(v_hpp_total, greatest(v_journal_loss - v_journal_credit, 0));
  v_hpp_part := least(v_total, v_hpp_net);

  -- Penolakan berurutan; kalimat bahasa biasa untuk layar.
  if v_rep is null then
    v_code := 'LAMA'; v_msg := 'Opname ini belum punya catatan nilai saat diposting (opname lama), jadi beban ke karyawan tidak bisa dicatat lewat sistem. Catat manual lewat Finance bila perlu.';
  elsif v_rec.source_snapshot->>'warehouse_policy' is distinct from 'variance-loss-expense-gain-income'
     or v_rec.source_snapshot->>'variance_account' is distinct from '720010' then
    v_code := 'LAMA'; v_msg := 'Opname ini diposting sebelum aturan akun selisih baru berlaku, jadi beban ke karyawan tidak bisa dicatat lewat sistem. Catat manual lewat Finance bila perlu.';
  elsif v_count = 0 then
    v_code := 'TANPA_KURANG'; v_msg := 'Opname ini tidak punya selisih kurang, jadi tidak ada yang bisa dibebankan.';
  elsif v_missing > 0 then
    v_code := 'HPP_KOSONG'; v_msg := 'Nilai modal sebagian barang selisih kurang tidak tercatat saat posting. Hubungi Finance; beban belum bisa dicatat.';
  else
    v_loss := (v_rec.source_snapshot->>'loss_cost')::numeric;
    if v_loss is distinct from v_hpp or v_journal_loss is distinct from v_hpp then
      v_code := 'TIDAK_COCOK'; v_msg := 'Nilai modal selisih kurang tidak cocok dengan jurnal opname asal. Hubungi Finance untuk diperiksa dulu.';
    elsif exists (select 1 from public.stock_document_corrections c where c.kind = 'opname' and c.document_id = v_res.id) then
      v_code := 'DIKOREKSI'; v_msg := 'Opname ini sudah dikoreksi sesudah diposting. Beban ke karyawan hanya untuk hasil asal yang belum dikoreksi; catat manual lewat Finance bila perlu.';
    elsif exists (select 1 from public.opname_variance_charges c where c.result_id = v_res.id and c.cancelled_at is null) then
      v_code := 'SUDAH'; v_msg := 'Selisih kurang opname ini sudah dibebankan ke karyawan. Batalkan beban yang ada dulu bila ingin mengubahnya.';
    elsif v_jual_kurang <= 0 then
      v_code := 'HARGA_JUAL_KOSONG'; v_msg := 'Harga jual barang yang kurang Rp0, jadi tidak ada nilai yang bisa dibebankan ke karyawan.';
    elsif v_total <= 0 then
      v_code := 'LEBIH_MENUTUPI'; v_msg := format('Selisih lebih opname ini (nilai jual Rp %s) sudah menutup selisih kurang (nilai jual Rp %s), jadi tidak ada yang dibebankan ke karyawan.',
        trim_scale(v_jual_lebih)::text, trim_scale(v_jual_kurang)::text);
    else
      select closed_until into v_closed from public.accounting_locks where id;
      if v_closed is not null and v_today <= v_closed then
        v_code := 'PERIODE'; v_msg := format('Periode akuntansi sampai %s sudah ditutup, jadi beban hari ini belum bisa dicatat. Minta Owner membuka periodenya dulu.', to_char(v_closed, 'DD-MM-YYYY'));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'result_id', v_res.id, 'no_hasil', v_res.no_hasil, 'tanggal_opname', v_res.tanggal,
    'order_id', v_order.id, 'no_opname', v_order.no_opname,
    'branch_id', v_wh.branch_id, 'warehouse_id', v_wh.id, 'warehouse', v_wh.name,
    'method', v_rep->>'method', 'policy', v_rec.source_snapshot->>'warehouse_policy',
    'minus_lines', v_lines, 'minus_count', v_count,
    'plus_lines', v_plus, 'plus_count', v_plus_count, 'jual_kurang', v_jual_kurang, 'jual_lebih', v_jual_lebih, 'hpp_lebih', round(v_hpp_plus, 2),
    'hpp_total', v_hpp_total, 'hpp_neto', v_hpp_net, 'jual_total', v_total,
    'hpp_part', v_hpp_part, 'gain_part', v_total - v_hpp_part,
    'today', v_today,
    'refuse', case when v_code is null then null else jsonb_build_object('code', v_code, 'message', v_msg) end);
end $$;

-- 3. Ringkasan: tambah bukti neto pada riwayat beban.
create or replace function public.read_opname_variance_charge(p_result_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_role text; v_actor text; v_basis jsonb; v_charges jsonb;
begin
  perform admin_online_private.deny_admin_online();
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or p_result_id is null then
    raise exception 'BEBAN_KARYAWAN_DITOLAK: akses ringkasan selisih opname ditolak.' using errcode = '42501';
  end if;
  select role::text into v_role from public.profiles where id = auth.uid() and is_active;
  v_actor := public.opname_variance_charge_actor();
  if v_role is null or (v_role not in ('OWNER', 'FINANCE') and v_actor is null) then
    raise exception 'BEBAN_KARYAWAN_DITOLAK: ringkasan nilai selisih opname hanya untuk Owner/Finance.' using errcode = '42501';
  end if;
  v_basis := public.opname_variance_charge_basis(p_result_id);
  if v_basis is null or not public.user_can_access_branch((v_basis->>'branch_id')::uuid) then
    raise exception 'BEBAN_KARYAWAN_DITOLAK: hasil opname tidak ditemukan atau cabangnya tidak dapat diakses.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'tanggal', c.tanggal, 'reason', c.reason, 'total', c.total, 'hpp_part', c.hpp_part, 'gain_part', c.gain_part, 'jual_kurang', c.jual_kurang, 'jual_lebih', c.jual_lebih,
           'actor_name', (select p.full_name from public.profiles p where p.id = c.actor_id), 'created_at', c.created_at,
           'journal_id', c.journal_id, 'cancelled_at', c.cancelled_at, 'cancel_reason', c.cancel_reason, 'cancel_journal_id', c.cancel_journal_id,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                        'employee_id', x.employee_id, 'nama', e.nama, 'amount', x.amount, 'advance_id', x.advance_id,
                        'status', ca.status,
                        'dibayar', coalesce((select sum(i.jumlah) from public.cash_advance_installments i where i.advance_id = x.advance_id), 0))
                      order by e.nama, x.employee_id), '[]'::jsonb)
                     from jsonb_to_recordset(c.lines) x(employee_id uuid, amount numeric, advance_id uuid)
                     left join public.employees e on e.id = x.employee_id
                     left join public.cash_advances ca on ca.id = x.advance_id))
         order by c.created_at desc), '[]'::jsonb)
    into v_charges
    from public.opname_variance_charges c where c.result_id = p_result_id;
  return v_basis || jsonb_build_object('can_charge', v_actor is not null, 'charges', v_charges);
end $$;

-- 4. Catat beban: nilai neto + bukti.
create or replace function public.charge_opname_variance_to_employees(p_result_id uuid, p_lines jsonb, p_reason text, p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_actor text := public.opname_variance_charge_actor(); v_uid uuid := auth.uid(); v_reason text; v_norm jsonb; v_payload jsonb;
  v_prior public.opname_variance_charges%rowtype; v_basis jsonb; v_branch uuid; v_count integer; v_distinct integer; v_sum numeric;
  v_total numeric; v_hpp_part numeric; v_gain_part numeric; v_today date; v_id uuid := gen_random_uuid(); v_lines jsonb := '[]';
  v_advances uuid[] := '{}'; v_line record; v_adv uuid; v_journal uuid; v_jl jsonb; v_desc text; v_kurang numeric; v_lebih numeric;
begin
  perform admin_online_private.deny_admin_online();
  if v_actor is null then
    raise exception using errcode = '42501', message = 'BEBAN_KARYAWAN_DITOLAK: hanya Owner atau peran yang diberi izin "Bebankan selisih opname ke karyawan".';
  end if;
  v_reason := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  if length(v_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_ALASAN: alasan wajib diisi 3 sampai 300 huruf.';
  end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KUNCI: muat ulang halaman lalu coba lagi.'; end if;
  if p_result_id is null then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_OPNAME: hasil opname tidak ditemukan.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 10
     or exists (select 1 from jsonb_array_elements(p_lines) e
                where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'amount') <> 'number'
                   or coalesce(e->>'employee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_BAGI: pilih 1 sampai 10 karyawan dan isi jumlah untuk tiap orang.';
  end if;
  select jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'amount', x.amount) order by x.employee_id),
         count(*), count(distinct x.employee_id), sum(x.amount)
    into v_norm, v_count, v_distinct, v_sum
    from jsonb_to_recordset(p_lines) x(employee_id uuid, amount numeric);
  if v_distinct <> v_count then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_BAGI: satu karyawan hanya boleh dipilih sekali.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(employee_id uuid, amount numeric)
             where x.amount <= 0 or x.amount <> round(x.amount, 2) or x.amount > 1000000000000) then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_BAGI: jumlah tiap karyawan harus lebih dari 0 (maksimal 2 angka di belakang koma).';
  end if;
  v_payload := jsonb_build_object('result_id', p_result_id, 'lines', v_norm, 'reason', v_reason);

  -- Kunci permintaan: sama + isi sama = hasil lama; sama + isi beda = ditolak.
  perform pg_advisory_xact_lock(hashtextextended('opname-beban-karyawan:' || p_request_key::text, 0));
  select * into v_prior from public.opname_variance_charges where request_key = p_request_key;
  if found then
    if v_prior.request_payload is distinct from v_payload or v_prior.actor_id is distinct from v_uid then
      raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
    end if;
    return jsonb_build_object('charge_id', v_prior.id, 'result_id', v_prior.result_id, 'no_hasil', v_prior.no_hasil, 'total', v_prior.total,
      'hpp_part', v_prior.hpp_part, 'gain_part', v_prior.gain_part, 'journal_id', v_prior.journal_id, 'advance_ids', to_jsonb(v_prior.advance_ids),
      'tanggal', v_prior.tanggal, 'already_applied', true);
  end if;

  -- Serialkan per opname (dengan koreksi stok dan pencatatan beban lain).
  perform 1 from public.opname_results where id = p_result_id for update;
  if not found then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_OPNAME: hasil opname tidak ditemukan.'; end if;
  perform 1 from public.accounting_locks where id for share;
  v_basis := public.opname_variance_charge_basis(p_result_id);
  v_branch := (v_basis->>'branch_id')::uuid;
  if not public.user_can_access_branch(v_branch) then
    raise exception using errcode = '42501', message = 'BEBAN_KARYAWAN_DITOLAK: cabang opname ini tidak dapat diakses.';
  end if;
  if v_basis->'refuse' is not null and jsonb_typeof(v_basis->'refuse') = 'object' then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_' || (v_basis->'refuse'->>'code') || ': ' || (v_basis->'refuse'->>'message');
  end if;
  v_total := (v_basis->>'jual_total')::numeric;
  v_hpp_part := (v_basis->>'hpp_part')::numeric;
  v_gain_part := (v_basis->>'gain_part')::numeric;
  v_today := (v_basis->>'today')::date;
  v_kurang := (v_basis->>'jual_kurang')::numeric;
  v_lebih := (v_basis->>'jual_lebih')::numeric;
  if v_sum is distinct from v_total then
    raise exception using errcode = '22023', message = format('BEBAN_KARYAWAN_TOTAL: jumlah pembagian (Rp %s) harus sama dengan nilai beban (Rp %s).',
      trim_scale(v_sum)::text, trim_scale(v_total)::text);
  end if;
  perform 1 from public.employees e
   where e.id in (select x.employee_id from jsonb_to_recordset(v_norm) x(employee_id uuid, amount numeric)) order by e.id for share;
  if (select count(*) from public.employees e
       where e.id in (select x.employee_id from jsonb_to_recordset(v_norm) x(employee_id uuid, amount numeric))
         and e.status = 'Aktif' and e.trashed_at is null) <> v_count then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KARYAWAN: karyawan yang dipilih tidak ditemukan atau sudah tidak aktif.';
  end if;
  if (select count(*) from public.coa_accounts where code in ('182001', public.stock_opname_account('variance'), public.stock_opname_account('gain'))
       and is_active and not is_header) <> 3 then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_AKUN: akun 182001 Kasbon Karyawan / 720010 Beban Selisih Stok / 810004 Pendapatan Lain-lain belum aktif. Hubungi Finance.';
  end if;

  -- Kasbon per karyawan: status 'Dicatat' = tercatat, TIDAK dipotong gaji otomatis.
  for v_line in select x.employee_id, x.amount from jsonb_to_recordset(v_norm) x(employee_id uuid, amount numeric) order by x.employee_id loop
    v_adv := gen_random_uuid();
    insert into public.cash_advances(id, employee_id, tanggal, jumlah, tenor_bulan, status, alasan, approved_by, approved_at, disbursed_at)
    values (v_adv, v_line.employee_id, v_today, v_line.amount, 1, 'Dicatat',
            left('Beban selisih stok opname ' || (v_basis->>'no_hasil') || ' — ' || v_reason, 500), v_uid, now(), now());
    v_advances := v_advances || v_adv;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('employee_id', v_line.employee_id, 'amount', v_line.amount, 'advance_id', v_adv));
  end loop;

  v_jl := jsonb_build_array(
            jsonb_build_object('code', '182001', 'debit', v_total, 'credit', 0),
            jsonb_build_object('code', public.stock_opname_account('variance'), 'debit', 0, 'credit', v_hpp_part))
          || case when v_gain_part > 0 then jsonb_build_array(jsonb_build_object('code', public.stock_opname_account('gain'), 'debit', 0, 'credit', v_gain_part))
                  else '[]'::jsonb end;
  v_desc := 'Beban selisih stok opname ' || (v_basis->>'no_hasil') || ' ke karyawan (' || (v_basis->>'no_opname') || ') #' || left(v_id::text, 8)
           || case when v_lebih > 0 then ' — neto: kurang Rp ' || trim_scale(v_kurang)::text || ' − lebih Rp ' || trim_scale(v_lebih)::text else '' end;
  v_journal := public.opname_posting_journal(v_today, v_branch, 'opname-beban-karyawan', v_basis->>'no_hasil', v_desc, v_jl);

  insert into public.opname_variance_charges(id, request_key, request_payload, actor_id, actor_role, result_id, no_hasil, branch_id, warehouse_id,
    tanggal, reason, total, hpp_total, hpp_part, gain_part, lines, minus_lines, advance_ids, journal_id, jual_kurang, jual_lebih)
  values (v_id, p_request_key, v_payload, v_uid, v_actor, p_result_id, v_basis->>'no_hasil', v_branch, (v_basis->>'warehouse_id')::uuid,
    v_today, v_reason, v_total, (v_basis->>'hpp_total')::numeric, v_hpp_part, v_gain_part, v_lines, v_basis->'minus_lines', v_advances, v_journal, v_kurang, v_lebih);

  return jsonb_build_object('charge_id', v_id, 'result_id', p_result_id, 'no_hasil', v_basis->>'no_hasil', 'total', v_total,
    'hpp_part', v_hpp_part, 'gain_part', v_gain_part, 'journal_id', v_journal, 'advance_ids', to_jsonb(v_advances),
    'tanggal', v_today, 'already_applied', false);
end $$;

do $check$ begin
 if not has_function_privilege('authenticated','public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)','EXECUTE')
  or has_function_privilege('anon','public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.opname_variance_charge_basis(uuid)','EXECUTE')
  or has_function_privilege('anon','public.read_opname_variance_charge(uuid)','EXECUTE')
  or not has_function_privilege('authenticated','public.read_opname_variance_charge(uuid)','EXECUTE')
 then raise exception 'SO_KASBON_NETO: ACL fungsi beban karyawan berubah'; end if;
 if (select count(*) from pg_proc p where p.oid in ('public.opname_variance_charge_basis(uuid)'::regprocedure,'public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)'::regprocedure,'public.read_opname_variance_charge(uuid)'::regprocedure)
       and p.prosecdef and p.proconfig @> array['search_path=""']) <> 3
 then raise exception 'SO_KASBON_NETO: DEFINER/search_path berubah'; end if;
end $check$;
