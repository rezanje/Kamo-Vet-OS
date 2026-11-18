-- Baris jurnal per akun dibaca di database dalam SATU query, bukan 500 baris per permintaan lewat RLS.
--
-- Masalah (diukur di Production 18 Nov 2026): Buku Besar per akun, rincian Kas & Bank per rekening, dan
-- Arus Kas membaca journal_lines + journal_entries per halaman 500 baris. Tiap halaman menghitung ulang
-- jumlah pasti seluruh baris (count exact) dan memeriksa RLS jl_all/je_all PER BARIS (user_can_access_branch
-- dipanggil puluhan ribu kali). Akun Persediaan bulan November (8.831 baris) = 18 halaman x ±2,7 dtk = ±49 dtk;
-- dibaca 6 bersamaan pun masih ±26 dtk dan satu query mencapai ±9 dtk (batas role authenticated 8 dtk).
--
-- Perubahan: satu fungsi baca-saja yang mengembalikan baris yang sama dalam SATU jsonb. Hak baca SAMA dengan
-- RLS je_all/jl_all dan pagar Admin Online: baris tanpa cabang ikut, baris bercabang hanya bila
-- public.user_can_access_branch(cabang) benar (dicek sekali per cabang, bukan sekali per baris), dan akun
-- Admin Online ditolak seperti pada ledger_account_totals. Bentuk setiap baris SAMA dengan hasil PostgREST
-- `journal_lines?select=id,account_id,debit,credit,journal_entries!inner(tanggal,branch_id,source,source_ref,no_jurnal,deskripsi,branches(name))`,
-- diurutkan menurut id baris jurnal (sama dengan order=id), jadi pemanggil lama tidak perlu berubah selain sumbernya.
-- Tidak ada tabel, kebijakan, indeks, atau data yang diubah.
--
-- Filter sama dengan pembaca lama (src/lib/ledger.ts fetchLines): tanggal inklusif dari/sampai; daftar cabang
-- (null = tanpa filter; baris tanpa cabang TIDAK ikut bila daftar diisi, seperti .in()/.eq() PostgREST);
-- daftar akun (null = semua akun).
--
-- Aplikasi tetap berjalan sebelum migrasi ini dipasang: bila fungsi belum ada, pembaca lama dipakai.

create or replace function public.ledger_account_lines(
  p_from date default null,
  p_to date default null,
  p_branch_ids uuid[] default null,
  p_account_ids uuid[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_boleh uuid[];
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
      and (p_from is null or e.tanggal >= p_from)
      and (p_to is null or e.tanggal <= p_to)
      and (p_branch_ids is null or e.branch_id = any(p_branch_ids))
      and (p_account_ids is null or l.account_id = any(p_account_ids))
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.ledger_account_lines(date, date, uuid[], uuid[]) from public, anon;
grant execute on function public.ledger_account_lines(date, date, uuid[], uuid[]) to authenticated;
