-- Input PENGELUARAN dengan tanggal mundur (backdate) — back office /pos/expense dan /buku-besar/beban, kasir petshop /kasir/pengeluaran, klinik /klinik/pengeluaran.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Permintaan Andri (23 Nov 2026): "yang input pengeluaran bisa backdate tgl udah bisa? ... klinik juga tolong dikerjakan"; koreksi (pesan 5253):
-- "ga perlu khusus owner, ini bisa dilakukan oleh semua akun".  KEPUTUSAN OWNER: SEMUA akun yang sudah boleh input pengeluaran boleh memakai tanggal mundur.
-- Tidak ada izin baru dan tidak ada pembatasan peran. Yang ditambahkan adalah PENGAMAN (bukan pembatas peran):
--  * tanggal sebelum hari ini (WIB) wajib beralasan (3-200 huruf) dan paling lama 31 hari ke belakang;
--  * tanggal masa depan tetap ditolak, periode akuntansi yang ditutup tetap ditolak (pesan lama), rekonsiliasi bank pada/sesudah tanggal itu ditolak
--    untuk rekening kas/bank yang dipakai;
--  * jejak tak bisa diubah (expense_backdates: pelaku, waktu nyata, tanggal efektif, alasan);
--  * lubang INSERT langsung ke public.expenses oleh peran klien dengan tanggal bebas ditutup (harus lewat post_expense_atomic).
-- Kategori pengeluaran tidak memuat gaji/komisi, jadi aturan "bulan sudah digaji" (versi penjualan) tidak relevan dan tidak dipasang.
-- Tanggal hari ini: tidak berubah sama sekali (tanpa alasan, tanpa baris jejak, hasil identik).
-- Konteks kasir/klinik: uang tunai keluar dari laci shift terbuka SEKARANG (expenses.shift_id; tutup shift menghitung per shift_id) sedangkan jurnal jatuh di tanggal mundur.
-- Fungsi lama yang ditambal (berjangkar, gagal-tertutup bila jangkar bergeser): post_expense_atomic. Penanda: BACKDATE_PENGELUARAN.

set local lock_timeout = '5s';

-- ───────────────────────── 1. Jejak ─────────────────────────
-- expense_id sengaja TANPA foreign key (pelajaran: tabel jejak tidak boleh menahan baris yang fungsi lain dapat menghapus); unik = satu jejak per pengeluaran.
create table public.expense_backdates(
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null unique,
 actor_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id),
 context text not null check(context in ('cashier','clinic','backoffice')),
 request_key text not null check(length(request_key) between 1 and 120),
 effective_date date not null,
 reason text not null check(length(btrim(reason)) between 3 and 200),
 recorded_at timestamptz not null default now(),
 shift_id uuid,
 kategori text not null,
 jumlah numeric not null check(jumlah>0),
 unique(actor_id,request_key),
 constraint expense_backdates_date_check check(effective_date<(recorded_at at time zone 'Asia/Jakarta')::date
   and effective_date>=(recorded_at at time zone 'Asia/Jakarta')::date-31)
);
create index expense_backdates_branch_idx on public.expense_backdates(branch_id,effective_date);
comment on table public.expense_backdates is 'Pengeluaran bertanggal mundur: pelaku, waktu nyata (recorded_at), tanggal efektif, alasan. Tidak dapat diubah atau dihapus.';
alter table public.expense_backdates enable row level security;
create policy expense_backdates_read on public.expense_backdates for select to authenticated
 using (public.user_can_access_branch(branch_id)
  and (actor_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN','FINANCE'))));
revoke all on public.expense_backdates from public,anon,authenticated,service_role;
grant select on public.expense_backdates to authenticated;

create function public.guard_expense_backdates() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Jejak tanggal mundur pengeluaran tidak dapat diubah atau dihapus';
end $$;
revoke all on function public.guard_expense_backdates() from public,anon,authenticated,service_role;
create trigger expense_backdates_guard before update or delete on public.expense_backdates for each row execute function public.guard_expense_backdates();
create trigger expense_backdates_guard_truncate before truncate on public.expense_backdates for each statement execute function public.guard_expense_backdates();

-- ───────────────────────── 2. Pemeriksaan (internal; hanya dipanggil post_expense_atomic) ─────────────────────────
-- NULL = bukan tanggal mundur (hari ini); selain itu alasan yang sudah dirapikan. Galat bila alasan kurang / lebih dari 31 hari.
create function public.expense_backdate_precheck(p_date date, p_reason text) returns text language plpgsql stable set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Jakarta')::date; v_reason text:=btrim(coalesce(p_reason,''));
begin
 if p_date is null then raise exception 'Tanggal mundur: tanggal pengeluaran belum dipilih.' using errcode='22023';end if;
 if p_date>=today then return null;end if;
 if length(v_reason) not between 3 and 200 then
  raise exception 'Tanggal mundur: alasan wajib diisi (3-200 huruf) untuk pengeluaran bertanggal sebelum hari ini.' using errcode='22023';end if;
 if today-p_date>31 then
  raise exception 'Tanggal mundur: paling lama 31 hari ke belakang. Lebih lama dari itu perlu koreksi pembukuan, bukan input pengeluaran.' using errcode='22023';end if;
 return v_reason;
end $$;
revoke all on function public.expense_backdate_precheck(date,text) from public,anon,authenticated,service_role;

-- Rekonsiliasi bank yang sudah mencakup rekening yang dipakai pada/sesudah tanggal itu: ditolak (tunai tidak punya rekonsiliasi bank).
create function public.expense_backdate_bank_check(p_date date, p_cash_code text) returns void language plpgsql stable set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 if p_date>=today then return;end if;
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
   left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
   where r.voided_at is null and r.tanggal>=p_date and (c.id is null or c.code=p_cash_code)) then
  raise exception 'Tanggal mundur: rekonsiliasi bank sudah mencakup rekening pembayaran ini pada/sesudah tanggal itu; koreksi rekonsiliasi dahulu atau pilih rekening/tanggal lain.' using errcode='22023';end if;
end $$;
revoke all on function public.expense_backdate_bank_check(date,text) from public,anon,authenticated,service_role;

-- ───────────────────────── 3. Gerbang INSERT/UPDATE langsung (database memutuskan, bukan layar) ─────────────────────────
-- SECURITY INVOKER: current_user = peran penulis sebenarnya. Penulis legal (post_expense_atomic, revise_expense_atomic, refund/retur/biaya merchant/J03) adalah
-- SECURITY DEFINER milik postgres, jadi tidak terpengaruh. service_role tidak digerbang (kunci server tepercaya).
create function public.expense_date_gate() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('authenticated','anon') then return new;end if;
 if tg_op='UPDATE' then
  if new.tanggal is not distinct from old.tanggal then return new;end if;
  raise exception 'Tanggal mundur: tanggal pengeluaran tidak dapat diubah langsung; gunakan Ubah/Koreksi pada layar Pengeluaran (berjejak).' using errcode='42501';end if;
 if new.tanggal is distinct from (now() at time zone 'Asia/Jakarta')::date then
  raise exception 'Tanggal mundur: pengeluaran bertanggal selain hari ini hanya dapat dicatat lewat layar Pengeluaran (dengan alasan), bukan langsung ke tabel.' using errcode='42501';end if;
 return new;
end $$;
revoke all on function public.expense_date_gate() from public,anon,authenticated,service_role;
drop trigger if exists a0_expense_date_gate on public.expenses;
create trigger a0_expense_date_gate before insert or update of tanggal on public.expenses for each row execute function public.expense_date_gate();

-- ───────────────────────── 4. Tambalan berjangkar post_expense_atomic ─────────────────────────
do $patch$
declare
 signature regprocedure:='public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure;
 body text;
 anchors text[]:=array[
  -- 1. sebelum pemeriksaan periode tutup: alasan wajib + paling lama 31 hari untuk tanggal sebelum hari ini
  $a$ perform 1 from public.accounting_locks where id for share;$a$,
  -- 2. sesudah akun kas/bank ditentukan: rekonsiliasi bank
  $a$ else cash_code:=public.unit_posting_cash(method,branch);
 end if;$a$,
  -- 3. sesudah jurnal terhubung: jejak tanggal mundur (satu transaksi dengan dokumen dan jurnal)
  $a$ update public.expenses set journal_entry_id=journal where id=doc;$a$
 ];
 replacements text[]:=array[
  $r$ -- BACKDATE_PENGELUARAN: alasan wajib (3-200) dan paling lama 31 hari untuk tanggal sebelum hari ini; hari ini = tidak ada pemeriksaan tambahan.
 perform public.expense_backdate_precheck(d,p_expense->>'alasan_tanggal');
 perform 1 from public.accounting_locks where id for share;$r$,
  $r$ else cash_code:=public.unit_posting_cash(method,branch);
 end if;
 -- BACKDATE_PENGELUARAN: rekonsiliasi bank pada/sesudah tanggal mundur untuk rekening ini ditolak.
 perform public.expense_backdate_bank_check(d,cash_code);$r$,
  $r$ update public.expenses set journal_entry_id=journal where id=doc;
 -- BACKDATE_PENGELUARAN: jejak tidak dapat diubah (pelaku, waktu nyata, tanggal efektif, alasan).
 if d<(now() at time zone 'Asia/Jakarta')::date then
   insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,shift_id,kategori,jumlah)
   values(doc,auth.uid(),branch,p_context,p_request_key,d,btrim(p_expense->>'alasan_tanggal'),case when p_context in ('cashier','clinic') then shift.id else null end,category,amount);
 end if;$r$
 ];
 i integer;
begin
 body:=pg_get_functiondef(signature);
 if position('BACKDATE_PENGELUARAN' in body)>0 then
  raise exception 'BACKDATE_PENGELUARAN patch already present; verify migration history';end if;
 for i in 1..array_length(anchors,1) loop
  if (length(body)-length(replace(body,anchors[i],'')))/length(anchors[i])<>1 then
   raise exception 'BACKDATE_PENGELUARAN anchor % not found exactly once; review post_expense_atomic',i;end if;
  body:=replace(body,anchors[i],replacements[i]);
 end loop;
 execute body;
end $patch$;

-- Hak tidak berubah oleh CREATE OR REPLACE; ditegaskan ulang agar kontraknya terlihat.
revoke all on function public.post_expense_atomic(text,text,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.post_expense_atomic(text,text,uuid,jsonb,jsonb) to authenticated;

-- Pemeriksaan pemasangan: fungsi tertambal dan gerbang terpasang.
do $check$
begin
 if position('BACKDATE_PENGELUARAN' in pg_get_functiondef('public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure))=0 then
  raise exception 'BACKDATE_PENGELUARAN marker missing after patch';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.expenses'::regclass and tgname='a0_expense_date_gate' and not tgisinternal) then
  raise exception 'BACKDATE_PENGELUARAN gate trigger missing';end if;
end $check$;

-- Pagar Admin Online (#549): fungsi SECURITY DEFINER baru diberi penjaga deny_admin_online() dan tabel baru diberi pagar baca/tulis. Idempotent.
select admin_online_private.guard_all();
select admin_online_private.fence_all();
