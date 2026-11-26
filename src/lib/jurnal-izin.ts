// Tombol Jurnal Umum per peran (Akses Grup > Tindakan; hanya peran ADMIN_UMUM): lihat, buat jurnal manual, koreksi/batalkan jurnal manual
// (izin khusus, bawaan MATI), lihat semua sumber. Penegakan SEBENARNYA ada di database (create_manual_journal_atomic / revise_manual_journal lewat
// public.jurnal_aksi_diizinkan, migrasi 20261214100100); file ini hanya menyusun tampilan layar Jurnal Umum dari hasil RPC `jurnal_izin`.
// Peran lain tidak berubah sama sekali (tampilan lama persis).
import { ADMIN_UMUM } from "./peran-admin";

export type JurnalIzin = { lihat: boolean; buat_manual: boolean; koreksi_manual: boolean; lihat_semua_sumber: boolean };
export const AKSI_JURNAL = ["jurnal.lihat", "jurnal.buat_manual", "jurnal.koreksi_manual", "jurnal.lihat_semua_sumber"] as const;
/** Sumber jurnal yang dibuat orang lewat layar Jurnal Umum (bukan otomatis dari kasir/klinik/pembelian/dll). */
export const SUMBER_MANUAL = ["manual", "manual-correction", "manual-reversal"] as const;

export function parseJurnalIzin(data: unknown): JurnalIzin | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  for (const k of ["lihat", "buat_manual", "koreksi_manual", "lihat_semua_sumber"]) if (typeof d[k] !== "boolean") return null;
  return { lihat: d.lihat as boolean, buat_manual: d.buat_manual as boolean, koreksi_manual: d.koreksi_manual as boolean, lihat_semua_sumber: d.lihat_semua_sumber as boolean };
}

type RpcClient = { rpc(name: "jurnal_izin"): PromiseLike<{ data: unknown; error: unknown }> };

/** null = peran ini tidak diatur tombol ini (peran lain); "gagal" = tidak terbaca (ditolak, gagal tertutup); selain itu hasil RPC. */
export async function bacaIzinJurnal(client: RpcClient, role: string | null | undefined): Promise<JurnalIzin | "gagal" | null> {
  if (role !== ADMIN_UMUM) return null;
  try {
    const { data, error } = await client.rpc("jurnal_izin");
    if (error) return "gagal";
    return parseJurnalIzin(data) ?? "gagal";
  } catch { return "gagal"; }
}

export type JurnalUi = { tolak: boolean; pesan: string; bolehBuat: boolean; bolehKoreksi: boolean; semuaSumber: boolean };

export function tentukanJurnalUi(o: { role: string | null | undefined; aktif: boolean; izin: JurnalIzin | "gagal" | null }): JurnalUi {
  // Peran lain: tampilan lama persis (database tetap menolak yang tidak berhak).
  if (o.role !== ADMIN_UMUM) return { tolak: false, pesan: "", bolehBuat: true, bolehKoreksi: false, semuaSumber: true };
  if (!o.aktif) return { tolak: true, pesan: "Akun tidak aktif.", bolehBuat: false, bolehKoreksi: false, semuaSumber: false };
  if (o.izin === "gagal" || o.izin === null) {
    return { tolak: true, pesan: "Izin Jurnal Umum belum dapat diperiksa. Tidak ada yang ditampilkan; muat ulang halaman.", bolehBuat: false, bolehKoreksi: false, semuaSumber: false };
  }
  if (!o.izin.lihat) {
    return { tolak: true, pesan: "Akses Jurnal Umum belum diberikan untuk peran Anda. Minta Owner membukanya di Pengaturan › Akses Grup › Admin Umum.", bolehBuat: false, bolehKoreksi: false, semuaSumber: false };
  }
  return { tolak: false, pesan: "", bolehBuat: o.izin.buat_manual, bolehKoreksi: o.izin.koreksi_manual, semuaSumber: o.izin.lihat_semua_sumber };
}
