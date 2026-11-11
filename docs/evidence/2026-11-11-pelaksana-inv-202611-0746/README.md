# Isi dokter di nota klinik lunas, Cimanggu (11 Nov 2026)

**Permintaan:** user Cimanggu lewat Reza. Nota tanggal 10 Nov dibayar tanpa dokter penanggung jawab, jadi semua
baris tertulis "Pelaksana belum ditetapkan" atau "data lama". Layar koreksi (void & terbitkan ulang) belum bisa
mengganti pelaksana; perbaikannya ada di PR yang sama.

| Nota | Dokter | Baris | Catatan |
|---|---|---|---|
| INV-202611-0746 (terbit ulang dari 0707) | DRH. NOVIA NUR ISKANDARI | 7 | `apply.sql`; koreksi masih terbuka saat diisi |
| INV-202611-0708 | DRH. CORNELIA ISTYANI HAPSARI | 6 | `apply-batch2.sql` |
| INV-202611-0710 | DRH. HEPPY FANI KRISMANINGRUM | 6 | `apply-batch2.sql` |
| INV-202611-0711 | DRH. NURSETA RAIS MAHENDRA | 3 | `apply-batch2.sql` ("rais mahendra") |

Non-dokter tidak disebut, jadi tetap kosong. Snapshot dibentuk lewat `normalize_service_performers` (karyawan
aktif, cabang Cimanggu, jabatan dokter). Trigger `service_line_performers` (menolak UPDATE atribusi) dimatikan
hanya di dalam transaksi yang sama. Setelah transaksi selesai, trigger terverifikasi aktif lagi (`tgenabled = O`).

**Verifikasi:** semua baris keempat nota terisi dokter di atas, tidak ada baris kosong. Total, pembayaran, dan
jurnal tidak disentuh.

**Catatan INV-202611-0746:** nota ini masih dalam mode koreksi. User perlu memuat ulang halaman sebelum menyimpan
koreksi; form yang terbuka sebelum pengisian membawa pelaksana kosong. Setelah dimuat ulang, form membawa
drh. Novia dan database menyalinnya dari baris sumber.
