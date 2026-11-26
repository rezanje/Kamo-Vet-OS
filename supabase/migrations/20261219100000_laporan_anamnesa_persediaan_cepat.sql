-- Laporan tahap 4: Daftar Anamnesa & Penyakit dan Nilai Persediaan Historis dibaca di database dalam SATU query,
-- bukan puluhan halaman 500 baris lewat RLS. Tiga fungsi baca-saja; tidak ada tabel, kebijakan, indeks, atau data yang diubah.
--
-- Masalah (diukur di Production 26 Nov 2026, akses Owner, batas role authenticated 8 dtk):
--   * Anamnesa: rekam medis + kunjungan + cabang + hewan + pelanggan dibaca per halaman 500 baris dengan hitungan
--     pasti (count exact) di tiap halaman; RLS kunjungan dicek PER BARIS. 1-26 Nov (±5.600 baris) = 12 halaman berurutan.
--   * Nilai Persediaan Historis: lapisan FIFO (8.680 baris, 18 halaman), stok minus, dan SELURUH baris jurnal akun 170001
--     sampai tanggal itu (13.180 baris, 27 halaman, makin banyak tiap hari) dibaca per halaman + RLS per baris.
--
-- 1) public.laporan_anamnesa(p_from, p_to, p_branch_id)   SECURITY INVOKER
--    Baris YANG SAMA dengan `medical_records?select=id,diagnosis,anamnesis,gejala_klinis,follow_up,created_at,
--    visits(branch_id,dokter,branches(name),pets(name,species,breed),customers(name))` (+ `!inner` bila cabang dipilih) dengan
--    created_at inklusif p_from..p_to (p_to_eksklusif=true: p_to tidak ikut, untuk memecah rentang panjang tanpa celah), urutan created_at desc lalu id. Karena berjalan SEBAGAI PEMANGGIL, semua kebijakan RLS
--    (medical_records, visits termasuk riwayat impor/legacy, branches, pets, customers, pagar Admin Online, header cabang
--    operasional) berlaku persis seperti pembaca lama; tidak ada logika hak akses yang disalin.
-- 2) public.laporan_persediaan_lapisan(p_branch_ids)       SECURITY INVOKER
--    Per cabang: jumlah qty_left x unit_cost lapisan FIFO bersisa (gudang yang terlihat pemanggil), jumlah stok minus, dan
--    jumlah lapisan berbiaya negatif (aplikasi menolak laporan seperti pembaca lama). Aritmetika NUMERIC eksak, tanpa pembulatan.
-- 3) public.laporan_persediaan_buku_besar(p_as_of, p_branch_ids, p_tak_teralokasi)   SECURITY DEFINER
--    Saldo (debit - kredit) akun 170001 per cabang sampai p_as_of (+ baris tanpa cabang bila diminta). Seluruh riwayat jurnal
--    makin besar, jadi hak baca dicek SEKALI per cabang (public.user_can_access_branch), bukan per baris: persis kebijakan
--    je_all/jl_all (baris tanpa cabang ikut; baris bercabang hanya bila cabangnya boleh). Admin Online ditolak
--    (admin_online_private.deny_admin_online), anon tidak punya hak eksekusi.
--
-- Aplikasi tetap berjalan sebelum migrasi ini dipasang: bila fungsi belum ada, pembaca lama dipakai.

create or replace function public.laporan_anamnesa(
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid default null,
  p_to_eksklusif boolean default false
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_n integer;
begin
  -- Admin Online: pagar RLS sudah mengosongkan semua tabel; tolak terang-terangan seperti fungsi laporan lain.
  if admin_online_private.is_admin_online() then
    raise exception 'ADMIN_ONLINE_FUNCTION_DENIED: fungsi ini tidak tersedia untuk peran Admin Online' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then
    raise exception 'LAPORAN_ANAMNESA_PERIODE: tanggal awal dan akhir wajib diisi' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x.baris order by x.created_at desc, x.id), '[]'::jsonb), count(*)::integer
    into v_rows, v_n
  from (
    select mr.id, mr.created_at,
      jsonb_build_object(
        'id', mr.id,
        'diagnosis', mr.diagnosis,
        'anamnesis', mr.anamnesis,
        'gejala_klinis', mr.gejala_klinis,
        'follow_up', mr.follow_up,
        'created_at', mr.created_at,
        'visits', case when v.id is null then null else jsonb_build_object(
          'branch_id', v.branch_id,
          'dokter', v.dokter,
          'branches', case when b.id is null then null else jsonb_build_object('name', b.name) end,
          'pets', case when p.id is null then null else jsonb_build_object('name', p.name, 'species', p.species, 'breed', p.breed) end,
          'customers', case when c.id is null then null else jsonb_build_object('name', c.name) end
        ) end
      ) as baris
    from public.medical_records mr
    left join public.visits v on v.id = mr.visit_id
    left join public.branches b on b.id = v.branch_id
    left join public.pets p on p.id = v.pet_id
    left join public.customers c on c.id = v.customer_id
    where mr.created_at >= p_from
      and (case when p_to_eksklusif then mr.created_at < p_to else mr.created_at <= p_to end)
      -- `visits!inner` + eq pada pembaca lama: kunjungan wajib ada dan bercabang p_branch_id
      and (p_branch_id is null or (v.id is not null and v.branch_id = p_branch_id))
  ) x;

  return jsonb_build_object('n', v_n, 'rows', v_rows);
end;
$$;

create or replace function public.laporan_persediaan_lapisan(
  p_branch_ids uuid[]
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_per jsonb;
  v_negatif bigint;
begin
  if admin_online_private.is_admin_online() then
    raise exception 'ADMIN_ONLINE_FUNCTION_DENIED: fungsi ini tidak tersedia untuk peran Admin Online' using errcode = '42501';
  end if;
  if p_branch_ids is null then
    raise exception 'LAPORAN_PERSEDIAAN_CABANG: daftar cabang wajib diisi' using errcode = '22023';
  end if;

  with w as materialized (
    select id, branch_id from public.warehouses where branch_id = any(p_branch_ids)
  ), lay as (
    select w.branch_id, sum(sl.qty_left * sl.unit_cost) as nilai
    from public.stock_layers sl join w on w.id = sl.warehouse_id
    where sl.qty_left > 0
    group by w.branch_id
  ), neg as (
    select w.branch_id, count(*) as n
    from public.stock s join w on w.id = s.warehouse_id
    where s.qty < 0
    group by w.branch_id
  )
  select coalesce(jsonb_object_agg(b.id::text, jsonb_build_object(
           'nilai', coalesce(lay.nilai, 0)::text, 'minus', coalesce(neg.n, 0))), '{}'::jsonb)
    into v_per
  from (select distinct x as id from unnest(p_branch_ids) x) b
  left join lay on lay.branch_id = b.id
  left join neg on neg.branch_id = b.id;

  select count(*) into v_negatif
  from public.stock_layers sl
  join public.warehouses w on w.id = sl.warehouse_id
  where w.branch_id = any(p_branch_ids) and sl.qty_left > 0 and sl.unit_cost < 0;

  return jsonb_build_object('per_cabang', v_per, 'biaya_negatif', v_negatif);
end;
$$;

create or replace function public.laporan_persediaan_buku_besar(
  p_as_of date,
  p_branch_ids uuid[],
  p_tak_teralokasi boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_boleh uuid[];
  v_akun uuid;
  v_per jsonb;
  v_tak numeric;
  v_negatif bigint;
begin
  perform admin_online_private.deny_admin_online();
  if p_as_of is null or p_branch_ids is null then
    raise exception 'LAPORAN_PERSEDIAAN_BUKU_BESAR: tanggal dan daftar cabang wajib diisi' using errcode = '22023';
  end if;
  select a.id into v_akun from public.coa_accounts a where a.code = '170001';
  if v_akun is null then
    return jsonb_build_object('akun_ada', false);
  end if;
  -- Cabang yang boleh dilihat pemanggil: sekali per cabang, logika persis RLS je_all/jl_all.
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_boleh
  from public.branches b
  where public.user_can_access_branch(b.id);

  with l as materialized (
    select e.branch_id, jl.debit, jl.credit
    from public.journal_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    where jl.account_id = v_akun
      and e.tanggal <= p_as_of
      and ((e.branch_id = any(p_branch_ids) and e.branch_id = any(v_boleh))
           or (p_tak_teralokasi and e.branch_id is null))
  )
  select
    coalesce((select jsonb_object_agg(g.branch_id::text, g.saldo::text)
              from (select branch_id, sum(debit - credit) as saldo from l where branch_id is not null group by branch_id) g), '{}'::jsonb),
    coalesce((select sum(debit - credit) from l where branch_id is null), 0),
    (select count(*) from l where debit < 0 or credit < 0)
    into v_per, v_tak, v_negatif;

  return jsonb_build_object('akun_ada', true, 'per_cabang', v_per, 'tak_teralokasi', v_tak::text, 'negatif', v_negatif);
end;
$$;

revoke all on function public.laporan_anamnesa(timestamptz, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.laporan_anamnesa(timestamptz, timestamptz, uuid, boolean) to authenticated;
revoke all on function public.laporan_persediaan_lapisan(uuid[]) from public, anon;
grant execute on function public.laporan_persediaan_lapisan(uuid[]) to authenticated;
revoke all on function public.laporan_persediaan_buku_besar(date, uuid[], boolean) from public, anon;
grant execute on function public.laporan_persediaan_buku_besar(date, uuid[], boolean) to authenticated;
