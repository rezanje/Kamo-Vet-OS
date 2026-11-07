// Promo Paket (Syarat → Hasil) — logika murni editor admin: bentuk isian ↔ aturan, validasi sisi-klien dalam Bahasa
// Indonesia, kalimat pratinjau, taksiran rugi di bawah HPP, pemetaan galat database, dan gerbang peran.
//
// Database tetap satu-satunya otoritas (save_promo_syarat_hasil / set_promo_syarat_hasil_active, migrasi
// 20261106500000): validator di sini hanya memberi pesan yang jelas SEBELUM kirim dan memakai validator mesin
// (validateSyaratHasilDef) sebagai pagar terakhir supaya bentuknya selalu sama dengan yang dibaca kasir.
import type { PromoEditSnapshot } from "./promo-edit";
import {
  SH_MAX_HASIL_ITEMS, SH_MAX_MONEY, SH_MAX_QTY_MIN, SH_MAX_REWARD_QTY, SH_MAX_ROW_ITEMS, SH_MAX_SYARAT_ROWS, validateSyaratHasilDef,
} from "./promo-syarat-hasil";

export type PaketItemRef = { item_id: string; unit: string };
export type PaketSyaratForm = { kind: "qty"; min: string; items: PaketItemRef[] } | { kind: "nilai"; min: string };
export type PaketHasilForm = { items: PaketItemRef[]; rewardQty: string; discountType: "nominal" | "percent"; value: string; maxAmount: string };
export type PaketForm = {
  name: string; branchIds: string[]; validFrom: string; validUntil: string; repeat: boolean;
  syarat: PaketSyaratForm[]; hasil: PaketHasilForm; belowHpp: { allowed: boolean; reason: string };
};
export type PaketRuleForm = Pick<PaketForm, "repeat" | "syarat" | "hasil" | "belowHpp">;
export type PaketItemInfo = { id: string; code: string; name: string; units: string[]; active: boolean };
export type PaketIssue = { field: string; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PAKET_MAX_SUGGEST = 200;

export const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");

/**
 * Angka dari isian, dibaca TANPA salah tafsir (id-ID: titik = ribuan, koma = desimal; en: titik = desimal, koma = ribuan).
 *  "1.000" → 1000 · "1,5" → 1.5 · "1.000,50" → 1000.5 · "1,000.50" → 1000.5 · "0.001" → 0.001 · "0.500" → 0.5.
 * Satu-satunya bentuk yang TIDAK bisa dibedakan, "1,000" (1 atau 1000?), ditolak (null) daripada ditebak; lihat angkaAmbigu.
 * Huruf, minus, eksponen, spasi di dalam angka, angka nol di depan ("00.100"), pengelompokan ribuan yang salah → null.
 */
type AngkaBaca = { value: number; desimal: boolean } | null | "ambigu";
const GRUP_TITIK = /^[1-9]\d{0,2}(\.\d{3})+$/, GRUP_KOMA = /^[1-9]\d{0,2}(,\d{3})+$/;
function bacaAngka(raw: unknown): AngkaBaca {
  const s = String(raw ?? "").trim();
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  const hasDot = s.includes("."), hasComma = s.includes(",");
  const ok = (text: string, desimal: boolean): AngkaBaca => { const n = Number(text); return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? { value: n, desimal } : null; };
  const INT = /^(0|[1-9]\d*)$/, FRAC = /^\d+$/;
  if (!hasDot && !hasComma) return /^\d+$/.test(s) ? ok(s, false) : null;
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",", grp = dec === "." ? "," : ".";
    const parts = s.split(dec);
    if (parts.length !== 2 || !FRAC.test(parts[1]) || parts[0].includes(dec)) return null;
    if (!(grp === "." ? GRUP_TITIK : GRUP_KOMA).test(parts[0])) return null;
    return ok(`${parts[0].split(grp).join("")}.${parts[1]}`, true);
  }
  const sep = hasDot ? "." : ",", parts = s.split(sep);
  if (parts.length > 2) return (sep === "." ? GRUP_TITIK : GRUP_KOMA).test(s) ? ok(s.split(sep).join(""), false) : null;
  const [a, b] = parts;
  if (!INT.test(a) || !FRAC.test(b)) return null;
  const kelompokRibuan = a !== "0" && a.length <= 3 && b.length === 3;
  if (sep === "." && kelompokRibuan) return ok(`${a}${b}`, false); // id-ID: "1.000" = seribu
  if (sep === "," && kelompokRibuan) return "ambigu";
  return ok(`${a}.${b}`, true);
}
export function parseAngka(raw: unknown): number | null { const r = bacaAngka(raw); return r === null || r === "ambigu" ? null : r.value; }
/** "1,000" / "2,500": bisa dibaca 1 atau 1000 — ditolak dengan penjelasan, tidak ditebak. */
export function angkaAmbigu(raw: unknown): boolean { return bacaAngka(raw) === "ambigu"; }
/** Bilangan bulat tak negatif dari isian: "2", "100.000" (titik ribuan). Bentuk desimal ("0.5", "1,5", "1.00"), minus, huruf, eksponen, ambigu → null. */
export function parseBulat(raw: unknown): number | null {
  const r = bacaAngka(raw);
  return r === null || r === "ambigu" || r.desimal || !Number.isSafeInteger(r.value) ? null : r.value;
}
const inRange = (n: number | null, lo: number, hi: number): n is number => n !== null && n >= lo && n <= hi;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

export function emptyPaketForm(today: string): PaketForm {
  return {
    name: "", branchIds: [], validFrom: today, validUntil: "", repeat: true,
    syarat: [{ kind: "qty", min: "1", items: [] }],
    hasil: { items: [], rewardQty: "1", discountType: "nominal", value: "", maxAmount: "" },
    belowHpp: { allowed: false, reason: "" },
  };
}

// ---------------------------------------------------------------------------------------------
// Aturan tersimpan ↔ isian
// ---------------------------------------------------------------------------------------------
const refsFrom = (v: unknown): PaketItemRef[] | null => {
  if (!Array.isArray(v)) return null;
  const out: PaketItemRef[] = [];
  for (const x of v) { if (!isRecord(x) || typeof x.item_id !== "string" || typeof x.unit !== "string") return null; out.push({ item_id: x.item_id, unit: x.unit }); }
  return out;
};

export function paketFormFromRule(rule: unknown): PaketRuleForm | null {
  if (!isRecord(rule) || rule.discount_mode !== "syarat_hasil" || !isRecord(rule.syarat_hasil)) return null;
  const sh = rule.syarat_hasil;
  if (typeof sh.repeat !== "boolean" || !Array.isArray(sh.syarat) || !isRecord(sh.hasil) || !isRecord(sh.hasil.discount)) return null;
  const syarat: PaketSyaratForm[] = [];
  for (const r of sh.syarat) {
    if (!isRecord(r) || typeof r.min !== "number") return null;
    if (r.kind === "nilai") syarat.push({ kind: "nilai", min: String(r.min) });
    else if (r.kind === "qty") { const items = refsFrom(r.items); if (!items) return null; syarat.push({ kind: "qty", min: String(r.min), items }); }
    else return null;
  }
  const items = refsFrom(sh.hasil.items);
  const d = sh.hasil.discount;
  if (!items || (d.type !== "nominal" && d.type !== "percent") || typeof d.value !== "number") return null;
  const below = isRecord(sh.below_hpp) ? sh.below_hpp : {};
  return {
    repeat: sh.repeat, syarat,
    hasil: { items, rewardQty: String(typeof sh.hasil.reward_qty === "number" ? sh.hasil.reward_qty : 1), discountType: d.type, value: String(d.value), maxAmount: typeof d.max_amount === "number" ? String(d.max_amount) : "" },
    belowHpp: below.allowed === true ? { allowed: true, reason: typeof below.reason === "string" ? below.reason : "" } : { allowed: false, reason: "" },
  };
}

export function paketFormFromSnapshot(snapshot: PromoEditSnapshot): PaketForm | null {
  const base = paketFormFromRule(snapshot?.promo?.rule);
  if (!base) return null;
  const p = snapshot.promo;
  return { name: p.name, branchIds: p.branch_ids ?? [], validFrom: p.valid_from ?? "", validUntil: p.valid_until ?? "", ...base };
}

/** Struktur isian yang dikirim dari browser / dipulihkan dari draf: bentuk salah → null (tidak pernah dipercaya buta). */
export function parsePaketForm(v: unknown): PaketForm | null {
  if (!isRecord(v)) return null;
  const strs = (a: unknown): a is string[] => Array.isArray(a) && a.length <= 200 && a.every((x) => typeof x === "string" && x.length <= 120);
  const refs = (a: unknown): a is PaketItemRef[] => Array.isArray(a) && a.length <= 200 && a.every((x) => isRecord(x) && typeof x.item_id === "string" && x.item_id.length <= 64 && typeof x.unit === "string" && x.unit.length <= 40);
  if (typeof v.name !== "string" || v.name.length > 300 || !strs(v.branchIds) || typeof v.validFrom !== "string" || typeof v.validUntil !== "string" || typeof v.repeat !== "boolean") return null;
  if (!Array.isArray(v.syarat) || v.syarat.length > 50 || !isRecord(v.hasil) || !isRecord(v.belowHpp)) return null;
  const syarat: PaketSyaratForm[] = [];
  for (const r of v.syarat) {
    if (!isRecord(r) || typeof r.min !== "string" || r.min.length > 30) return null;
    if (r.kind === "nilai") syarat.push({ kind: "nilai", min: r.min });
    else if (r.kind === "qty" && refs(r.items)) syarat.push({ kind: "qty", min: r.min, items: r.items.map((x) => ({ item_id: x.item_id, unit: x.unit })) });
    else return null;
  }
  const h = v.hasil, b = v.belowHpp;
  if (!refs(h.items) || typeof h.rewardQty !== "string" || (h.discountType !== "nominal" && h.discountType !== "percent") || typeof h.value !== "string" || typeof h.maxAmount !== "string") return null;
  if (typeof b.allowed !== "boolean" || typeof b.reason !== "string" || b.reason.length > 400) return null;
  return {
    name: v.name, branchIds: [...v.branchIds], validFrom: v.validFrom, validUntil: v.validUntil, repeat: v.repeat, syarat,
    hasil: { items: h.items.map((x) => ({ item_id: x.item_id, unit: x.unit })), rewardQty: h.rewardQty, discountType: h.discountType, value: h.value, maxAmount: h.maxAmount },
    belowHpp: { allowed: b.allowed, reason: b.reason },
  };
}

/** Tepat sembilan kunci yang diterima save_promo_syarat_hasil (kunci lain ditolak database). ack_by/ack_at diisi database. */
export function paketValuesFromForm(f: PaketForm, suggest: string): Record<string, unknown> {
  const n = (s: string) => parseBulat(s) as number;
  const pct = f.hasil.discountType === "percent";
  const cap = pct ? parseBulat(f.hasil.maxAmount) : null;
  return {
    name: f.name.trim(), suggest: suggest.slice(0, PAKET_MAX_SUGGEST), branch_ids: [...f.branchIds],
    valid_from: f.validFrom.trim() || null, valid_until: f.validUntil.trim() || null, repeat: f.repeat,
    syarat: f.syarat.map((r) => r.kind === "nilai"
      ? { kind: "nilai", min: n(r.min) }
      : { kind: "qty", min: n(r.min), items: r.items.map((i) => ({ item_id: i.item_id, unit: i.unit })) }),
    hasil: {
      kind: "barang", items: f.hasil.items.map((i) => ({ item_id: i.item_id, unit: i.unit })), reward_qty: n(f.hasil.rewardQty),
      discount: pct ? { type: "percent", value: n(f.hasil.value), ...(cap ? { max_amount: cap } : {}) } : { type: "nominal", value: n(f.hasil.value) },
    },
    below_hpp: f.belowHpp.allowed ? { allowed: true, reason: f.belowHpp.reason.trim() } : { allowed: false },
  };
}

// ---------------------------------------------------------------------------------------------
// Validasi (pesan Indonesia, semua masalah sekaligus)
// ---------------------------------------------------------------------------------------------
export type PaketValidateContext = { today: string; items: ReadonlyMap<string, PaketItemInfo>; isOwner: boolean };

function itemIssues(refs: PaketItemRef[], label: string, field: string, max: number, items: ReadonlyMap<string, PaketItemInfo>, out: PaketIssue[]) {
  if (refs.length === 0) { out.push({ field, message: label === "Hasil" ? "Hasil: pilih minimal 1 barang hasil." : `${label}: pilih minimal 1 barang.` }); return; }
  if (refs.length > max) out.push({ field, message: `${label}: maksimal ${max} barang.` });
  const seen = new Set<string>();
  let missing = false;
  for (const r of refs) {
    const info = items.get(r.item_id);
    if (!info) { missing = true; continue; }
    if (!info.active) { out.push({ field, message: `${label}: ${info.name} tidak aktif / bukan barang persediaan.` }); continue; }
    if (!info.units.includes(r.unit)) out.push({ field, message: `${label}: satuan ${r.unit} bukan satuan resmi ${info.name}.` });
    const k = `${r.item_id}|${r.unit}`;
    if (seen.has(k)) out.push({ field, message: `${label}: ${info.name} (${r.unit}) terpilih dua kali.` });
    seen.add(k);
  }
  if (missing) out.push({ field, message: `${label}: ada barang yang tidak tersedia. Lepaskan lalu pilih ulang.` });
}

/** Petunjuk tambahan bila isian memakai pemisah yang bisa dibaca dua arti. */
const ambigu = (raw: string) => (angkaAmbigu(raw) ? ` "${raw.trim()}" bisa dibaca 1 atau 1000 (ambigu): tulis 1000 atau 1.000.` : "");

export function validatePaketForm(f: PaketForm, ctx: PaketValidateContext): PaketIssue[] {
  const out: PaketIssue[] = [];
  const name = f.name.trim();
  if (!name) out.push({ field: "name", message: "Nama promo wajib diisi." });
  else if (name.length > 120) out.push({ field: "name", message: "Nama promo maksimal 120 karakter." });

  const from = f.validFrom.trim(), until = f.validUntil.trim();
  if (from && !validDate(from)) out.push({ field: "tanggal", message: "Tanggal mulai tidak valid." });
  if (until && !validDate(until)) out.push({ field: "tanggal", message: "Tanggal berakhir tidak valid." });
  if (from && until && validDate(from) && validDate(until)) {
    if (until < from) out.push({ field: "tanggal", message: "Tanggal berakhir lebih awal dari tanggal mulai." });
    else if (until < ctx.today) out.push({ field: "tanggal", message: "Tanggal berakhir sudah lewat. Isi tanggal hari ini atau sesudahnya." });
  } else if (until && validDate(until) && until < ctx.today) out.push({ field: "tanggal", message: "Tanggal berakhir sudah lewat. Isi tanggal hari ini atau sesudahnya." });

  if (f.syarat.length === 0) out.push({ field: "syarat", message: "Tambahkan minimal 1 syarat promo." });
  if (f.syarat.length > SH_MAX_SYARAT_ROWS) out.push({ field: "syarat", message: `Syarat promo maksimal ${SH_MAX_SYARAT_ROWS} baris.` });
  f.syarat.forEach((r, i) => {
    const field = `syarat.${i}`, label = `Syarat ${i + 1}`;
    if (r.kind === "qty") {
      if (!inRange(parseBulat(r.min), 1, SH_MAX_QTY_MIN)) out.push({ field, message: `${label}: kuantitas minimum harus bilangan bulat 1–99.999.${ambigu(r.min)}` });
      itemIssues(r.items, label, field, SH_MAX_ROW_ITEMS, ctx.items, out);
    } else if (!inRange(parseBulat(r.min), 1, SH_MAX_MONEY)) out.push({ field, message: `${label}: nilai minimum harus bilangan bulat 1–99.999.999 (Rp).${ambigu(r.min)}` });
  });

  itemIssues(f.hasil.items, "Hasil", "hasil", SH_MAX_HASIL_ITEMS, ctx.items, out);
  if (!inRange(parseBulat(f.hasil.rewardQty), 1, SH_MAX_REWARD_QTY)) out.push({ field: "hasil", message: `Hasil: jumlah barang hasil per kelipatan harus bilangan bulat 1–999.${ambigu(f.hasil.rewardQty)}` });
  if (f.hasil.discountType === "nominal") {
    if (!inRange(parseBulat(f.hasil.value), 1, SH_MAX_MONEY)) out.push({ field: "hasil", message: `Hasil: potongan nominal harus bilangan bulat Rp1–99.999.999.${ambigu(f.hasil.value)}` });
  } else {
    if (!inRange(parseBulat(f.hasil.value), 1, 100)) out.push({ field: "hasil", message: `Hasil: potongan persen harus bilangan bulat 1–100.${ambigu(f.hasil.value)}` });
    if (f.hasil.maxAmount.trim() && !inRange(parseBulat(f.hasil.maxAmount), 1, SH_MAX_MONEY)) out.push({ field: "hasil", message: "Hasil: maksimum diskon harus bilangan bulat Rp1–99.999.999 (atau kosongkan)." });
  }

  if (f.belowHpp.allowed) {
    if (!ctx.isOwner) out.push({ field: "waiver", message: "Hanya Owner yang boleh mengizinkan penjualan di bawah HPP." });
    const reason = f.belowHpp.reason.trim();
    if (reason.length < 10) out.push({ field: "waiver", message: "Alasan izin di bawah HPP minimal 10 karakter." });
    else if (f.belowHpp.reason.length > 200) out.push({ field: "waiver", message: "Alasan izin di bawah HPP maksimal 200 karakter." });
  }

  // Pagar terakhir: bentuk yang sama persis dengan yang dibaca kasir (mesin) — hanya bila tidak ada masalah lain.
  if (out.length === 0) {
    const v = paketValuesFromForm(f, "");
    const def = { id: "form", repeat: v.repeat, syarat: v.syarat, hasil: { items: (v.hasil as { items: unknown }).items, reward_qty: (v.hasil as { reward_qty: unknown }).reward_qty, discount: (v.hasil as { discount: unknown }).discount } };
    const res = validateSyaratHasilDef(def);
    if (!res.ok) out.push({ field: "definisi", message: res.message });
  }
  return out;
}

/**
 * Pagar murah yang HARUS jalan sebelum pembacaan master barang/cabang: ukuran daftar (batas yang sama dengan database) dan
 * bentuk id cabang (UUID), supaya payload raksasa/palsu ditolak dengan pesan Indonesia tanpa satu pun query.
 */
export function cekUkuranPaket(f: Pick<PaketForm, "branchIds" | "syarat" | "hasil">): PaketIssue[] {
  const out: PaketIssue[] = [];
  if (f.syarat.length > SH_MAX_SYARAT_ROWS) out.push({ field: "syarat", message: `Syarat promo maksimal ${SH_MAX_SYARAT_ROWS} baris.` });
  f.syarat.forEach((r, i) => { if (r.kind === "qty" && r.items.length > SH_MAX_ROW_ITEMS) out.push({ field: `syarat.${i}`, message: `Syarat ${i + 1}: maksimal ${SH_MAX_ROW_ITEMS} barang.` }); });
  if (f.hasil.items.length > SH_MAX_HASIL_ITEMS) out.push({ field: "hasil", message: `Hasil: maksimal ${SH_MAX_HASIL_ITEMS} barang.` });
  if (f.branchIds.some((b) => !UUID.test(b))) out.push({ field: "cabang", message: "Cabang tidak valid. Muat ulang halaman lalu pilih cabang lagi." });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Kalimat pratinjau
// ---------------------------------------------------------------------------------------------
const satuanUnik = (refs: PaketItemRef[]) => [...new Set(refs.map((r) => r.unit))].sort();
/** Nama barang; satuan ikut ditulis per barang hanya bila kelompok bercampur satuan (satuan tunggal ditulis sekali di kalimat). */
const kumpulan = (refs: PaketItemRef[], nameOf: (id: string) => string, denganSatuan = false) => {
  const names = refs.map((r) => (denganSatuan ? `${nameOf(r.item_id)} (${r.unit})` : nameOf(r.item_id)));
  return names.length <= 3 ? names.join(" / ") : `${names.slice(0, 2).join(" / ")} +${names.length - 2} varian`;
};
/** Keterangan campuran: varian banyak dan/atau satuan berbeda. Daftar satuan disebut bila nama yang tampil terpotong. */
const campuran = (refs: PaketItemRef[], opts: { varian: boolean }) => {
  const units = satuanUnik(refs), parts: string[] = [];
  if (opts.varian && refs.length > 1) parts.push("campur varian");
  if (units.length > 1) parts.push(refs.length > 3 ? `campur satuan: ${units.join(", ")}` : "campur satuan");
  return parts.length ? ` (${parts.join(", ")})` : "";
};

export function ringkasPaket(f: Pick<PaketForm, "repeat" | "syarat" | "hasil">, nameOf: (id: string) => string): string {
  if (f.syarat.length === 0) return "Promo belum lengkap: isi syarat.";
  const pieces = f.syarat.map((r) => {
    if (r.kind === "nilai") { const m = parseBulat(r.min); return `belanja minimal ${m === null ? "Rp…" : rp(m)}`; }
    const m = parseBulat(r.min), jumlah = m === null ? "…" : String(m);
    if (r.items.length === 0) return `beli ${jumlah} (barang belum dipilih)`;
    const satu = satuanUnik(r.items).length === 1;
    return `beli ${jumlah} ${satu ? r.items[0].unit : "unit"} ${kumpulan(r.items, nameOf, !satu)}${campuran(r.items, { varian: true })}`;
  });
  const syarat = pieces.join(" DAN ");
  const head = `${syarat.charAt(0).toUpperCase()}${syarat.slice(1)}`;
  const missing: string[] = [];
  if (f.hasil.items.length === 0) missing.push("pilih barang hasil");
  const value = parseBulat(f.hasil.value);
  if (!inRange(value, 1, f.hasil.discountType === "percent" ? 100 : SH_MAX_MONEY)) missing.push("isi potongan");
  if (missing.length) return `${head} → (promo belum lengkap: ${missing.join(", ")})`;
  const cap = parseBulat(f.hasil.maxAmount);
  const satu = satuanUnik(f.hasil.items).length === 1, U = satu ? f.hasil.items[0].unit : "unit";
  const diskon = f.hasil.discountType === "percent" ? `potongan ${value}% per ${U}` : `potongan ${rp(value as number)} per ${U}`;
  const rq = parseBulat(f.hasil.rewardQty);
  const tail = [
    f.hasil.discountType === "percent" && cap ? `maks. diskon ${rp(cap)} per ${U}` : null,
    rq && rq > 1 ? `maks. ${rq} ${U} per kelipatan` : null, f.repeat ? "berlaku kelipatan" : "sekali saja",
  ].filter(Boolean).join(", ");
  return `${head} → ${diskon} ${kumpulan(f.hasil.items, nameOf, !satu)}${campuran(f.hasil.items, { varian: false })}, ${tail}`;
}

/** Ringkasan satu baris untuk daftar promo; "—" bila aturan bukan Syarat-Hasil. */
export function ringkasAturanPaket(rule: unknown, nameOf: (id: string) => string): string {
  const f = paketFormFromRule(rule);
  return f ? ringkasPaket(f, nameOf) : "—";
}

// ---------------------------------------------------------------------------------------------
// Taksiran rugi di bawah HPP (per unit hasil)
// ---------------------------------------------------------------------------------------------
export type EstimasiHasil = { discountPerUnit: number; netPerUnit: number; hpp: number | null; belowHpp: boolean | null; lossPerUnit: number };
/** Aturan yang sama dengan mesin: potongan nominal/persen (setengah-ke-atas) per unit, dibatasi maks. diskon, neto tak pernah < Rp1. */
export function estimasiHasil(a: { price: number; hpp: number | null; discount: { type: "nominal" | "percent"; value: number; maxAmount?: number | null } }): EstimasiHasil {
  const price = Math.round(a.price);
  let d = a.discount.type === "nominal" ? a.discount.value : Math.floor((price * a.discount.value + 50) / 100);
  if (a.discount.type === "percent" && a.discount.maxAmount) d = Math.min(d, a.discount.maxAmount);
  d = Math.max(0, Math.min(d, price - 1));
  const net = price - d;
  if (a.hpp === null || !Number.isFinite(a.hpp)) return { discountPerUnit: d, netPerUnit: net, hpp: null, belowHpp: null, lossPerUnit: 0 };
  const below = net < a.hpp;
  return { discountPerUnit: d, netPerUnit: net, hpp: a.hpp, belowHpp: below, lossPerUnit: below ? Math.round(a.hpp - net) : 0 };
}

// ---------------------------------------------------------------------------------------------
// Galat database → Indonesia
// ---------------------------------------------------------------------------------------------
export const PESAN_BELUM_DIRILIS = "Fitur promo paket belum dirilis oleh Owner. Promo tetap tersimpan sebagai draf dan bisa diaktifkan setelah dirilis.";
export const PESAN_STALE = "Promo ini sudah diubah orang lain sejak Anda membukanya. Isian Anda tetap tersimpan di browser; muat ulang data terbaru, lalu terapkan lagi perubahan Anda.";

export function pesanGalatPaket(error: { code?: string | null; message?: string | null } | string | null | undefined): string {
  const e = typeof error === "string" ? { message: error, code: null } : error ?? {};
  const msg = e.message ?? "", code = e.code ?? "";
  const detail = (tag: string) => msg.slice(msg.indexOf(tag) + tag.length).replace(/^:\s*/, "").replace(/^SH_[A-Z_]+:\s*/, "").trim();
  if (msg.includes("PROMO_SH_RELEASE")) return /di bawah HPP/i.test(msg) ? "Izin penjualan di bawah HPP belum dirilis oleh Owner. Matikan izin tersebut atau tunggu rilis." : PESAN_BELUM_DIRILIS;
  if (code === "40001" || msg.includes("PROMO_EDIT_CONFLICT")) return PESAN_STALE;
  if (msg.includes("PROMO_SH_OWNER_ONLY")) return "Hanya Owner yang boleh mengizinkan penjualan di bawah HPP.";
  if (msg.includes("PROMO_SH_ACTIVE_EDIT")) return "Promo sedang aktif. Nonaktifkan dulu sebelum mengubah isinya.";
  if (msg.includes("PROMO_SH_DUPLICATE")) return "Sudah ada promo aktif dengan aturan yang sama pada tanggal dan cabang yang beririsan.";
  if (msg.includes("PROMO_SH_NO_DELETE")) return "Promo paket tidak bisa dihapus. Nonaktifkan saja.";
  if (msg.includes("PROMO_SH_MODE")) return "Jenis promo tidak bisa diubah. Buat promo paket baru.";
  if (msg.includes("PROMO_SH_TARGET")) return `Barang promo bermasalah: ${detail("PROMO_SH_TARGET")}`;
  if (msg.includes("PROMO_SH_RULE")) return `Aturan promo ditolak: ${detail("PROMO_SH_RULE")}`;
  if (/(?:^|[^A-Z_])KADALUARSA:/.test(msg)) return msg.slice(msg.search(/KADALUARSA:/) + "KADALUARSA:".length).trim();
  if (/Promo tidak ditemukan/i.test(msg)) return "Promo tidak ditemukan atau bukan promo paket.";
  if (code === "42501" || /Hanya owner\/manajer/i.test(msg)) return "Hanya Owner/Admin aktif yang bisa mengatur promo.";
  return msg ? `Gagal menyimpan promo: ${msg}` : "Gagal menyimpan promo. Coba lagi.";
}

// ---------------------------------------------------------------------------------------------
// Gerbang peran
// ---------------------------------------------------------------------------------------------
export function paketAkses(me: { role?: string | null; is_active?: boolean | null } | null | undefined): { allowed: boolean; isOwner: boolean } {
  const ok = !!me && me.is_active === true && (me.role === "OWNER" || me.role === "ADMIN");
  return { allowed: ok, isOwner: ok && me!.role === "OWNER" };
}
export const UUID_RE = UUID;
