"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { EXCEL_SHEET_MAX_BYTES } from "@/lib/excel-sheet";
import { PROMO_MASTER_MAX_ROWS, readPromoMasterExcel, type PromoMasterExcelRow } from "@/lib/promo-master-excel";
import {
  reviewPromoMaster,
  type PromoMasterBranch,
  type PromoMasterExisting,
  type PromoMasterItem,
  type PromoMasterReview,
} from "@/lib/promo-master-import";

const KOSONG: PromoMasterReview = { rows: [], plans: [], diffs: [], valid: false, error: null };

async function managerClient() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sesi berakhir. Masuk kembali sebelum mengunggah daftar promo.");
  const { data: profile, error } = await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (error || !profile?.is_active || !["OWNER", "ADMIN"].includes(profile.role)) {
    throw new Error("Hanya Owner/Admin aktif yang boleh mengunggah daftar promo.");
  }
  return db;
}

type Db = Awaited<ReturnType<typeof managerClient>>;

type PromoRow = {
  id: string; name: string; promo_type: string;
  rule: { suggest?: unknown; min_subtotal?: unknown; discount_mode?: string } | null;
  discount_type: "percent" | "nominal" | null; discount_value: number | null;
  auto_apply: boolean; branch_ids: string[] | null;
  valid_from: string | null; valid_until: string | null;
  min_qty: number | null; max_qty: number | null; kelipatan: boolean;
};

const angka = (value: unknown): number | null => (value == null || value === "" ? null : Number(value));

/**
 * Semua bahan pemeriksaan dibaca sekali, lalu dipakai mesin murni yang sama
 * dengan layar preview — supaya "yang terlihat hijau" dan "yang benar-benar
 * tersimpan" tidak pernah dihitung dua kali dengan aturan berbeda.
 */
async function review(db: Db, rows: PromoMasterExcelRow[]): Promise<PromoMasterReview> {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > PROMO_MASTER_MAX_ROWS) {
    throw new Error(`Daftar promo harus berisi 1 sampai ${PROMO_MASTER_MAX_ROWS} baris.`);
  }
  const codes = [...new Set(rows.map(row => String(row["Kode SKU"] ?? "").trim()).filter(Boolean))];
  const names = new Set(rows.map(row => String(row["Nama Promo"] ?? "").trim().toLowerCase()).filter(Boolean));

  const items: PromoMasterItem[] = [];
  for (let offset = 0; offset < codes.length; offset += 150) {
    items.push(...await readCompleteList<PromoMasterItem>((from, to) => db.from("items")
      .select("id,code,name,is_active", { count: "exact" })
      .in("code", codes.slice(offset, offset + 150)).order("id").range(from, to),
    "Master SKU promo", { maxRows: null }));
  }

  const branches = await readCompleteList<PromoMasterBranch>((from, to) => db.from("branches")
    .select("id,code,name,is_active", { count: "exact" }).order("id").range(from, to),
  "Cabang promo", { maxRows: null });

  // Master promo adalah konfigurasi, bukan transaksi: jumlahnya kecil dan
  // dibaca utuh supaya pencocokan nama bisa mengabaikan huruf besar/kecil.
  const promos = await readCompleteList<PromoRow>((from, to) => db.from("promos")
    .select("id,name,promo_type,rule,discount_type,discount_value,auto_apply,branch_ids,valid_from,valid_until,min_qty,max_qty,kelipatan", { count: "exact" })
    .order("id").range(from, to), "Daftar promo", { maxRows: null });
  const cocok = promos.filter(promo => names.has(String(promo.name ?? "").trim().toLowerCase()));
  const ids = cocok.map(promo => promo.id);

  const targets = ids.length
    ? await readCompleteList<{ promo_id: string; item_id: string; id: string }>(async (from, to) => {
        const result = await db.from("promo_items").select("promo_id,item_id", { count: "exact" })
          .in("promo_id", ids).order("promo_id").order("item_id").range(from, to);
        return { ...result, data: Array.isArray(result.data)
          ? (result.data as { promo_id: string; item_id: string }[]).map(row => ({ ...row, id: `${row.promo_id}:${row.item_id}` }))
          : null };
      }, "Barang promo lama", { maxRows: null })
    : [];

  const locked = ids.length
    ? await readCompleteList<{ promo_id: string; id: string }>(async (from, to) => {
        const result = await db.from("promo_import_targets").select("promo_id", { count: "exact" })
          .in("promo_id", ids).order("promo_id").range(from, to);
        return { ...result, data: Array.isArray(result.data)
          ? (result.data as { promo_id: string }[]).map(row => ({ ...row, id: row.promo_id })) : null };
      }, "Promo impor per-SKU", { maxRows: null })
    : [];
  const terkunci = new Set(locked.map(row => row.promo_id));

  const perPromo = new Map<string, string[]>();
  for (const row of targets) perPromo.set(row.promo_id, [...(perPromo.get(row.promo_id) ?? []), row.item_id]);

  // Nama barang lama dipakai memberi tahu barang mana yang akan DIHAPUS dari promo.
  const lamaIds = [...new Set(targets.map(row => row.item_id))].filter(id => !items.some(item => item.id === id));
  const lama: { id: string; code: string; name: string }[] = [];
  for (let offset = 0; offset < lamaIds.length; offset += 150) {
    lama.push(...await readCompleteList<{ id: string; code: string; name: string }>((from, to) => db.from("items")
      .select("id,code,name", { count: "exact" })
      .in("id", lamaIds.slice(offset, offset + 150)).order("id").range(from, to),
    "Barang promo lama", { maxRows: null }));
  }
  const itemLabels = Object.fromEntries([...items, ...lama].map(item => [item.id, `${item.code} · ${item.name}`]));

  const existing: PromoMasterExisting[] = cocok.map(promo => ({
    id: promo.id, name: promo.name, promo_type: promo.promo_type,
    discount_type: promo.discount_type, discount_value: angka(promo.discount_value),
    auto_apply: !!promo.auto_apply, branch_ids: promo.branch_ids,
    valid_from: promo.valid_from, valid_until: promo.valid_until,
    min_qty: angka(promo.min_qty), max_qty: angka(promo.max_qty), kelipatan: !!promo.kelipatan,
    min_subtotal: angka(promo.rule?.min_subtotal), suggest: promo.rule?.suggest == null ? null : String(promo.rule.suggest),
    item_ids: perPromo.get(promo.id) ?? [],
    locked: terkunci.has(promo.id),
    discount_mode: promo.rule?.discount_mode ?? "per_unit",
  }));

  return reviewPromoMaster(rows, { items, branches, existing, itemLabels });
}

export async function previewPromoMaster(formData: FormData): Promise<PromoMasterReview> {
  try {
    const db = await managerClient();
    const file = formData.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error("Pilih file Excel .xlsx dari format daftar promo.");
    }
    if (file.size < 1 || file.size > EXCEL_SHEET_MAX_BYTES) {
      throw new Error("File Excel harus 1 byte sampai 1 MB");
    }
    const rows = await readPromoMasterExcel(new Uint8Array(await file.arrayBuffer()));
    return await review(db, rows);
  } catch (error) {
    return { ...KOSONG, error: error instanceof Error ? error.message : "Berkas promo tidak dapat dibaca" };
  }
}

export async function periksaPromoMaster(rows: PromoMasterExcelRow[]): Promise<PromoMasterReview> {
  try {
    return await review(await managerClient(), rows);
  } catch (error) {
    return { ...KOSONG, error: error instanceof Error ? error.message : "Baris promo tidak dapat diperiksa" };
  }
}

export async function simpanPromoMaster(rows: PromoMasterExcelRow[]): Promise<{ ok: boolean; message: string }> {
  try {
    const db = await managerClient();
    // Yang disimpan adalah hasil pemeriksaan ULANG di server, bukan rencana dari
    // layar: layar yang sudah lama terbuka bisa memegang SKU yang sudah nonaktif.
    const hasil = await review(db, rows);
    if (!hasil.valid) {
      return { ok: false, message: hasil.error ?? "Perbaiki baris bertanda merah, lalu periksa ulang sebelum menyimpan." };
    }
    const { data, error } = await db.rpc("import_promo_master", {
      p_promos: hasil.plans.map(plan => ({
        name: plan.name, discount_type: plan.discount_type, discount_value: plan.discount_value,
        auto_apply: plan.auto_apply, branch_ids: plan.branch_ids,
        valid_from: plan.valid_from, valid_until: plan.valid_until,
        min_qty: plan.min_qty, max_qty: plan.max_qty, kelipatan: plan.kelipatan,
        min_subtotal: plan.min_subtotal, suggest: plan.suggest, item_ids: plan.item_ids,
      })),
    });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/crm/promo");
    const baru = Number(data?.created ?? 0);
    const diperbarui = Number(data?.updated ?? 0);
    return { ok: true, message: `${baru} promo baru dan ${diperbarui} promo diperbarui.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Daftar promo gagal disimpan" };
  }
}
