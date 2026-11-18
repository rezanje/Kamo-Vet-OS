"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  alasanUbahDokter, kalimatHasilUbahDokter, pesanUbahDokter, ringkasanDariRpc, PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI,
  type HasilUbahDokter,
} from "@/lib/ubah-dokter-pj";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InputUbahDokter = {
  visitId: string;
  doctorId: string;
  reason: string;
  /** Dibuat sekali per pembukaan dialog; mengulang tekan Simpan memakai kunci yang sama (idempoten). */
  requestKey: string;
  ikutBaris: boolean;
  konfirmasiFinal: boolean;
};

const tolak = (kode: string, pesan: string, perluKonfirmasi = false): HasilUbahDokter => ({ ok: false, kode, pesan, ...(perluKonfirmasi ? { perluKonfirmasi } : {}) });

/**
 * Mengganti dokter PJ kunjungan lewat RPC `clinic_change_visit_doctor`. Semua penolakan DIKEMBALIKAN sebagai objek
 * (tidak dilempar): produksi menyamarkan galat lempar menjadi "Server Components render", sehingga staf tidak bisa membaca atau memulihkannya.
 */
export async function ubahDokterPJ(input: InputUbahDokter): Promise<HasilUbahDokter> {
  try {
    const visitId = String(input?.visitId ?? "").trim();
    const doctorId = String(input?.doctorId ?? "").trim();
    const requestKey = String(input?.requestKey ?? "").trim();
    if (!UUID.test(visitId)) return tolak("INPUT", "Kunjungan tidak dikenali. Muat ulang halaman lalu coba lagi.");
    if (!UUID.test(doctorId)) return tolak("PILIHAN", "Pilih dokter pengganti dari daftar.");
    const reason = alasanUbahDokter(input?.reason);
    if (!reason) return tolak("ALASAN", "Alasan wajib diisi (5 sampai 500 huruf).");
    if (requestKey.length < 8 || requestKey.length > 100) return tolak("INPUT", "Kunci permintaan belum siap. Tutup dialog, buka lagi, lalu coba lagi.");

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return tolak("AUTH", "Sesi masuk berakhir. Masuk lagi lalu coba ulang.");

    const { data, error } = await supabase.rpc("clinic_change_visit_doctor", {
      p_visit_id: visitId, p_new_doctor_id: doctorId, p_reason: reason, p_request_key: requestKey,
      p_follow_lines: input.ikutBaris !== false, p_ack_final: input.konfirmasiFinal === true,
    });
    if (error) {
      const t = pesanUbahDokter(error.message);
      return tolak(t.kode, t.pesan, t.perluKonfirmasi);
    }
    const ringkasan = ringkasanDariRpc(data);
    if (!ringkasan) return tolak("TIDAK_TERKONFIRMASI", PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI);

    for (const path of ["/klinik/rawat-inap", "/klinik/rekam-medis", "/klinik/pembayaran", "/laporan/penjual", "/laporan/visit", "/penjualan/komisi"]) {
      try { revalidatePath(path, "layout"); } catch { /* cache hanya optimasi; database sudah tersimpan */ }
    }
    return { ok: true, pesan: kalimatHasilUbahDokter(ringkasan), ...ringkasan };
  } catch {
    return tolak("TIDAK_TERKONFIRMASI", PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI);
  }
}
