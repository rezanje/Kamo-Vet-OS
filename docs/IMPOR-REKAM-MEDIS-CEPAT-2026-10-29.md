# Impor Rekam Medis mengalir — catatan teknis (29 Oktober 2026)

Laporan asal: satu folder ±1 GB butuh ±6 jam di browser lalu tumbang semalam **tanpa satu pun
riwayat tersimpan**. Produksi saat itu: 0 `visits` dengan `legacy_source_key`.

## Kenapa lambat

| Penyebab | Dampak |
| --- | --- |
| Browser membaca SEMUA workbook dulu, baru menyimpan | memori tab terus naik; crash = semua hilang |
| Satu permintaan server **per file**, berisi byte Excel mentah | 2.000 file = 2.000 unggahan (±1 GB keluar-masuk) |
| Excel diurai **di server** | tiap permintaan kena batas waktu fungsi |
| `import_legacy_medical_record_resolved` dipanggil **per baris** | 20.000 perjalanan ke database |
| `loadIdentityPlan` memuat **seluruh** tabel `customers` + `pets` tiap batch | makin banyak diimpor, makin lambat (kuadratik) |

## Sesudah

```
folder pemilik -> potongan (<=25 file / <=8 MB)
  -> baca byte di tab
  -> urai di Web Worker (pengurai yang SAMA dengan server)
  -> kirim BARIS HASIL URAI (bukan byte Excel) ke satu server action
       -> import_legacy_identity_scan   (1x: mana yang sudah ada + calon pemilik/anabul)
       -> import_legacy_medical_records_bulk (1x per <=150 baris, SATU transaksi)
  -> lepas memori -> potongan berikutnya
```

Pengukuran (`node scripts/ukur-impor-rekam-medis.mjs`), 200 folder / 2.000 kartu / 20.000 riwayat / ±977 MB:

| | permintaan browser | panggilan database |
| --- | --- | --- |
| Sebelum | 2.400 | 22.000 |
| Sesudah | 200 | 400 |

## Keputusan yang perlu diingat

- **`SECURITY INVOKER`, bukan `SECURITY DEFINER`.** Fungsi per baris yang dibungkus menulis
  `customers`/`pets`/`visits`/`medical_records` di bawah RLS pemanggil. Menjalankannya sebagai
  pemilik fungsi akan diam-diam melewati RLS itu. Penjaga perannya tetap `auth.uid()` +
  `public.is_admin()`, sama persis dengan fungsi lama.
- **Aturan identitas tetap di TypeScript.** Database hanya menyaring *calon* (nama ATAU telepon)
  — sengaja lebih luas daripada aturan aplikasi, jadi tidak ada kandidat klarifikasi yang hilang.
  Keputusan "persis / mirip / baru" tetap diambil `identitasPersisRekamMedis` dan
  `klarifikasiIdentitasRekamMedis` yang sudah teruji.
- **Satu baris bermasalah tidak membatalkan 149 lainnya**: tiap baris dibungkus subtransaksi
  (`begin ... exception when others`) di dalam satu transaksi besar.
- **Kiriman berbarengan**: yang kalah di indeks unik `visits_legacy_source_key_global_unique`
  membaca ulang barisnya dan melapor `sudah_ada`, bukan `ditahan`.
- **Batas waktu**: `statement_timeout` peran `authenticated` adalah 8 detik; kedua fungsi baru
  memasang `set statement_timeout = '30s'` di tingkat fungsi, dan ukuran kiriman dibatasi
  150 baris (database menolak di atas 500).
- **Potongan tidak pernah mencampur dua folder pemilik** — kartu satu pemilik perlu dibaca
  bersama supaya alamat/spesies yang kosong bisa dilengkapi dari kartunya yang lain.
- **Titik simpan** disimpan di `localStorage` per pilihan folder (`akar|jumlahFolder|jumlahBerkas|totalBytes`),
  berisi daftar folder yang sudah selesai. Sumber kebenaran tetap database (`legacy_source_key`);
  titik simpan hanya mempercepat.

## Sumber berkas yang bisa ditukar

`src/lib/impor-rekam-medis-sumber.ts` mendefinisikan `SumberImporRekamMedis`
(`daftarFolder()` + `bacaBerkas()`). Hari ini hanya `sumberFolderLokal`. Sumber Google Drive
(service account, folder dibagikan ke akunnya) nanti cukup mengimplementasikan antarmuka itu —
pemotongan, simpan massal, dan lanjut-setelah-putus tidak perlu diubah.
