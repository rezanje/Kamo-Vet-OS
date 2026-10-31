/**
 * Kartu rekam medis TERTUNDA ("Perlu Dilengkapi"): kartu lama hasil migrasi yang belum lengkap, disimpan utuh di ruang
 * tunggu terpisah (bukan riwayat resmi). Dibaca/diisi OWNER/ADMIN lewat RPC database (migrasi 20261104140000).
 *
 * Gagal dimuat ≠ kosong: jawaban rusak/ditolak menjadi pesan generik. Pesan galat database yang ditujukan ke petugas
 * (bahasa Indonesia, tanpa detail teknis) diteruskan; selain itu diganti pesan generik.
 */
import { kunciHpIndonesia } from "./kontak";
import { kunciTeksImporRekamMedis } from "./impor-rekam-medis";

// Supabase clients and the lightweight test clients share this surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const HALAMAN_KARTU_TERTUNDA = 50;
export const PESAN_GAGAL_KARTU_TERTUNDA = "Kartu perlu dilengkapi belum dapat dimuat. Coba muat ulang.";

export type StatusKartuTertunda = "perlu_dilengkapi" | "selesai" | "dibatalkan";
export const STATUS_KARTU_TERTUNDA: readonly StatusKartuTertunda[] = ["perlu_dilengkapi", "selesai", "dibatalkan"];

export const LABEL_KEKURANGAN: Record<string, string> = {
  hp_kosong: "Nomor HP kosong",
  hp_tidak_valid: "Nomor HP tidak valid",
  hp_angka: "Nomor HP kehilangan angka 0",
  nama_pemilik_kosong: "Nama pemilik kosong",
  nama_hewan_kosong: "Nama hewan kosong",
  tanggal_bentrok: "Tanggal bentrok",
  tanggal_kosong: "Tanggal kosong",
  kemungkinan_salinan: "Mungkin salinan kartu lain",
};

export type IsiKartu = Partial<Record<
  "owner_name" | "phone" | "address" | "patient_name" | "species" | "breed" | "gender" | "dob" | "record_no" | "tanggal_usulan"
  | "tanggal_tab" | "tanggal_sel" | "doctor" | "note" | "anamnesis" | "clinical_findings" | "diagnosis" | "therapy", string>>;

export type KartuTertunda = {
  id: string;
  status: StatusKartuTertunda;
  kekurangan: string[];
  isi: IsiKartu;
  sumber_berkas: string | null;
  sumber_sheet: string | null;
  visit_id: string | null;
  catatan: string | null;
  dibuat_pada: string;
};

export class KartuTertundaGagal extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const teksAtauNull = (v: unknown) => (v == null ? null : typeof v === "string" ? v : undefined);

/** Satu baris jawaban RPC; `null` bila bentuknya tidak sah. */
export function barisKartu(item: unknown): (KartuTertunda & { total: number }) | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID.test(r.id) || !STATUS_KARTU_TERTUNDA.includes(r.status as StatusKartuTertunda)) return null;
  if (!Array.isArray(r.kekurangan) || r.kekurangan.some((k) => typeof k !== "string")) return null;
  if (!r.isi || typeof r.isi !== "object" || Array.isArray(r.isi)) return null;
  const isi: IsiKartu = {};
  for (const [k, v] of Object.entries(r.isi as Record<string, unknown>)) {
    if (typeof v !== "string") return null;
    isi[k as keyof IsiKartu] = v;
  }
  const berkas = teksAtauNull(r.sumber_berkas), sheet = teksAtauNull(r.sumber_sheet), catatan = teksAtauNull(r.catatan);
  if (berkas === undefined || sheet === undefined || catatan === undefined) return null;
  if (r.visit_id != null && !(typeof r.visit_id === "string" && UUID.test(r.visit_id))) return null;
  if (typeof r.dibuat_pada !== "string" || Number.isNaN(Date.parse(r.dibuat_pada))) return null;
  const total = Number(r.total);
  if (!Number.isSafeInteger(total) || total < 0) return null;
  return {
    id: r.id, status: r.status as StatusKartuTertunda, kekurangan: r.kekurangan as string[], isi, sumber_berkas: berkas, sumber_sheet: sheet,
    visit_id: (r.visit_id as string | null) ?? null, catatan, dibuat_pada: r.dibuat_pada, total,
  };
}

export async function bacaDaftarKartuTertunda(client: Client, status: StatusKartuTertunda, cari: string, halaman: number) {
  const dari = Math.max(0, (Math.max(1, Math.floor(halaman)) - 1) * HALAMAN_KARTU_TERTUNDA);
  let hasil: { data: unknown; error: unknown };
  try {
    hasil = await client.rpc("daftar_kartu_tertunda", { p_status: status, p_cari: cari.trim() || null, p_dari: dari, p_jumlah: HALAMAN_KARTU_TERTUNDA });
  } catch { throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA); }
  if (hasil.error || !Array.isArray(hasil.data) || hasil.data.length > HALAMAN_KARTU_TERTUNDA) throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA);
  const baris = hasil.data.map((item) => {
    const b = barisKartu(item);
    if (!b || b.status !== status) throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA);
    return b;
  });
  if (new Set(baris.map((b) => b.id)).size !== baris.length) throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA);
  return { baris, total: baris[0]?.total ?? 0, dari };
}

export async function bacaKartuTertunda(client: Client, id: string): Promise<KartuTertunda | null> {
  if (!UUID.test(id)) return null;
  let hasil: { data: unknown; error: unknown };
  try { hasil = await client.rpc("detail_kartu_tertunda", { p_id: id }); } catch { throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA); }
  if (hasil.error || !Array.isArray(hasil.data) || hasil.data.length > 1) throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA);
  if (!hasil.data.length) return null;
  const b = barisKartu(hasil.data[0]);
  if (!b || b.id !== id) throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA);
  return b;
}

/** OWNER/ADMIN aktif. Melempar bila profil tidak terbaca (tidak tahu ≠ bukan pengimpor). */
export async function bolehKelolaKartuTertunda(client: Client, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await client.from("profiles").select("role, is_active").eq("id", userId).maybeSingle();
  if (error) throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA);
  return (data?.role === "OWNER" || data?.role === "ADMIN") && data?.is_active === true;
}

/** HP kartu yang boleh dipakai otomatis (bukan bila kartu bertanda masalah HP). */
export function hpKartuSah(k: Pick<KartuTertunda, "kekurangan" | "isi">): string | null {
  if (k.kekurangan.some((x) => x.startsWith("hp_"))) return null;
  return k.isi.phone?.trim() || null;
}

export type CalonPemilik = { id: string; name: string; phone: string };
export type CalonHewan = { id: string; name: string };
export type CalonIdentitas = { pemilik: CalonPemilik[]; hewanPer: (customerId: string, nama: string) => CalonHewan[] };

/**
 * Calon pemilik dengan kunci HP sama (patokan utama) dan hewan mereka, lewat pemindai identitas impor yang sudah ada
 * (OWNER/ADMIN, RLS pemanggil; hewan termasuk nonaktif). Hewan senama >1 = petugas wajib memilih.
 */
export async function calonIdentitas(client: Client, phone: string): Promise<CalonIdentitas> {
  const kunci = kunciHpIndonesia(phone);
  const kosong: CalonIdentitas = { pemilik: [], hewanPer: () => [] };
  if (kunci.length < 10) return kosong;
  let hasil: { data: unknown; error: unknown };
  try {
    hasil = await client.rpc("import_legacy_identity_scan", { p_source_keys: [], p_owner_keys: [], p_phone_keys: [kunci] });
  } catch { throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA); }
  const d = hasil.data as { customers?: unknown; pets?: unknown } | null;
  if (hasil.error || !d || !Array.isArray(d.customers) || !Array.isArray(d.pets)) throw new KartuTertundaGagal(PESAN_GAGAL_KARTU_TERTUNDA);
  const pemilik = (d.customers as Record<string, unknown>[]).flatMap((c) =>
    typeof c?.id === "string" && typeof c.name === "string" && typeof c.phone === "string" && kunciHpIndonesia(c.phone) === kunci
      ? [{ id: c.id, name: c.name, phone: c.phone }] : []);
  const pets = (d.pets as Record<string, unknown>[]).flatMap((p) =>
    typeof p?.id === "string" && typeof p.customer_id === "string" && typeof p.name === "string" ? [{ id: p.id, customer_id: p.customer_id, name: p.name }] : []);
  return {
    pemilik,
    hewanPer: (customerId, nama) => {
      const k = kunciTeksImporRekamMedis(nama);
      return pets.filter((p) => p.customer_id === customerId
        && (p.name.trim().toLowerCase() === nama.trim().toLowerCase() || kunciTeksImporRekamMedis(p.name) === k)).map(({ id, name }) => ({ id, name }));
    },
  };
}

export type IsianLengkapi = {
  p_id: string;
  p_phone: string | null;
  p_customer_id: string | null;
  p_owner_name: string | null;
  p_patient_name: string | null;
  p_pet_id: string | null;
  p_record_date: string | null;
};

const opsional = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Isian formulir -> argumen RPC. Validasi bentuk saja; aturan identitas & tanggal ditegakkan database. */
export function isianLengkapi(form: FormData): { ok: true; isian: IsianLengkapi } | { ok: false; pesan: string } {
  const id = opsional(form.get("id"));
  if (!id || !UUID.test(id)) return { ok: false, pesan: "Kartu tidak dikenal." };
  const isian: IsianLengkapi = {
    p_id: id,
    p_phone: opsional(form.get("phone")),
    p_customer_id: opsional(form.get("customer_id")),
    p_owner_name: opsional(form.get("owner_name")),
    p_patient_name: opsional(form.get("patient_name")),
    p_pet_id: opsional(form.get("pet_id")),
    p_record_date: opsional(form.get("record_date")),
  };
  for (const k of ["p_customer_id", "p_pet_id"] as const) {
    if (isian[k] && !UUID.test(isian[k]!)) return { ok: false, pesan: "Pilihan pemilik/hewan tidak dikenal." };
  }
  if (isian.p_record_date && !/^\d{4}-\d{2}-\d{2}$/.test(isian.p_record_date)) return { ok: false, pesan: "Format tanggal tidak dikenal." };
  if (isian.p_phone && isian.p_phone.length > 30) return { ok: false, pesan: "Nomor HP terlalu panjang." };
  for (const k of ["p_owner_name", "p_patient_name"] as const) {
    if (isian[k] && [...isian[k]!].length > 100) return { ok: false, pesan: "Nama maksimal 100 karakter." };
  }
  return { ok: true, isian };
}

/** Pesan database yang memang untuk petugas; selain itu pesan generik (tanpa detail teknis). */
const PESAN_DB_PETUGAS = [
  "Nomor HP tidak valid", "Isi nomor HP pemilik", "Pemilik pilihan tidak ditemukan", "Nomor HP berbeda dengan nomor pemilik",
  "Ada beberapa pemilik dengan nomor HP ini", "Nama pemilik wajib diisi", "Nama pemilik maksimal", "Hewan pilihan bukan milik",
  "Nama hewan wajib diisi", "Nama hewan maksimal", "Ada beberapa hewan bernama sama", "Pilih tanggal pemeriksaan",
  "Tanggal pemeriksaan di luar rentang", "Kartu ini sudah selesai atau dibatalkan", "Kartu tertunda tidak ditemukan",
  "Alasan pembatalan wajib diisi", "Hanya OWNER/ADMIN", "Jejak sumber bentrok", "Perlu keputusan identitas",
];

export function pesanPetugas(pesan: string | null | undefined): string {
  const p = (pesan ?? "").trim();
  return PESAN_DB_PETUGAS.some((awal) => p.startsWith(awal)) ? p.split("\n")[0].slice(0, 300) : "Kartu belum dapat disimpan. Coba lagi atau hubungi admin.";
}

/** Tanggal pilihan (unik, urut) untuk kartu: usulan, tab, sel. */
export function pilihanTanggal(isi: IsiKartu): { tanggal: string; label: string }[] {
  const daftar: { tanggal: string; label: string }[] = [];
  for (const [k, label] of [["tanggal_usulan", "Tanggal di kartu"], ["tanggal_sel", "Tanggal di isi kartu"], ["tanggal_tab", "Tanggal di nama tab"]] as const) {
    const t = isi[k];
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t) && !daftar.some((d) => d.tanggal === t)) daftar.push({ tanggal: t, label });
  }
  return daftar;
}
