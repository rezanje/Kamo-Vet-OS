-- Saldo awal Kas Toko ikut cabangnya (laporan finance, 18 Nov 2026).
--
-- Jurnal saldo awal (source 'saldo-awal') adalah satu jurnal gabungan tanpa cabang ("Pusat"). Akun Kas Toko
-- 110004–110021 terikat ke cabang (cash_accounts.branch_id), dan semua transaksi harian / transfer kas toko
-- dicatat atas nama cabangnya. Akibatnya laporan per cabang (Buku Besar, Neraca, Neraca Saldo dengan filter
-- cabang) tidak memuat saldo awal kas toko, sedangkan tampilan "Pusat" hanya berisi saldo awalnya.
--
-- 1. Untuk setiap rekening kas/bank yang terikat cabang dan punya saldo di jurnal saldo awal Pusat, buat
--    sepasang jurnal pemindahan (source 'saldo-awal-cabang', source_ref = kode akun, tanggal = tanggal saldo awal):
--      Pusat : Dr 410001 Modal Pemilik / Cr Kas Toko X
--      Cabang: Dr Kas Toko X           / Cr 410001 Modal Pemilik
--    Total seluruh perusahaan tidak berubah; jurnal saldo awal asli tidak disentuh. Idempoten per kode akun.
-- 2. Koreksi saldo awal moneter (monetary_opening_context) untuk akun yang sudah dipindah memakai cabang
--    rekening, bukan Pusat, supaya koreksi berikutnya tidak memecah saldo lagi.
--
-- Rollback: lihat docs/2026-11-18-saldo-awal-kas-toko-ke-cabang.md.

do $$
declare
  r record;
  equity uuid;
  e_pusat uuid;
  e_cabang uuid;
  dibuat integer := 0;
begin
  for r in
    select e.tanggal, e.no_jurnal, c.coa_code, c.nama, c.branch_id, b.name as branch_name, l.account_id,
           sum(l.debit - l.credit) as amt
      from public.journal_entries e
      join public.journal_lines l on l.entry_id = e.id
      join public.coa_accounts a on a.id = l.account_id
      join public.cash_accounts c on c.coa_code = a.code and c.branch_id is not null
      join public.branches b on b.id = c.branch_id
     where e.source = 'saldo-awal' and e.branch_id is null and e.voided_at is null
     group by e.tanggal, e.no_jurnal, c.coa_code, c.nama, c.branch_id, b.name, l.account_id
    having sum(l.debit - l.credit) <> 0
     order by c.coa_code
  loop
    if exists (select 1 from public.journal_entries where source = 'saldo-awal-cabang' and source_ref = r.coa_code) then
      continue;
    end if;
    if equity is null then
      select id into equity from public.coa_accounts
       where code = '410001' and type = 'EKUITAS' and not is_header and is_active;
      if equity is null then
        raise exception 'Akun 410001 Modal Pemilik tidak tersedia; pemindahan saldo awal kas toko dibatalkan';
      end if;
    end if;

    e_pusat := gen_random_uuid();
    e_cabang := gen_random_uuid();
    insert into public.journal_entries(id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id) values
      (e_pusat, public.sales_next_number('JRN', r.tanggal), r.tanggal,
       'Pindah saldo awal ' || r.nama || ' ke ' || r.branch_name || ' (keluar dari Pusat, asal ' || r.no_jurnal || ')',
       'saldo-awal-cabang', r.coa_code, null);
    insert into public.journal_lines(entry_id, account_id, debit, credit) values
      (e_pusat, equity,       greatest(r.amt, 0),  greatest(-r.amt, 0)),
      (e_pusat, r.account_id, greatest(-r.amt, 0), greatest(r.amt, 0));

    insert into public.journal_entries(id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id) values
      (e_cabang, public.sales_next_number('JRN', r.tanggal), r.tanggal,
       'Pindah saldo awal ' || r.nama || ' ke ' || r.branch_name || ' (masuk ke cabang, asal ' || r.no_jurnal || ')',
       'saldo-awal-cabang', r.coa_code, r.branch_id);
    insert into public.journal_lines(entry_id, account_id, debit, credit) values
      (e_cabang, r.account_id, greatest(r.amt, 0),  greatest(-r.amt, 0)),
      (e_cabang, equity,       greatest(-r.amt, 0), greatest(r.amt, 0));

    dibuat := dibuat + 1;
  end loop;
  raise notice 'Saldo awal dipindah ke cabang untuk % akun', dibuat;
end $$;

-- Koreksi saldo awal moneter: akun yang saldo awalnya sudah dipindah ke cabang dikoreksi di cabang rekening.
do $$
declare
  def text;
  lama constant text := 'posting_branch:=original.branch_id;';
begin
  if to_regprocedure('public.monetary_opening_context(uuid)') is null then
    return;
  end if;
  def := pg_get_functiondef('public.monetary_opening_context(uuid)'::regprocedure);
  if position('saldo-awal-cabang' in def) > 0 then
    return;
  end if;
  if position(lama in def) = 0 then
    raise exception 'monetary_opening_context berubah bentuk; periksa manual sebelum memasang migrasi ini';
  end if;
  def := replace(def, lama,
    'posting_branch:=case when original.source=''saldo-awal'' and account.branch_id is not null'
    || ' and exists(select 1 from public.journal_entries x where x.source=''saldo-awal-cabang'''
    || ' and x.source_ref=account.coa_code and x.branch_id=account.branch_id and x.voided_at is null)'
    || ' then account.branch_id else original.branch_id end;');
  execute def;
end $$;
