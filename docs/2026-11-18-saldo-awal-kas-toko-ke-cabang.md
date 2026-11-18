# Saldo awal Kas Toko ikut cabangnya (18 Nov 2026)

Pelapor: finance (grup klinik, 18 Nov 14.26–14.27), diteruskan Reza: "kas kas ini minta tolong di hubungkan ke
cabang mas, soalnya saya transfer kas nya kan percabang yaa. ini jadi gak ketarik saldonya" + tangkapan layar
akun 110004–110019 dengan saldo.

## Penyebab

- Rekening Kas Toko 110004–110021 **sudah** terikat cabang (`20261107010000`), dan semua transaksi harian,
  pengeluaran, tutup shift, dan transfer kas toko dicatat atas nama cabangnya.
- Tetapi saldo awal per 31 Okt 2026 (JRN-202610-0021, source `saldo-awal`) adalah **satu jurnal gabungan tanpa
  cabang** ("Pusat"). Angka di tangkapan layar persis sama dengan baris saldo awal itu (BTKM 2.437.500, CIAWI
  2.340.000, … Vet PDRY 175.830, Vet TKI dan Vet GRLG kosong karena tidak punya saldo awal).
- Akibatnya laporan per cabang (Buku Besar / Neraca / Neraca Saldo dengan filter cabang) tidak memuat saldo awal
  kas toko — transfer/setoran dari kas toko bisa terlihat minus — sedangkan tampilan Pusat hanya berisi saldo
  awalnya. Saldo gabungan seluruh perusahaan sudah benar.

## Perbaikan

Migrasi `supabase/migrations/20261130300000_saldo_awal_kas_toko_ke_cabang.sql`:

1. Untuk tiap rekening kas/bank yang terikat cabang dan punya saldo di jurnal saldo awal Pusat, dibuat sepasang
   jurnal pemindahan bertanggal saldo awal (source `saldo-awal-cabang`, source_ref = kode akun):
   - Pusat: Dr 410001 Modal Pemilik / Cr Kas Toko X
   - Cabang: Dr Kas Toko X / Cr 410001 Modal Pemilik
   Jurnal saldo awal asli tidak diubah; total seluruh perusahaan tidak berubah; neraca per cabang tetap seimbang.
   Idempoten per kode akun.
2. `monetary_opening_context` ditambal (penggantian satu baris lewat `pg_get_functiondef`): koreksi saldo awal
   moneter untuk akun yang sudah dipindah diposting di cabang rekening, bukan Pusat. Akun tanpa cabang tetap Pusat.
3. Label sumber `saldo-awal-cabang` di Mutasi Rekening dan Daftar Jurnal.

Pratinjau Production (baca-saja, 18 Nov): 15 akun dipindah (110004–110016, 110018, 110020). 110017 Vet TKI,
110019 Vet GRLG, 110021 Vet GRND tidak punya saldo awal → tidak berubah. Contoh saldo per cabang sesudah:
BTKM 13.905.500 → 16.343.000; Vet CMS 2.827.500 → 3.138.000.

## Verifikasi lokal

`python3 -I scripts/test-saldo-awal-kas-toko-cabang-postgres.py` — PostgreSQL 16 sekali pakai, 455 migrasi,
bentuk data meniru Production: no-op tanpa saldo awal; terapkan ulang tanpa perubahan; saldo gabungan semua akun
tidak berubah; saldo per cabang = saldo awal + transaksi cabang; saldo Pusat kas toko jadi 0; akun tanpa cabang
(110001) tetap di Pusat; semua jurnal seimbang; jurnal asli utuh; koreksi saldo awal moneter jatuh di cabang
rekening (tidak membuka saldo Pusat lagi), akun tanpa cabang tetap Pusat. `tsc --noEmit`, eslint berkas ubahan,
vitest jurnal/rekening lulus.

## Rilis

1. Terapkan migrasi ke Production (satu transaksi). NOTICE: "Saldo awal dipindah ke cabang untuk 15 akun".
2. Kueri cek:

```sql
select count(*) from journal_entries where source='saldo-awal-cabang';            -- 30
select a.code, sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id
  join coa_accounts a on a.id=l.account_id where a.code between '110004' and '110021' and e.branch_id is null
  group by 1 having sum(l.debit-l.credit)<>0;                                       -- 0 baris (sisa kas-entry batal = 0)
```

3. Cek live: Buku Besar filter cabang (mis. Kamo Petshop Bantarkemang) → Kas Toko BTKM memuat saldo awal.

## Rollback

Batalkan pasangan jurnal `saldo-awal-cabang` (hapus 30 jurnal itu sebagai superuser selama belum ada koreksi
saldo awal moneter yang memakainya), lalu kembalikan `monetary_opening_context` dengan mengganti ekspresi
`case … end` kembali ke `posting_branch:=original.branch_id;`.
