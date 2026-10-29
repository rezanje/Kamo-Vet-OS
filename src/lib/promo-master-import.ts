import type { PromoMasterExcelRow } from "./promo-master-excel";

// Pemeriksaan berkas "Daftar Promo" — murni, tanpa database, supaya layar preview
// dan server memakai hasil yang persis sama. Tidak ada satu pun promo tersimpan
// sampai seluruh baris bersih.

export type PromoMasterItem = { id: string; code: string; name: string; is_active: boolean };
export type PromoMasterBranch = { id: string; code: string | null; name: string; is_active: boolean };

export type PromoMasterExisting = {
  id: string; name: string; promo_type: string;
  discount_type: "percent" | "nominal" | null; discount_value: number | null;
  auto_apply: boolean; branch_ids: string[] | null;
  valid_from: string | null; valid_until: string | null;
  min_qty: number | null; max_qty: number | null; kelipatan: boolean;
  min_subtotal: number | null; suggest: string | null;
  item_ids: string[];
  /** Promo hasil impor per-SKU lama: target & satuannya dikunci trigger database. */
  locked: boolean;
};

export type PromoMasterPlan = {
  name: string;
  discount_type: "percent" | "nominal";
  discount_value: number;
  auto_apply: boolean;
  /** null = semua cabang. */
  branch_ids: string[] | null;
  branch_codes: string[];
  valid_from: string; valid_until: string;
  min_qty: number | null; max_qty: number | null;
  kelipatan: boolean;
  min_subtotal: number | null;
  suggest: string;
  item_ids: string[];
  item_codes: string[];
};

export type PromoMasterChange = { label: string; dari: string; ke: string };
export type PromoMasterDiff = {
  name: string;
  promoId: string | null;
  status: "baru" | "ubah" | "sama";
  itemsAdded: string[];
  itemsRemoved: string[];
  changes: PromoMasterChange[];
};

export type PromoMasterReviewRow = PromoMasterExcelRow & { item_name: string | null; error: string | null };

export type PromoMasterReview = {
  rows: PromoMasterReviewRow[];
  plans: PromoMasterPlan[];
  diffs: PromoMasterDiff[];
  valid: boolean;
  error: string | null;
};

export const PROMO_MASTER_MAX_PROMOS = 50;

const teks = (value: unknown) => String(value ?? "").trim();

/** Angka Indonesia maupun Inggris; maksimal dua desimal. NaN = tidak valid. */
export function parsePromoAngka(raw: string): number {
  const text = raw.replace(/\s|_/g, "").replace(/^Rp/i, "");
  if (!text) return NaN;
  let normal = text;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) normal = text.replaceAll(".", "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(text)) normal = text.replace(",", ".");
  else if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  const value = Number(normal);
  return Number.isFinite(value) ? value : NaN;
}

/** "YYYY-MM-DD", "DD/MM/YYYY" atau "D-M-YYYY" → "YYYY-MM-DD"; "" bila tidak valid. */
export function parsePromoTanggal(raw: string): string {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const lokal = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : lokal ? [lokal[3], lokal[2], lokal[1]] : null;
  if (!parts) return "";
  const [year, month, day] = parts.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return date.toISOString().slice(0, 10);
}

export function parsePromoYaTidak(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (["ya", "y", "true", "1", "aktif"].includes(text)) return true;
  if (["tidak", "t", "n", "no", "false", "0", "-"].includes(text)) return false;
  return null;
}

const rupiah = (value: number | null) => (value == null ? "—" : `Rp ${Math.round(value).toLocaleString("id-ID")}`);
const yaTidak = (value: boolean) => (value ? "Ya" : "Tidak");
const angka = (value: number | null) => (value == null ? "—" : String(value));

type Parsed = {
  nama: string;
  sku: string;
  discount_type: "percent" | "nominal" | null;
  discount_value: number;
  auto_apply: boolean | null;
  branch_codes: string[];
  valid_from: string; valid_until: string;
  min_qty: number | null; max_qty: number | null;
  kelipatan: boolean | null;
  min_subtotal: number | null;
  suggest: string;
};

const BANDING: { key: keyof Parsed; label: string }[] = [
  { key: "discount_type", label: "Jenis Diskon" }, { key: "discount_value", label: "Nilai" },
  { key: "auto_apply", label: "Potong Otomatis" }, { key: "valid_from", label: "Tanggal Mulai" },
  { key: "valid_until", label: "Tanggal Berakhir" }, { key: "min_qty", label: "Min Qty" },
  { key: "max_qty", label: "Maks Qty" }, { key: "kelipatan", label: "Kelipatan" },
  { key: "min_subtotal", label: "Min Belanja" }, { key: "suggest", label: "Teks Saran" },
];

function samaCabang(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

export function reviewPromoMaster(
  rows: PromoMasterExcelRow[],
  master: { items: PromoMasterItem[]; branches: PromoMasterBranch[]; existing: PromoMasterExisting[]; itemLabels?: Record<string, string> },
): PromoMasterReview {
  if (!Array.isArray(rows) || rows.length < 1) {
    return { rows: [], plans: [], diffs: [], valid: false, error: "Berkas promo belum berisi satu baris pun." };
  }
  const byCode = new Map(master.items.map(item => [item.code.toLowerCase(), item]));
  const branchByCode = new Map(master.branches.flatMap(branch => (branch.code ? [[branch.code.toLowerCase(), branch] as const] : [])));
  const existingByName = new Map(master.existing.map(promo => [promo.name.trim().toLowerCase(), promo]));
  const label = (id: string) => master.itemLabels?.[id] ?? id;

  const errors = new Map<number, string>();
  const setError = (index: number, message: string) => { if (!errors.has(index)) errors.set(index, message); };

  const parsed: Parsed[] = rows.map((row, index) => {
    const nama = teks(row["Nama Promo"]);
    const sku = teks(row["Kode SKU"]);
    const jenisRaw = teks(row["Jenis Diskon"]).toLowerCase();
    const jenis = jenisRaw === "persen" || jenisRaw === "percent" ? "percent"
      : jenisRaw === "nominal" || jenisRaw === "rupiah" ? "nominal" : null;
    const nilai = parsePromoAngka(teks(row["Nilai"]));
    const otomatis = parsePromoYaTidak(teks(row["Potong Otomatis"]));
    const cabangRaw = teks(row["Cabang"]);
    const branch_codes = [...new Set(cabangRaw.split(",").map(part => part.trim().toUpperCase()).filter(Boolean))].sort();
    const mulai = parsePromoTanggal(teks(row["Tanggal Mulai"]));
    const akhir = parsePromoTanggal(teks(row["Tanggal Berakhir"]));
    const minRaw = teks(row["Min Qty"]);
    const maksRaw = teks(row["Maks Qty"]);
    const kelipatan = parsePromoYaTidak(teks(row["Kelipatan"]) || "Tidak");
    const belanjaRaw = teks(row["Min Belanja"]);
    const saran = teks(row["Teks Saran"]).slice(0, 160) || nama.slice(0, 160);
    const minQty = minRaw ? parsePromoAngka(minRaw) : null;
    const maxQty = maksRaw ? parsePromoAngka(maksRaw) : null;
    const minBelanja = belanjaRaw ? parsePromoAngka(belanjaRaw) : null;

    const item = byCode.get(sku.toLowerCase());
    if (!nama) setError(index, "Nama Promo wajib diisi");
    else if (nama.length > 120) setError(index, "Nama Promo maksimal 120 karakter");
    else if (!sku) setError(index, "Kode SKU wajib diisi");
    else if (!item) setError(index, "SKU tidak ada di master");
    else if (!item.is_active) setError(index, "SKU nonaktif");
    else if (!jenis) setError(index, "Jenis Diskon harus Persen atau Nominal");
    else if (!Number.isFinite(nilai) || nilai <= 0) setError(index, "Nilai harus angka lebih dari 0, maksimal dua desimal");
    else if (jenis === "percent" && nilai > 100) setError(index, "Diskon Persen tidak boleh lebih dari 100");
    else if (otomatis === null) setError(index, "Potong Otomatis harus Ya atau Tidak");
    else if (kelipatan === null) setError(index, "Kelipatan harus Ya atau Tidak");
    else if (branch_codes.some(code => !branchByCode.get(code.toLowerCase())?.is_active)) {
      setError(index, `Kode cabang tidak dikenal atau nonaktif: ${branch_codes.filter(code => !branchByCode.get(code.toLowerCase())?.is_active).join(", ")}`);
    } else if (!mulai || !akhir) setError(index, "Tanggal Mulai dan Tanggal Berakhir wajib format YYYY-MM-DD");
    else if (akhir < mulai) setError(index, "Tanggal Berakhir mendahului Tanggal Mulai");
    else if (minRaw && (!Number.isFinite(minQty as number) || (minQty as number) <= 0)) setError(index, "Min Qty harus lebih dari 0 atau dikosongkan");
    else if (maksRaw && (!Number.isFinite(maxQty as number) || (maxQty as number) <= 0)) setError(index, "Maks Qty harus lebih dari 0 atau dikosongkan");
    else if (minQty != null && maxQty != null && maxQty < minQty) setError(index, "Maks Qty tidak boleh lebih kecil dari Min Qty");
    else if (belanjaRaw && (!Number.isFinite(minBelanja as number) || (minBelanja as number) < 0)) setError(index, "Min Belanja harus angka 0 atau lebih");
    else if (kelipatan && otomatis && minQty == null) setError(index, "Kelipatan Ya memerlukan Min Qty terisi");

    return {
      nama, sku, discount_type: jenis, discount_value: Number.isFinite(nilai) ? nilai : 0,
      auto_apply: otomatis, branch_codes, valid_from: mulai, valid_until: akhir,
      min_qty: minRaw && Number.isFinite(minQty as number) ? (minQty as number) : null,
      max_qty: maksRaw && Number.isFinite(maxQty as number) ? (maxQty as number) : null,
      kelipatan, min_subtotal: belanjaRaw && Number.isFinite(minBelanja as number) ? (minBelanja as number) : null,
      suggest: saran,
    };
  });

  // Kelompokkan baris per Nama Promo. Nilai selain Kode SKU wajib sama persis.
  const groups = new Map<string, number[]>();
  parsed.forEach((row, index) => {
    if (!row.nama) return;
    const key = row.nama.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  if (groups.size > PROMO_MASTER_MAX_PROMOS) {
    return {
      rows: rows.map((row, index) => ({ ...row, item_name: byCode.get(teks(row["Kode SKU"]).toLowerCase())?.name ?? null, error: errors.get(index) ?? null })),
      plans: [], diffs: [], valid: false,
      error: `Maksimal ${PROMO_MASTER_MAX_PROMOS} promo per berkas; berkas ini berisi ${groups.size}.`,
    };
  }

  const plans: PromoMasterPlan[] = [];
  const diffs: PromoMasterDiff[] = [];

  for (const [key, indexes] of groups) {
    const first = parsed[indexes[0]];
    const seen = new Set<string>();
    for (const index of indexes) {
      const row = parsed[index];
      const sku = row.sku.toLowerCase();
      if (seen.has(sku)) setError(index, "Kode SKU ini sudah ada di promo yang sama");
      seen.add(sku);
      if (index === indexes[0]) continue;
      const beda = BANDING.find(field => JSON.stringify(row[field.key]) !== JSON.stringify(first[field.key]));
      if (beda) setError(index, `Kolom ${beda.label} berbeda dari baris pertama promo ini`);
      else if (!samaCabang(row.branch_codes, first.branch_codes)) setError(index, "Kolom Cabang berbeda dari baris pertama promo ini");
    }

    const existing = existingByName.get(key) ?? null;
    if (existing && existing.promo_type !== "diskon_produk") {
      setError(indexes[0], `Nama ini sudah dipakai promo jenis ${existing.promo_type}; ganti nama promo`);
    } else if (existing?.locked) {
      setError(indexes[0], "Promo ini dibuat lewat impor per-SKU dan targetnya dikunci; buat nama baru");
    }
    if (indexes.some(index => errors.has(index))) continue;

    const item_ids = indexes.map(index => byCode.get(parsed[index].sku.toLowerCase())!.id);
    const branch_ids = first.branch_codes.length
      ? first.branch_codes.map(code => branchByCode.get(code.toLowerCase())!.id).sort()
      : null;
    const plan: PromoMasterPlan = {
      name: first.nama, discount_type: first.discount_type!, discount_value: first.discount_value,
      auto_apply: !!first.auto_apply, branch_ids, branch_codes: first.branch_codes,
      valid_from: first.valid_from, valid_until: first.valid_until,
      min_qty: first.min_qty, max_qty: first.max_qty, kelipatan: !!first.kelipatan,
      min_subtotal: first.min_subtotal, suggest: first.suggest,
      item_ids: [...new Set(item_ids)].sort(),
      item_codes: indexes.map(index => parsed[index].sku),
    };
    plans.push(plan);
    diffs.push(bandingkan(plan, existing, master.branches, label));
  }

  const reviewed: PromoMasterReviewRow[] = rows.map((row, index) => ({
    ...row,
    item_name: byCode.get(teks(row["Kode SKU"]).toLowerCase())?.name ?? null,
    error: errors.get(index) ?? null,
  }));
  const valid = reviewed.every(row => !row.error) && plans.length > 0;
  return { rows: reviewed, plans, diffs, valid, error: null };
}

function bandingkan(
  plan: PromoMasterPlan, existing: PromoMasterExisting | null,
  branches: PromoMasterBranch[], label: (id: string) => string,
): PromoMasterDiff {
  if (!existing) {
    return { name: plan.name, promoId: null, status: "baru", itemsAdded: plan.item_codes, itemsRemoved: [], changes: [] };
  }
  const branchName = new Map(branches.map(branch => [branch.id, branch.code || branch.name]));
  const cabangLama = existing.branch_ids?.length ? [...existing.branch_ids].sort().map(id => branchName.get(id) ?? id).join(", ") : "Semua cabang";
  const cabangBaru = plan.branch_ids?.length ? plan.branch_ids.map(id => branchName.get(id) ?? id).join(", ") : "Semua cabang";
  const changes: PromoMasterChange[] = [];
  const catat = (label: string, dari: string, ke: string) => { if (dari !== ke) changes.push({ label, dari, ke }); };
  catat("Jenis Diskon", existing.discount_type === "percent" ? "Persen" : existing.discount_type === "nominal" ? "Nominal" : "—",
    plan.discount_type === "percent" ? "Persen" : "Nominal");
  catat("Nilai", existing.discount_value == null ? "—" : String(existing.discount_value), String(plan.discount_value));
  catat("Potong Otomatis", yaTidak(existing.auto_apply), yaTidak(plan.auto_apply));
  catat("Cabang", cabangLama, cabangBaru);
  catat("Tanggal Mulai", existing.valid_from ?? "—", plan.valid_from);
  catat("Tanggal Berakhir", existing.valid_until ?? "—", plan.valid_until);
  catat("Min Qty", angka(existing.min_qty), angka(plan.min_qty));
  catat("Maks Qty", angka(existing.max_qty), angka(plan.max_qty));
  catat("Kelipatan", yaTidak(existing.kelipatan), yaTidak(plan.kelipatan));
  catat("Min Belanja", rupiah(existing.min_subtotal), rupiah(plan.min_subtotal));
  catat("Teks Saran", existing.suggest ?? "—", plan.suggest);

  const lama = new Set(existing.item_ids);
  const baru = new Set(plan.item_ids);
  const itemsAdded = plan.item_ids.filter(id => !lama.has(id)).map(label);
  const itemsRemoved = existing.item_ids.filter(id => !baru.has(id)).map(label);
  const status = changes.length || itemsAdded.length || itemsRemoved.length ? "ubah" : "sama";
  return { name: plan.name, promoId: existing.id, status, itemsAdded, itemsRemoved, changes };
}
