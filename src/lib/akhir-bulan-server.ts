// Pelaksana proses akhir bulan (S8). Dipakai dua pintu yang harus berperilaku sama:
// cron tiap tanggal 1 dan tombol "Jalankan sekarang" di layar Tutup Buku.
//
// Semua langkahnya idempoten: penyusutan dikunci unique(asset_id, periode), jurnal
// berulang dikunci last_posted, dan penguncian periode hanya maju, tidak pernah mundur.
// Jadi menjalankan dua kali di hari yang sama tidak menggandakan apa pun.
import { catchUpDepreciation } from "@/lib/depreciation";
import { postRecurringCatchUp } from "@/lib/recurring";
import { hariIniWIB } from "@/lib/tanggal";
import { bolehKunci, periodeSelesai, ringkasHasil, tanggalTerakhir, type HasilAkhirBulan } from "@/lib/akhir-bulan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type OpsiJalankan = {
  /** 'cron' = otomatis tiap tanggal 1 · 'manual' = ditekan dari layar. */
  sumber: "cron" | "manual";
  userId?: string | null;
  /** Paksa kunci walau pengaturannya mati — dipakai tombol manual OWNER. */
  paksaKunci?: boolean;
};

export async function jalankanAkhirBulan(
  supabase: AnyClient,
  opsi: OpsiJalankan,
): Promise<HasilAkhirBulan> {
  const hariIni = hariIniWIB();
  const periode = periodeSelesai(hariIni);

  // Penyusutan dulu, baru jurnal berulang: keduanya bebas urutan, tapi kalau
  // penguncian ikut jalan, semua jurnal bulan itu harus sudah masuk sebelum dikunci.
  const penyusutan = await catchUpDepreciation(supabase);
  const jurnalBerulang = await postRecurringCatchUp(supabase);

  const { data: lock } = await supabase
    .from("accounting_locks")
    .select("closed_until, auto_kunci, auto_kunci_jeda_hari").eq("id", true).maybeSingle();

  const terkunciSampai = (lock?.closed_until as string | null) ?? null;
  const autoKunci = !!lock?.auto_kunci;
  const jedaHari = Number(lock?.auto_kunci_jeda_hari ?? 5);

  let dikunciSampai: string | null = null;
  let kunciDilewati: string | null = null;

  if (!autoKunci && !opsi.paksaKunci) {
    kunciDilewati = "penguncian otomatis masih dimatikan";
  } else if (!bolehKunci({ hariIni, periode, jedaHari, terkunciSampai })) {
    const akhir = tanggalTerakhir(periode);
    kunciDilewati = terkunciSampai && terkunciSampai >= akhir
      ? "periode itu sudah terkunci sebelumnya"
      : `masa tenggang ${jedaHari} hari belum lewat`;
  } else {
    const sampai = tanggalTerakhir(periode);
    // Upsert, bukan update: baris accounting_locks pernah ditemukan TIDAK ADA, dan
    // update yang mengenai 0 baris tidak melempar error — kuncinya gagal diam-diam.
    const { error } = await supabase.from("accounting_locks").upsert({
      id: true, closed_until: sampai,
      updated_at: new Date().toISOString(), updated_by: opsi.userId ?? null,
    });
    if (error) kunciDilewati = `gagal mengunci: ${error.message}`;
    else dikunciSampai = sampai;
  }

  const hasil: HasilAkhirBulan = { periode, penyusutan, jurnalBerulang, dikunciSampai, kunciDilewati };

  // Catatan jalannya proses ditulis belakangan dan kegagalannya sengaja tidak
  // membatalkan apa pun — jurnal yang sudah masuk tetap sah walau log gagal ditulis.
  await supabase.from("month_end_runs").insert({
    periode,
    sumber: opsi.sumber,
    dijalankan_oleh: opsi.userId ?? null,
    berhasil: !kunciDilewati?.startsWith("gagal"),
    ringkasan: ringkasHasil(hasil),
    rincian: hasil,
  });

  return hasil;
}
