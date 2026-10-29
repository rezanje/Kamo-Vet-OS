// Penegakan "lewat batas waktu = otomatis nonaktif" di luar jam cron.
//
// Proyek ini belum memasang pg_cron (lihat migrasi 20261031150000), jadi
// penyapunya dipanggil malas: setiap kali layar yang memperlihatkan atau
// memakai promo dimuat. Fungsinya idempoten dan berhenti lebih awal lewat
// indeks parsial kalau memang tidak ada yang lewat tanggal, jadi aman dipanggil
// dari jalur ramai seperti kasir.
//
// Kebenaran TAMPILAN tidak bergantung pada panggilan ini: promoActiveFor,
// voucherBerlaku, loadPromoAktif dan promoScheduleStatus sudah menilai tanggal
// saat membaca. Gagalnya panggilan ini — termasuk saat migrasinya belum
// diterapkan ke sebuah environment — karena itu sengaja didiamkan, bukan
// dijadikan error halaman.

// Dipanggil dari halaman server yang klien-nya sudah bertipe; yang dibutuhkan
// cuma rpc(), jadi diminta secara struktural supaya `any` tidak menyebar.
type PemanggilRpc = { rpc(nama: string): PromiseLike<unknown> };

export async function nonaktifkanPromoKadaluarsa(supabase: PemanggilRpc): Promise<void> {
  try {
    await supabase.rpc("nonaktifkan_promo_kadaluarsa");
  } catch {
    /* Tanggal tetap diperiksa saat baca; biarkan halaman tampil. */
  }
}
