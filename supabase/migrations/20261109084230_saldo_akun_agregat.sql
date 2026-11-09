-- Saldo per akun dihitung di database, bukan dengan menarik seluruh baris jurnal ke aplikasi.
-- Versi riwayat Production: 20261109084230 (dipasang 9 Nov 2026 lewat Management API). Isi fungsi,
-- hak EXECUTE, dan indeks = berkas ini; yang dipasang hanya memakai komentar pembuka yang lebih pendek.
--
-- Masalah (Production 9 Nov 2026, ±15.08 WIB): Kas & Bank menampilkan "Application error" dan
-- halaman lain ikut lambat. Saldo tiap rekening (Kas & Bank, Rekening, Transfer, Kas masuk/keluar,
-- Dashboard, Neraca, Laba Rugi, Buku Besar, dst.) dihitung dengan membaca SEMUA baris
-- journal_lines sejak awal (500 baris per permintaan), lalu dijumlah di aplikasi. Setiap permintaan
-- itu juga menghitung ulang jumlah pasti seluruh baris (count exact), dan setiap baris diperiksa RLS
-- jl_all (subquery journal_entries + user_can_access_branch). Makin banyak transaksi, makin banyak
-- permintaan dan makin berat tiap permintaannya — sampai melewati batas 8 detik role `authenticated`
-- atau datanya "berubah selama pembacaan" karena kasir terus memposting jurnal di jam ramai.
-- Halamannya melempar galat dan pengguna melihat layar error.
--
-- Perubahan: satu fungsi baca-saja yang mengembalikan total debit/kredit per akun dalam SATU query.
-- Tidak ada tabel, kebijakan, atau data yang diubah.
--
-- Hak baca SAMA dengan RLS jl_all/je_all: baris jurnal tanpa cabang (branch_id null) ikut, baris
-- bercabang hanya bila public.user_can_access_branch(cabang) benar. Bedanya, pengecekan cabang
-- dilakukan sekali per cabang (beberapa baris di tabel branches), bukan sekali per baris jurnal.
-- Karena itu fungsi ini SECURITY DEFINER; ia tidak pernah mengembalikan baris yang tidak boleh
-- dilihat pemanggil lewat tabelnya langsung. Kesetaraan dibuktikan di
-- scripts/test-saldo-akun-agregat-postgres.py.
--
-- Filter sama dengan pembaca lama di aplikasi (src/lib/ledger.ts fetchLines): tanggal inklusif
-- dari/sampai, dan daftar cabang (null = tanpa filter cabang; baris tanpa cabang TIDAK ikut bila
-- daftar cabang diisi, persis seperti .in()/.eq() PostgREST).
--
-- Hasil berupa satu jsonb (bukan set baris) supaya tidak terpotong batas max-rows PostgREST.
-- Aplikasi tetap bisa jalan sebelum migrasi ini dipasang: bila fungsi belum ada, ia kembali ke
-- pembaca lama.

create or replace function public.ledger_account_totals(
  p_from date default null,
  p_to date default null,
  p_branch_ids uuid[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_boleh uuid[];
begin
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
        and (p_from is null or e.tanggal >= p_from)
        and (p_to is null or e.tanggal <= p_to)
        and (p_branch_ids is null or e.branch_id = any(p_branch_ids))
      group by l.account_id
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.ledger_account_totals(date, date, uuid[]) from public, anon;
grant execute on function public.ledger_account_totals(date, date, uuid[]) to authenticated;

-- Penyaring periode (Neraca/Laba Rugi/Dashboard tahun berjalan) dan Buku Besar per akun.
create index if not exists journal_entries_tanggal_idx on public.journal_entries(tanggal);
create index if not exists journal_lines_account_id_idx on public.journal_lines(account_id);
