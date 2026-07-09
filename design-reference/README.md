# VetOS — Design Reference (dari mockup Aldi/KamoGroup)

> Sumber: `UI_ERP_KAMO_2026-2.pdf` (Canva export, 28 halaman). Diekstrak jadi PNG individual per layar, bukan PDF mentah — alasannya di bagian bawah.

## Kenapa PNG per-layar, bukan PDF langsung / MD / JSON?

- **PDF mentah**: coding agent baca PDF terutama lewat text layer. Mockup ini isinya screenshot rasterized dalam slide Canva — gak ada text layer yang berguna buat layout, cuma gambar. Kalau di-dump sebagai PDF utuh, agent kemungkinan besar cuma dapet metadata/teks anotasi merahnya doang, bukan layout visualnya.
- **JSON**: cocok buat design *tokens* (warna, spacing, radius) — makanya tetep ada di bawah — tapi gak bisa nangkep layout/komposisi visual.
- **MD doang (tanpa gambar)**: itu udah gue kasih di `VetOS_Spec_Addendum_v1.md` — bagus buat schema & logic, tapi kalau tujuannya minta agent niruin **visual** persis kayak di PPT, deskripsi teks gampang meleset (spacing, proporsi, hierarchy visual susah dijelasin akurat pake kata-kata).
- **PNG per layar + index MD ini**: setiap file gambar bisa langsung "dilihat" sama coding agent yang support vision (Claude Code bisa). Satu file = satu layar = paling presisi buat one-shot prompt.

**Cara pakai:** taruh folder `design-reference/` ini di root project lo. Pas mulai prompt ke agent, reference filepath-nya langsung, jangan cuma bilang "liat mockup gue" — kasih path eksplisit. Contoh di bagian paling bawah file ini.

---

## Design Tokens (hasil sampling warna dari mockup, bukan tebakan)

```
--color-klinik-primary: #08408c;     /* header bar KAMO CLINIC */
--color-petshop-primary: #0038a6;    /* header bar KAMO PETSHOP */
--color-sidebar-navy: #031f59;       /* sidebar tema "Biru Tua" */
--color-bg-app: #f4f7fc;             /* background utama — OFF-WHITE kebiruan tipis, BUKAN pure white */
--color-surface-card: #ffffff;       /* card/panel di atas background */
```

> ⚠️ **Flag buat lo**: background app di mockup ini `#f4f7fc` (off-white kebiruan), bukan pure white murni. Ini beda dari preferensi desain lo yang biasanya pure white background. Kalau lo mau tetep pure white ala preferensi lo, bilang eksplisit ke agent buat override token ini — kalau enggak, agent bakal niru persis dari screenshot (termasuk yang off-white ini).

Badge status warna (dari observasi visual, bukan sampling presisi — cocokkan manual pas review kode):
- Biru = status menunggu/info
- Hijau = status selesai/disetujui/sehat
- Orange/kuning = status proses/pending
- Merah = status ditolak/kritis

Font: mockup pakai sans-serif standar (kemungkinan Inter/Poppins/system default Canva) — **belum final**, ini bukan brand typography KamoGroup, cuma placeholder desain. Perlu dikonfirmasi/diganti sesuai brand guideline mereka kalau ada.

---

## Struktur Folder

```
design-reference/
├── README.md              (file ini)
├── petshop/                8 layar — kasir, shift, pengeluaran, persediaan, quest
├── klinik/                 15 layar — pendaftaran, antrian, rekam medis, rawat inap, invoice
└── shared/                 2 layar — contoh 2 opsi tema (navy vs biru)
```

## Index Layar — Petshop

| File | Layar | Modul terkait (spec addendum) | Catatan |
|---|---|---|---|
| `01-shift-start.png` | Mulai Shift — input modal kasir | Section 1 | Layar awal wajib sebelum akses POS |
| `02-kasir-pos-main.png` | POS utama — data customer, produk, cart, payment | Section 6 | Ada anotasi merah: notif promo, tambah pot per item, kode voucher, cetak struk detail promo |
| `03-kasir-reminder-promo-base.png` | POS dengan cart terisi | Section 6 | Base state sebelum popup muncul |
| `03-kasir-reminder-promo-popup.png` | Popup "Reminder Promo" (Bundling/Tebus Murah) | Section 6 | Overlay non-blocking di atas layar POS |
| `04-pengeluaran.png` | Input & daftar pengeluaran operasional | — | Belum ada di spec addendum, cukup CRUD sederhana |
| `05-persediaan-permintaan-list.png` | List Permintaan Barang dengan status badge | Section 5 | Tab Permintaan Barang / Penerimaan Barang |
| `06-buat-permintaan-barang.png` | Form buat permintaan stok ke gudang | Section 5 | |
| `07-penerimaan-barang.png` | Form terima barang, dipesan vs diterima | Section 5 | Ada scan barcode |
| `08-quest-dashboard.png` | Dashboard Quest — poin, streak, leaderboard, reward | Section 8 | |

## Index Layar — Klinik

| File | Layar | Modul terkait (spec addendum) | Catatan |
|---|---|---|---|
| `01-shift-start.png` | Mulai Shift klinik | Section 1 | |
| `02-welcome-menu-a.png` / `-b.png` | Menu utama: Pendaftaran/Antrian/Rawat Inap/Lain-lain | — | Ada anotasi "Tambah data cabang" — 2 file mirip, pakai salah satu aja sebagai referensi utama |
| `03-pendaftaran-pasien-a.png` / `-b.png` | Form pendaftaran pasien baru | — | Data Pemilik + Data Pasien (hewan) + Riwayat Kesehatan. Anotasi: "bisa panggil data anabul existing", "simpan dan pembayaran" |
| `04-antrian-pasien.png` | Dashboard antrian real-time | Section 4 | |
| `05-detail-pasien-riwayat-medis.png` | Detail pasien — timeline riwayat medis | — | Tab: Riwayat Medis / Rawat Inap / Resep-Racikan / Invoice |
| `06-rekam-medis-pasien-a.png` | Layar rekam medis — input diagnosa + obat/jasa | Section 2 | |
| `06-rekam-medis-pasien-b-annotated.png` | Sama seperti `-a` tapi ada anotasi merah "Tambah resepnya" | Section 2 | **Ini revision note Aldi, bukan desain final** — treat sebagai requirement (resep perlu ditambahkan), bukan literal visual |
| `07-rekam-medis-rawat-inap-popup.png` | Popup "Catatan Rawat Inap — rencana tindakan dari dokter PIC" | Section 3 | |
| `08-status-rawat-inap-dashboard.png` | Dashboard rawat inap semua cabang | Section 3 | Card: Total/Hari Ini/Sembuh/Kritis |
| `09-laporan-rawat-inap.png` | Laporan harian per pasien rawat inap | Section 3 | |
| `10-rawat-inap-form.png` | Form input tindakan rawat inap harian | Section 3 | Anotasi: "Tambah Kondisi: Sembuh, Stabil, Kritis, RIP" |
| `11-racik-obat.png` | Layar racik obat untuk apoteker/PCA | Section 2 | Tabel komposisi + instruksi racik |
| `12-invoice-pembayaran-a.png` / `-b.png` | Invoice & pembayaran | Section 7 | Anotasi: "Buat bisa di edit" |
| `13-pengeluaran.png` | Pengeluaran klinik (sama pola dengan petshop) | — | |
| `14-permintaan-barang.png` | Permintaan barang klinik | Section 5 | |
| `15-cetak-rekam-medis.png` | Print-out rekam medis (letterhead KAMO PET CARE + QR code + ttd) | — | Referensi buat fitur export/print, bukan layar in-app |

## Index Layar — Shared

| File | Layar | Catatan |
|---|---|---|
| `theme-navy-dark.png` | Opsi tema sidebar navy tua | **Perlu keputusan final** sebelum agent mulai styling — lihat sub-bab di chat sebelumnya |
| `theme-blue.png` | Opsi tema sidebar biru | Sama seperti di atas |

---

## Cara Pakai — One-Shot Prompt Template

Gabungkan folder ini dengan `VetOS_Spec_Addendum_v1.md` dalam satu prompt ke coding agent lo. Contoh:

```
Baca design-reference/README.md dan design-reference/klinik/*.png sebagai
referensi visual, dan VetOS_Spec_Addendum_v1.md sebagai referensi
schema + business logic.

Implementasikan Section 1 (Shift & Cash Reconciliation) untuk modul Klinik:
- Layout & komponen visual: ikuti design-reference/klinik/01-shift-start.png
- Schema & logic: ikuti Section 1 di VetOS_Spec_Addendum_v1.md
- Warna: pakai token di design-reference/README.md, TAPI ganti
  --color-bg-app ke pure white (#ffffff), bukan #f4f7fc dari mockup asli
- Stack: Next.js 15 App Router, Tailwind, Supabase, TanStack Query v5
- Style layout mengikuti gambar SEDEKAT MUNGKIN, tapi tetap responsive
  (mockup cuma desktop — buatin breakpoint mobile yang masuk akal
  mengikuti pola yang sama)
```

Prompt per section (bukan sekaligus semua 15+ layar) biar hasil lebih akurat dan gampang direview satu-satu.
