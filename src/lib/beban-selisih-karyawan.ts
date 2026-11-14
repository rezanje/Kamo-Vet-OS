/**
 * F2 (meeting 12 Nov 2026, keputusan Reza: A + "dicatat kasbon saja") — ringkasan selisih kurang stok opname dan beban ke karyawan.
 *
 * Satu tempat untuk aturan layar, pembacaan isian, dan pesan. Penegak sebenarnya ada di database
 * (migrasi 20261118660000_f2_beban_selisih_karyawan.sql): read_opname_variance_charge / charge_opname_variance_to_employees /
 * cancel_opname_variance_charge memeriksa ulang hak, cabang, nilai, pembagian, periode, dan anti-dobel.
 *
 * Aturan bisnis:
 * - Nilai beban = qty kurang x HARGA JUAL cabang (snapshot saat posting), seluruh baris kurang satu opname.
 * - Dibagi ke 1-10 karyawan; jumlahnya wajib sama persis dengan nilai beban.
 * - Dicatat sebagai kasbon status "Dicatat": tampil di HRIS, TIDAK dipotong gaji otomatis (penggajian hanya membaca "Disetujui").
 * - Jurnal: Dr 182001 Kasbon Karyawan / Cr 720010 Beban Selisih Stok (HPP) / Cr 810004 Pendapatan Lain-lain (jual - HPP).
 */

import { ALASAN_SELISIH_KAS } from "./kasbon";

export const IZIN_BEBAN_SELISIH = "persediaan.beban_selisih_karyawan";
/** Status kasbon hasil beban opname: tercatat, tidak dipotong gaji otomatis. */
export const STATUS_KASBON_DICATAT = "Dicatat";
export const STATUS_KASBON_BATAL = "Batal";
/** Awalan alasan kasbon yang lahir dari beban selisih opname (ditulis database). */
export const ALASAN_BEBAN_OPNAME = "Beban selisih stok opname";
export const ALASAN_BEBAN_MIN = 3;
export const ALASAN_BEBAN_MAKS = 300;
export const MAKS_KARYAWAN = 10;

export const PESAN_BEBAN_BELUM_TERKONFIRMASI =
  "Beban karyawan belum terkonfirmasi. Muat ulang halaman dan periksa riwayat beban sebelum mencoba lagi.";

export type BarisKurang = { item_id: string; code: string; name: string; unit: string; qty: number; hpp: number | null; harga_jual: number; jual: number };
export type BarisBeban = { employee_id: string; nama: string | null; amount: number; advance_id: string; status: string | null; dibayar: number };
export type RiwayatBeban = {
  id: string; tanggal: string; reason: string; total: number; hpp_part: number; gain_part: number; actor_name: string | null; created_at: string;
  journal_id: string; cancelled_at: string | null; cancel_reason: string | null; cancel_journal_id: string | null; lines: BarisBeban[];
};
export type RingkasanBeban = {
  result_id: string; no_hasil: string; tanggal_opname: string; order_id: string; no_opname: string; branch_id: string; warehouse: string;
  method: string | null; minus_lines: BarisKurang[]; minus_count: number; hpp_total: number; jual_total: number; hpp_part: number; gain_part: number;
  today: string; refuse: { code: string; message: string } | null; can_charge: boolean; charges: RiwayatBeban[];
};

const angka = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Validasi bentuk jawaban RPC; null = tidak sah (layar menampilkan pesan gagal, tidak menebak). */
export function bacaRingkasanBeban(raw: unknown): RingkasanBeban | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nums = ["minus_count", "hpp_total", "jual_total", "hpp_part", "gain_part"] as const;
  if (typeof r.result_id !== "string" || typeof r.no_hasil !== "string" || !Array.isArray(r.minus_lines) || !Array.isArray(r.charges)
    || typeof r.can_charge !== "boolean" || nums.some((k) => angka(r[k]) === null)) return null;
  const refuse = r.refuse && typeof r.refuse === "object" && typeof (r.refuse as { message?: unknown }).message === "string"
    ? { code: String((r.refuse as { code?: unknown }).code ?? ""), message: (r.refuse as { message: string }).message } : null;
  const minus = (r.minus_lines as Record<string, unknown>[]).map((x) => ({
    item_id: String(x.item_id ?? ""), code: String(x.code ?? ""), name: String(x.name ?? ""), unit: String(x.unit ?? ""),
    qty: angka(x.qty) ?? 0, hpp: angka(x.hpp), harga_jual: angka(x.harga_jual) ?? 0, jual: angka(x.jual) ?? 0,
  }));
  const charges = (r.charges as Record<string, unknown>[]).map((c) => ({
    id: String(c.id ?? ""), tanggal: String(c.tanggal ?? ""), reason: String(c.reason ?? ""),
    total: angka(c.total) ?? 0, hpp_part: angka(c.hpp_part) ?? 0, gain_part: angka(c.gain_part) ?? 0,
    actor_name: typeof c.actor_name === "string" ? c.actor_name : null, created_at: String(c.created_at ?? ""),
    journal_id: String(c.journal_id ?? ""), cancelled_at: typeof c.cancelled_at === "string" ? c.cancelled_at : null,
    cancel_reason: typeof c.cancel_reason === "string" ? c.cancel_reason : null,
    cancel_journal_id: typeof c.cancel_journal_id === "string" ? c.cancel_journal_id : null,
    lines: (Array.isArray(c.lines) ? c.lines as Record<string, unknown>[] : []).map((l) => ({
      employee_id: String(l.employee_id ?? ""), nama: typeof l.nama === "string" ? l.nama : null, amount: angka(l.amount) ?? 0,
      advance_id: String(l.advance_id ?? ""), status: typeof l.status === "string" ? l.status : null, dibayar: angka(l.dibayar) ?? 0,
    })),
  }));
  return {
    result_id: r.result_id, no_hasil: r.no_hasil, tanggal_opname: String(r.tanggal_opname ?? ""), order_id: String(r.order_id ?? ""),
    no_opname: String(r.no_opname ?? ""), branch_id: String(r.branch_id ?? ""), warehouse: String(r.warehouse ?? ""),
    method: typeof r.method === "string" ? r.method : null, minus_lines: minus, minus_count: angka(r.minus_count)!,
    hpp_total: angka(r.hpp_total)!, jual_total: angka(r.jual_total)!, hpp_part: angka(r.hpp_part)!, gain_part: angka(r.gain_part)!,
    today: String(r.today ?? ""), refuse, can_charge: r.can_charge, charges,
  };
}

/** "150.000" / "150000" / "150.000,50" / "150000.5" -> rupiah (maks 2 desimal). Null bila tidak sah. */
export function bacaRupiah(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && Math.round(raw * 100) === raw * 100 ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s/g, "");
  let norm: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) norm = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(t)) norm = t.replace(",", ".");
  else if (/^\d+(\.\d{1,2})?$/.test(t)) norm = t;
  else return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

const sen = (n: number) => Math.round(n * 100);

/** Bagi rata dalam sen; sisa pembulatan ditaruh di orang TERAKHIR supaya totalnya persis. */
export function bagiRata(total: number, jumlahOrang: number): number[] {
  const n = Math.max(1, Math.min(MAKS_KARYAWAN, Math.floor(jumlahOrang) || 1));
  const t = sen(total);
  if (t <= 0) return [];
  const dasar = Math.floor(t / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? t - dasar * (n - 1) : dasar) / 100);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const kunciSah = (k: unknown): k is string => typeof k === "string" && UUID.test(k);

export type IsianBeban = { baris: { employee_id: string; amount: number }[]; alasan: string };

/** Baca isian form (baris JSON + alasan) dan cocokkan dengan nilai beban. Database tetap memeriksa ulang. */
export function bacaIsianBeban(raw: { baris?: unknown; alasan?: unknown }, total: number): { ok: true; isian: IsianBeban } | { ok: false; pesan: string } {
  let parsed: unknown;
  try { parsed = typeof raw.baris === "string" ? JSON.parse(raw.baris) : null; } catch { parsed = null; }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAKS_KARYAWAN) return { ok: false, pesan: `Pilih 1 sampai ${MAKS_KARYAWAN} karyawan.` };
  const baris: IsianBeban["baris"] = [];
  for (const row of parsed as Record<string, unknown>[]) {
    const id = typeof row?.employee_id === "string" ? row.employee_id : "";
    if (!UUID.test(id)) return { ok: false, pesan: "Pilih karyawan untuk setiap baris." };
    const amount = bacaRupiah(row.amount);
    if (amount === null || amount <= 0) return { ok: false, pesan: "Jumlah tiap karyawan harus lebih dari 0 (maksimal 2 angka di belakang koma)." };
    if (baris.some((b) => b.employee_id === id)) return { ok: false, pesan: "Satu karyawan hanya boleh dipilih sekali." };
    baris.push({ employee_id: id, amount });
  }
  const jumlah = baris.reduce((a, b) => a + sen(b.amount), 0);
  if (jumlah !== sen(total)) return { ok: false, pesan: `Jumlah pembagian (${rupiah(jumlah / 100)}) harus sama dengan nilai beban (${rupiah(total)}).` };
  const alasan = typeof raw.alasan === "string" ? raw.alasan.trim().replace(/\s+/g, " ") : "";
  if (alasan.length < ALASAN_BEBAN_MIN || alasan.length > ALASAN_BEBAN_MAKS) return { ok: false, pesan: `Alasan wajib diisi ${ALASAN_BEBAN_MIN}–${ALASAN_BEBAN_MAKS} huruf.` };
  return { ok: true, isian: { baris, alasan } };
}

export const rupiah = (n: number) =>
  "Rp " + Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Galat RPC -> kalimat untuk layar. Penolakan database ("BEBAN_KARYAWAN_<KODE>: kalimat") sudah berbahasa biasa; kodenya dibuang. */
export function pesanBebanKaryawan(error: { code?: string; message?: string } | null | undefined): string {
  const msg = String(error?.message ?? "").trim();
  if (error?.code === "PGRST202" || error?.code === "42883" || (/opname_variance_charge|charge_opname_variance/.test(msg) && /not find|does not exist/i.test(msg))) {
    return "Fitur beban selisih ke karyawan belum aktif. Hubungi admin sistem.";
  }
  const kode = /BEBAN_KARYAWAN_[A-Z_]+:\s*([\s\S]+)$/.exec(msg);
  if (kode) return kode[1].trim();
  if (/Batalkan beban karyawan dulu/.test(msg)) return msg.replace(/^ERROR:\s*/, "");
  if (/sudah ditutup — jurnal terkunci|Periode akuntansi/.test(msg)) return "Periode akuntansi hari ini sudah ditutup. Minta Owner membuka periodenya dulu.";
  if (/lock timeout|55P03|40P01|deadlock/i.test(msg)) return "Opname ini sedang diproses orang lain. Tunggu sebentar lalu coba lagi.";
  if (error?.code === "42501" || /permission denied/i.test(msg)) return "Hanya Owner (atau peran yang diberi izin \"Bebankan selisih opname ke karyawan\") yang boleh melakukan ini.";
  return PESAN_BEBAN_BELUM_TERKONFIRMASI;
}

/** Penanda baris kasbon di HRIS / layar karyawan. */
export function asalKasbon(status: string | null | undefined, alasan: string | null | undefined): "beban-opname" | "selisih-kas" | "kasbon" {
  if (status === STATUS_KASBON_DICATAT || String(alasan ?? "").startsWith(ALASAN_BEBAN_OPNAME)) return "beban-opname";
  if (String(alasan ?? "").startsWith(ALASAN_SELISIH_KAS)) return "selisih-kas";
  return "kasbon";
}
