// Pembaca/penulis sisi server untuk Follow up pelanggan. Semua hitungan di fungsi SQL `marketing_followup_daftar`;
// penulisan hanya lewat RPC `marketing_log_contact`. Tidak ada pengiriman WhatsApp dan whatsapp_message_log/wa_engine tidak disentuh.
import { bolehBukaPath, type AturanTersimpan } from "./akses";
import { amankanSel } from "./laporan-kategori-penjualan";
import { gabungSubmenu } from "./submenu-access";
import { loadSubmenuPolicy } from "./submenu-policy";
import {
  FUNGSI_BOLEH, FUNGSI_CATAT, FUNGSI_DAFTAR, FUNGSI_RINGKAS, HALAMAN_FOLLOWUP, LABEL_TANPA_CABANG, bacaHasilDaftar, jenisLogDari, periksaIsianKontak, tanggalWib,
  type BarisFollowUp, type FilterFollowUp, type HasilDaftar, type TabId,
} from "./marketing-followup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export class MarketingError extends Error {}

export type AksesMarketing = { ok: boolean; role: string | null; bolehUnduh: boolean };
const DITOLAK: AksesMarketing = { ok: false, role: null, bolehUnduh: false };
export const PERAN_UNDUH = ["OWNER", "ADMIN"] as const;

/**
 * Gerbang sisi server (halaman, unduhan, kartu dashboard): peran aktif + Akses Grup (modul CRM dan sub-menu) + fungsi database
 * `marketing_followup_allowed()` (OWNER selalu; peran lain hanya bila sub-menu dicentang). Gagal baca = tertutup, kecuali OWNER.
 */
export async function periksaAksesMarketing(client: AnyClient): Promise<AksesMarketing> {
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return DITOLAK;
    const { data: profile, error: profileError } = await client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
    if (profileError || !profile?.role || profile.is_active === false) return DITOLAK;
    const role = String(profile.role);
    if (role !== "OWNER") {
      const { data: rules, error: rulesError } = await client.from("role_modules").select("role, module_id").eq("role", role);
      if (rulesError || !Array.isArray(rules)) return DITOLAK;
      const kebijakan = await loadSubmenuPolicy(client);
      if (kebijakan.status === "error") return DITOLAK;
      const aturan = gabungSubmenu(rules as { role: string; module_id: string }[], kebijakan.rows) as AturanTersimpan;
      if (!bolehBukaPath(role, HALAMAN_FOLLOWUP, aturan)) return DITOLAK;
      const { data: boleh, error: bolehError } = await client.rpc(FUNGSI_BOLEH);
      if (bolehError || boleh !== true) return DITOLAK;
    }
    return { ok: true, role, bolehUnduh: (PERAN_UNDUH as readonly string[]).includes(role) };
  } catch { return DITOLAK; }
}

const PESAN_GALAT: [RegExp, string][] = [
  [/MARKETING_DITOLAK/, "Akun Anda belum diberi akses Follow up pelanggan. Minta Owner mencentangnya di Akses Grup."],
  [/MARKETING_CABANG_DITOLAK/, "Cabang ini tidak boleh Anda akses."],
  [/MARKETING_KUNCI_DIPAKAI/, "Permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman lalu coba lagi."],
  [/MARKETING_HASIL/, "Pilih hasil menghubungi."],
  [/MARKETING_CATATAN/, "Catatan maksimal 500 huruf."],
  [/MARKETING_PELANGGAN|MARKETING_HEWAN/, "Data pelanggan atau hewan tidak ditemukan. Muat ulang halaman."],
];
export const pesanGalatMarketing = (message: string | undefined | null): string =>
  PESAN_GALAT.find(([re]) => re.test(String(message ?? "")))?.[1] ?? "Belum bisa disimpan. Muat ulang halaman lalu coba lagi.";

function galatDaftar(error: { code?: string; message?: string }): MarketingError {
  if (error.code === "PGRST202" || error.code === "42883") return new MarketingError("Fungsi follow up belum terpasang di database.");
  if (/MARKETING_DITOLAK/.test(error.message ?? "")) return new MarketingError(pesanGalatMarketing(error.message));
  return new MarketingError("Daftar belum dapat dimuat. Muat ulang sebentar lagi.");
}

/** Satu panggilan database; hasil divalidasi bentuknya. */
export async function muatDaftarMarketing(client: AnyClient, f: FilterFollowUp, opsi: { limit?: number } = {}): Promise<HasilDaftar> {
  const { data, error } = await client.rpc(FUNGSI_DAFTAR, {
    p_tab: f.tab, p_hari: f.hari, p_cabang: f.cabang && f.cabang !== "kosong" ? f.cabang : null, p_cabang_kosong: f.cabang === "kosong",
    p_status: f.status, p_cari: f.cari || null, p_interval: f.interval, p_depan: f.depan, p_cooldown: f.cooldown, p_limit: opsi.limit ?? 200,
  });
  if (error) throw galatDaftar(error);
  const hasil = bacaHasilDaftar(data);
  if (!hasil) throw new MarketingError("Data follow up belum dapat dibaca lengkap. Muat ulang.");
  return hasil;
}

export type CatatInput = { customerId: string; petId: string | null; tab: TabId; cabangId: string | null; hasil: string; catatan: string; kunci: string };
export type CatatHasil = { ok: true; sudahAda: boolean } | { ok: false; pesan: string };

export async function catatDihubungi(client: AnyClient, i: CatatInput): Promise<CatatHasil> {
  const salah = periksaIsianKontak(i.hasil, i.catatan);
  if (salah) return { ok: false, pesan: salah };
  try {
    const { data, error } = await client.rpc(FUNGSI_CATAT, {
      p_customer_id: i.customerId, p_pet_id: i.petId, p_jenis: jenisLogDari(i.tab), p_branch_id: i.cabangId,
      p_hasil: i.hasil, p_catatan: i.catatan.trim() || null, p_request_key: i.kunci,
    });
    if (error) return { ok: false, pesan: pesanGalatMarketing(error.message) };
    return { ok: true, sudahAda: (data as { already_applied?: boolean } | null)?.already_applied === true };
  } catch { return { ok: false, pesan: pesanGalatMarketing("") }; }
}

export type KartuMarketing = { galat: string } | { galat?: undefined; lama: number; grooming: number; hariIni: number } | null;

/** Kartu dashboard "Perlu follow up". null = tidak ditampilkan (tanpa akses). Galat apa pun menjadi kartu "belum dapat dihitung". */
export async function muatKartuMarketing(client: AnyClient): Promise<KartuMarketing> {
  const akses = await periksaAksesMarketing(client);
  if (!akses.ok) return null;
  try {
    const { data, error } = await client.rpc(FUNGSI_RINGKAS);
    if (error) throw galatDaftar(error);
    const d = data as { lama?: unknown; grooming?: unknown; hari_ini?: unknown } | null;
    if (!d || ![d.lama, d.grooming, d.hari_ini].every(x => typeof x === "number" && Number.isFinite(x))) throw new MarketingError("Angka follow up belum dapat dibaca.");
    return { lama: d.lama as number, grooming: d.grooming as number, hariIni: d.hari_ini as number };
  } catch (e) {
    return { galat: e instanceof MarketingError ? e.message : "Angka follow up belum dapat dihitung. Muat ulang sebentar lagi." };
  }
}

const ringkasItem = (b: BarisFollowUp) => (b.item ?? []).map(i => `${i.jenis} ${i.tanggal}${i.hewan ? ` (${i.hewan})` : ""}${i.catatan ? `: ${i.catatan}` : ""}`).join("; ");

/** Satu baris Excel; teks yang diawali rumus diberi tanda petik (amankanSel). */
export function barisExcelFollowUp(b: BarisFollowUp): (string | number)[] {
  const d = b.dihubungi;
  return [
    b.cabang ?? LABEL_TANPA_CABANG, b.nama, b.hewan.join(", "), b.hp ?? "", tanggalWib(b.terakhir) ?? b.jadwal ?? "", b.jenis_terakhir ?? b.sumber ?? "",
    b.hari ?? "", Math.round(b.total_belanja || 0), b.kunjungan ?? "", ringkasItem(b) || (b.groomer ? `Groomer ${b.groomer}` : ""),
    d ? (d.sudah ? "Sudah dihubungi" : "Dihubungi, masa tunggu habis") : "Belum dihubungi", d?.hasil ?? "", d?.catatan ?? "", d?.oleh ?? "",
  ].map(amankanSel);
}

