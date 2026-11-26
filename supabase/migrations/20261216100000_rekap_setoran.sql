-- REKAP SETORAN (Andri 26 Nov 2026): kewajiban setoran tunai per PERIODE (mis. Jumat-Minggu, jatuh tempo Senin sebelum jam 12.00) per cabang,
-- pengeluaran dari dana setoran di layar yang sama, setoran/transfer parsial ke perusahaan dengan konfirmasi Finance, persetujuan akhir oleh
-- Finance/penanggung jawab, selisih kurang -> kasbon karyawan, selisih lebih -> Pendapatan Diluar Operasional Lain.
-- Apply as ONE transaction (satu transaksi; file ini sengaja tanpa begin/commit sendiri).
--
-- TAFSIRAN (dinyatakan di laporan supaya Andri bisa mengubah)
--  1. Setoran = kewajiban satu cabang untuk satu periode transaksi (periode_mulai..periode_selesai, WIB) dengan jadwal setoran (tanggal) dan batas jam (bawaan 12:00).
--     Kewajiban = SUM(closing_balance - opening_balance) semua shift TERTUTUP cabang itu yang ditutup di periode (per hari = tanggal tutup WIB). closing_balance adalah uang fisik yang
--     sudah dicocokkan pembukuan saat tutup shift (retur/refund tunai dan pengeluaran tunai shift sudah di dalamnya; selisih tutup shift SUDAH dijurnal oleh tutup shift:
--     kasbon 182001 / 760002 / 810004). Jadi selisih tutup shift TIDAK dijurnal dua kali: selisih setoran hanyalah selisih antara uang yang diterima perusahaan dan
--     kewajiban SESUDAH yang sudah dibukukan. Modal awal laci dianggap tetap di laci (tidak ikut disetor).
--  2. Pengeluaran dari dana setoran = baris yang diinput di layar setoran (tanggal sendiri antara awal periode dan hari ini, lampiran bukti wajib). Disimpan sebagai usulan
--     dan DIPOSTING SAAT PERSETUJUAN AKHIR lewat post_expense_atomic (konteks backoffice, tunai, tanggal baris itu, alasan tanggal otomatis bila < hari ini): tidak ada jalur posting kedua,
--     tepat satu kali per baris (kunci permintaan setoran:<id baris>). Pengeluaran tunai yang sudah diinput lewat Kasir Pengeluaran selama shift tampil sebagai informasi, tidak dikurangkan lagi.
--  3. Sudah ditransfer = transfer parsial (tanggal, jumlah, Transfer/Serah tunai, rekening tujuan perusahaan, foto bukti). Finance mengonfirmasi uang masuk (bukan pembuat transfer).
--     Transfer TIDAK menghasilkan jurnal di modul ini (Finance tetap mencatat penerimaan di bank lewat Kas Masuk/Transfer seperti biasa; agar tidak dobel). Hanya transfer Dikonfirmasi dihitung saat penutupan.
--  4. Alur: Draft(aktif) -> Diajukan (staf: "selesai disetor, ajukan penutupan") -> Disetujui | Ditolak (kembali bisa diedit dengan alasan); Disetujui -> Void (Owner/Finance, jurnal pembalik).
--     Penyetuju = OWNER/FINANCE/ADMIN (+ ADMIN_UMUM bila ada) yang boleh mengakses cabang itu; penyetuju tidak boleh pembuat/pengaju setoran itu dan tidak boleh mengonfirmasi transfer buatannya sendiri.
--  5. Penutupan: selisih = transfer Dikonfirmasi - (kewajiban - pengeluaran). Kurang -> kasbon karyawan (cash_advances 'Dicatat', tanpa potong gaji otomatis, sama dengan F2),
--     Dr 182001 / Cr Kas laci, dibagi rata ke kasir shift (boleh ditimpa Finance) atau beban perusahaan 760002 dengan alasan. Lebih -> Dr Kas / Cr 810004. Pas -> tanpa jurnal.
--     Jurnal selisih bertanggal periode_selesai (periode akuntansi tertutup ditolak).
--  6. PRIVASI: staf melihat kewajiban dan sisa yang harus disetor (sisa dipatok >= 0, tanpa kata "lebih") tetapi TIDAK melihat selisih, jenis (kurang/lebih), total lebih, kasbon,
--     jurnal, catatan penyetuju, dan rekap. Semua tabel dicabut dari klien (RLS tanpa kebijakan, ACL kosong); seluruh baca/tulis lewat fungsi SECURITY DEFINER yang membentuk hasil menurut peran.
--  7. Tidak ada data lama yang diubah. Tidak ada jurnal yang bergerak sampai ada setoran yang disetujui.
--
-- ROLLBACK (sebelum ada setoran disetujui): drop semua fungsi public.setoran_* dan public.guard_setoran_*; drop table setoran_permintaan, setoran_event, setoran_kasbon, setoran_transfer,
--   setoran_pengeluaran, setoran_keuangan, setoran_shift, setoran. Setelah ada yang disetujui: JANGAN drop tabel; void per setoran.
set local lock_timeout = '5s';

-- ───────────────────────── 0. Pagar prasyarat (gagal tertutup) ─────────────────────────
do $guard$
begin
  if to_regclass('public.setoran') is not null or to_regprocedure('public.setoran_buat(uuid,date,date,date,text,uuid)') is not null then
    raise exception 'SETORAN_PRECONDITION: objek setoran sudah ada; periksa urutan migrasi';
  end if;
  if to_regclass('public.cashier_shifts') is null or to_regclass('public.expenses') is null or to_regclass('public.cash_advances') is null
     or to_regclass('public.employees') is null or to_regclass('public.accounting_locks') is null or to_regclass('public.journal_entries') is null
     or to_regclass('public.cash_accounts') is null
     or to_regprocedure('public.post_expense_atomic(text,text,uuid,jsonb,jsonb)') is null
     or to_regprocedure('public.revise_expense_atomic(text,uuid,integer,text,jsonb,text)') is null
     or to_regprocedure('public.sales_write_journal(date,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public.unit_posting_cash(text,uuid)') is null
     or to_regprocedure('public.user_can_access_branch(uuid)') is null
     or to_regprocedure('public.expense_account_code(text)') is null
     or to_regprocedure('admin_online_private.deny_admin_online()') is null then
    raise exception 'SETORAN_PRECONDITION: prasyarat tidak lengkap; periksa urutan migrasi';
  end if;
  if position('BACKDATE_PENGELUARAN' in pg_get_functiondef('public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure)) = 0 then
    raise exception 'SETORAN_PRECONDITION: aturan tanggal mundur pengeluaran belum terpasang';
  end if;
  if (select count(*) from public.coa_accounts where code in ('182001','810004','760002') and is_active and not is_header) <> 3 then
    raise exception 'SETORAN_PRECONDITION: akun 182001 / 810004 / 760002 belum aktif sebagai akun rincian';
  end if;
  if position('''Dicatat''' in coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.cash_advances'::regclass and conname = 'cash_advances_status_check'), '')) = 0 then
    raise exception 'SETORAN_PRECONDITION: status kasbon Dicatat (F2) belum terpasang';
  end if;
end $guard$;

-- ───────────────────────── 0b. Katalog Akses Grup (sub-menu Rekap Setoran di modul Kas & Bank; dipasang SEBELUM aplikasi dideploy) ─────────────────────────
insert into role_settings_private.submenu_catalog(id,module_id) values
('kas-bank.setoran','kas-bank')
on conflict (id) do nothing;

-- ───────────────────────── 1. Tabel (dicabut dari klien; hanya fungsi di bawah yang menyentuhnya) ─────────────────────────
create table public.setoran (
  id uuid primary key default gen_random_uuid(),
  no_setoran text not null unique,
  branch_id uuid not null references public.branches(id),
  periode_mulai date not null,
  periode_selesai date not null,
  jadwal date not null,
  batas_jam time not null default '12:00',
  status text not null default 'Draft' check (status in ('Draft','Diajukan','Disetujui','Ditolak','Void')),
  request_key uuid not null,
  catatan text check (catatan is null or length(catatan) <= 500),
  revision integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  void_by uuid references public.profiles(id),
  void_at timestamptz,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 3 and 300),
  unique (created_by, request_key),
  constraint setoran_periode check (periode_selesai >= periode_mulai and periode_selesai - periode_mulai <= 30 and jadwal >= periode_selesai),
  constraint setoran_ajukan_wajib check (status in ('Draft','Ditolak','Void') or (submitted_by is not null and submitted_at is not null)),
  constraint setoran_putus_wajib check (status <> 'Disetujui' or (decided_by is not null and decided_at is not null)),
  constraint setoran_void_wajib check ((status = 'Void') = (void_at is not null and void_by is not null and void_reason is not null))
);
create index setoran_cabang_periode on public.setoran (branch_id, periode_selesai, status);
create index setoran_status on public.setoran (status, submitted_at);
comment on table public.setoran is 'Kewajiban setoran tunai per cabang dan periode. Dibaca hanya lewat fungsi setoran_* (bentuk hasil menurut peran).';

create table public.setoran_shift (
  setoran_id uuid not null references public.setoran(id),
  shift_id uuid not null references public.cashier_shifts(id),
  aktif boolean not null default true,
  primary key (setoran_id, shift_id)
);
create unique index setoran_shift_aktif on public.setoran_shift (shift_id) where aktif;

create table public.setoran_keuangan (
  setoran_id uuid primary key references public.setoran(id),
  shift_net numeric(15,2) not null,
  pengeluaran_total numeric(15,2) not null check (pengeluaran_total >= 0),
  expected_amount numeric(15,2) not null,
  rincian jsonb not null,
  snapshot_at timestamptz not null default now(),
  transfer_total numeric(15,2),
  selisih numeric(15,2),
  jenis text check (jenis in ('Pas','Kurang','Lebih')),
  penjelasan_lebih text check (penjelasan_lebih is null or length(penjelasan_lebih) <= 500),
  penyelesaian text check (penyelesaian in ('Pas','Kasbon','BebanPerusahaan','PendapatanLain')),
  selisih_journal_id uuid references public.journal_entries(id),
  catatan_keuangan text check (catatan_keuangan is null or length(catatan_keuangan) <= 500),
  reversal_journal_id uuid references public.journal_entries(id),
  constraint setoran_keuangan_jenis check ((jenis is null) = (selisih is null) and (jenis is null) = (transfer_total is null)
     and (jenis is null or ((jenis = 'Pas') = (selisih = 0) and (jenis = 'Kurang') = (selisih < 0) and (jenis = 'Lebih') = (selisih > 0))))
);
comment on table public.setoran_keuangan is 'Snapshot kewajiban, selisih, jenis, jurnal. HANYA untuk peran penyetuju (lewat fungsi); staf tidak boleh melihat selisih/lebih.';

create table public.setoran_pengeluaran (
  id uuid primary key default gen_random_uuid(),
  setoran_id uuid not null references public.setoran(id),
  tanggal date not null,
  kategori text not null,
  deskripsi text check (deskripsi is null or length(deskripsi) <= 300),
  jumlah numeric(15,2) not null check (jumlah > 0 and jumlah <= 1000000000000),
  lampiran jsonb not null check (jsonb_typeof(lampiran) = 'array' and jsonb_array_length(lampiran) between 1 and 20),
  entered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  request_key uuid not null,
  expense_id uuid,
  journal_id uuid,
  unique (setoran_id, request_key)
);
create index setoran_pengeluaran_setoran on public.setoran_pengeluaran (setoran_id);

create table public.setoran_transfer (
  id uuid primary key default gen_random_uuid(),
  setoran_id uuid not null references public.setoran(id),
  tanggal date not null,
  jumlah numeric(15,2) not null check (jumlah > 0 and jumlah <= 1000000000000),
  metode text not null check (metode in ('Transfer','Serah tunai')),
  cash_account_id uuid not null references public.cash_accounts(id),
  lampiran jsonb not null default '[]'::jsonb check (jsonb_typeof(lampiran) = 'array' and jsonb_array_length(lampiran) <= 20),
  catatan text check (catatan is null or length(catatan) <= 300),
  entered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  request_key uuid not null,
  status text not null default 'Menunggu' check (status in ('Menunggu','Dikonfirmasi','Ditolak')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  catatan_keuangan text check (catatan_keuangan is null or length(catatan_keuangan) <= 300),
  unique (setoran_id, request_key),
  constraint setoran_transfer_putus check ((status = 'Menunggu') = (decided_by is null and decided_at is null)),
  constraint setoran_transfer_bukti check (metode <> 'Transfer' or jsonb_array_length(lampiran) >= 1)
);
create index setoran_transfer_setoran on public.setoran_transfer (setoran_id, status);

create table public.setoran_kasbon (
  id uuid primary key default gen_random_uuid(),
  setoran_id uuid not null references public.setoran(id),
  employee_id uuid not null references public.employees(id),
  jumlah numeric(15,2) not null check (jumlah > 0),
  advance_id uuid not null,
  mode text not null check (mode in ('otomatis','manual')),
  created_at timestamptz not null default now(),
  unique (setoran_id, employee_id)
);
create index setoran_kasbon_karyawan on public.setoran_kasbon (employee_id);
comment on table public.setoran_kasbon is 'Rekaman per karyawan atas selisih kurang setoran; advance_id menunjuk cash_advances (status Dicatat) yang tampil di HRIS Utang karyawan.';

create table public.setoran_event (
  id bigint generated always as identity primary key,
  setoran_id uuid not null references public.setoran(id),
  jenis text not null,
  dari text,
  ke text,
  actor_id uuid,
  actor_role text,
  catatan text,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default clock_timestamp()
);
create index setoran_event_setoran on public.setoran_event (setoran_id, id);

create table public.setoran_permintaan (
  actor_id uuid not null,
  request_key uuid not null,
  jenis text not null,
  payload jsonb not null,
  hasil jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key)
);

do $rls$
declare t text;
begin
  foreach t in array array['setoran','setoran_shift','setoran_keuangan','setoran_pengeluaran','setoran_transfer','setoran_kasbon','setoran_event','setoran_permintaan'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $rls$;

-- ───────────────────────── 2. Penjaga jejak & mesin status (berlaku untuk SEMUA penulis, termasuk fungsi) ─────────────────────────
create function public.guard_setoran_jejak() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'SETORAN_JEJAK: jejak setoran tidak dapat diubah atau dihapus.' using errcode = '42501';
end $$;
revoke all on function public.guard_setoran_jejak() from public, anon, authenticated, service_role;
create trigger setoran_event_jejak before update or delete on public.setoran_event for each row execute function public.guard_setoran_jejak();
create trigger setoran_event_jejak_truncate before truncate on public.setoran_event for each statement execute function public.guard_setoran_jejak();
create trigger setoran_permintaan_jejak before update or delete on public.setoran_permintaan for each row execute function public.guard_setoran_jejak();
create trigger setoran_permintaan_jejak_truncate before truncate on public.setoran_permintaan for each statement execute function public.guard_setoran_jejak();
create trigger setoran_kasbon_jejak before update or delete on public.setoran_kasbon for each row execute function public.guard_setoran_jejak();
create trigger setoran_kasbon_jejak_truncate before truncate on public.setoran_kasbon for each statement execute function public.guard_setoran_jejak();

create function public.guard_setoran_status() returns trigger
language plpgsql set search_path = '' as $$
declare v_allow text[];
begin
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception 'SETORAN_JEJAK: setoran tidak dapat dihapus; batalkan lewat status Void.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Draft' then raise exception 'SETORAN_STATUS: setoran baru harus berstatus Draft.' using errcode = '22023'; end if;
    return new;
  end if;
  if old.status = new.status then
    if old.status in ('Draft','Ditolak') then v_allow := array['catatan','revision'];
    else raise exception 'SETORAN_BEKU: setoran berstatus % tidak dapat diubah.', old.status using errcode = '42501'; end if;
  elsif old.status in ('Draft','Ditolak') and new.status = 'Diajukan' then v_allow := array['status','submitted_by','submitted_at','revision'];
  elsif old.status = 'Diajukan' and new.status in ('Disetujui','Ditolak') then v_allow := array['status','decided_by','decided_at','decision_note'];
  elsif old.status in ('Draft','Ditolak','Disetujui') and new.status = 'Void' then v_allow := array['status','void_by','void_at','void_reason'];
  else raise exception 'SETORAN_STATUS: perpindahan status % -> % tidak diperbolehkan.', old.status, new.status using errcode = '22023';
  end if;
  if (to_jsonb(new) - v_allow) is distinct from (to_jsonb(old) - v_allow) then
    raise exception 'SETORAN_BEKU: kolom yang tidak boleh berubah pada perpindahan % -> % ikut berubah.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_setoran_status() from public, anon, authenticated, service_role;
create trigger setoran_status_guard before insert or update or delete on public.setoran for each row execute function public.guard_setoran_status();
create trigger setoran_status_guard_truncate before truncate on public.setoran for each statement execute function public.guard_setoran_status();

-- Baris anak hanya berubah selama setoran masih Draft/Ditolak; pengecualian terbatas dijelaskan per tabel.
create function public.guard_setoran_anak() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text; v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.setoran_id else new.setoran_id end;
  select status into v_status from public.setoran where id = v_id;
  if tg_table_name = 'setoran_pengeluaran' and tg_op = 'UPDATE' then
    if v_status = 'Diajukan' and old.expense_id is null and old.journal_id is null
       and (to_jsonb(new) - array['expense_id','journal_id']) = (to_jsonb(old) - array['expense_id','journal_id']) then return new; end if;
    raise exception 'SETORAN_BEKU: baris pengeluaran setoran tidak dapat diubah.' using errcode = '42501';
  end if;
  if tg_table_name = 'setoran_shift' and tg_op = 'UPDATE' then
    if v_status = 'Void' and old.aktif and not new.aktif and (to_jsonb(new) - 'aktif') = (to_jsonb(old) - 'aktif') then return new; end if;
    raise exception 'SETORAN_BEKU: shift setoran tidak dapat diubah.' using errcode = '42501';
  end if;
  if tg_table_name = 'setoran_transfer' and tg_op = 'UPDATE' then
    -- hanya keputusan Finance (Menunggu -> Dikonfirmasi/Ditolak) selama setoran belum Disetujui/Void
    if v_status in ('Draft','Ditolak','Diajukan') and old.status = 'Menunggu' and new.status in ('Dikonfirmasi','Ditolak')
       and (to_jsonb(new) - array['status','decided_by','decided_at','catatan_keuangan']) = (to_jsonb(old) - array['status','decided_by','decided_at','catatan_keuangan']) then return new; end if;
    raise exception 'SETORAN_BEKU: transfer setoran tidak dapat diubah.' using errcode = '42501';
  end if;
  if tg_table_name = 'setoran_transfer' and tg_op = 'DELETE' then
    if (to_jsonb(old) ->> 'status') <> 'Menunggu' then
      raise exception 'SETORAN_BEKU: transfer yang sudah diputuskan tidak dapat dihapus.' using errcode = '42501';
    end if;
  end if;
  if v_status not in ('Draft','Ditolak') then
    raise exception 'SETORAN_BEKU: setoran berstatus % tidak dapat diubah rinciannya.', v_status using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.guard_setoran_anak() from public, anon, authenticated, service_role;
create trigger setoran_pengeluaran_guard before insert or update or delete on public.setoran_pengeluaran for each row execute function public.guard_setoran_anak();
create trigger setoran_shift_guard before insert or update or delete on public.setoran_shift for each row execute function public.guard_setoran_anak();
create trigger setoran_transfer_guard before insert or update or delete on public.setoran_transfer for each row execute function public.guard_setoran_anak();

create function public.guard_setoran_keuangan() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if tg_op in ('DELETE','TRUNCATE') then raise exception 'SETORAN_JEJAK: data keuangan setoran tidak dapat dihapus.' using errcode = '42501'; end if;
  select status into v_status from public.setoran where id = new.setoran_id;
  if v_status in ('Draft','Ditolak','Diajukan') then return new; end if;
  if tg_op = 'INSERT' then raise exception 'SETORAN_BEKU: data keuangan hanya dibuat saat pengajuan.' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['reversal_journal_id']) is distinct from (to_jsonb(old) - array['reversal_journal_id']) then
    raise exception 'SETORAN_BEKU: data keuangan setoran % tidak dapat diubah.', v_status using errcode = '42501'; end if;
  return new;
end $$;
revoke all on function public.guard_setoran_keuangan() from public, anon, authenticated, service_role;
create trigger setoran_keuangan_guard before insert or update or delete on public.setoran_keuangan for each row execute function public.guard_setoran_keuangan();
create trigger setoran_keuangan_guard_truncate before truncate on public.setoran_keuangan for each statement execute function public.guard_setoran_keuangan();

-- ───────────────────────── 3. Pembantu internal (tidak ada EXECUTE untuk klien) ─────────────────────────
create function public.setoran_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role::text from public.profiles p where p.id = auth.uid() and p.is_active and auth.role() = 'authenticated'
$$;
revoke all on function public.setoran_role() from public, anon, authenticated, service_role;

-- Penyetuju: Owner, Finance, Admin (dan Admin Umum bila peran itu ada; dibandingkan sebagai teks supaya aman walau enum belum ada).
create function public.setoran_penyetuju() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.setoran_role() in ('OWNER','FINANCE','ADMIN','ADMIN_UMUM'), false)
$$;
revoke all on function public.setoran_penyetuju() from public, anon, authenticated, service_role;

create function public.setoran_lampiran_valid(p_lampiran jsonb, p_min integer) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_lampiran) = 'array' and jsonb_array_length(p_lampiran) between p_min and 20
    and not exists (select 1 from jsonb_to_recordset(p_lampiran) as x(path text, nama text, mime text, ukuran numeric)
      where path is null or path = '' or left(path,1) = '/' or position('..' in path) > 0 or length(path) > 2000
        or nama is null or length(nama) not between 1 and 200 or length(mime) > 120
        or (ukuran is not null and (ukuran <= 0 or ukuran > 10485760 or ukuran <> trunc(ukuran))))
$$;
revoke all on function public.setoran_lampiran_valid(jsonb, integer) from public, anon, authenticated, service_role;

create function public.setoran_nama(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(p.full_name), ''), 'Pengguna') from public.profiles p where p.id = p_user
$$;
revoke all on function public.setoran_nama(uuid) from public, anon, authenticated, service_role;

create function public.setoran_log(p_id uuid, p_jenis text, p_dari text, p_ke text, p_catatan text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.setoran_event(setoran_id, jenis, dari, ke, actor_id, actor_role, catatan, data)
  values (p_id, p_jenis, p_dari, p_ke, auth.uid(), public.setoran_role(), left(p_catatan, 500), coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function public.setoran_log(uuid, text, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- Idempotensi: kunci sama + isi sama = hasil lama; kunci sama + isi beda = ditolak.
create function public.setoran_ulang(p_key uuid, p_jenis text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prior public.setoran_permintaan%rowtype;
begin
  if p_key is null then raise exception 'SETORAN_KUNCI: muat ulang halaman lalu coba lagi.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('setoran:req:' || auth.uid()::text || ':' || p_key::text, 0));
  select * into v_prior from public.setoran_permintaan where actor_id = auth.uid() and request_key = p_key;
  if not found then return null; end if;
  if v_prior.jenis is distinct from p_jenis or v_prior.payload is distinct from p_payload then
    raise exception 'SETORAN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.' using errcode = '22023';
  end if;
  return v_prior.hasil || jsonb_build_object('ulang', true);
end $$;
revoke all on function public.setoran_ulang(uuid, text, jsonb) from public, anon, authenticated, service_role;

create function public.setoran_simpan_permintaan(p_key uuid, p_jenis text, p_payload jsonb, p_hasil jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.setoran_permintaan(actor_id, request_key, jenis, payload, hasil) values (auth.uid(), p_key, p_jenis, p_payload, p_hasil);
end $$;
revoke all on function public.setoran_simpan_permintaan(uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;

create function public.setoran_akses_cabang(p_branch uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or public.setoran_role() is null then
    raise exception 'SETORAN_DITOLAK: akses setoran ditolak.' using errcode = '42501'; end if;
  if p_branch is null or not public.user_can_access_branch(p_branch) then
    raise exception 'SETORAN_DITOLAK: cabang ini tidak dapat diakses.' using errcode = '42501'; end if;
end $$;
revoke all on function public.setoran_akses_cabang(uuid) from public, anon, authenticated, service_role;

create function public.setoran_periode_terbuka(p_tanggal date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.accounting_locks where id for share;
  if exists (select 1 from public.accounting_locks where id and p_tanggal <= closed_until) then
    raise exception 'SETORAN_PERIODE: periode akuntansi untuk tanggal % sudah ditutup.', p_tanggal using errcode = '22023'; end if;
end $$;
revoke all on function public.setoran_periode_terbuka(date) from public, anon, authenticated, service_role;

-- Shift yang memenuhi syarat untuk setoran ini (belum terhubung ke setoran aktif lain).
create function public.setoran_shift_layak(p_id uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id order by s.id), '{}') from public.setoran t join public.cashier_shifts s on s.branch_id = t.branch_id
   where t.id = p_id and s.status = 'closed' and s.closing_balance is not null and s.closed_at is not null
     and (s.closed_at at time zone 'Asia/Jakarta')::date between t.periode_mulai and t.periode_selesai
     and not exists (select 1 from public.setoran_shift ss where ss.shift_id = s.id and ss.aktif and ss.setoran_id <> p_id)
$$;
revoke all on function public.setoran_shift_layak(uuid) from public, anon, authenticated, service_role;

-- Sambungkan semua shift tertutup yang layak (idempoten). Dipanggil oleh fungsi tulis selama setoran Draft/Ditolak.
create function public.setoran_sinkron_inti(p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_n integer;
begin
  v_ids := public.setoran_shift_layak(p_id);
  if cardinality(v_ids) = 0 then return 0; end if;
  perform 1 from public.cashier_shifts where id = any (v_ids) order by id for share;
  insert into public.setoran_shift(setoran_id, shift_id) select p_id, x from unnest(v_ids) x on conflict (setoran_id, shift_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.setoran_sinkron_inti(uuid) from public, anon, authenticated, service_role;

-- Baris shift (angka uang) dari shift yang tersambung; tanpa kunci (pembaca).
create function public.setoran_rincian_live(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
            'shift_id', s.id, 'jenis', s.shift_type, 'kasir', coalesce(e.nama, pr.full_name, 'Kasir'),
            'dibuka', s.opened_at, 'ditutup', s.closed_at, 'modal_awal', s.opening_balance,
            'kas_seharusnya_tutup', s.expected_cash, 'kas_fisik_tutup', s.closing_balance, 'selisih_tutup', s.selisih,
            'penjualan_tunai', coalesce((s.closing_breakdown ->> 'Tunai')::numeric, 0),
            'pengeluaran_tunai_shift', coalesce((select sum(x.jumlah) from public.expenses x where x.shift_id = s.id and x.metode_bayar = 'Tunai' and x.voided_at is null), 0),
            'bersih', s.closing_balance - s.opening_balance) order by s.closed_at, s.id), '[]'::jsonb)
    from public.setoran_shift ss join public.cashier_shifts s on s.id = ss.shift_id
    left join public.employees e on e.id = s.employee_id left join public.profiles pr on pr.id = s.opened_by
   where ss.setoran_id = p_id and ss.aktif and s.closing_balance is not null
$$;
revoke all on function public.setoran_rincian_live(uuid) from public, anon, authenticated, service_role;

-- Rincian per hari dari baris shift (hari = tanggal tutup WIB); satu baris per tanggal di periode.
create function public.setoran_harian(p_mulai date, p_selesai date, p_rows jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tanggal', d::date, 'total',
           coalesce((select sum((x ->> 'bersih')::numeric) from jsonb_array_elements(p_rows) x
                      where ((x ->> 'ditutup')::timestamptz at time zone 'Asia/Jakarta')::date = d::date), 0)) order by d), '[]'::jsonb)
    from generate_series(p_mulai::timestamp, p_selesai::timestamp, interval '1 day') d
$$;
revoke all on function public.setoran_harian(date, date, jsonb) from public, anon, authenticated, service_role;

-- Angka setoran (pembaca, tanpa kunci). Disetujui/Void memakai snapshot tetap; selain itu hidup dari shift tersambung.
create function public.setoran_angka(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.setoran%rowtype; v_k public.setoran_keuangan%rowtype; v_rows jsonb; v_kew numeric; v_peng numeric; v_all numeric; v_ok numeric; v_wait integer;
begin
  select * into v_s from public.setoran where id = p_id;
  select * into v_k from public.setoran_keuangan where setoran_id = p_id;
  if v_s.status in ('Diajukan','Disetujui','Void') and v_k.setoran_id is not null then
    v_rows := v_k.rincian; v_kew := v_k.shift_net; v_peng := v_k.pengeluaran_total;
  else
    v_rows := public.setoran_rincian_live(p_id);
    select coalesce(sum((x ->> 'bersih')::numeric), 0) into v_kew from jsonb_array_elements(v_rows) x;
    select coalesce(sum(jumlah), 0) into v_peng from public.setoran_pengeluaran where setoran_id = p_id;
  end if;
  select coalesce(sum(jumlah) filter (where status in ('Menunggu','Dikonfirmasi')), 0), coalesce(sum(jumlah) filter (where status = 'Dikonfirmasi'), 0),
         count(*) filter (where status = 'Menunggu')::integer
    into v_all, v_ok, v_wait from public.setoran_transfer where setoran_id = p_id;
  return jsonb_build_object('rincian', v_rows, 'harian', public.setoran_harian(v_s.periode_mulai, v_s.periode_selesai, v_rows),
    'kewajiban', v_kew, 'pengeluaran', v_peng, 'diharapkan', v_kew - v_peng, 'transfer_semua', v_all, 'transfer_konfirmasi', v_ok, 'transfer_menunggu', v_wait,
    'sisa', v_kew - v_peng - v_all);
end $$;
revoke all on function public.setoran_angka(uuid) from public, anon, authenticated, service_role;

-- Hitung dengan KUNCI + validasi (jalur tulis): shift tersambung wajib tertutup, satu cabang, ditutup di periode.
create function public.setoran_hitung(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.setoran%rowtype; v_ids uuid[]; v_bad boolean; v_rows jsonb; v_net numeric; v_peng numeric;
begin
  select * into v_s from public.setoran where id = p_id;
  select array_agg(ss.shift_id order by ss.shift_id) into v_ids from public.setoran_shift ss where ss.setoran_id = p_id and ss.aktif;
  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('rincian', '[]'::jsonb, 'shift_net', 0, 'pengeluaran_total', (select coalesce(sum(jumlah), 0) from public.setoran_pengeluaran where setoran_id = p_id),
      'expected', 0 - (select coalesce(sum(jumlah), 0) from public.setoran_pengeluaran where setoran_id = p_id)); end if;
  perform 1 from public.cashier_shifts where id = any (v_ids) order by id for share;
  select exists (select 1 from public.cashier_shifts s where s.id = any (v_ids)
    and (s.status <> 'closed' or s.closing_balance is null or s.closed_at is null or s.branch_id <> v_s.branch_id
         or (s.closed_at at time zone 'Asia/Jakarta')::date not between v_s.periode_mulai and v_s.periode_selesai)) into v_bad;
  if v_bad then raise exception 'SETORAN_SHIFT: shift setoran harus sudah ditutup, satu cabang, dan ditutup di dalam periode.' using errcode = '22023'; end if;
  v_rows := public.setoran_rincian_live(p_id);
  select coalesce(sum((x ->> 'bersih')::numeric), 0) into v_net from jsonb_array_elements(v_rows) x;
  select coalesce(sum(p.jumlah), 0) into v_peng from public.setoran_pengeluaran p where p.setoran_id = p_id;
  return jsonb_build_object('rincian', v_rows, 'shift_net', v_net, 'pengeluaran_total', v_peng, 'expected', v_net - v_peng);
end $$;
revoke all on function public.setoran_hitung(uuid) from public, anon, authenticated, service_role;

-- Karyawan penanggung jawab = kasir shift (karyawan aktif), unik, urut id.
create function public.setoran_penanggung(p_id uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct e.id order by e.id), '{}')
    from public.setoran_shift ss join public.cashier_shifts s on s.id = ss.shift_id
    join public.employees e on e.id = coalesce(s.employee_id, (select e2.id from public.employees e2 where e2.profile_id = s.opened_by and e2.status = 'Aktif' and e2.trashed_at is null order by e2.id limit 1))
   where ss.setoran_id = p_id and ss.aktif and e.status = 'Aktif' and e.trashed_at is null
$$;
revoke all on function public.setoran_penanggung(uuid) from public, anon, authenticated, service_role;

-- Label status untuk layar (tidak membocorkan lebih: 'Lunas' berlaku untuk sisa <= 0).
create function public.setoran_label(p_status text, p_sisa numeric, p_jadwal date, p_batas time) returns jsonb
language sql stable set search_path = '' as $$
  with t as (select ((p_jadwal + p_batas)::timestamp at time zone 'Asia/Jakarta') < now() as lewat)
  select jsonb_build_object(
    'badge', case when p_status = 'Disetujui' then 'Lunas' when p_status = 'Void' then 'Dibatalkan' when p_status = 'Diajukan' then 'Menunggu persetujuan'
                  when p_sisa <= 0 then 'Lunas (belum ditutup)' when t.lewat then 'Terlambat' else 'Belum lunas' end,
    'status_periode', case when p_status = 'Disetujui' then 'Selesai' when p_status = 'Void' then 'Dibatalkan' when t.lewat then 'Terlambat' else 'Aktif' end,
    'terlambat', (p_status in ('Draft','Ditolak') and p_sisa > 0 and t.lewat)) from t
$$;
revoke all on function public.setoran_label(text, numeric, date, time) from public, anon, authenticated, service_role;

-- Rekening tujuan perusahaan: aktif, bukan header, cabang cocok (atau umum). Transfer bank wajib rekening Bank di bawah header 120000.
create function public.setoran_akun_valid(p_account uuid, p_branch uuid, p_metode text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.cash_accounts%rowtype;
begin
  select * into v_a from public.cash_accounts where id = p_account and is_active and (branch_id is null or branch_id = p_branch);
  if not found then raise exception 'SETORAN_REKENING: rekening tujuan tidak ditemukan, tidak aktif, atau bukan milik cabang ini.' using errcode = '22023'; end if;
  if not exists (select 1 from public.coa_accounts a where a.code = v_a.coa_code and a.is_active and not a.is_header) then
    raise exception 'SETORAN_REKENING: akun buku besar rekening tujuan tidak aktif.' using errcode = '22023'; end if;
  if p_metode = 'Transfer' then
    if v_a.jenis <> 'Bank' then raise exception 'SETORAN_REKENING: transfer harus ke rekening bank perusahaan.' using errcode = '22023'; end if;
    if not exists (select 1 from public.coa_accounts a join public.coa_accounts g on g.id = a.parent_id where a.code = v_a.coa_code and g.code = '120000' and g.is_header) then
      raise exception 'SETORAN_REKENING: rekening tujuan bukan rekening bank yang sah.' using errcode = '22023'; end if;
  elsif v_a.jenis <> 'Kas' then
    raise exception 'SETORAN_REKENING: serah tunai harus ke akun kas perusahaan.' using errcode = '22023';
  end if;
end $$;
revoke all on function public.setoran_akun_valid(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ───────────────────────── 4. Fungsi untuk layar (SECURITY DEFINER; bentuk hasil menurut peran) ─────────────────────────
create function public.setoran_akses() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform admin_online_private.deny_admin_online();
  if public.setoran_role() is null then return jsonb_build_object('masuk', false, 'penyetuju', false, 'void', false); end if;
  return jsonb_build_object('masuk', true, 'penyetuju', public.setoran_penyetuju(), 'void', public.setoran_role() in ('OWNER','FINANCE'));
end $$;
revoke all on function public.setoran_akses() from public, anon, service_role;
grant execute on function public.setoran_akses() to authenticated;

-- Rekening tujuan yang boleh dipilih (nama + jenis; tanpa nomor rekening penuh).
create function public.setoran_rekening_tujuan(p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang(p_branch);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nama', a.nama, 'jenis', a.jenis, 'bank', a.bank_nama) order by a.jenis, a.nama)
     from public.cash_accounts a join public.coa_accounts c on c.code = a.coa_code
    where a.is_active and (a.branch_id is null or a.branch_id = p_branch) and c.is_active and not c.is_header), '[]'::jsonb);
end $$;
revoke all on function public.setoran_rekening_tujuan(uuid) from public, anon, service_role;
grant execute on function public.setoran_rekening_tujuan(uuid) to authenticated;

create function public.setoran_buat(p_branch uuid, p_mulai date, p_selesai date, p_jadwal date, p_batas_jam text, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_uid uuid := auth.uid(); v_payload jsonb; v_prior jsonb; v_id uuid := gen_random_uuid(); v_no text; v_n integer; v_hasil jsonb;
  v_today date := (now() at time zone 'Asia/Jakarta')::date; v_jam time; v_batas text := coalesce(nullif(btrim(p_batas_jam), ''), '12:00');
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang(p_branch);
  v_payload := jsonb_build_object('branch', p_branch, 'mulai', p_mulai, 'selesai', p_selesai, 'jadwal', p_jadwal, 'jam', v_batas);
  v_prior := public.setoran_ulang(p_request_key, 'buat', v_payload);
  if v_prior is not null then return v_prior; end if;
  if p_mulai is null or p_selesai is null or p_jadwal is null or p_selesai < p_mulai or p_selesai - p_mulai > 30 then
    raise exception 'SETORAN_PERIODE: periode transaksi tidak valid (paling lama 31 hari, tanggal akhir tidak sebelum awal).' using errcode = '22023'; end if;
  if p_selesai > v_today then raise exception 'SETORAN_PERIODE: periode transaksi belum berakhir (tanggal akhir tidak boleh di masa depan).' using errcode = '22023'; end if;
  if v_today - p_mulai > 62 then raise exception 'SETORAN_PERIODE: periode terlalu lama ke belakang (paling lama 62 hari).' using errcode = '22023'; end if;
  if p_jadwal < p_selesai or p_jadwal - p_selesai > 14 then
    raise exception 'SETORAN_JADWAL: jadwal setoran harus sesudah/sama dengan akhir periode dan paling lama 14 hari sesudahnya.' using errcode = '22023'; end if;
  if v_batas !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'SETORAN_JAM: batas waktu harus berformat JJ:MM.' using errcode = '22023'; end if;
  v_jam := v_batas::time;
  perform public.setoran_periode_terbuka(p_selesai);
  perform pg_advisory_xact_lock(hashtextextended('setoran:cabang:' || p_branch::text, 0));
  if exists (select 1 from public.setoran s where s.branch_id = p_branch and s.status <> 'Void' and s.periode_mulai <= p_selesai and s.periode_selesai >= p_mulai) then
    raise exception 'SETORAN_TUMPANG_TINDIH: sudah ada setoran cabang ini yang periodenya beririsan.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('setoran:nomor:' || to_char(p_jadwal, 'YYYYMMDD'), 0));
  select coalesce(max(substring(no_setoran from '[0-9]+$')::integer), 0) + 1 into v_n from public.setoran where no_setoran like 'STR-' || to_char(p_jadwal, 'YYYYMMDD') || '-%';
  v_no := 'STR-' || to_char(p_jadwal, 'YYYYMMDD') || '-' || lpad(v_n::text, 3, '0');
  insert into public.setoran(id, no_setoran, branch_id, periode_mulai, periode_selesai, jadwal, batas_jam, request_key, created_by)
  values (v_id, v_no, p_branch, p_mulai, p_selesai, p_jadwal, v_jam, p_request_key, v_uid);
  v_n := public.setoran_sinkron_inti(v_id);
  perform public.setoran_log(v_id, 'dibuat', null, 'Draft', null, jsonb_build_object('shift_tersambung', v_n));
  v_hasil := jsonb_build_object('id', v_id, 'no_setoran', v_no, 'status', 'Draft', 'revision', 0);
  perform public.setoran_simpan_permintaan(p_request_key, 'buat', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_buat(uuid, date, date, date, text, uuid) from public, anon, service_role;
grant execute on function public.setoran_buat(uuid, date, date, date, text, uuid) to authenticated;

-- Muat ulang shift tertutup baru ke setoran Draft/Ditolak (alami idempoten; tanpa kunci permintaan).
create function public.setoran_sinkron(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare v_s public.setoran%rowtype; v_n integer;
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak') then raise exception 'SETORAN_STATUS: setoran % tidak dapat diubah.', v_s.status using errcode = '22023'; end if;
  v_n := public.setoran_sinkron_inti(p_id);
  if v_n > 0 then
    update public.setoran set revision = revision + 1 where id = p_id;
    perform public.setoran_log(p_id, 'shift_dimuat', v_s.status, v_s.status, null, jsonb_build_object('baru', v_n));
  end if;
  return jsonb_build_object('id', p_id, 'shift_baru', v_n, 'revision', v_s.revision + case when v_n > 0 then 1 else 0 end);
end $$;
revoke all on function public.setoran_sinkron(uuid) from public, anon, service_role;
grant execute on function public.setoran_sinkron(uuid) to authenticated;

create function public.setoran_tambah_pengeluaran(p_id uuid, p_tanggal date, p_kategori text, p_jumlah numeric, p_deskripsi text, p_lampiran jsonb, p_revision integer, p_request_key uuid) returns jsonb
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
  insert into public.setoran_pengeluaran(id, setoran_id, tanggal, kategori, deskripsi, jumlah, lampiran, entered_by, request_key)
  values (v_line, p_id, p_tanggal, p_kategori, v_desk, p_jumlah, p_lampiran, auth.uid(), p_request_key);
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'pengeluaran_ditambah', v_s.status, v_s.status, left(p_kategori, 60), jsonb_build_object('baris', v_line));
  v_hasil := jsonb_build_object('id', p_id, 'baris_id', v_line, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'tambah_pengeluaran', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_tambah_pengeluaran(uuid, date, text, numeric, text, jsonb, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_tambah_pengeluaran(uuid, date, text, numeric, text, jsonb, integer, uuid) to authenticated;

create function public.setoran_hapus_pengeluaran(p_id uuid, p_baris uuid, p_revision integer, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb;
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
  delete from public.setoran_pengeluaran where id = p_baris and setoran_id = p_id;
  if not found then raise exception 'SETORAN_TIDAK_ADA: baris pengeluaran tidak ditemukan.' using errcode = '22023'; end if;
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'pengeluaran_dihapus', v_s.status, v_s.status, null, jsonb_build_object('baris', p_baris));
  v_hasil := jsonb_build_object('id', p_id, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'hapus_pengeluaran', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_hapus_pengeluaran(uuid, uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_hapus_pengeluaran(uuid, uuid, integer, uuid) to authenticated;

-- Catat transfer/serah tunai ke perusahaan (parsial boleh berkali-kali). Tidak ada jurnal; Finance mengonfirmasi uang masuk.
create function public.setoran_tambah_transfer(p_id uuid, p_tanggal date, p_jumlah numeric, p_metode text, p_rekening uuid, p_lampiran jsonb, p_catatan text, p_revision integer, p_request_key uuid) returns jsonb
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
  insert into public.setoran_transfer(id, setoran_id, tanggal, jumlah, metode, cash_account_id, lampiran, catatan, entered_by, request_key)
  values (v_tr, p_id, p_tanggal, p_jumlah, p_metode, p_rekening, v_lamp, v_cat, auth.uid(), p_request_key);
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'transfer_dicatat', v_s.status, v_s.status, null, jsonb_build_object('transfer', v_tr));
  v_hasil := jsonb_build_object('id', p_id, 'transfer_id', v_tr, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'tambah_transfer', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_tambah_transfer(uuid, date, numeric, text, uuid, jsonb, text, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_tambah_transfer(uuid, date, numeric, text, uuid, jsonb, text, integer, uuid) to authenticated;

create function public.setoran_hapus_transfer(p_id uuid, p_transfer uuid, p_revision integer, p_request_key uuid) returns jsonb
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
  update public.setoran set revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'transfer_dihapus', v_s.status, v_s.status, null, jsonb_build_object('transfer', p_transfer));
  v_hasil := jsonb_build_object('id', p_id, 'status', v_s.status, 'revision', v_s.revision + 1);
  perform public.setoran_simpan_permintaan(p_request_key, 'hapus_transfer', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_hapus_transfer(uuid, uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_hapus_transfer(uuid, uuid, integer, uuid) to authenticated;

-- Finance mengonfirmasi/menolak uang masuk satu transfer. Bukan pembuat transfer; setoran belum final.
create function public.setoran_putuskan_transfer(p_id uuid, p_transfer uuid, p_terima boolean, p_catatan text, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_s public.setoran%rowtype; v_t public.setoran_transfer%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_cat text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_ke text := case when p_terima then 'Dikonfirmasi' else 'Ditolak' end;
begin
  perform admin_online_private.deny_admin_online();
  if not public.setoran_penyetuju() then
    raise exception 'SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat mengonfirmasi transfer.' using errcode = '42501'; end if;
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'transfer', p_transfer, 'terima', p_terima, 'catatan', v_cat);
  v_prior := public.setoran_ulang(p_request_key, 'putuskan_transfer', v_payload);
  if v_prior is not null then return v_prior; end if;
  if p_terima is null then raise exception 'SETORAN_KEPUTUSAN: pilih konfirmasi atau tolak.' using errcode = '22023'; end if;
  if not p_terima and (v_cat is null or length(v_cat) < 3) then raise exception 'SETORAN_ALASAN: alasan penolakan transfer wajib (minimal 3 huruf).' using errcode = '22023'; end if;
  if v_cat is not null and length(v_cat) > 300 then raise exception 'SETORAN_CATATAN: catatan maksimal 300 huruf.' using errcode = '22023'; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak','Diajukan') then raise exception 'SETORAN_STATUS: setoran % sudah final.', v_s.status using errcode = '22023'; end if;
  select * into v_t from public.setoran_transfer where id = p_transfer and setoran_id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: transfer tidak ditemukan.' using errcode = '22023'; end if;
  if v_t.status <> 'Menunggu' then raise exception 'SETORAN_TRANSFER_STATUS: transfer ini sudah diputuskan (%).', v_t.status using errcode = '22023'; end if;
  if auth.uid() = v_t.entered_by then
    raise exception 'SETORAN_PEMISAHAN_TUGAS: Anda mencatat transfer ini, jadi tidak boleh mengonfirmasinya sendiri.' using errcode = '42501'; end if;
  update public.setoran_transfer set status = v_ke, decided_by = auth.uid(), decided_at = now(), catatan_keuangan = v_cat where id = p_transfer;
  perform public.setoran_log(p_id, case when p_terima then 'transfer_dikonfirmasi' else 'transfer_ditolak' end, v_s.status, v_s.status, v_cat, jsonb_build_object('transfer', p_transfer, 'jumlah', v_t.jumlah));
  v_hasil := jsonb_build_object('id', p_id, 'transfer_id', p_transfer, 'status_transfer', v_ke);
  perform public.setoran_simpan_permintaan(p_request_key, 'putuskan_transfer', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_putuskan_transfer(uuid, uuid, boolean, text, uuid) from public, anon, service_role;
grant execute on function public.setoran_putuskan_transfer(uuid, uuid, boolean, text, uuid) to authenticated;

-- Ajukan penutupan: staf menyatakan selesai disetor. Snapshot kewajiban dikunci (hanya untuk penyetuju). Hasil ke pengaju TIDAK memuat angka.
create function public.setoran_ajukan(p_id uuid, p_revision integer, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_h jsonb;
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'revision', p_revision);
  v_prior := public.setoran_ulang(p_request_key, 'ajukan', v_payload);
  if v_prior is not null then return v_prior; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak') then raise exception 'SETORAN_STATUS: setoran % tidak dapat diajukan.', v_s.status using errcode = '22023'; end if;
  if v_s.revision is distinct from p_revision then raise exception 'SETORAN_BERUBAH: setoran sudah berubah; muat ulang.' using errcode = '22023'; end if;
  if exists (select 1 from public.cashier_shifts s where s.branch_id = v_s.branch_id and s.status = 'open'
             and (s.opened_at at time zone 'Asia/Jakarta')::date <= v_s.periode_selesai) then
    raise exception 'SETORAN_SHIFT_TERBUKA: masih ada shift cabang ini yang belum ditutup dan jatuh di periode; tutup shift dulu.' using errcode = '22023'; end if;
  perform public.setoran_periode_terbuka(v_s.periode_selesai);
  perform public.setoran_sinkron_inti(p_id);
  v_h := public.setoran_hitung(p_id);
  insert into public.setoran_keuangan(setoran_id, shift_net, pengeluaran_total, expected_amount, rincian, snapshot_at)
  values (p_id, (v_h ->> 'shift_net')::numeric, (v_h ->> 'pengeluaran_total')::numeric, (v_h ->> 'expected')::numeric, v_h -> 'rincian', now())
  on conflict (setoran_id) do update set shift_net = excluded.shift_net, pengeluaran_total = excluded.pengeluaran_total, expected_amount = excluded.expected_amount,
    rincian = excluded.rincian, snapshot_at = excluded.snapshot_at;
  update public.setoran set status = 'Diajukan', submitted_by = auth.uid(), submitted_at = now(), revision = revision + 1 where id = p_id;
  perform public.setoran_log(p_id, 'diajukan', v_s.status, 'Diajukan', null, '{}'::jsonb);
  v_hasil := jsonb_build_object('id', p_id, 'no_setoran', v_s.no_setoran, 'status', 'Diajukan');
  perform public.setoran_simpan_permintaan(p_request_key, 'ajukan', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_ajukan(uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.setoran_ajukan(uuid, integer, uuid) to authenticated;

create function public.setoran_batalkan_draft(p_id uuid, p_alasan text, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_alasan text := btrim(regexp_replace(coalesce(p_alasan, ''), '\s+', ' ', 'g'));
begin
  perform admin_online_private.deny_admin_online();
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'alasan', v_alasan);
  v_prior := public.setoran_ulang(p_request_key, 'batalkan_draft', v_payload);
  if v_prior is not null then return v_prior; end if;
  if length(v_alasan) not between 3 and 300 then raise exception 'SETORAN_ALASAN: alasan wajib 3 sampai 300 huruf.' using errcode = '22023'; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status not in ('Draft','Ditolak') then raise exception 'SETORAN_STATUS: hanya Draft atau Ditolak yang bisa dibuang.' using errcode = '22023'; end if;
  if exists (select 1 from public.setoran_transfer where setoran_id = p_id and status = 'Dikonfirmasi') then
    raise exception 'SETORAN_TRANSFER_STATUS: ada transfer yang sudah dikonfirmasi Finance; setoran tidak dapat dibuang.' using errcode = '22023'; end if;
  update public.setoran set status = 'Void', void_by = auth.uid(), void_at = now(), void_reason = v_alasan where id = p_id;
  update public.setoran_shift set aktif = false where setoran_id = p_id and aktif;
  perform public.setoran_log(p_id, 'draft_dibuang', v_s.status, 'Void', v_alasan, '{}'::jsonb);
  v_hasil := jsonb_build_object('id', p_id, 'status', 'Void');
  perform public.setoran_simpan_permintaan(p_request_key, 'batalkan_draft', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_batalkan_draft(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.setoran_batalkan_draft(uuid, text, uuid) to authenticated;

create function public.setoran_tolak(p_id uuid, p_alasan text, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare v_s public.setoran%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_alasan text := btrim(regexp_replace(coalesce(p_alasan, ''), '\s+', ' ', 'g'));
begin
  perform admin_online_private.deny_admin_online();
  if not public.setoran_penyetuju() then
    raise exception 'SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menolak setoran.' using errcode = '42501'; end if;
  perform public.setoran_akses_cabang((select branch_id from public.setoran where id = p_id));
  v_payload := jsonb_build_object('id', p_id, 'alasan', v_alasan);
  v_prior := public.setoran_ulang(p_request_key, 'tolak', v_payload);
  if v_prior is not null then return v_prior; end if;
  if length(v_alasan) not between 3 and 300 then raise exception 'SETORAN_ALASAN: alasan wajib 3 sampai 300 huruf.' using errcode = '22023'; end if;
  select * into v_s from public.setoran where id = p_id for update;
  if not found then raise exception 'SETORAN_TIDAK_ADA: setoran tidak ditemukan.' using errcode = '22023'; end if;
  if v_s.status <> 'Diajukan' then raise exception 'SETORAN_STATUS: setoran sudah diputuskan (%).', v_s.status using errcode = '22023'; end if;
  update public.setoran set status = 'Ditolak', decided_by = auth.uid(), decided_at = now(), decision_note = v_alasan where id = p_id;
  perform public.setoran_log(p_id, 'ditolak', 'Diajukan', 'Ditolak', v_alasan, '{}'::jsonb);
  v_hasil := jsonb_build_object('id', p_id, 'status', 'Ditolak');
  perform public.setoran_simpan_permintaan(p_request_key, 'tolak', v_payload, v_hasil);
  return v_hasil;
end $$;
revoke all on function public.setoran_tolak(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.setoran_tolak(uuid, text, uuid) to authenticated;

-- Setujui & tutup periode: posting pengeluaran (post_expense_atomic) + jurnal penyelesaian selisih + kasbon, semua satu transaksi.
create function public.setoran_setujui(p_id uuid, p_request_key uuid, p_penjelasan text, p_alokasi jsonb, p_beban_perusahaan boolean, p_konfirmasi_besar boolean, p_catatan text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_uid uuid := auth.uid(); v_s public.setoran%rowtype; v_k public.setoran_keuangan%rowtype; v_payload jsonb; v_prior jsonb; v_hasil jsonb; v_h jsonb;
  v_pen text := nullif(btrim(coalesce(p_penjelasan, '')), ''); v_cat text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_today date := (now() at time zone 'Asia/Jakarta')::date; v_exp numeric; v_diff numeric; v_abs numeric; v_cash text; v_line record; v_res jsonb; v_tr numeric;
  v_exp_ids uuid[] := '{}'; v_emp uuid[]; v_n integer; v_cents bigint; v_base bigint; v_rem bigint; v_i integer := 0; v_alloc jsonb := '[]'; v_a record;
  v_adv uuid; v_sum numeric; v_jid uuid; v_jl jsonb; v_mode text; v_adv_ids uuid[] := '{}'; v_desc text; v_selesai text;
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
    perform public.sales_write_journal(v_s.periode_selesai, v_s.branch_id, 'setoran', p_id::text, v_desc, v_jl);
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

-- Void: hanya Owner/Finance, jurnal pembalik (selisih + pengeluaran lewat revise_expense_atomic), kasbon dibatalkan bila masih Dicatat.
create function public.setoran_void(p_id uuid, p_alasan text, p_request_key uuid) returns jsonb
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
    perform public.sales_write_journal(v_s.periode_selesai, v_s.branch_id, 'setoran-batal', p_id::text, 'Pembalik setoran ' || v_s.no_setoran || ': ' || v_alasan, v_lines);
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

-- ───────────────────────── 5. Baca: daftar, detail, rekap, SO terakhir (bentuk menurut peran) ─────────────────────────
create function public.setoran_daftar(p_dari date, p_sampai date, p_branch uuid, p_status text, p_kasir uuid) returns jsonb
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
             'sisa', greatest((a.v ->> 'sisa')::numeric, 0), 'transfer_menunggu', (a.v ->> 'transfer_menunggu')::integer,
             'umur_hari', case when s.status = 'Diajukan' then (now() at time zone 'Asia/Jakarta')::date - (s.submitted_at at time zone 'Asia/Jakarta')::date end)
           || (public.setoran_label(s.status, (a.v ->> 'sisa')::numeric, s.jadwal, s.batas_jam))
           || case when s.status = 'Ditolak' then jsonb_build_object('alasan_tolak', s.decision_note) else '{}'::jsonb end
           || case when v_app and s.status in ('Diajukan','Disetujui','Void') and k.setoran_id is not null
                   then jsonb_build_object('diharapkan', k.expected_amount, 'selisih_sementara', ((a.v ->> 'transfer_konfirmasi')::numeric - k.expected_amount),
                          'selisih', k.selisih, 'jenis', k.jenis, 'penyelesaian', k.penyelesaian)
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

create function public.setoran_detail(p_id uuid) returns jsonb
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
    'sisa', greatest(v_sisa, 0), 'persen', case when v_kew - v_peng <= 0 then 100 else least(100, floor(((v_peng + v_tr) / v_kew) * 100)) end,
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
                   from public.setoran_kasbon kb join public.employees e on e.id = kb.employee_id left join public.cash_advances ca on ca.id = kb.advance_id where kb.setoran_id = p_id), '[]'::jsonb)));
    end if;
  end if;
  return v_out;
end $$;
revoke all on function public.setoran_detail(uuid) from public, anon, service_role;
grant execute on function public.setoran_detail(uuid) to authenticated;

create function public.setoran_rekap(p_dari date, p_sampai date, p_branch uuid, p_status text, p_kasir uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cab jsonb; v_tot jsonb; v_aging jsonb; v_pending integer; v_telat integer;
begin
  perform admin_online_private.deny_admin_online();
  if not public.setoran_penyetuju() then
    raise exception 'SETORAN_DITOLAK_PERAN: rekap setoran hanya untuk Owner, Finance, atau Admin.' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('Draft','Diajukan','Disetujui','Ditolak','Void') then
    raise exception 'SETORAN_FILTER: status tidak dikenal.' using errcode = '22023'; end if;
  with f as (
    select s.id, s.branch_id, s.status, b.name as cabang, (a.v ->> 'diharapkan')::numeric as diharapkan, (a.v ->> 'transfer_konfirmasi')::numeric as ok,
           (a.v ->> 'kewajiban')::numeric as kew, (a.v ->> 'pengeluaran')::numeric as peng, (a.v ->> 'sisa')::numeric as sisa, s.jadwal, s.batas_jam
      from public.setoran s join public.branches b on b.id = s.branch_id cross join lateral (select public.setoran_angka(s.id) as v) a
     where public.user_can_access_branch(s.branch_id) and s.status <> 'Void' or (s.status = 'Void' and p_status = 'Void' and public.user_can_access_branch(s.branch_id))
  ), g as (
    select f.* from f join public.setoran s on s.id = f.id
     where (p_dari is null or s.periode_selesai >= p_dari) and (p_sampai is null or s.periode_selesai <= p_sampai)
       and (p_branch is null or s.branch_id = p_branch) and (p_status is null or s.status = p_status)
       and (p_kasir is null or s.created_by = p_kasir or s.submitted_by = p_kasir
            or exists (select 1 from public.setoran_transfer tr where tr.setoran_id = s.id and tr.entered_by = p_kasir)
            or exists (select 1 from public.setoran_shift ss join public.cashier_shifts cs on cs.id = ss.shift_id where ss.setoran_id = s.id and cs.opened_by = p_kasir))
  ), agg as (
    select branch_id, cabang, count(*) as jumlah, count(*) filter (where status = 'Diajukan') as menunggu,
           count(*) filter (where status in ('Draft','Ditolak') and sisa > 0 and ((jadwal + batas_jam)::timestamp at time zone 'Asia/Jakarta') < now()) as terlambat,
           coalesce(sum(kew), 0) as kewajiban, coalesce(sum(peng), 0) as pengeluaran, coalesce(sum(diharapkan), 0) as diharapkan,
           coalesce(sum(ok) filter (where status in ('Diajukan','Disetujui')), 0) as disetor,
           coalesce(sum(diharapkan - ok) filter (where status in ('Diajukan','Disetujui') and ok < diharapkan), 0) as kurang,
           coalesce(sum(ok - diharapkan) filter (where status in ('Diajukan','Disetujui') and ok > diharapkan), 0) as lebih
      from g group by branch_id, cabang
  )
  select coalesce(jsonb_agg(to_jsonb(a) order by a.cabang), '[]'::jsonb),
         jsonb_build_object('jumlah', coalesce(sum(a.jumlah), 0), 'menunggu', coalesce(sum(a.menunggu), 0), 'terlambat', coalesce(sum(a.terlambat), 0),
           'kewajiban', coalesce(sum(a.kewajiban), 0), 'pengeluaran', coalesce(sum(a.pengeluaran), 0), 'diharapkan', coalesce(sum(a.diharapkan), 0),
           'disetor', coalesce(sum(a.disetor), 0), 'kurang', coalesce(sum(a.kurang), 0), 'lebih', coalesce(sum(a.lebih), 0)),
         coalesce(sum(a.terlambat), 0)::integer
    into v_cab, v_tot, v_telat from agg a;
  select jsonb_build_object('hari_0_1', count(*) filter (where d <= 1), 'hari_2_3', count(*) filter (where d between 2 and 3),
           'hari_4_7', count(*) filter (where d between 4 and 7), 'hari_8_plus', count(*) filter (where d >= 8)), count(*)::integer
    into v_aging, v_pending
    from (select (now() at time zone 'Asia/Jakarta')::date - (s.submitted_at at time zone 'Asia/Jakarta')::date as d
            from public.setoran s
           where s.status = 'Diajukan' and public.user_can_access_branch(s.branch_id) and (p_branch is null or s.branch_id = p_branch)
             and (p_kasir is null or s.created_by = p_kasir or s.submitted_by = p_kasir
                  or exists (select 1 from public.setoran_transfer tr where tr.setoran_id = s.id and tr.entered_by = p_kasir)
                  or exists (select 1 from public.setoran_shift ss join public.cashier_shifts cs on cs.id = ss.shift_id where ss.setoran_id = s.id and cs.opened_by = p_kasir))) q;
  return jsonb_build_object('cabang', v_cab, 'total', v_tot, 'umur_menunggu', v_aging, 'menunggu_persetujuan', v_pending, 'terlambat', v_telat);
end $$;
revoke all on function public.setoran_rekap(date, date, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.setoran_rekap(date, date, uuid, text, uuid) to authenticated;

-- Pintasan: hasil opname (SO) terakhir cabang untuk membantu Finance menilai kelebihan uang (tidak ada offset otomatis ke stok).
create function public.setoran_so_terakhir(p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_r record; v_b jsonb; v_kurang numeric; v_lebih numeric;
begin
  perform admin_online_private.deny_admin_online();
  if not public.setoran_penyetuju() then
    raise exception 'SETORAN_DITOLAK_PERAN: hanya untuk Owner, Finance, atau Admin.' using errcode = '42501'; end if;
  perform public.setoran_akses_cabang(p_branch);
  select r.id, r.order_id, r.no_hasil, r.tanggal into v_r from public.opname_results r join public.opname_orders o on o.id = r.order_id join public.warehouses w on w.id = o.warehouse_id
   where w.branch_id = p_branch order by r.tanggal desc, r.created_at desc limit 1;
  if not found then return jsonb_build_object('ada', false); end if;
  begin
    v_b := public.opname_variance_charge_basis(v_r.id);
    v_kurang := nullif(v_b ->> 'jual_kurang', '')::numeric; v_lebih := nullif(v_b ->> 'jual_lebih', '')::numeric;
  exception when others then v_kurang := null; v_lebih := null;
  end;
  return jsonb_build_object('ada', true, 'result_id', v_r.id, 'order_id', v_r.order_id, 'no_hasil', v_r.no_hasil, 'tanggal', v_r.tanggal, 'nilai_jual_kurang', v_kurang, 'nilai_jual_lebih', v_lebih);
end $$;
revoke all on function public.setoran_so_terakhir(uuid) from public, anon, service_role;
grant execute on function public.setoran_so_terakhir(uuid) to authenticated;

-- ───────────────────────── 6. Pemeriksaan pemasangan ─────────────────────────
do $check$
declare t text; f text;
begin
  if not exists (select 1 from role_settings_private.submenu_catalog where id = 'kas-bank.setoran' and module_id = 'kas-bank') then raise exception 'SETORAN_CHECK: katalog sub-menu belum ada'; end if;
  foreach t in array array['setoran','setoran_shift','setoran_keuangan','setoran_pengeluaran','setoran_transfer','setoran_kasbon','setoran_event','setoran_permintaan'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'SETORAN_CHECK: RLS % mati', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'select')
       or has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('service_role', 'public.' || t, 'select') then
      raise exception 'SETORAN_CHECK: klien masih punya hak langsung atas %', t; end if;
  end loop;
  if position('setoran:' in pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure)) = 0
     or position('post_expense_atomic' in pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure)) = 0 then
    raise exception 'SETORAN_CHECK: setujui tidak memakai post_expense_atomic'; end if;
  foreach f in array array['setoran_role()','setoran_penyetuju()','setoran_hitung(uuid)','setoran_angka(uuid)','setoran_log(uuid,text,text,text,text,jsonb)','setoran_ulang(uuid,text,jsonb)'] loop
    if has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') or has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute') then
      raise exception 'SETORAN_CHECK: fungsi internal % dapat dipanggil klien', f; end if;
  end loop;
end $check$;

-- Pagar Admin Online (#549): fungsi SECURITY DEFINER baru diberi penjaga deny_admin_online() dan tabel baru diberi pagar baca/tulis. Idempotent.
select admin_online_private.guard_all();
select admin_online_private.fence_all();
