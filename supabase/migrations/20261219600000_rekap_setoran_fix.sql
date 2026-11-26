-- REKAP SETORAN — perbaikan temuan review independen PR #595 (REKAP-SETORAN-FIX). Produksi: 0 baris setoran, jadi tidak ada data nyata yang berisiko.
-- Apply as ONE transaction (satu transaksi; file ini sengaja tanpa begin/commit sendiri). Sepenuhnya aditif: tidak ada data yang diubah.
--
-- B1  Staf bisa membaca jurnal setoran (selisih kurang/lebih/kasbon/beban) lewat tabel journal_entries/journal_lines (RLS je_all/jl_all hanya membatasi
--     cabang) DAN lewat fungsi buku besar ledger_account_lines/ledger_account_totals (SECURITY DEFINER yang meniru RLS tanpa peran).
--     PERBAIKAN SEMPIT: dua kebijakan RESTRICTIVE (FOR ALL, hanya menyaring baris source 'setoran' / 'setoran-batal' dan barisnya) +
--     dua fungsi buku besar menyaring entri yang sama. Hanya OWNER/ADMIN/ADMIN_UMUM/FINANCE (setoran_penyetuju) dan service_role yang melihatnya;
--     jalur SECURITY DEFINER (fungsi posting, milik postgres, di luar RLS) tidak berubah. Kebijakan jurnal umum (je_all/jl_all) TIDAK diubah:
--     lubang umum itu dilaporkan terpisah kepada pemilik. Jurnal setoran kini bernomor SJR-YYYYMM-NNNN (bukan JRN-) supaya tidak ada celah nomor JRN
--     yang bisa dibaca staf sebagai petunjuk adanya selisih.
-- M1  Sisa yang tampil ke staf: setelah Diajukan/Disetujui/Void sisa = 0 dan persen = 100 (kekurangan nyata hanya untuk penyetuju).
-- M2  Pengeluaran > kewajiban (atau periode tanpa shift) bukan kelebihan kas: setujui DITOLAK dengan pesan jelas untuk Finance; lantai nol untuk penyelesaian.
-- M3  Bucket 'dokumen' awalan setoran/: kebijakan storage RESTRICTIVE (baca/unggah hanya peran setoran dengan akses cabang di path; ubah ditutup; hapus
--     hanya berkas yatim milik sendiri/Owner).
-- M4  Pemisahan tugas: penyetuju bukan orang yang menginput pengeluaran/transfer atau membuka/memegang shift yang masuk hitungan; peringatan di layar penyetuju.
-- M5  Lampiran: wajib setoran/<cabang setoran>/<berkas>, berkas ada di storage, tidak dipakai dua kali (tabel klaim setoran_lampiran_pakai); peringatan pengeluaran
--     kembar atau mirip pengeluaran kasir (kategori+jumlah+tanggal) untuk penyetuju.
-- M6  Shift tertutup (semua tipe) tidak bisa diubah angka uangnya / dibuka kembali lewat klien (pemicu cashier_shift_tutup_uang_guard).
-- m2  Jejak menyimpan jumlah/tanggal/berkas baris yang dihapus.
--
-- ROLLBACK: lihat ROLLBACK.sql di folder bukti (pulihkan definisi lama dari cadangan hosted + drop kebijakan/fungsi/tabel/pemicu baru; sebelum ada setoran disetujui).
set local lock_timeout = '5s';

-- ───────────────────────── 0. Pagar prasyarat (gagal tertutup) ─────────────────────────
do $guard$
begin
  if to_regprocedure('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)') is null
     or to_regprocedure('public.setoran_penyetuju()') is null or to_regprocedure('public.setoran_role()') is null
     or to_regprocedure('public.ledger_account_lines(date,date,uuid[],uuid[])') is null or to_regprocedure('public.ledger_account_totals(date,date,uuid[])') is null
     or to_regprocedure('public.sales_write_journal(date,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('admin_online_private.deny_admin_online()') is null then
    raise exception 'SETORAN_FIX_PRECONDITION: fungsi setoran/buku besar belum ada; periksa urutan migrasi';
  end if;
  if to_regclass('public.setoran_lampiran_pakai') is not null or to_regprocedure('public.setoran_jurnal_boleh()') is not null
     or position('REKAP-SETORAN-FIX' in pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure)) > 0 then
    raise exception 'SETORAN_FIX_PRECONDITION: perbaikan sudah terpasang';
  end if;
  if position('SETORAN_SHIFT_BARU' in pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure)) = 0 then
    raise exception 'SETORAN_FIX_PRECONDITION: setoran_setujui bukan versi 20261214100050';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entries' and policyname = 'je_all')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_lines' and policyname = 'jl_all') then
    raise exception 'SETORAN_FIX_PRECONDITION: kebijakan je_all/jl_all berbeda dari yang diharapkan';
  end if;
end $guard$;

-- ───────────────────────── 1. Klaim berkas bukti (satu berkas = satu baris; tidak dapat dipakai ulang) ─────────────────────────
create table public.setoran_lampiran_pakai (
  path text primary key,
  setoran_id uuid not null references public.setoran(id),
  jenis text not null check (jenis in ('pengeluaran','transfer')),
  baris_id uuid not null,
  dipakai_oleh uuid not null,
  dipakai_at timestamptz not null default now()
);
create index setoran_lampiran_pakai_baris on public.setoran_lampiran_pakai (baris_id);
create index setoran_lampiran_pakai_setoran on public.setoran_lampiran_pakai (setoran_id);
comment on table public.setoran_lampiran_pakai is 'Klaim berkas bukti setoran: satu path hanya untuk satu baris. Dilepas hanya saat baris dihapus selagi Draft/Ditolak. Dibaca/ditulis hanya fungsi setoran_*.';
alter table public.setoran_lampiran_pakai enable row level security;
revoke all on public.setoran_lampiran_pakai from public, anon, authenticated, service_role;

create function public.guard_setoran_pakai() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if tg_op in ('UPDATE','TRUNCATE') then
    raise exception 'SETORAN_JEJAK: klaim berkas bukti tidak dapat diubah.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then return new; end if;
  select status into v_status from public.setoran where id = old.setoran_id;
  if v_status is null or v_status not in ('Draft','Ditolak') then
    raise exception 'SETORAN_BEKU: berkas bukti setoran berstatus % tidak dapat dilepas.', coalesce(v_status, '?') using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function public.guard_setoran_pakai() from public, anon, authenticated, service_role;
create trigger setoran_pakai_guard before insert or update or delete on public.setoran_lampiran_pakai for each row execute function public.guard_setoran_pakai();
create trigger setoran_pakai_guard_truncate before truncate on public.setoran_lampiran_pakai for each statement execute function public.guard_setoran_pakai();

-- Pengisian awal klaim dari baris yang mungkin sudah ada (produksi saat ini 0 baris; aman bila nanti ada). Path ganda: yang tertua menang.
insert into public.setoran_lampiran_pakai(path, setoran_id, jenis, baris_id, dipakai_oleh, dipakai_at)
select distinct on (u.path) u.path, u.setoran_id, u.jenis, u.baris_id, u.oleh, u.at from (
  select x.path, p.setoran_id, 'pengeluaran'::text as jenis, p.id as baris_id, p.entered_by as oleh, p.created_at as at
    from public.setoran_pengeluaran p cross join lateral jsonb_to_recordset(p.lampiran) as x(path text) where x.path is not null
  union all
  select x.path, t.setoran_id, 'transfer', t.id, t.entered_by, t.created_at
    from public.setoran_transfer t cross join lateral jsonb_to_recordset(t.lampiran) as x(path text) where x.path is not null) u
order by u.path, u.at
on conflict (path) do nothing;

-- ───────────────────────── 2. Pembantu baru ─────────────────────────
-- Boleh melihat jurnal setoran? Penyetuju (OWNER/ADMIN/ADMIN_UMUM/FINANCE aktif) dan service_role. Dipanggil dari kebijakan RLS (sebagai pengguna), jadi harus dapat dieksekusi authenticated.
create function public.setoran_jurnal_boleh() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.setoran_penyetuju(), false) or coalesce(auth.role(), '') = 'service_role'
$$;
revoke all on function public.setoran_jurnal_boleh() from public, anon, service_role;
grant execute on function public.setoran_jurnal_boleh() to authenticated;
comment on function public.setoran_jurnal_boleh() is 'Kebijakan jurnal setoran: true untuk penyetuju setoran dan service_role.';

-- Daftar id entri jurnal setoran yang HARUS disembunyikan dari pemanggil ini ('{}' bagi penyetuju/service_role). Dipakai kebijakan journal_lines dan fungsi buku besar.
create function public.setoran_jurnal_tersembunyi() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case when public.setoran_jurnal_boleh() then '{}'::uuid[]
              else coalesce((select array_agg(e.id) from public.journal_entries e where e.source in ('setoran','setoran-batal')), '{}'::uuid[]) end
$$;
revoke all on function public.setoran_jurnal_tersembunyi() from public, anon, service_role;
grant execute on function public.setoran_jurnal_tersembunyi() to authenticated;
comment on function public.setoran_jurnal_tersembunyi() is 'Entri jurnal setoran yang disembunyikan dari pemanggil bukan penyetuju.';

-- Tulis jurnal setoran: sama dengan sales_write_journal tetapi bernomor SJR-YYYYMM-NNNN (tidak menggeser deret JRN yang terlihat staf).
create function public.setoran_tulis_jurnal(p_date date, p_branch uuid, p_source text, p_ref text, p_description text, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_line record; v_account uuid; v_id uuid := gen_random_uuid(); v_lines jsonb := '[]'; v_prefix text; v_seq bigint;
begin
  if p_source not in ('setoran','setoran-batal') then raise exception 'SETORAN_JURNAL: sumber jurnal tidak dikenal.' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) = 0 then return; end if;
  if (select sum(debit) - sum(credit) from jsonb_to_recordset(p_lines) as x(code text, debit numeric, credit numeric)) <> 0 then raise exception 'Jurnal tidak seimbang'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as x(code text, debit numeric, credit numeric) where debit > 0 or credit > 0 loop
    select id into v_account from public.coa_accounts where code = v_line.code and is_active and not is_header;
    if not found then raise exception 'Akun % tidak tersedia atau bukan akun detail aktif.', v_line.code; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_account, 'debit', v_line.debit, 'credit', v_line.credit));
  end loop;
  v_prefix := 'SJR-' || to_char(p_date, 'YYYYMM') || '-';
  perform pg_advisory_xact_lock(hashtext('vetos:journal:' || v_prefix)::bigint);
  select coalesce(max((substring(substring(e.no_jurnal from length(v_prefix) + 1) from '^[0-9]{1,12}'))::bigint), 0) + 1 into v_seq
    from public.journal_entries e where left(e.no_jurnal, length(v_prefix)) = v_prefix;
  insert into public.journal_entries(id, no_jurnal, tanggal, branch_id, source, source_ref, deskripsi)
    values (v_id, v_prefix || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0'), p_date, p_branch, p_source, p_ref, p_description);
  insert into public.journal_lines(entry_id, account_id, debit, credit)
    select v_id, account_id, debit, credit from jsonb_to_recordset(v_lines) as x(account_id uuid, debit numeric, credit numeric);
end $$;
revoke all on function public.setoran_tulis_jurnal(date, uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- Daftar alasan konflik tugas untuk p_user pada setoran p_id (selain pembuat/pengaju yang sudah dicek terpisah).
create function public.setoran_konflik_tugas(p_id uuid, p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_remove(array[
    case when exists (select 1 from public.setoran_pengeluaran x where x.setoran_id = p_id and x.entered_by = p_user)
         then 'menginput baris pengeluaran setoran ini' end,
    case when exists (select 1 from public.setoran_transfer x where x.setoran_id = p_id and x.entered_by = p_user)
         then 'mencatat transfer/serah tunai setoran ini' end,
    case when exists (select 1 from public.setoran_shift ss join public.cashier_shifts s on s.id = ss.shift_id
                       where ss.setoran_id = p_id and ss.aktif
                         and (s.opened_by = p_user or s.employee_id in (select e.id from public.employees e where e.profile_id = p_user)))
         then 'membuka atau memegang shift kasir yang masuk hitungan setoran ini' end
  ], null), '{}'::text[])
$$;
revoke all on function public.setoran_konflik_tugas(uuid, uuid) from public, anon, authenticated, service_role;

-- Peringatan untuk layar penyetuju (hanya dipanggil dari setoran_detail bagian keuangan; tidak pernah ke staf).
create function public.setoran_peringatan(p_id uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.setoran%rowtype; v_k public.setoran_keuangan%rowtype; v_out jsonb := '[]'::jsonb; v_konf text[]; v_n integer;
begin
  select * into v_s from public.setoran where id = p_id;
  if not found then return v_out; end if;
  select * into v_k from public.setoran_keuangan where setoran_id = p_id;
  v_konf := public.setoran_konflik_tugas(p_id, p_user);
  if p_user in (v_s.created_by, v_s.submitted_by) then v_konf := array_append(v_konf, 'membuat atau mengajukan setoran ini'); end if;
  if cardinality(v_konf) > 0 and v_s.status = 'Diajukan' then
    v_out := v_out || jsonb_build_array(jsonb_build_object('kode', 'PEMISAHAN_TUGAS', 'tingkat', 'blokir',
      'pesan', 'Anda tidak dapat menyetujui setoran ini karena Anda ' || array_to_string(v_konf, '; ') || '. Minta Owner/Finance/Admin lain.'));
  end if;
  if v_k.setoran_id is not null and v_k.expected_amount < 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('kode', 'PENGELUARAN_MELEBIHI', 'tingkat', case when v_s.status = 'Diajukan' then 'blokir' else 'info' end,
      'pesan', 'Pengeluaran dari dana setoran (Rp ' || v_k.pengeluaran_total || ') lebih besar dari kewajiban (Rp ' || v_k.shift_net || '). Ini bukan kelebihan kas: setoran tidak dapat disetujui; tolak agar baris pengeluaran diperiksa.'));
  end if;
  select count(*) into v_n from public.setoran_pengeluaran p
   where p.setoran_id = p_id and exists (select 1 from public.expenses x where x.branch_id = v_s.branch_id and x.tanggal = p.tanggal and x.kategori = p.kategori
                                          and x.jumlah = p.jumlah and x.voided_at is null and x.metode_bayar = 'Tunai' and (p.expense_id is null or x.id <> p.expense_id));
  if v_n > 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('kode', 'PENGELUARAN_MIRIP_KASIR', 'tingkat', 'peringatan', 'jumlah', v_n,
      'pesan', v_n || ' baris pengeluaran setoran sama (kategori, jumlah, tanggal) dengan pengeluaran tunai yang sudah dicatat di kasir; periksa kemungkinan tercatat dua kali.'));
  end if;
  select count(*) into v_n from (select 1 from public.setoran_pengeluaran p where p.setoran_id = p_id group by p.tanggal, p.kategori, p.jumlah having count(*) > 1) q;
  if v_n > 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('kode', 'PENGELUARAN_KEMBAR', 'tingkat', 'peringatan', 'jumlah', v_n,
      'pesan', 'Ada baris pengeluaran kembar (tanggal, kategori, dan jumlah sama) di setoran ini; periksa kemungkinan diinput dua kali.'));
  end if;
  if not exists (select 1 from public.setoran_shift ss where ss.setoran_id = p_id and ss.aktif) then
    v_out := v_out || jsonb_build_array(jsonb_build_object('kode', 'TANPA_SHIFT', 'tingkat', 'info',
      'pesan', 'Tidak ada shift tertutup di periode ini: kewajiban Rp 0. Uang yang diterima tanpa kewajiban akan tercatat sebagai kelebihan.'));
  end if;
  return v_out;
end $$;
revoke all on function public.setoran_peringatan(uuid, uuid) from public, anon, authenticated, service_role;

-- Validasi berkas bukti (jalur tulis): awalan setoran/<cabang setoran>/<nama>, ada di storage, tidak dobel, belum dipakai baris lain.
create function public.setoran_lampiran_cek(p_lampiran jsonb, p_branch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pre text := 'setoran/' || p_branch::text || '/'; v_n integer; v_d integer;
begin
  if p_lampiran is null or jsonb_typeof(p_lampiran) <> 'array' then
    raise exception 'SETORAN_LAMPIRAN: lampiran tidak valid.' using errcode = '22023'; end if;
  if jsonb_array_length(p_lampiran) = 0 then return; end if;
  select count(*), count(distinct x.path) into v_n, v_d from jsonb_to_recordset(p_lampiran) as x(path text);
  if v_n <> v_d then raise exception 'SETORAN_LAMPIRAN_GANDA: berkas bukti yang sama dipilih dua kali.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lampiran) as x(path text)
              where x.path is null or length(x.path) <= length(v_pre) or left(x.path, length(v_pre)) <> v_pre or position('/' in substr(x.path, length(v_pre) + 1)) > 0) then
    raise exception 'SETORAN_LAMPIRAN_PATH: berkas bukti harus diunggah lewat layar setoran cabang ini (folder setoran/<cabang>/).' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lampiran) as x(path text)
              where not exists (select 1 from storage.objects o where o.bucket_id = 'dokumen' and o.name = x.path)) then
    raise exception 'SETORAN_LAMPIRAN_TIDAK_ADA: berkas bukti belum terunggah; unggah ulang fotonya.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lampiran) as x(path text) join public.setoran_lampiran_pakai u on u.path = x.path) then
    raise exception 'SETORAN_LAMPIRAN_PAKAI: berkas bukti ini sudah dipakai di baris lain; unggah foto bukti yang baru untuk baris ini.' using errcode = '22023'; end if;
end $$;
revoke all on function public.setoran_lampiran_cek(jsonb, uuid) from public, anon, authenticated, service_role;

create function public.setoran_lampiran_klaim(p_setoran uuid, p_jenis text, p_baris uuid, p_lampiran jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p text;
begin
  for v_p in select x.path from jsonb_to_recordset(coalesce(p_lampiran, '[]'::jsonb)) as x(path text) loop
    begin
      insert into public.setoran_lampiran_pakai(path, setoran_id, jenis, baris_id, dipakai_oleh) values (v_p, p_setoran, p_jenis, p_baris, auth.uid());
    exception when unique_violation then
      raise exception 'SETORAN_LAMPIRAN_PAKAI: berkas bukti ini sudah dipakai di baris lain; unggah foto bukti yang baru untuk baris ini.' using errcode = '22023';
    end;
  end loop;
end $$;
revoke all on function public.setoran_lampiran_klaim(uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;

-- Fungsi kebijakan storage (dipanggil sebagai pengguna, jadi harus dapat dieksekusi authenticated).
create function public.setoran_berkas_cabang(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^setoran/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' then split_part(p_name, '/', 2)::uuid end
$$;
revoke all on function public.setoran_berkas_cabang(text) from public, anon, service_role;
grant execute on function public.setoran_berkas_cabang(text) to authenticated;

-- Boleh membaca/mengunggah berkas setoran/<cabang>/...: peran setoran aktif (bukan Dokter/Admin Online) dengan akses ke cabang di path.
create function public.setoran_berkas_boleh(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_b uuid := public.setoran_berkas_cabang(p_name);
begin
  if v_b is null or public.setoran_role() is null then return false; end if;
  return public.user_can_access_branch(v_b);
end $$;
revoke all on function public.setoran_berkas_boleh(text) from public, anon, service_role;
grant execute on function public.setoran_berkas_boleh(text) to authenticated;
comment on function public.setoran_berkas_boleh(text) is 'Kebijakan storage setoran/: peran setoran + akses cabang di path.';

-- Boleh menghapus: hanya berkas yatim (belum diklaim baris mana pun), oleh pengunggah atau Owner, dan tetap harus boleh membaca.
create function public.setoran_berkas_boleh_hapus(p_name text, p_owner text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.setoran_berkas_boleh(p_name) then return false; end if;
  if exists (select 1 from public.setoran_lampiran_pakai u where u.path = p_name) then return false; end if;
  return public.setoran_role() = 'OWNER' or (p_owner is not null and p_owner = auth.uid()::text);
end $$;
revoke all on function public.setoran_berkas_boleh_hapus(text, text) from public, anon, service_role;
grant execute on function public.setoran_berkas_boleh_hapus(text, text) to authenticated;
comment on function public.setoran_berkas_boleh_hapus(text, text) is 'Kebijakan storage setoran/: hapus hanya berkas yatim, oleh pengunggah atau Owner.';

-- ───────────────────────── 3. Fungsi setoran yang diperketat (create or replace; ACL dinyatakan ulang) ─────────────────────────

create or replace function public.setoran_tambah_pengeluaran(p_id uuid, p_tanggal date, p_kategori text, p_jumlah numeric, p_deskripsi text, p_lampiran jsonb, p_revision integer, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_line uuid := gen_random_uuid(); v_desk text := nullif(btrim(coalesce(p_deskripsi, '')), '');
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'tanggal', p_tanggal, 'kategori', p_kategori, 'jumlah', p_jumlah, 'deskripsi', v_desk, 'lampiran', p_lampiran, 'revision', p_revision);
  v_prior := public.setoran_ulang(p_request_key, 'tambah_pengeluaran', v_payload);
  if v_prior is not null then return v_prior; end if;
  if p_kategori is null or public.expense_account_code(p_kategori) is null then
    raise exception 'SETORAN_KATEGORI: kategori pengeluaran tidak dikenal.' using errcode = '22023'; end if;
  if p_jumlah is null or p_jumlah <= 0 or p_jumlah > 1000000000000 or p_jumlah <> round(p_jumlah, 2) then
    raise exception 'SETORAN_JUMLAH: jumlah pengeluaran harus lebih dari 0 (maksimal 2 angka di belakang koma).' using errcode = '22023'; end if;
  if v_desk is not null and length(v_desk) > 300 then raise exception 'SETORAN_CATATAN: deskripsi maksimal 300 huruf.' using errcode = '22023'; end if;
  if p_lampiran is null or not public.setoran_lampiran_valid(p_lampiran, 1) then
    raise exception 'SETORAN_LAMPIRAN: lampiran bukti pengeluaran wajib diisi.' using errcode = '22023'; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak') then raise exception 'SETORAN_STATUS: setoran % tidak dapat diubah.', v_s.status using errcode = '22023'; end if;
  if v_s.revision is distinct from p_revision then raise exception 'SETORAN_BERUBAH: setoran sudah berubah; muat ulang.' using errcode = '22023'; end if;
  if p_tanggal is null or p_tanggal < v_s.periode_mulai or p_tanggal > v_today then
    raise exception 'SETORAN_TANGGAL: tanggal pengeluaran harus antara awal periode (%) dan hari ini.', v_s.periode_mulai using errcode = '22023'; end if;
  if v_today - p_tanggal > 31 then
    raise exception 'SETORAN_TANGGAL: tanggal pengeluaran paling lama 31 hari ke belakang (aturan tanggal mundur pengeluaran).' using errcode = '22023'; end if;
  if (select count(*) from public.setoran_pengeluaran where setoran_id = p_id) >= 50 then
    raise exception 'SETORAN_BATAS: maksimal 50 pengeluaran per setoran.' using errcode = '22023'; end if;
  perform public.setoran_lampiran_cek(p_lampiran, v_s.branch_id);   -- REKAP-SETORAN-FIX M5: awalan setoran/<cabang>/, ada di storage, belum dipakai
  insert into public.setoran_pengeluaran(id, setoran_id, tanggal, kategori, deskripsi, jumlah, lampiran, entered_by, request_key)
  values (v_line, p_id, p_tanggal, p_kategori, v_desk, p_jumlah, p_lampiran, auth.uid(), p_request_key);
  perform public.setoran_lampiran_klaim(p_id, 'pengeluaran', v_line, p_lampiran);
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'pengeluaran_ditambah', v_s.status, v_s.status, left(p_kategori, 60),
    jsonb_build_object('baris', v_line, 'jumlah', p_jumlah, 'tanggal', p_tanggal, 'kategori', p_kategori, 'lampiran', p_lampiran));
  v_hasil := jsonb_build_object('id', p_id, 'baris_id', v_line, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'tambah_pengeluaran', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_tambah_pengeluaran(uuid, date, text, numeric, text, jsonb, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_tambah_pengeluaran(uuid, date, text, numeric, text, jsonb, integer, uuid) to authenticated;

create or replace function public.setoran_hapus_pengeluaran(p_id uuid, p_baris uuid, p_revision integer, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_row public.setoran_pengeluaran%rowtype;
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'baris', p_baris, 'revision', p_revision);
  v_prior := public.setoran_ulang(p_request_key, 'hapus_pengeluaran', v_payload);
  if v_prior is not null then return v_prior; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak') then raise exception 'SETORAN_STATUS: setoran % tidak dapat diubah.', v_s.status using errcode = '22023'; end if;
  if v_s.revision is distinct from p_revision then raise exception 'SETORAN_BERUBAH: setoran sudah berubah; muat ulang.' using errcode = '22023'; end if;
  select * into v_row from public.setoran_pengeluaran where id = p_baris and setoran_id = p_id;
  if not found then raise exception 'SETORAN_TIDAK_ADA: baris pengeluaran tidak ditemukan.' using errcode = '22023'; end if;
  delete from public.setoran_pengeluaran where id = p_baris;
  delete from public.setoran_lampiran_pakai where baris_id = p_baris;   -- REKAP-SETORAN-FIX: berkas dilepas hanya saat Draft/Ditolak
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'pengeluaran_dihapus', v_s.status, v_s.status, null,
    jsonb_build_object('baris', p_baris, 'jumlah', v_row.jumlah, 'tanggal', v_row.tanggal, 'kategori', v_row.kategori, 'lampiran', v_row.lampiran));
  v_hasil := jsonb_build_object('id', p_id, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'hapus_pengeluaran', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_hapus_pengeluaran(uuid, uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_hapus_pengeluaran(uuid, uuid, integer, uuid) to authenticated;

create or replace function public.setoran_tambah_transfer(p_id uuid, p_tanggal date, p_jumlah numeric, p_metode text, p_rekening uuid, p_lampiran jsonb, p_catatan text, p_revision integer, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_tr uuid := gen_random_uuid(); v_cat text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_today date := (now() at time zone 'Asia/Jakarta')::date; v_lamp jsonb := coalesce(p_lampiran, '[]'::jsonb);
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'tanggal', p_tanggal, 'jumlah', p_jumlah, 'metode', p_metode, 'rekening', p_rekening, 'lampiran', v_lamp, 'catatan', v_cat, 'revision', p_revision);
  v_prior := public.setoran_ulang(p_request_key, 'tambah_transfer', v_payload);
  if v_prior is not null then return v_prior; end if;
  if p_metode is null or p_metode not in ('Transfer','Serah tunai') then raise exception 'SETORAN_METODE: pilih Transfer atau Serah tunai.' using errcode = '22023'; end if;
  if p_jumlah is null or p_jumlah <= 0 or p_jumlah > 1000000000000 or p_jumlah <> round(p_jumlah, 2) then
    raise exception 'SETORAN_JUMLAH: jumlah harus lebih dari 0 (maksimal 2 angka di belakang koma).' using errcode = '22023'; end if;
  if v_cat is not null and length(v_cat) > 300 then raise exception 'SETORAN_CATATAN: catatan maksimal 300 huruf.' using errcode = '22023'; end if;
  if not public.setoran_lampiran_valid(v_lamp, case when p_metode = 'Transfer' then 1 else 0 end) then
    raise exception 'SETORAN_LAMPIRAN: foto bukti transfer wajib diisi untuk metode Transfer.' using errcode = '22023'; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak') then raise exception 'SETORAN_STATUS: setoran % tidak dapat diubah.', v_s.status using errcode = '22023'; end if;
  if v_s.revision is distinct from p_revision then raise exception 'SETORAN_BERUBAH: setoran sudah berubah; muat ulang.' using errcode = '22023'; end if;
  if p_tanggal is null or p_tanggal < v_s.periode_mulai or p_tanggal > v_today then
    raise exception 'SETORAN_TANGGAL: tanggal transfer harus antara awal periode (%) dan hari ini.', v_s.periode_mulai using errcode = '22023'; end if;
  perform public.setoran_akun_valid(p_rekening, v_s.branch_id, p_metode);
  if (select count(*) from public.setoran_transfer where setoran_id = p_id) >= 50 then
    raise exception 'SETORAN_BATAS: maksimal 50 transfer per setoran.' using errcode = '22023'; end if;
  perform public.setoran_lampiran_cek(v_lamp, v_s.branch_id);   -- REKAP-SETORAN-FIX M5
  insert into public.setoran_transfer(id, setoran_id, tanggal, jumlah, metode, cash_account_id, lampiran, catatan, entered_by, request_key)
  values (v_tr, p_id, p_tanggal, p_jumlah, p_metode, p_rekening, v_lamp, v_cat, auth.uid(), p_request_key);
  perform public.setoran_lampiran_klaim(p_id, 'transfer', v_tr, v_lamp);
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'transfer_dicatat', v_s.status, v_s.status, null,
    jsonb_build_object('transfer', v_tr, 'jumlah', p_jumlah, 'metode', p_metode, 'tanggal', p_tanggal, 'rekening', p_rekening, 'lampiran', v_lamp));
  v_hasil := jsonb_build_object('id', p_id, 'transfer_id', v_tr, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'tambah_transfer', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_tambah_transfer(uuid, date, numeric, text, uuid, jsonb, text, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_tambah_transfer(uuid, date, numeric, text, uuid, jsonb, text, integer, uuid) to authenticated;

create or replace function public.setoran_hapus_transfer(p_id uuid, p_transfer uuid, p_revision integer, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_t public.setoran_transfer%rowtype;
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'transfer', p_transfer, 'revision', p_revision);
  v_prior := public.setoran_ulang(p_request_key, 'hapus_transfer', v_payload);
  if v_prior is not null then return v_prior; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak') then raise exception 'SETORAN_STATUS: setoran % tidak dapat diubah.', v_s.status using errcode = '22023'; end if;
  if v_s.revision is distinct from p_revision then raise exception 'SETORAN_BERUBAH: setoran sudah berubah; muat ulang.' using errcode = '22023'; end if;
  select * into v_t from public.setoran_transfer where id = p_transfer and setoran_id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: transfer tidak ditemukan.' using errcode = '22023'; end if;
  if v_t.status <> 'Menunggu' then raise exception 'SETORAN_TRANSFER_STATUS: transfer yang sudah diputuskan Finance tidak dapat dihapus.' using errcode = '22023'; end if;
  delete from public.setoran_transfer where id = p_transfer;
  delete from public.setoran_lampiran_pakai where baris_id = p_transfer;   -- REKAP-SETORAN-FIX: berkas dilepas hanya saat Draft/Ditolak
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'transfer_dihapus', v_s.status, v_s.status, null,
    jsonb_build_object('transfer', p_transfer, 'jumlah', v_t.jumlah, 'metode', v_t.metode, 'tanggal', v_t.tanggal, 'lampiran', v_t.lampiran));
  v_hasil := jsonb_build_object('id', p_id, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'hapus_transfer', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_hapus_transfer(uuid, uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_hapus_transfer(uuid, uuid, integer, uuid) to authenticated;

create or replace function public.setoran_setujui(p_id uuid, p_request_key uuid, p_penjelasan text, p_alokasi jsonb, p_beban_perusahaan boolean, p_konfirmasi_besar boolean, p_catatan text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_uid uuid := auth.uid(); v_s public.setoran%rowtype; v_k public.setoran_keuangan%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_h jsonb;
  v_pen text := nullif(btrim(coalesce(p_penjelasan, '')), ''); v_cat text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_today date := (now() at time zone 'Asia/Jakarta')::date; v_exp numeric; v_diff numeric; v_abs numeric; v_cash text; v_line record; v_res jsonb; v_tr numeric;
  v_exp_ids uuid[] := '{}'; v_emp uuid[]; v_n integer; v_cents bigint; v_base bigint; v_rem bigint; v_i integer := 0; v_alloc jsonb := '[]'; v_a record;
  v_adv uuid; v_sum numeric; v_jid uuid; v_jl jsonb; v_mode text; v_adv_ids uuid[] := '{}'; v_desc text; v_selesai text; v_konflik text[]; v_raw numeric;
begin
  perform admin_online_private.deny_admin_online();
  if not public.setoran_penyetuju() then
    raise exception 'SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menyetujui setoran.' using errcode = '42501'; end if;
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'penjelasan', v_pen, 'alokasi', p_alokasi, 'beban', coalesce(p_beban_perusahaan, false), 'besar', coalesce(p_konfirmasi_besar, false), 'catatan', v_cat);
  v_prior := public.setoran_ulang(p_request_key, 'setujui', v_payload);
  if v_prior is not null then return v_prior; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status <> 'Diajukan' then raise exception 'SETORAN_STATUS: setoran sudah diputuskan (%).', v_s.status using errcode = '22023'; end if;
  if v_uid in (v_s.created_by, v_s.submitted_by) then
    raise exception 'SETORAN_PEMISAHAN_TUGAS: Anda ikut membuat atau mengajukan setoran ini, jadi tidak boleh menyetujuinya sendiri.' using errcode = '42501'; end if;
  -- REKAP-SETORAN-FIX M4: penyetuju juga bukan orang yang menginput pengeluaran/transfer atau memegang shift yang masuk hitungan.
  v_konflik := public.setoran_konflik_tugas(p_id, v_uid);
  if cardinality(v_konflik) > 0 then
    raise exception 'SETORAN_PEMISAHAN_TUGAS: Anda tidak boleh menyetujui setoran ini karena Anda %. Minta Owner/Finance/Admin lain yang menyetujui.', array_to_string(v_konflik, '; ') using errcode = '42501';
  end if;
  if v_pen is not null and length(v_pen) > 500 then raise exception 'SETORAN_CATATAN: penjelasan maksimal 500 huruf.' using errcode = '22023'; end if;
  if v_cat is not null and length(v_cat) > 500 then raise exception 'SETORAN_CATATAN: catatan maksimal 500 huruf.' using errcode = '22023'; end if;
  perform public.setoran_periode_terbuka(v_s.periode_selesai);
  select * into v_k from public.setoran_keuangan where setoran_id = p_id for update;
  if not found then raise exception 'SETORAN_BERUBAH: data keuangan setoran tidak ada; tolak ke Draft lalu ajukan ulang.' using errcode = '22023'; end if;
  if exists (select 1 from public.setoran_transfer where setoran_id = p_id and status = 'Menunggu') then
    raise exception 'SETORAN_TRANSFER_MENUNGGU: masih ada transfer yang belum dikonfirmasi atau ditolak; putuskan dulu.' using errcode = '22023'; end if;
  if coalesce(cardinality(public.setoran_shift_layak(p_id)), 0) > 0 and exists (select 1 from unnest(public.setoran_shift_layak(p_id)) x where not exists (select 1 from public.setoran_shift ss where ss.setoran_id = p_id and ss.shift_id = x and ss.aktif)) then
    raise exception 'SETORAN_SHIFT_BARU: ada shift tertutup baru di periode ini yang belum masuk setoran; tolak ke Draft lalu muat ulang.' using errcode = '22023'; end if;
  v_h := public.setoran_hitung(p_id);
  v_exp := (v_h ->> 'expected')::numeric;
  if v_exp is distinct from v_k.expected_amount or (v_h ->> 'shift_net')::numeric is distinct from v_k.shift_net
     or (v_h ->> 'pengeluaran_total')::numeric is distinct from v_k.pengeluaran_total then
    raise exception 'SETORAN_BERUBAH: angka shift berubah sejak diajukan; tolak ke Draft lalu ajukan ulang.' using errcode = '22023'; end if;
  select coalesce(sum(jumlah), 0) into v_tr from public.setoran_transfer where setoran_id = p_id and status = 'Dikonfirmasi';
  -- REKAP-SETORAN-FIX M2: pengeluaran lebih besar dari kewajiban BUKAN kelebihan kas. Diblok untuk keputusan Finance; lantai nol untuk penyelesaian.
  v_raw := v_exp;
  if v_raw < 0 then
    raise exception 'SETORAN_PENGELUARAN_MELEBIHI: pengeluaran dari dana setoran (Rp %) lebih besar dari kewajiban setoran (Rp %), kelebihannya Rp %. Ini bukan kelebihan kas dan tidak dibukukan sebagai pendapatan. Tolak setoran supaya baris pengeluaran diperiksa (sudah tercatat di Kasir Pengeluaran, salah periode, atau salah ketik), atau Owner/Finance memutuskan perlakuannya di luar setoran.',
      v_k.pengeluaran_total, v_k.shift_net, -v_raw using errcode = '22023';
  end if;
  v_exp := greatest(v_exp, 0);
  v_diff := v_tr - v_exp; v_abs := abs(v_diff);
  if v_abs > 5000000 and not coalesce(p_konfirmasi_besar, false) then
    raise exception 'SETORAN_SELISIH_BESAR: selisih lebih dari Rp 5.000.000; periksa kemungkinan salah ketik, lalu setujui dengan konfirmasi.' using errcode = '22023'; end if;
  if v_diff >= 0 and (p_alokasi is not null or coalesce(p_beban_perusahaan, false)) then
    raise exception 'SETORAN_ALOKASI: alokasi karyawan / beban perusahaan hanya untuk selisih kurang.' using errcode = '22023'; end if;
  v_cash := public.unit_posting_cash('Tunai', v_s.branch_id);

  -- 1) Pengeluaran dari dana setoran -> post_expense_atomic (backoffice, tunai, tanggal barisnya); tepat satu kali per baris.
  if exists (select 1 from public.setoran_pengeluaran where setoran_id = p_id and v_today - tanggal > 31) then
    raise exception 'SETORAN_KEDALUWARSA: ada pengeluaran bertanggal lebih dari 31 hari lalu; aturan tanggal mundur pengeluaran menolaknya. Tolak ke Draft atau hubungi Owner untuk jurnal manual.' using errcode = '22023'; end if;
  for v_line in select * from public.setoran_pengeluaran where setoran_id = p_id order by tanggal, created_at, id loop
    v_res := public.post_expense_atomic('setoran:' || v_line.id::text, 'backoffice', v_s.branch_id,
      jsonb_strip_nulls(jsonb_build_object('tanggal', v_line.tanggal::text, 'kategori', v_line.kategori,
        'deskripsi', 'Setoran ' || v_s.no_setoran || coalesce(': ' || v_line.deskripsi, ''), 'jumlah', v_line.jumlah, 'metode_bayar', 'Tunai',
        'alasan_tanggal', case when v_line.tanggal < v_today then 'Pengeluaran dari dana setoran ' || v_s.no_setoran || ' tanggal ' || v_line.tanggal::text end)),
      v_line.lampiran);
    update public.setoran_pengeluaran set expense_id = (v_res ->> 'expense_id')::uuid, journal_id = (v_res ->> 'journal_id')::uuid where id = v_line.id;
    v_exp_ids := v_exp_ids || (v_res ->> 'expense_id')::uuid;
  end loop;

  -- 2) Penyelesaian selisih (hanya selisih yang BELUM dibukukan: kewajiban memakai closing_balance sesudah selisih tutup shift)
  v_selesai := 'Pas'; v_jid := null;
  if v_diff < 0 then
    if coalesce(p_beban_perusahaan, false) then
      if v_cat is null or length(v_cat) < 3 then
        raise exception 'SETORAN_ALASAN: beban perusahaan tanpa kasbon wajib diberi catatan alasan (minimal 3 huruf).' using errcode = '22023'; end if;
      v_selesai := 'BebanPerusahaan';
      v_jl := jsonb_build_array(jsonb_build_object('code', '760002', 'debit', v_abs, 'credit', 0), jsonb_build_object('code', v_cash, 'debit', 0, 'credit', v_abs));
      v_desc := 'Selisih kurang setoran ' || v_s.no_setoran || ' — beban perusahaan';
    else
      v_selesai := 'Kasbon';
      if p_alokasi is not null then
        v_mode := 'manual';
        if jsonb_typeof(p_alokasi) <> 'array' or jsonb_array_length(p_alokasi) not between 1 and 10
           or exists (select 1 from jsonb_array_elements(p_alokasi) e where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'jumlah') <> 'number'
                      or coalesce(e ->> 'employee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
          raise exception 'SETORAN_ALOKASI: pilih 1 sampai 10 karyawan dan isi jumlah tiap orang.' using errcode = '22023'; end if;
        select count(*), count(distinct x.employee_id), sum(x.jumlah) into v_n, v_i, v_sum from jsonb_to_recordset(p_alokasi) x(employee_id uuid, jumlah numeric);
        if v_n <> v_i then raise exception 'SETORAN_ALOKASI: satu karyawan hanya boleh dipilih sekali.' using errcode = '22023'; end if;
        if exists (select 1 from jsonb_to_recordset(p_alokasi) x(employee_id uuid, jumlah numeric) where x.jumlah <= 0 or x.jumlah <> round(x.jumlah, 2)) then
          raise exception 'SETORAN_ALOKASI: jumlah tiap karyawan harus lebih dari 0 (maksimal 2 angka di belakang koma).' using errcode = '22023'; end if;
        if v_sum <> v_abs then
          raise exception 'SETORAN_ALOKASI: jumlah pembagian harus sama dengan selisih kurang.' using errcode = '22023'; end if;
        perform 1 from public.employees e where e.id in (select x.employee_id from jsonb_to_recordset(p_alokasi) x(employee_id uuid, jumlah numeric)) order by e.id for share;
        if (select count(*) from public.employees e where e.id in (select x.employee_id from jsonb_to_recordset(p_alokasi) x(employee_id uuid, jumlah numeric))
              and e.status = 'Aktif' and e.trashed_at is null) <> v_n then
          raise exception 'SETORAN_ALOKASI: karyawan yang dipilih tidak ditemukan atau sudah tidak aktif.' using errcode = '22023'; end if;
        v_alloc := (select jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'jumlah', x.jumlah) order by x.employee_id) from jsonb_to_recordset(p_alokasi) x(employee_id uuid, jumlah numeric));
      else
        v_mode := 'otomatis';
        v_emp := public.setoran_penanggung(p_id);
        if cardinality(v_emp) = 0 then
          raise exception 'SETORAN_PENANGGUNG: kasir shift belum tertaut ke data karyawan aktif. Pilih karyawan penanggung jawab atau pilih beban perusahaan dengan alasan.' using errcode = '22023'; end if;
        perform 1 from public.employees e where e.id = any (v_emp) order by e.id for share;
        v_cents := round(v_abs * 100)::bigint; v_base := v_cents / cardinality(v_emp); v_rem := v_cents % cardinality(v_emp);
        for v_i in 1..cardinality(v_emp) loop
          v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('employee_id', v_emp[v_i],
            'jumlah', (v_base + case when v_i <= v_rem then 1 else 0 end)::numeric / 100));
        end loop;
      end if;
      for v_a in select x.employee_id, x.jumlah from jsonb_to_recordset(v_alloc) x(employee_id uuid, jumlah numeric) order by x.employee_id loop
        v_adv := gen_random_uuid();
        insert into public.cash_advances(id, employee_id, tanggal, jumlah, tenor_bulan, status, alasan, approved_by, approved_at, disbursed_at)
        values (v_adv, v_a.employee_id, v_s.periode_selesai, v_a.jumlah, 1, 'Dicatat',
                left('Selisih kurang setoran ' || v_s.no_setoran || ' (periode ' || v_s.periode_mulai::text || ' s/d ' || v_s.periode_selesai::text || ')', 500), v_uid, now(), now());
        insert into public.setoran_kasbon(setoran_id, employee_id, jumlah, advance_id, mode) values (p_id, v_a.employee_id, v_a.jumlah, v_adv, v_mode);
        v_adv_ids := v_adv_ids || v_adv;
      end loop;
      v_jl := jsonb_build_array(jsonb_build_object('code', '182001', 'debit', v_abs, 'credit', 0), jsonb_build_object('code', v_cash, 'debit', 0, 'credit', v_abs));
      v_desc := 'Selisih kurang setoran ' || v_s.no_setoran || ' — kasbon karyawan';
    end if;
  elsif v_diff > 0 then
    v_selesai := 'PendapatanLain';
    v_jl := jsonb_build_array(jsonb_build_object('code', v_cash, 'debit', v_abs, 'credit', 0), jsonb_build_object('code', '810004', 'debit', 0, 'credit', v_abs));
    v_desc := 'Kelebihan kas setoran ' || v_s.no_setoran;
  end if;
  if v_selesai <> 'Pas' then
    perform public.setoran_tulis_jurnal(v_s.periode_selesai, v_s.branch_id, 'setoran', p_id::text, v_desc, v_jl);
    select id into strict v_jid from public.journal_entries where source = 'setoran' and source_ref = p_id::text;
  end if;
  update public.setoran_keuangan set transfer_total = v_tr, selisih = v_diff, jenis = case when v_diff = 0 then 'Pas' when v_diff < 0 then 'Kurang' else 'Lebih' end,
         penjelasan_lebih = case when v_diff > 0 then v_pen else null end, penyelesaian = v_selesai, selisih_journal_id = v_jid, catatan_keuangan = v_cat
   where setoran_id = p_id;
  update public.setoran set status = 'Disetujui', decided_by = v_uid, decided_at = now(), decision_note = v_cat where id = p_id;
  perform public.setoran_log(p_id, 'disetujui', 'Diajukan', 'Disetujui', v_cat,
    jsonb_build_object('selesai', v_selesai, 'selisih', v_diff, 'jurnal', v_jid, 'pengeluaran', to_jsonb(v_exp_ids), 'kasbon', to_jsonb(v_adv_ids)));
  v_hasil := jsonb_build_object('id', p_id, 'status', 'Disetujui', 'penyelesaian', v_selesai, 'selisih', v_diff, 'journal_id', v_jid,
    'pengeluaran_ids', to_jsonb(v_exp_ids), 'kasbon_ids', to_jsonb(v_adv_ids));
  perform public.setoran_simpan_permintaan(p_request_key, 'setujui', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_setujui(uuid, uuid, text, jsonb, boolean, boolean, text) from public, anon, service_role;
grant execute on function public.setoran_setujui(uuid, uuid, text, jsonb, boolean, boolean, text) to authenticated;

create or replace function public.setoran_void(p_id uuid, p_alasan text, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_uid uuid := auth.uid(); v_s public.setoran%rowtype; v_k public.setoran_keuangan%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb;
  v_alasan text := btrim(regexp_replace(coalesce(p_alasan, ''), '\s+', ' ', 'g')); v_line record; v_rev integer; v_lines jsonb; v_rj uuid; v_adv_n integer;
begin
  perform admin_online_private.deny_admin_online();
  if public.setoran_role() is null or public.setoran_role() not in ('OWNER','FINANCE') then
    raise exception 'SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat membatalkan setoran yang sudah disetujui.' using errcode = '42501'; end if;
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'alasan', v_alasan);
  v_prior := public.setoran_ulang(p_request_key, 'void', v_payload);
  if v_prior is not null then return v_prior; end if;
  if length(v_alasan) not between 3 and 300 then raise exception 'SETORAN_ALASAN: alasan wajib 3 sampai 300 huruf.' using errcode = '22023'; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status <> 'Disetujui' then raise exception 'SETORAN_STATUS: hanya setoran Disetujui yang dapat dibatalkan (status sekarang %).', v_s.status using errcode = '22023'; end if;
  perform public.setoran_periode_terbuka(v_s.periode_selesai);
  select * into v_k from public.setoran_keuangan where setoran_id = p_id for update;
  perform 1 from public.cash_advances where id in (select advance_id from public.setoran_kasbon where setoran_id = p_id) order by id for update;
  select count(*) into v_adv_n from public.setoran_kasbon k join public.cash_advances ca on ca.id = k.advance_id where k.setoran_id = p_id and ca.status = 'Dicatat'
     and not exists (select 1 from public.cash_advance_installments i where i.advance_id = ca.id);
  if v_adv_n <> (select count(*) from public.setoran_kasbon where setoran_id = p_id) then
    raise exception 'SETORAN_KASBON_BERUBAH: kasbon karyawan dari setoran ini sudah diproses (bukan lagi Dicatat); selesaikan kasbonnya dulu.' using errcode = '22023'; end if;
  for v_line in select * from public.setoran_pengeluaran where setoran_id = p_id and expense_id is not null order by tanggal, created_at, id loop
    select revision into v_rev from public.expenses where id = v_line.expense_id for update;
    perform public.revise_expense_atomic('setoran-void:' || v_line.id::text, v_line.expense_id, v_rev, 'void', null, 'Setoran ' || v_s.no_setoran || ' dibatalkan: ' || v_alasan);
  end loop;
  if v_k.selisih_journal_id is not null then
    select jsonb_agg(jsonb_build_object('code', a.code, 'debit', l.credit, 'credit', l.debit)) into v_lines
      from public.journal_lines l join public.coa_accounts a on a.id = l.account_id where l.entry_id = v_k.selisih_journal_id;
    perform public.setoran_tulis_jurnal(v_s.periode_selesai, v_s.branch_id, 'setoran-batal', p_id::text, 'Pembalik setoran ' || v_s.no_setoran || ': ' || v_alasan, v_lines);   -- REKAP-SETORAN-FIX B1
    select id into strict v_rj from public.journal_entries where source = 'setoran-batal' and source_ref = p_id::text;
    update public.setoran_keuangan set reversal_journal_id = v_rj where setoran_id = p_id;
  end if;
  update public.cash_advances set status = 'Batal', catatan_penyetuju = left('Setoran ' || v_s.no_setoran || ' dibatalkan: ' || v_alasan, 300)
   where id in (select advance_id from public.setoran_kasbon where setoran_id = p_id);
  update public.setoran set status = 'Void', void_by = v_uid, void_at = now(), void_reason = v_alasan where id = p_id;
  update public.setoran_shift set aktif = false where setoran_id = p_id and aktif;
  perform public.setoran_log(p_id, 'void', 'Disetujui', 'Void', v_alasan, jsonb_build_object('pembalik', v_rj));
  v_hasil := jsonb_build_object('id', p_id, 'status', 'Void', 'reversal_journal_id', v_rj);
  perform public.setoran_simpan_permintaan(p_request_key, 'void', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_void(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.setoran_void(uuid, text, uuid) to authenticated;

create or replace function public.setoran_daftar(p_dari date, p_sampai date, p_branch uuid, p_status text, p_kasir uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_app boolean; v_rows jsonb;
begin
  perform admin_online_private.deny_admin_online();
  if public.setoran_role() is null then raise exception 'SETORAN_DITOLAK: akses setoran ditolak.' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('Draft','Diajukan','Disetujui','Ditolak','Void') then
    raise exception 'SETORAN_FILTER: status tidak dikenal.' using errcode = '22023'; end if;
  v_app := public.setoran_penyetuju();
  select coalesce(jsonb_agg(q.r order by q.sk desc, q.nk desc), '[]'::jsonb) into v_rows from (
    select s.periode_selesai as sk, s.no_setoran as nk,
           jsonb_build_object('id', s.id, 'no_setoran', s.no_setoran, 'branch_id', s.branch_id, 'cabang', b.name, 'periode_mulai', s.periode_mulai, 'periode_selesai', s.periode_selesai,
             'jadwal', s.jadwal, 'batas_jam', to_char(s.batas_jam, 'HH24:MI'), 'status', s.status, 'diajukan_at', s.submitted_at, 'dibuat_oleh', public.setoran_nama(s.created_by),
             'kewajiban', (a.v ->> 'kewajiban')::numeric, 'pengeluaran', (a.v ->> 'pengeluaran')::numeric, 'transfer', (a.v ->> 'transfer_semua')::numeric,
             'sisa', case when not v_app and s.status in ('Diajukan','Disetujui','Void') then 0 else greatest((a.v ->> 'sisa')::numeric, 0) end, 'transfer_menunggu', (a.v ->> 'transfer_menunggu')::integer,
             'umur_hari', case when s.status = 'Diajukan' then (now() at time zone 'Asia/Jakarta')::date - (s.submitted_at at time zone 'Asia/Jakarta')::date end)
           || (public.setoran_label(s.status, (a.v ->> 'sisa')::numeric, s.jadwal, s.batas_jam))
           || case when s.status = 'Ditolak' then jsonb_build_object('alasan_tolak', s.decision_note) else '{}'::jsonb end
           || case when v_app and s.status in ('Diajukan','Disetujui','Void') and k.setoran_id is not null
                   then jsonb_build_object('diharapkan', k.expected_amount, 'selisih_sementara', ((a.v ->> 'transfer_konfirmasi')::numeric - k.expected_amount),
                          'selisih', k.selisih, 'jenis', k.jenis, 'penyelesaian', k.penyelesaian, 'pengeluaran_melebihi', (k.expected_amount < 0))
                   else '{}'::jsonb end as r
      from public.setoran s join public.branches b on b.id = s.branch_id left join public.setoran_keuangan k on k.setoran_id = s.id
      cross join lateral (select public.setoran_angka(s.id) as v) a
     where public.user_can_access_branch(s.branch_id)
       and (p_dari is null or s.periode_selesai >= p_dari) and (p_sampai is null or s.periode_selesai <= p_sampai)
       and (p_branch is null or s.branch_id = p_branch) and (p_status is null or s.status = p_status)
       and (p_kasir is null or s.created_by = p_kasir or s.submitted_by = p_kasir
            or exists (select 1 from public.setoran_transfer tr where tr.setoran_id = s.id and tr.entered_by = p_kasir)
            or exists (select 1 from public.setoran_shift ss join public.cashier_shifts cs on cs.id = ss.shift_id where ss.setoran_id = s.id and cs.opened_by = p_kasir))
     order by s.periode_selesai desc, s.no_setoran desc limit 500) q;
  return jsonb_build_object('penyetuju', v_app, 'baris', v_rows);
end $$;
revoke all on function public.setoran_daftar(date, date, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.setoran_daftar(date, date, uuid, text, uuid) to authenticated;

create or replace function public.setoran_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.setoran%rowtype; v_k public.setoran_keuangan%rowtype; v_app boolean; v_out jsonb; v_a jsonb; v_kew numeric; v_peng numeric; v_tr numeric; v_sisa numeric; v_label jsonb;
  v_ids uuid[]; v_baru integer;
begin
  perform admin_online_private.deny_admin_online();
  if public.setoran_role() is null then raise exception 'SETORAN_DITOLAK: akses setoran ditolak.' using errcode = '42501'; end if;
  select * into v_s from public.setoran where id = p_id;
  if not found or not public.user_can_access_branch(v_s.branch_id) then
    raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan atau tidak dapat diakses.' using errcode = '22023'; end if;
  v_app := public.setoran_penyetuju();
  v_a := public.setoran_angka(p_id);
  v_kew := (v_a ->> 'kewajiban')::numeric; v_peng := (v_a ->> 'pengeluaran')::numeric; v_tr := (v_a ->> 'transfer_semua')::numeric; v_sisa := (v_a ->> 'sisa')::numeric;
  v_label := public.setoran_label(v_s.status, v_sisa, v_s.jadwal, v_s.batas_jam);
  select array_agg(shift_id) into v_ids from public.setoran_shift where setoran_id = p_id and aktif;
  v_baru := case when v_s.status in ('Draft','Ditolak') then (select count(*) from unnest(public.setoran_shift_layak(p_id)) x
                   where not exists (select 1 from public.setoran_shift ss where ss.setoran_id = p_id and ss.shift_id = x and ss.aktif)) else 0 end;
  v_out := jsonb_build_object(
    'id', v_s.id, 'no_setoran', v_s.no_setoran, 'branch_id', v_s.branch_id, 'cabang', (select name from public.branches where id = v_s.branch_id),
    'periode_mulai', v_s.periode_mulai, 'periode_selesai', v_s.periode_selesai, 'jadwal', v_s.jadwal, 'batas_jam', to_char(v_s.batas_jam, 'HH24:MI'),
    'status', v_s.status, 'revision', v_s.revision, 'penyetuju', v_app, 'catatan', v_s.catatan,
    'kewajiban', v_kew, 'pengeluaran', v_peng, 'transfer', v_tr,
    -- Staf tidak boleh melihat kelebihan: sisa dipatok >= 0 dan persen paling tinggi 100.
    -- REKAP-SETORAN-FIX M1: staf yang sudah mengajukan / setoran disetujui / dibatalkan melihat sisa 0 dan 100% (kekurangan nyata hanya untuk penyetuju).
    'sisa', case when (not v_app and v_s.status in ('Diajukan','Disetujui','Void')) then 0 else greatest(v_sisa, 0) end,
    'persen', case when (not v_app and v_s.status in ('Diajukan','Disetujui','Void')) or v_kew - v_peng <= 0 then 100 else least(100, floor(((v_peng + v_tr) / v_kew) * 100)) end,
    'harian', v_a -> 'harian', 'shift_baru', v_baru,
    'dibuat_oleh', public.setoran_nama(v_s.created_by), 'diajukan_oleh', case when v_s.submitted_by is null then null else public.setoran_nama(v_s.submitted_by) end, 'diajukan_at', v_s.submitted_at,
    'alasan_tolak', case when v_s.status = 'Ditolak' then v_s.decision_note end,
    'shift', coalesce((select jsonb_agg(jsonb_build_object('shift_id', s.id, 'jenis', s.shift_type, 'kasir', coalesce(e.nama, pr.full_name, 'Kasir'), 'dibuka', s.opened_at, 'ditutup', s.closed_at,
                   'pengeluaran_tunai_shift', coalesce((select sum(x.jumlah) from public.expenses x where x.shift_id = s.id and x.metode_bayar = 'Tunai' and x.voided_at is null), 0)) order by s.closed_at, s.id)
                 from public.cashier_shifts s left join public.employees e on e.id = s.employee_id left join public.profiles pr on pr.id = s.opened_by
                where s.id = any (coalesce(v_ids, '{}'))), '[]'::jsonb),
    'pengeluaran_shift', coalesce((select jsonb_agg(jsonb_build_object('shift_id', x.shift_id, 'kategori', x.kategori, 'deskripsi', x.deskripsi, 'jumlah', x.jumlah) order by x.created_at, x.id)
                from public.expenses x where x.shift_id = any (coalesce(v_ids, '{}')) and x.metode_bayar = 'Tunai' and x.voided_at is null), '[]'::jsonb),
    'pengeluaran_baris', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'tanggal', p.tanggal, 'kategori', p.kategori, 'deskripsi', p.deskripsi, 'jumlah', p.jumlah, 'lampiran', p.lampiran,
                   'dimasukkan_oleh', public.setoran_nama(p.entered_by), 'expense_id', p.expense_id) order by p.tanggal, p.created_at, p.id)
                from public.setoran_pengeluaran p where p.setoran_id = p_id), '[]'::jsonb),
    'transfer_baris', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'tanggal', t.tanggal, 'jumlah', t.jumlah, 'metode', t.metode, 'rekening', ac.nama, 'lampiran', t.lampiran,
                   'status', t.status, 'dicatat_oleh', public.setoran_nama(t.entered_by), 'catatan', t.catatan)
                   || case when t.status = 'Ditolak' then jsonb_build_object('alasan_tolak', t.catatan_keuangan) else '{}'::jsonb end order by t.tanggal, t.created_at, t.id)
                from public.setoran_transfer t join public.cash_accounts ac on ac.id = t.cash_account_id where t.setoran_id = p_id), '[]'::jsonb),
    'riwayat', coalesce((select jsonb_agg(jsonb_build_object('jenis', ev.jenis, 'dari', ev.dari, 'ke', ev.ke, 'at', ev.at, 'oleh', public.setoran_nama(ev.actor_id))
                     || case when v_app or ev.jenis = 'ditolak' then jsonb_build_object('catatan', ev.catatan) else '{}'::jsonb end order by ev.id)
                from public.setoran_event ev where ev.setoran_id = p_id and (v_app or ev.jenis not in ('disetujui','void','transfer_dikonfirmasi','transfer_ditolak'))), '[]'::jsonb))
    || v_label;
  -- Bagian keuangan (selisih, lebih/kurang, jurnal, kasbon): HANYA penyetuju dan hanya sesudah diajukan.
  if v_app and v_s.status in ('Diajukan','Disetujui','Void') then
    select * into v_k from public.setoran_keuangan where setoran_id = p_id;
    if found then
      v_out := v_out || jsonb_build_object('keuangan', jsonb_build_object(
        'diharapkan', v_k.expected_amount, 'bersih_shift', v_k.shift_net, 'pengeluaran_setoran', v_k.pengeluaran_total,
        'transfer_dikonfirmasi', (v_a ->> 'transfer_konfirmasi')::numeric, 'transfer_menunggu', (v_a ->> 'transfer_menunggu')::integer,
        'selisih_sementara', ((v_a ->> 'transfer_konfirmasi')::numeric - v_k.expected_amount),
        'selisih', v_k.selisih, 'jenis', v_k.jenis, 'rincian_shift', v_k.rincian, 'penjelasan_lebih', v_k.penjelasan_lebih, 'penyelesaian', v_k.penyelesaian,
        'journal_id', v_k.selisih_journal_id, 'pembalik_journal_id', v_k.reversal_journal_id, 'catatan_keuangan', v_k.catatan_keuangan,
        'penanggung_otomatis', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'nama', e.nama) order by e.id) from public.employees e where e.id = any (public.setoran_penanggung(p_id))), '[]'::jsonb),
        'kasbon', coalesce((select jsonb_agg(jsonb_build_object('employee_id', kb.employee_id, 'nama', e.nama, 'jumlah', kb.jumlah, 'advance_id', kb.advance_id, 'mode', kb.mode, 'status', ca.status) order by kb.employee_id)
                   from public.setoran_kasbon kb join public.employees e on e.id = kb.employee_id left join public.cash_advances ca on ca.id = kb.advance_id where kb.setoran_id = p_id), '[]'::jsonb),
        'peringatan', public.setoran_peringatan(p_id, auth.uid())));
    end if;
  end if;
  return v_out;
end $$;
revoke all on function public.setoran_detail(uuid) from public, anon, service_role;
grant execute on function public.setoran_detail(uuid) to authenticated;

-- ───────────────────────── 4. Buku besar (ledger_account_lines / ledger_account_totals): jurnal setoran disembunyikan dari non-penyetuju ─────────────────────────

create or replace function public.ledger_account_lines(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_branch_ids uuid[] DEFAULT NULL::uuid[], p_account_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_boleh uuid[];
  v_tutup uuid[] := public.setoran_jurnal_tersembunyi();   -- REKAP-SETORAN-FIX B1
begin
  perform admin_online_private.deny_admin_online();
  -- Cabang yang boleh dilihat pemanggil: sekali per cabang, logika persis RLS je_all/jl_all.
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_boleh
  from public.branches b
  where public.user_can_access_branch(b.id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'account_id', l.account_id,
      'debit', l.debit,
      'credit', l.credit,
      'journal_entries', jsonb_build_object(
        'tanggal', e.tanggal,
        'branch_id', e.branch_id,
        'source', e.source,
        'source_ref', e.source_ref,
        'no_jurnal', e.no_jurnal,
        'deskripsi', e.deskripsi,
        'branches', case when b.id is null then null else jsonb_build_object('name', b.name) end
      )
    ) order by l.id)
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    left join public.branches b on b.id = e.branch_id
    where (e.branch_id is null or e.branch_id = any(v_boleh))
      and e.id <> all(v_tutup)
      and (p_from is null or e.tanggal >= p_from)
      and (p_to is null or e.tanggal <= p_to)
      and (p_branch_ids is null or e.branch_id = any(p_branch_ids))
      and (p_account_ids is null or l.account_id = any(p_account_ids))
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.ledger_account_totals(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_branch_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_boleh uuid[];
  v_tutup uuid[] := public.setoran_jurnal_tersembunyi();   -- REKAP-SETORAN-FIX B1
begin
  perform admin_online_private.deny_admin_online();
  -- Cabang yang boleh dilihat pemanggil: sekali per cabang, logika persis RLS je_all/jl_all.
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_boleh
  from public.branches b
  where public.user_can_access_branch(b.id);

  return coalesce((
    select jsonb_agg(jsonb_build_object('account_id', t.account_id, 'debit', t.debit, 'credit', t.credit)
                     order by t.account_id)
    from (
      select l.account_id, sum(l.debit) as debit, sum(l.credit) as credit
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id
      where (e.branch_id is null or e.branch_id = any(v_boleh))
      and e.id <> all(v_tutup)
        and (p_from is null or e.tanggal >= p_from)
        and (p_to is null or e.tanggal <= p_to)
        and (p_branch_ids is null or e.branch_id = any(p_branch_ids))
      group by l.account_id
    ) t
  ), '[]'::jsonb);
end;
$function$;


-- ───────────────────────── 5. Kebijakan RESTRICTIVE jurnal: baris setoran hanya untuk penyetuju (kebijakan umum je_all/jl_all TIDAK diubah) ─────────────────────────
-- FOR ALL: menyaring baca DAN menutup tulis klien atas baris source setoran (tidak ada jalur klien yang sah menulisnya). Fungsi SECURITY DEFINER (pemilik tabel) di luar RLS.
create policy setoran_jurnal_tertutup on public.journal_entries as restrictive for all to authenticated
  using (coalesce(source, '') not in ('setoran','setoran-batal') or (select public.setoran_jurnal_boleh()))
  with check (coalesce(source, '') not in ('setoran','setoran-batal') or (select public.setoran_jurnal_boleh()));
create policy setoran_jurnal_tertutup on public.journal_lines as restrictive for all to authenticated
  using (entry_id <> all (((select public.setoran_jurnal_tersembunyi()))::uuid[]))
  with check (entry_id <> all (((select public.setoran_jurnal_tersembunyi()))::uuid[]));

-- ───────────────────────── 6. Kebijakan RESTRICTIVE storage: bucket dokumen, awalan setoran/ (hanya bila kolom owner_id ada: Supabase asli) ─────────────────────────
do $storage$
begin
  if to_regclass('storage.objects') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    raise notice 'SETORAN_FIX: storage.objects tanpa kolom owner_id (bukan Supabase): kebijakan storage dilewati';
    return;
  end if;
  execute $p$create policy setoran_berkas_baca_ketat on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'dokumen' or name not like 'setoran/%' or public.setoran_berkas_boleh(name))$p$;
  execute $p$create policy setoran_berkas_tulis_ketat on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'dokumen' or name not like 'setoran/%' or public.setoran_berkas_boleh(name))$p$;
  execute $p$create policy setoran_berkas_hapus_ketat on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'dokumen' or name not like 'setoran/%' or public.setoran_berkas_boleh_hapus(name, coalesce(owner_id, owner::text)))$p$;
  execute $p$create policy setoran_berkas_ubah_ketat on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'dokumen' or name not like 'setoran/%') with check (bucket_id <> 'dokumen' or name not like 'setoran/%')$p$;
end $storage$;

-- ───────────────────────── 7. Shift tertutup: angka uang tidak dapat diubah lewat klien (semua tipe; klinik sudah dijaga pemicu lain) ─────────────────────────
create function public.guard_shift_tutup_uang() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if old.status = 'closed' and (
       new.status is distinct from old.status or new.closing_balance is distinct from old.closing_balance or new.expected_cash is distinct from old.expected_cash
    or new.selisih is distinct from old.selisih or new.closing_breakdown is distinct from old.closing_breakdown or new.closed_at is distinct from old.closed_at
    or new.opening_balance is distinct from old.opening_balance or new.opened_at is distinct from old.opened_at or new.opened_by is distinct from old.opened_by
    or new.branch_id is distinct from old.branch_id or new.shift_type is distinct from old.shift_type) then
    raise exception using errcode = '42501', message = 'SHIFT_TUTUP_UANG_BEKU: shift yang sudah ditutup tidak bisa dibuka kembali dan angka uangnya tidak bisa diubah (dasar kewajiban setoran).';
  end if;
  return new;
end $$;
revoke all on function public.guard_shift_tutup_uang() from public, anon, authenticated, service_role;
create trigger cashier_shift_tutup_uang_guard before update on public.cashier_shifts for each row execute function public.guard_shift_tutup_uang();

-- ───────────────────────── 8. Pagar Admin Online (jalankan ulang; tabel klaim baru diberi pagar tulis/baca; fungsi kebijakan sengaja dikecualikan guard_all) ─────────────────────────
select admin_online_private.guard_all();
select admin_online_private.fence_all();
notify pgrst, 'reload schema';

-- ───────────────────────── 9. Pemeriksaan pasang: gagal = seluruh migrasi batal ─────────────────────────
do $check$
declare f text; v_def text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.setoran_lampiran_pakai'::regclass)
     or has_table_privilege('authenticated', 'public.setoran_lampiran_pakai', 'select') or has_table_privilege('anon', 'public.setoran_lampiran_pakai', 'select')
     or has_table_privilege('authenticated', 'public.setoran_lampiran_pakai', 'insert') or has_table_privilege('service_role', 'public.setoran_lampiran_pakai', 'select') then
    raise exception 'SETORAN_FIX_CHECK: tabel klaim berkas harus RLS aktif tanpa hak klien';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and policyname = 'setoran_jurnal_tertutup' and permissive = 'RESTRICTIVE' and cmd = 'ALL'
        and tablename in ('journal_entries', 'journal_lines')) <> 2 then
    raise exception 'SETORAN_FIX_CHECK: dua kebijakan RESTRICTIVE jurnal harus ada';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('journal_entries', 'journal_lines') and policyname in ('je_all', 'jl_all')) <> 2 then
    raise exception 'SETORAN_FIX_CHECK: kebijakan umum je_all/jl_all harus tetap ada';
  end if;
  foreach f in array array['setoran_tulis_jurnal(date,uuid,text,text,text,jsonb)', 'setoran_konflik_tugas(uuid,uuid)', 'setoran_peringatan(uuid,uuid)',
                           'setoran_lampiran_cek(jsonb,uuid)', 'setoran_lampiran_klaim(uuid,text,uuid,jsonb)', 'guard_setoran_pakai()', 'guard_shift_tutup_uang()'] loop
    if has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') or has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute')
       or has_function_privilege('service_role', ('public.' || f)::regprocedure, 'execute') then
      raise exception 'SETORAN_FIX_CHECK: fungsi internal % dapat dipanggil klien', f; end if;
  end loop;
  foreach f in array array['setoran_jurnal_boleh()', 'setoran_jurnal_tersembunyi()', 'setoran_berkas_cabang(text)', 'setoran_berkas_boleh(text)', 'setoran_berkas_boleh_hapus(text,text)'] loop
    if not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') or has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute')
       or has_function_privilege('service_role', ('public.' || f)::regprocedure, 'execute') then
      raise exception 'SETORAN_FIX_CHECK: hak eksekusi kebijakan % salah', f; end if;
  end loop;
  for v_def in select pg_get_functiondef(p) from unnest(array['public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure, 'public.setoran_void(uuid,text,uuid)'::regprocedure,
        'public.setoran_daftar(date,date,uuid,text,uuid)'::regprocedure, 'public.setoran_detail(uuid)'::regprocedure, 'public.setoran_tambah_pengeluaran(uuid,date,text,numeric,text,jsonb,integer,uuid)'::regprocedure,
        'public.setoran_tambah_transfer(uuid,date,numeric,text,uuid,jsonb,text,integer,uuid)'::regprocedure, 'public.setoran_hapus_pengeluaran(uuid,uuid,integer,uuid)'::regprocedure,
        'public.setoran_hapus_transfer(uuid,uuid,integer,uuid)'::regprocedure]) p loop
    if v_def !~ 'admin_online_private\.deny_admin_online' then raise exception 'SETORAN_FIX_CHECK: penjaga Admin Online hilang dari fungsi setoran'; end if;
  end loop;
  v_def := pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure);
  if position('setoran_tulis_jurnal' in v_def) = 0 or position('SETORAN_PENGELUARAN_MELEBIHI' in v_def) = 0 or position('setoran_konflik_tugas' in v_def) = 0
     or position('sales_write_journal' in v_def) > 0 then
    raise exception 'SETORAN_FIX_CHECK: setujui tidak memakai pembantu baru';
  end if;
  foreach f in array array['public.ledger_account_lines(date,date,uuid[],uuid[])', 'public.ledger_account_totals(date,date,uuid[])'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position('setoran_jurnal_tersembunyi' in v_def) = 0 or v_def !~ 'admin_online_private\.deny_admin_online' or not exists (select 1 from pg_proc p where p.oid = f::regprocedure and p.prosecdef) then
      raise exception 'SETORAN_FIX_CHECK: % belum menyaring jurnal setoran', f; end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.cashier_shifts'::regclass and tgname = 'cashier_shift_tutup_uang_guard' and not tgisinternal) then
    raise exception 'SETORAN_FIX_CHECK: pemicu shift tertutup tidak terpasang'; end if;
  if to_regclass('storage.objects') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE'
          and policyname in ('setoran_berkas_baca_ketat', 'setoran_berkas_tulis_ketat', 'setoran_berkas_hapus_ketat', 'setoran_berkas_ubah_ketat')) <> 4 then
      raise exception 'SETORAN_FIX_CHECK: empat kebijakan RESTRICTIVE storage setoran harus ada'; end if;
  end if;
end $check$;
