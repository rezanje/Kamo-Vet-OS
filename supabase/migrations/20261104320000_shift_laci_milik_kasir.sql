-- Laci kasir klinik = tanggung jawab PEMILIKNYA, bukan siapa pun yang bisa membuka halaman.
--
-- Sebelum ini tabel cashier_shifts memakai kebijakan demo `using (true) with check (true)`
-- (0024) yang hanya dibatasi isolasi cabang. Akibatnya, di CABANG YANG SAMA:
--   * OWNER/ADMIN/FINANCE/DOCTOR bisa menutup laci kasir lain (selisih kas & kasbon
--     kurang kas jatuh ke kasir yang tidak menghitung uangnya);
--   * OWNER/ADMIN bisa membukakan laci atas nama orang lain;
--   * laci yang sudah ditutup bisa dibuka kembali / diubah angkanya, termasuk modal awal;
--   * laci bisa dihapus (riwayat uang kehilangan induknya);
--   * pengeluaran tunai bisa ditempelkan ke laci orang lain sehingga target kasnya turun.
--
-- Aturan baru (khusus laci jenis 'klinik', untuk penulis dari aplikasi = peran
-- authenticated/anon):
--   1. Buka laci hanya untuk diri sendiri, dalam keadaan terbuka, modal >= 0.
--   2. Hanya pemilik laci yang boleh menutup lacinya; penutupan wajib lengkap
--      (kas dihitung, target, selisih, waktu tutup).
--   3. Identitas & modal awal laci tidak berubah setelah dibuka. Laci tertutup kekal
--      (tidak bisa dibuka kembali atau diubah) — termasuk oleh pemiliknya.
--   4. Laci tidak bisa dihapus.
--   5. Pengeluaran hanya boleh menempel ke laci klinik TERBUKA milik penulisnya sendiri
--      di cabang yang sama.
-- Akses melihat laci (laporan/riwayat) tidak berubah.
--
-- Satu-satunya pengecualian supervisor adalah aturan yang SUDAH ada di aplikasi
-- (Addendum §1: laci nyangkut > 24 jam boleh ditutup paksa manajer cabang), kini lewat
-- fungsi eksplisit: OWNER/ADMIN aktif dengan akses cabang laci, laci orang lain yang
-- terbuka > 24 jam, alasan wajib, tanpa jurnal/selisih, dan tercatat di tabel audit.
-- Fungsi SECURITY DEFINER (penulis uang yang sudah ada & tutup paksa ini) berjalan
-- sebagai pemilik basis data dan tetap mengikuti penjaganya masing-masing.
--
-- Tidak ada baris riwayat yang dipindah atau diubah oleh migrasi ini.

create or replace function public.cashier_shift_accountability_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.shift_type is distinct from 'klinik' then return new; end if;
    if v_actor is null or new.opened_by is distinct from v_actor then
      raise exception using errcode = '42501',
        message = 'SHIFT_NOT_OWNER: laci klinik hanya bisa dibuka untuk akun sendiri';
    end if;
    if new.status is distinct from 'open' or new.closed_at is not null or new.closing_balance is not null
       or new.expected_cash is not null or new.selisih is not null or new.closing_breakdown is not null
       or new.opening_balance is null or new.opening_balance < 0 then
      raise exception using errcode = '23514',
        message = 'SHIFT_OPEN_INVALID: laci baru harus terbuka dengan modal awal nol atau lebih';
    end if;
    return new;
  end if;

  if old.shift_type is distinct from 'klinik' and (tg_op = 'DELETE' or new.shift_type is not distinct from old.shift_type) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'SHIFT_DELETE_DENIED: laci klinik tidak boleh dihapus';
  end if;
  if v_actor is null or old.opened_by is distinct from v_actor then
    raise exception using errcode = '42501',
      message = 'SHIFT_NOT_OWNER: laci klinik hanya bisa ditutup oleh pemiliknya; laci nyangkut > 24 jam memakai tutup paksa supervisor';
  end if;
  if old.status = 'closed' then
    raise exception using errcode = '42501',
      message = 'SHIFT_CLOSED_IMMUTABLE: laci klinik yang sudah ditutup tidak bisa dibuka kembali atau diubah';
  end if;
  if new.id is distinct from old.id or new.branch_id is distinct from old.branch_id
     or new.opened_by is distinct from old.opened_by or new.shift_type is distinct from old.shift_type
     or new.opening_balance is distinct from old.opening_balance or new.opened_at is distinct from old.opened_at then
    raise exception using errcode = '42501',
      message = 'SHIFT_FIELD_IMMUTABLE: cabang, pemilik, jenis, waktu buka dan modal awal laci tidak bisa diubah';
  end if;
  if new.status is distinct from 'closed' or new.closed_at is null or new.closing_balance is null
     or new.expected_cash is null or new.selisih is null or new.closing_breakdown is null then
    raise exception using errcode = '23514',
      message = 'SHIFT_CLOSE_INCOMPLETE: tutup laci wajib mengisi kas dihitung, target, selisih dan rincian metode';
  end if;
  return new;
end $$;
revoke all on function public.cashier_shift_accountability_guard() from public, anon, authenticated;

drop trigger if exists cashier_shift_accountability_guard on public.cashier_shifts;
create trigger cashier_shift_accountability_guard
  before insert or update or delete on public.cashier_shifts
  for each row execute function public.cashier_shift_accountability_guard();

-- Pengeluaran yang ditulis langsung dari aplikasi (layar pengeluaran klinik) hanya boleh
-- menempel ke laci klinik terbuka milik penulisnya di cabang yang sama.
-- Sengaja BUKAN security definer: `current_user` harus peran penulis sebenarnya, dan laci
-- dibaca dengan RLS penulis (laci cabang yang tidak bisa ia akses dianggap tidak ada).
create or replace function public.expense_shift_owner_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_shift public.cashier_shifts%rowtype;
begin
  if current_user not in ('authenticated', 'anon') or new.shift_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.shift_id is not distinct from old.shift_id and new.branch_id is not distinct from old.branch_id then
    return new;
  end if;
  select * into v_shift from public.cashier_shifts where id = new.shift_id;
  if found and v_shift.shift_type is distinct from 'klinik' then return new; end if;
  if not found or auth.uid() is null or v_shift.opened_by is distinct from auth.uid() or v_shift.status is distinct from 'open'
     or v_shift.branch_id is distinct from new.branch_id then
    raise exception using errcode = '42501',
      message = 'SHIFT_INVALID: pengeluaran hanya boleh dicatat di laci klinik terbuka milik sendiri di cabang yang sama';
  end if;
  return new;
end $$;
revoke all on function public.expense_shift_owner_guard() from public, anon, authenticated;

drop trigger if exists expense_shift_owner_guard on public.expenses;
create trigger expense_shift_owner_guard
  before insert or update of shift_id, branch_id on public.expenses
  for each row execute function public.expense_shift_owner_guard();

-- Jejak tutup paksa supervisor. Hanya ditulis oleh fungsi di bawah.
-- branch_id/drawer_owner/actor_id sengaja TANPA FK: FK ke branches di samping FK ke
-- cashier_shifts menjadikan tabel ini "tabel penghubung" bagi PostgREST, dan embed
-- cashier_shifts -> branches(name) yang sudah ada bisa menjadi ambigu (PGRST201).
create table if not exists public.cashier_shift_supervisor_closures (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references public.cashier_shifts(id) on delete restrict,
  branch_id uuid not null,
  shift_type text not null,
  drawer_owner uuid,
  actor_id uuid not null,
  actor_role text not null,
  reason text not null check (length(btrim(reason)) between 10 and 500),
  opened_at timestamptz not null,
  expected_cash numeric not null,
  closing_breakdown jsonb not null default '{}'::jsonb,
  closed_at timestamptz not null default now()
);
alter table public.cashier_shift_supervisor_closures enable row level security;
revoke all on table public.cashier_shift_supervisor_closures from public, anon, authenticated;
grant select on table public.cashier_shift_supervisor_closures to authenticated;
drop policy if exists cashier_shift_supervisor_closures_read on public.cashier_shift_supervisor_closures;
create policy cashier_shift_supervisor_closures_read on public.cashier_shift_supervisor_closures
  for select to authenticated using (public.user_can_access_branch(branch_id));

create or replace function public.cashier_shift_supervisor_close(
  p_shift_id uuid, p_reason text, p_expected numeric, p_breakdown jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_shift public.cashier_shifts%rowtype;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: sesi tidak valid';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_actor and p.is_active;
  if v_role is null or v_role not in ('OWNER', 'ADMIN') then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: hanya Owner/Admin cabang yang bisa tutup paksa laci';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'SHIFT_SUPERVISOR_DENIED: alasan tutup paksa wajib diisi (10-500 karakter)';
  end if;
  if p_expected is null or p_expected in ('NaN'::numeric, 'Infinity'::numeric) or p_expected < 0
     or jsonb_typeof(coalesce(p_breakdown, 'null'::jsonb)) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'SHIFT_SUPERVISOR_DENIED: target kas laci tidak valid; muat ulang';
  end if;
  select * into v_shift from public.cashier_shifts where id = p_shift_id for update;
  if not found or not public.user_can_access_branch(v_shift.branch_id) then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: laci tidak ditemukan di cabang Anda';
  end if;
  if v_shift.status is distinct from 'open' then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: laci sudah ditutup';
  end if;
  if v_shift.opened_by is not distinct from v_actor then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: laci sendiri ditutup lewat Selesai Shift biasa';
  end if;
  if v_shift.opened_at > now() - interval '24 hours' then
    raise exception using errcode = '42501', message = 'SHIFT_SUPERVISOR_DENIED: tutup paksa hanya untuk laci yang terbuka lebih dari 24 jam';
  end if;

  -- Tanpa hitung fisik: tidak ada kas yang dihitung, jadi selisih 0 dan tanpa jurnal.
  update public.cashier_shifts
     set closing_balance = p_expected, expected_cash = p_expected, selisih = 0,
         closing_breakdown = p_breakdown, closed_at = now(), status = 'closed'
   where id = v_shift.id and status = 'open';
  insert into public.cashier_shift_supervisor_closures
    (shift_id, branch_id, shift_type, drawer_owner, actor_id, actor_role, reason, opened_at, expected_cash, closing_breakdown)
  values
    (v_shift.id, v_shift.branch_id, v_shift.shift_type, v_shift.opened_by, v_actor, v_role, v_reason, v_shift.opened_at, p_expected, p_breakdown);
  return jsonb_build_object('shift_id', v_shift.id, 'status', 'closed', 'expected_cash', p_expected);
end $$;
revoke all on function public.cashier_shift_supervisor_close(uuid, text, numeric, jsonb) from public, anon;
grant execute on function public.cashier_shift_supervisor_close(uuid, text, numeric, jsonb) to authenticated;
