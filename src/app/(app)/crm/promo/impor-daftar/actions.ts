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
  type PromoMasterPlan,
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
  auto_apply: boolean; branch_ids: string[] | null; is_active: boolean;
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

  // One canonical DB snapshot feeds BOTH the visible diff and its save token.
  // Never combine an old header/target read with a newer accepted version.
  const context = await db.rpc("read_promo_import_context", { p_names: [...names] });
  if (context.error || !Array.isArray(context.data)) throw new Error("Konteks promo belum dapat dimuat. Coba muat ulang.");
  const contexts = context.data as { promo_id: string; locked: boolean; snapshot: { promo: PromoRow; item_ids: string[]; version: string } }[];
  const targets = contexts.flatMap(row => row.snapshot.item_ids.map(item_id => ({ promo_id: row.promo_id, item_id })));

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

  const existing: PromoMasterExisting[] = contexts.map(({ snapshot, locked }) => {
    const promo = snapshot.promo;
    return {
      id: promo.id, name: promo.name, promo_type: promo.promo_type,
      discount_type: promo.discount_type, discount_value: angka(promo.discount_value),
      auto_apply: !!promo.auto_apply, branch_ids: promo.branch_ids, is_active: promo.is_active,
      valid_from: promo.valid_from, valid_until: promo.valid_until,
      min_qty: angka(promo.min_qty), max_qty: angka(promo.max_qty), kelipatan: !!promo.kelipatan,
      min_subtotal: angka(promo.rule?.min_subtotal), suggest: promo.rule?.suggest == null ? null : String(promo.rule.suggest),
      item_ids: snapshot.item_ids,
      version: snapshot.version,
      locked,
      discount_mode: promo.rule?.discount_mode ?? "per_unit",
    };
  });

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

export async function simpanPromoMaster(rows: PromoMasterExcelRow[], expected?: Pick<PromoMasterPlan, "name" | "expected">[]): Promise<{ ok: boolean; message: string }> {
  try {
    const db = await managerClient();
    // Revalidate catalogue eligibility, but NEVER silently accept a newer diff.
    // The caller must submit the very snapshot displayed by preview/review.
    const hasil = await review(db, rows);
    if (!hasil.valid) {
      return { ok: false, message: hasil.error ?? "Perbaiki baris bertanda merah, lalu periksa ulang sebelum menyimpan." };
    }
    if (!Array.isArray(expected) || expected.length !== hasil.plans.length || hasil.plans.some(plan => {
      const old = expected.find(row => row.name.trim().toLowerCase() === plan.name.trim().toLowerCase());
      if (!old) return true;
      if (plan.expected === null) return old.expected !== null;
      return !old.expected || old.expected.id !== plan.expected.id || old.expected.version !== plan.expected.version;
    })) return { ok: false, message: "Promo sudah berubah atau preview belum tersedia. Periksa ulang dan tinjau perubahan sebelum menyimpan lagi." };
    const { data, error } = await db.rpc("import_promo_master", {
      p_promos: hasil.plans.map(plan => ({
        expected: expected.find(row => row.name.trim().toLowerCase() === plan.name.trim().toLowerCase())!.expected,
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
