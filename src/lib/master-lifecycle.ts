export const MASTER_PATHS = {
  employees: "/hris/karyawan", items: "/pos/sku", brands: "/pos/merek",
  suppliers: "/pembelian?tab=supplier", supplier_categories: "/pembelian/kategori-pemasok", units: "/pos/satuan",
} as const;
export type MasterEntity = keyof typeof MASTER_PATHS;
export type LifecycleRow = { lifecycle_revision?: number; trashed_at?: string | null };
export type MasterView = "all" | "active" | "inactive" | "trash";
export function masterView(value?: string): MasterView {
  return value === "active" || value === "inactive" || value === "trash" ? value : "all";
}
export function visibleMasters<T extends LifecycleRow>(rows: T[], view: MasterView, active: (row: T) => boolean) {
  return rows.filter(row => view === "trash" ? Boolean(row.trashed_at) : !row.trashed_at && (view === "all" || active(row) === (view === "active")));
}
// Only preserve known list filters; never trust a browser-provided redirect URL.
export function masterReturn(entity: MasterEntity, raw?: string) {
  const base = MASTER_PATHS[entity];
  const target = new URL(base, "https://local.invalid");
  const params = new URLSearchParams(raw);
  for (const key of ["view", "cari", "kat", "induk", "jenis", "hal", "cabang", "peran"]) {
    const value = params.get(key);
    if (value) target.searchParams.set(key, value.slice(0, 200));
  }
  return target.pathname + target.search;
}
export function lifecycleInput(data: FormData) {
  const entity = String(data.get("entity") ?? "") as MasterEntity;
  const id = String(data.get("id") ?? "");
  const action = String(data.get("action") ?? "");
  const revisionRaw = String(data.get("revision") ?? "");
  const revision = Number(revisionRaw);
  const reason = String(data.get("reason") ?? "").trim();
  if (!Object.hasOwn(MASTER_PATHS, entity) || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !["archive", "activate", "trash", "restore"].includes(action) || !revisionRaw
    || !Number.isSafeInteger(revision) || revision < 0 || reason.length < 3 || reason.length > 500) {
    throw new Error("Data, versi dan alasan (3–500 karakter) wajib diisi.");
  }
  return { entity, id, action, revision, reason };
}
