# Master Data & Kategori Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melengkapi enam master data ala Accurate (satuan global, kategori barang bertingkat, kategori pemasok, kategori aset, kategori pelanggan berdiskon) supaya migrasi data dari Accurate lancar dan diskon golongan pelanggan jalan otomatis di kasir.

**Architecture:** Satu migrasi (`0066`) membuat semua tabel master + backfill data lama. Tiap master punya halaman sendiri berpola `/pos/merek` (server component + `actions.ts` sefolder) — tidak ada komponen tabel generik, karena field tiap master berbeda. Yang dibagi hanya bagian yang benar-benar identik: guard peran (`assertMasterAdmin`) + kerangka halaman (`MasterPage`), plus logika murni di `src/lib/*.ts` yang punya test sendiri.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + RLS demo-permissive), TypeScript, Vitest. CSS = kelas clay/cream di `globals.css` (BUKAN Tailwind di area `(app)`), ikon Tabler via CDN.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-master-data-kategori-design.md`. Kalau plan dan spec bentrok, spec yang menang — laporkan bentrokannya.
- Guard peran: hanya `OWNER`/`ADMIN` boleh menulis master data. Role lain boleh **melihat** (banner read-only, bukan redirect).
- Kategori/master **tidak pernah dihapus** — hanya `is_active` di-toggle. Menghapus akan merusak riwayat.
- Semua kegagalan tampil sebagai pesan Bahasa Indonesia di banner halaman. **Tidak boleh** ada pesan error Postgres mentah sampai ke user.
- Bahasa UI: Indonesia. Nama kolom DB & fungsi: sesuai yang tertulis di plan ini, jangan diganti.
- Baris transaksi historis (`sale_items.satuan`, `purchase_order_items.satuan`, `prescription_items.satuan`) **tidak boleh diubah** oleh migrasi apa pun di plan ini.
- Migrasi diterapkan ke Supabase project `koaglxcyjqfmgfzxszkj` lewat MCP `apply_migration`, DAN file SQL-nya disimpan di `supabase/migrations/`.
- Jangan jalankan `npm run build` saat dev server preview nyala (merusak `.next`). Verifikasi pakai `npm test` + `npx tsc --noEmit`.
- Test pakai Vitest, colocated: `src/lib/<nama>.test.ts` (pola `src/lib/satuan.test.ts`).
- Nomor akun default penyusutan: beban `5601`, akumulasi `1509`. Jangan diganti.

---

### Task 1: Migrasi 0066 — semua tabel master + backfill

**Files:**
- Create: `supabase/migrations/0066_master_data_kategori.sql`

**Interfaces:**
- Consumes: tabel yang sudah ada — `items`, `item_units`, `item_categories`, `suppliers`, `fixed_assets`, `customers`, `sales`.
- Produces: tabel `units`, `supplier_categories`, `asset_categories`, `customer_categories`; kolom baru `item_categories.parent_id`, `item_categories.is_active`, `suppliers.category_id`, `fixed_assets.category_id`, `customers.category_id`, `sales.diskon_kategori`.

- [ ] **Step 1: Catat kondisi awal untuk perbandingan sesudah migrasi**

Jalankan lewat MCP `mcp__supabase__execute_sql` dan **simpan hasilnya** (dipakai Step 4):

```sql
select
  (select count(*) from items) as items,
  (select count(*) from item_units) as item_units,
  (select count(distinct lower(btrim(unit))) from items) as satuan_items_unik,
  (select count(*) from customers where kategori is not null) as cust_berkategori,
  (select count(*) from fixed_assets) as aset,
  (select coalesce(sum(qty),0) from stock_layers) as total_layer_qty;
```

Kalau tabel `stock_layers` tidak ada dengan nama itu, jalankan `mcp__supabase__list_tables` dulu dan pakai nama tabel layer FIFO yang benar; catat namanya di komentar file migrasi.

- [ ] **Step 2: Tulis file migrasi**

```sql
-- Master data & kategori ala Accurate — spec 2026-07-28.
-- Enam master: satuan global, kategori barang bertingkat, kategori pemasok,
-- kategori aset (umur + akun jurnal), kategori pelanggan (diskon persen).
-- Merek sudah lahir di 0065.
--
-- Prinsip backfill: nol data hilang. Nilai teks bebas yang sudah keburu diisi
-- dipetakan ke master baru; baris transaksi historis TIDAK disentuh.

-- ── 1. Satuan Barang (master global) ────────────────────────────────────────
create table units (
  id uuid primary key default gen_random_uuid(),
  nama varchar(20) not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table units enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action, sama pola dgn brands (0065).
create policy units_all on units for all to authenticated using (true) with check (true);

insert into units (nama)
select distinct lower(btrim(u)) from (
  select unit as u from items where unit is not null and btrim(unit) <> ''
  union all
  select unit as u from item_units where unit is not null and btrim(unit) <> ''
) s
on conflict (nama) do nothing;

-- Normalisasi bisa bentrok dgn unique(item_id, unit) kalau satu barang punya
-- "Box" dan "box" sekaligus — buang baris yang lebih baru dulu, deterministik.
delete from item_units a using item_units b
where a.item_id = b.item_id
  and lower(btrim(a.unit)) = lower(btrim(b.unit))
  and (a.created_at, a.id) > (b.created_at, b.id);

-- Nilai master dinormalkan. sale_items.satuan / purchase_order_items.satuan /
-- prescription_items.satuan SENGAJA dibiarkan: itu catatan historis.
update items set unit = lower(btrim(unit)) where unit is distinct from lower(btrim(unit));
update item_units set unit = lower(btrim(unit)) where unit is distinct from lower(btrim(unit));

-- ── 2. Kategori Barang bertingkat (2 tingkat) ───────────────────────────────
-- Batas 2 tingkat ditegakkan di server action (satu pintu tulis), bukan trigger.
alter table item_categories
  add column parent_id uuid references item_categories(id) on delete restrict,
  add column is_active boolean not null default true;
create index on item_categories(parent_id);
comment on column item_categories.parent_id is
  'Induk kategori. NULL = kategori ini induk. Maksimum 2 tingkat (induk → anak).';

-- ── 3. Kategori Pemasok ─────────────────────────────────────────────────────
create table supplier_categories (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table supplier_categories enable row level security;
create policy supcat_all on supplier_categories for all to authenticated using (true) with check (true);

insert into supplier_categories (nama) values ('Obat'), ('Pakan'), ('Alat'), ('Jasa');

alter table suppliers
  add column category_id uuid references supplier_categories(id) on delete set null;

-- ── 4. Kategori Aset ────────────────────────────────────────────────────────
create table asset_categories (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  umur_bulan int not null check (umur_bulan > 0),
  akun_beban varchar(10) not null default '5601',
  akun_akumulasi varchar(10) not null default '1509',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table asset_categories enable row level security;
create policy asetcat_all on asset_categories for all to authenticated using (true) with check (true);

insert into asset_categories (nama, umur_bulan) values
  ('Peralatan', 48), ('Inventaris Kantor', 48), ('Kendaraan', 96), ('Bangunan', 240);

alter table fixed_assets
  add column category_id uuid references asset_categories(id) on delete set null;

-- fixed_assets.kategori (teks) dibiarkan sebagai jejak historis.
update fixed_assets f set category_id = c.id
from asset_categories c where c.nama = f.kategori;

-- ── 5. Kategori Pelanggan + diskon ──────────────────────────────────────────
create table customer_categories (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  diskon_persen numeric(5,2) not null default 0
    check (diskon_persen >= 0 and diskon_persen <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table customer_categories enable row level security;
create policy custcat_all on customer_categories for all to authenticated using (true) with check (true);

-- Daftar tetap lama (0042: Umum/Member/B2B/Rescuer) dinaikkan jadi master.
insert into customer_categories (nama) values ('Umum'), ('Member'), ('B2B'), ('Rescuer');

alter table customers
  add column category_id uuid references customer_categories(id) on delete set null;

update customers c set category_id = k.id
from customer_categories k where k.nama = c.kategori;

alter table sales add column diskon_kategori numeric not null default 0;
comment on column sales.diskon_kategori is
  'Diskon dari golongan pelanggan, dihitung server dari customer_categories.diskon_persen. Terpisah dari sales.discount (diskon manual kasir/promo).';
```

- [ ] **Step 3: Terapkan migrasi**

Pakai MCP `mcp__supabase__apply_migration` dengan `name: "0066_master_data_kategori"` dan isi SQL di Step 2.

- [ ] **Step 4: Verifikasi migrasi tidak menghilangkan data**

Jalankan lewat `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from items) as items,
  (select count(*) from item_units) as item_units,
  (select count(*) from units) as units_master,
  (select count(*) from items i left join units u on u.nama = i.unit where u.id is null) as satuan_yatim,
  (select count(*) from customers where category_id is null and kategori is not null) as cust_gagal_map,
  (select count(*) from fixed_assets where category_id is null) as aset_tanpa_kategori,
  (select coalesce(sum(qty),0) from stock_layers) as total_layer_qty;
```

Harapan:
- `items` & `total_layer_qty` **sama persis** dengan Step 1.
- `item_units` sama dengan Step 1, atau lebih kecil **hanya** kalau ada duplikat case-insensitive (catat berapa yang terhapus dan kenapa).
- `satuan_yatim` = 0.
- `cust_gagal_map` = 0.
- `aset_tanpa_kategori` = 0.

Kalau ada yang tidak sesuai, **jangan lanjut** — laporkan angkanya.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0066_master_data_kategori.sql
git commit -m "feat(master-data): migrasi 0066 — satuan, kategori barang bertingkat, kategori pemasok/aset/pelanggan"
```

---

### Task 2: Kerangka bersama halaman master

**Files:**
- Create: `src/lib/master-guard.ts`
- Create: `src/components/MasterPage.tsx`
- Modify: `src/lib/barang.ts` (tambah pemetaan pesan unique violation)
- Test: `src/lib/barang.test.ts`

**Interfaces:**
- Consumes: `createClient` dari `@/lib/supabase/server`.
- Produces:
  - `assertMasterAdmin(back: string, apa: string): Promise<SupabaseClient>` — redirect ke `/login` kalau belum login, redirect ke `${back}?error=...` kalau bukan OWNER/ADMIN, kalau lolos mengembalikan client.
  - `bolehKelolaMaster(): Promise<boolean>` — dipakai server component untuk memutuskan tampil form atau banner read-only.
  - `<MasterPage back icon iconBg iconFg title desc error success successMsg bolehKelola readOnlyNote>{children}</MasterPage>`
  - `pesanSimpanGagal(raw: string): string` — sudah ada, ditambah pemetaan tabel baru.

- [ ] **Step 1: Tulis test yang gagal untuk pemetaan pesan error**

Buat `src/lib/barang.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pesanSimpanGagal } from "./barang";

describe("pesanSimpanGagal", () => {
  it("unique violation tiap master jadi bahasa manusia", () => {
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "units_nama_key"'))
      .toBe("Satuan dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "item_categories_name_key"'))
      .toBe("Kategori barang dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "supplier_categories_nama_key"'))
      .toBe("Kategori pemasok dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "asset_categories_nama_key"'))
      .toBe("Kategori aset dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "customer_categories_nama_key"'))
      .toBe("Golongan pelanggan dengan nama itu sudah ada");
  });

  it("pemetaan lama tetap jalan", () => {
    expect(pesanSimpanGagal('violates unique constraint "items_code_key"'))
      .toBe("Kode barang itu sudah dipakai barang lain");
    expect(pesanSimpanGagal('violates unique constraint "brands_name_key"'))
      .toBe("Merek dengan nama itu sudah ada");
  });

  it("error tak dikenal dilewatkan apa adanya biar tetap kelihatan", () => {
    expect(pesanSimpanGagal("connection reset by peer")).toBe("connection reset by peer");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run src/lib/barang.test.ts`
Expected: FAIL — pemetaan `units_nama_key` dsb belum ada, hasilnya masih string mentah.

- [ ] **Step 3: Tambah pemetaan di `src/lib/barang.ts`**

Ganti isi fungsi `pesanSimpanGagal` (baris 50-55) jadi:

```ts
// Error DB → bahasa manusia. Yang tidak dikenali dilewatkan apa adanya supaya
// masalah tak terduga tetap kelihatan, bukan ditelan jadi "terjadi kesalahan".
const UNIQUE_MSG: Record<string, string> = {
  items_code_key: "Kode barang itu sudah dipakai barang lain",
  brands_name_key: "Merek dengan nama itu sudah ada",
  units_nama_key: "Satuan dengan nama itu sudah ada",
  item_categories_name_key: "Kategori barang dengan nama itu sudah ada",
  supplier_categories_nama_key: "Kategori pemasok dengan nama itu sudah ada",
  asset_categories_nama_key: "Kategori aset dengan nama itu sudah ada",
  customer_categories_nama_key: "Golongan pelanggan dengan nama itu sudah ada",
};

export function pesanSimpanGagal(raw: string): string {
  const m = raw.toLowerCase();
  for (const [key, msg] of Object.entries(UNIQUE_MSG)) {
    if (m.includes(key)) return msg;
  }
  return raw;
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npx vitest run src/lib/barang.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Buat guard bersama `src/lib/master-guard.ts`**

```ts
// Guard peran untuk semua halaman master data (satuan, kategori barang/pemasok/
// aset/pelanggan). Pola diangkat dari pos/merek/actions.ts supaya aturannya
// satu tempat: OWNER/ADMIN boleh menulis, role lain read-only.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const BOLEH = ["OWNER", "ADMIN"];

async function roleSaya() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { supabase, role: profile?.role ?? "" };
}

// Dipakai server action: menulis tanpa hak = tendang balik dengan pesan.
export async function assertMasterAdmin(back: string, apa: string) {
  const { supabase, role } = await roleSaya();
  if (!BOLEH.includes(role)) {
    redirect(`${back}?error=${encodeURIComponent(`Hanya OWNER/ADMIN yang boleh mengubah ${apa}`)}`);
  }
  return supabase;
}

// Dipakai server component: staf tetap boleh LIHAT daftarnya, form-nya saja disembunyikan.
export async function bolehKelolaMaster(): Promise<boolean> {
  const { role } = await roleSaya();
  return BOLEH.includes(role);
}
```

- [ ] **Step 6: Buat kerangka halaman `src/components/MasterPage.tsx`**

```tsx
// Kerangka halaman master data: tombol kembali, judul berikon, banner
// error/sukses/read-only. Isi form & tabel dikirim sebagai children karena
// field tiap master berbeda — sengaja TIDAK bikin tabel generik.
import Link from "next/link";
import type { ReactNode } from "react";

export function MasterPage({
  back, icon, iconBg = "#eff6ff", iconFg = "#2563eb", title, desc,
  error, success, successMsg, bolehKelola, readOnlyNote, children,
}: {
  back: string;
  icon: string;
  iconBg?: string;
  iconFg?: string;
  title: string;
  desc: string;
  error?: string;
  success?: string;
  successMsg: string;
  bolehKelola: boolean;
  readOnlyNote: string;
  children: ReactNode;
}) {
  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href={back} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`ti ${icon}`} style={{ fontSize: 22, color: iconFg }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>{desc}</div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {successMsg}
        </div>
      )}
      {!bolehKelola && <div className="p2ban"><i className="ti ti-info-circle" /> {readOnlyNote}</div>}

      {children}
    </>
  );
}
```

- [ ] **Step 7: Pastikan tipe bersih**

Run: `npx tsc --noEmit`
Expected: tanpa error.

- [ ] **Step 8: Commit**

```bash
git add src/lib/master-guard.ts src/components/MasterPage.tsx src/lib/barang.ts src/lib/barang.test.ts
git commit -m "feat(master-data): kerangka halaman master + guard peran + pesan unique violation"
```

---

### Task 3: Logika satuan master (`src/lib/satuan-master.ts`)

**Files:**
- Create: `src/lib/satuan-master.ts`
- Test: `src/lib/satuan-master.test.ts`

**Interfaces:**
- Produces:
  - `normalizeUnit(raw: unknown): string` — trim, spasi ganda jadi satu, lowercase, potong 20 karakter.
  - `dedupeUnits(raws: string[]): string[]` — hasil normalisasi unik, urut abjad, buang kosong.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/satuan-master.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeUnit, dedupeUnits } from "./satuan-master";

describe("normalizeUnit", () => {
  it("beda huruf besar-kecil & spasi jadi satu satuan", () => {
    expect(normalizeUnit("PCS")).toBe("pcs");
    expect(normalizeUnit("  Box ")).toBe("box");
    expect(normalizeUnit("sak  besar")).toBe("sak besar");
  });

  it("nilai bukan teks jadi string kosong, bukan 'undefined'", () => {
    expect(normalizeUnit(null)).toBe("");
    expect(normalizeUnit(undefined)).toBe("");
    expect(normalizeUnit("   ")).toBe("");
  });

  it("dipotong 20 karakter mengikuti batas kolom units.nama", () => {
    expect(normalizeUnit("a".repeat(30))).toHaveLength(20);
  });
});

describe("dedupeUnits", () => {
  it("varian penulisan yang sama menyatu jadi satu baris", () => {
    expect(dedupeUnits(["pcs", "PCS", " Pcs "])).toEqual(["pcs"]);
  });

  it("hasil urut abjad & baris kosong dibuang", () => {
    expect(dedupeUnits(["kg", "", "box", "  ", "pcs"])).toEqual(["box", "kg", "pcs"]);
  });

  it("daftar kosong tetap kosong", () => {
    expect(dedupeUnits([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run src/lib/satuan-master.test.ts`
Expected: FAIL — "Failed to resolve import ./satuan-master".

- [ ] **Step 3: Tulis implementasi minimal**

Buat `src/lib/satuan-master.ts`:

```ts
// Satuan master global (tabel units). Dipisah dari satuan.ts yang mengurus
// KONVERSI per barang; file ini cuma soal penulisan nama satuan.
//
// Kenapa dinormalkan: "pcs" / "Pcs" / "PCS" pernah masuk sebagai tiga satuan
// berbeda, bikin laporan stok pecah dan migrasi dari Accurate kotor.

const MAX = 20; // batas kolom units.nama

export function normalizeUnit(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, MAX);
}

export function dedupeUnits(raws: string[]): string[] {
  const set = new Set<string>();
  for (const r of raws) {
    const n = normalizeUnit(r);
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "id"));
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npx vitest run src/lib/satuan-master.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/satuan-master.ts src/lib/satuan-master.test.ts
git commit -m "feat(master-data): normalisasi nama satuan + dedupe"
```

---

### Task 4: Halaman Satuan Barang (`/pos/satuan`)

**Files:**
- Create: `src/app/(app)/pos/satuan/page.tsx`
- Create: `src/app/(app)/pos/satuan/actions.ts`
- Modify: `src/lib/nav.ts:186` (tambah `href` tile "Satuan Barang")

**Interfaces:**
- Consumes: `assertMasterAdmin`, `bolehKelolaMaster` (Task 2), `MasterPage` (Task 2), `normalizeUnit` (Task 3), `pesanSimpanGagal` (Task 2).
- Produces: server action `simpanSatuan(formData)` & `toggleSatuan(formData)`; route `/pos/satuan`.

- [ ] **Step 1: Tulis server action**

Buat `src/app/(app)/pos/satuan/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { normalizeUnit } from "@/lib/satuan-master";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/satuan";

export async function simpanSatuan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "satuan barang");
  const id = String(formData.get("id") ?? "").trim();
  const nama = normalizeUnit(formData.get("nama"));

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama satuan wajib diisi")}`);

  const { error } = id
    ? await supabase.from("units").update({ nama }).eq("id", id)
    : await supabase.from("units").insert({ nama });

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Satuan tidak dihapus: barang & riwayat masih menunjuk namanya.
// Nonaktif = tidak muncul lagi di dropdown master barang.
export async function toggleSatuan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "satuan barang");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Satuan tidak valid")}`);

  const { error } = await supabase.from("units").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
```

- [ ] **Step 2: Tulis halaman**

Buat `src/app/(app)/pos/satuan/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanSatuan, toggleSatuan } from "./actions";

type Unit = { id: string; nama: string; is_active: boolean };

export default async function SatuanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: itemRows }, { data: unitRows }] = await Promise.all([
    supabase.from("units").select("id, nama, is_active").order("nama"),
    supabase.from("items").select("unit"),
    supabase.from("item_units").select("unit"),
  ]);

  const units = (data ?? []) as Unit[];

  // "Dipakai" = satuan dasar barang + satuan turunan; keduanya dihitung supaya
  // satuan yang kelihatan kosong benar-benar aman dinonaktifkan.
  const pakai = new Map<string, number>();
  for (const r of [...(itemRows ?? []), ...(unitRows ?? [])]) {
    const k = String((r as { unit: string | null }).unit ?? "");
    if (k) pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  const editing = edit ? units.find((u) => u.id === edit) ?? null : null;

  return (
    <MasterPage
      back="/pos" icon="ti-scale-outline" title="SATUAN BARANG"
      desc="Daftar satuan resmi — dipakai master Barang & Jasa"
      error={error} success={success} successMsg="Satuan tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah satuan."
    >
      {bolehKelola && (
        <form action={simpanSatuan} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="flab">{editing ? "Ubah nama satuan" : "Satuan baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={20} placeholder="mis. box" required />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Disimpan huruf kecil semua supaya tidak kembar.
              </div>
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pos/satuan" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Satuan</th>
                <th style={{ width: 110 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{u.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(u.nama) ?? 0} barang</td>
                  <td><span className={`bge ${u.is_active ? "g" : "x"}`}>{u.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pos/satuan?edit=${u.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleSatuan}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="aktif" value={u.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {u.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {units.length === 0 && (
                <tr><td colSpan={bolehKelola ? 5 : 4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada satuan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
```

- [ ] **Step 3: Sambungkan tile nav**

Di `src/lib/nav.ts`, ganti baris:

```ts
    { label: "Satuan Barang", icon: "ti-scale-outline", ...B },
```

jadi:

```ts
    { label: "Satuan Barang", icon: "ti-scale-outline", ...B, href: "/pos/satuan" },
```

- [ ] **Step 4: Verifikasi tipe & test masih hijau**

Run: `npx tsc --noEmit && npm test`
Expected: tanpa error tipe; seluruh test lolos.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/pos/satuan" src/lib/nav.ts
git commit -m "feat(persediaan): halaman master Satuan Barang"
```

---

### Task 5: Logika kategori bertingkat (`src/lib/kategori.ts`)

**Files:**
- Create: `src/lib/kategori.ts`
- Test: `src/lib/kategori.test.ts`

**Interfaces:**
- Produces:
  - `type KategoriRow = { id: string; name: string; parent_id: string | null; is_active: boolean }`
  - `buildTree(rows: KategoriRow[]): { induk: KategoriRow; anak: KategoriRow[] }[]`
  - `labelPath(id: string, rows: KategoriRow[]): string`
  - `validateParent(id: string, parentId: string | null, rows: KategoriRow[]): string | null`
  - `flatOptions(rows: KategoriRow[]): { id: string; label: string }[]` — untuk dropdown, urut hasil `buildTree`, label pakai `labelPath`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/kategori.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTree, labelPath, validateParent, flatOptions, type KategoriRow } from "./kategori";

const rows: KategoriRow[] = [
  { id: "mkn", name: "Makanan", parent_id: null, is_active: true },
  { id: "kucing", name: "Makanan Kucing", parent_id: "mkn", is_active: true },
  { id: "anjing", name: "Makanan Anjing", parent_id: "mkn", is_active: true },
  { id: "obat", name: "Obat", parent_id: null, is_active: true },
];

describe("buildTree", () => {
  it("induk urut abjad, anak nempel ke induknya", () => {
    const tree = buildTree(rows);
    expect(tree.map((t) => t.induk.id)).toEqual(["mkn", "obat"]);
    expect(tree[0].anak.map((a) => a.name)).toEqual(["Makanan Anjing", "Makanan Kucing"]);
    expect(tree[1].anak).toEqual([]);
  });

  it("anak yang induknya sudah hilang tetap tampil sebagai induk, tidak menghilang", () => {
    const yatim: KategoriRow[] = [{ id: "x", name: "Yatim", parent_id: "tidak-ada", is_active: true }];
    expect(buildTree(yatim).map((t) => t.induk.id)).toEqual(["x"]);
  });
});

describe("labelPath", () => {
  it("anak ditulis lengkap dengan induknya", () => {
    expect(labelPath("kucing", rows)).toBe("Makanan › Makanan Kucing");
    expect(labelPath("obat", rows)).toBe("Obat");
  });

  it("id tidak dikenal jadi string kosong", () => {
    expect(labelPath("hantu", rows)).toBe("");
  });
});

describe("validateParent", () => {
  it("tingkat ketiga ditolak", () => {
    expect(validateParent("obat", "kucing", rows)).toMatch(/dua tingkat/i);
  });

  it("kategori yang sudah punya anak tidak boleh dijadikan anak orang lain", () => {
    expect(validateParent("mkn", "obat", rows)).toMatch(/sudah punya anak/i);
  });

  it("kategori tidak boleh jadi induk dirinya sendiri", () => {
    expect(validateParent("mkn", "mkn", rows)).toMatch(/dirinya sendiri/i);
  });

  it("anak baru di bawah induk yang sah lolos", () => {
    expect(validateParent("obat", "mkn", rows)).toBeNull();
  });

  it("tanpa induk (jadi induk sendiri) selalu lolos", () => {
    expect(validateParent("kucing", null, rows)).toBeNull();
    expect(validateParent("", null, rows)).toBeNull();
  });

  it("induk yang tidak ada di daftar ditolak", () => {
    expect(validateParent("obat", "hantu", rows)).toMatch(/tidak ditemukan/i);
  });
});

describe("flatOptions", () => {
  it("urut pohon, anak berlabel lengkap", () => {
    expect(flatOptions(rows).map((o) => o.label)).toEqual([
      "Makanan",
      "Makanan › Makanan Anjing",
      "Makanan › Makanan Kucing",
      "Obat",
    ]);
  });

  it("kategori nonaktif dibuang beserta anaknya", () => {
    const mati = rows.map((r) => (r.id === "mkn" ? { ...r, is_active: false } : r));
    expect(flatOptions(mati).map((o) => o.id)).toEqual(["obat"]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run src/lib/kategori.test.ts`
Expected: FAIL — "Failed to resolve import ./kategori".

- [ ] **Step 3: Tulis implementasi**

Buat `src/lib/kategori.ts`:

```ts
// Kategori barang bertingkat (maks 2 tingkat: induk → anak), migrasi 0066.
// Batas 2 tingkat ditegakkan di sini + server action, bukan trigger DB —
// satu pintu tulis, jadi cukup dijaga di jalur itu.

export type KategoriRow = { id: string; name: string; parent_id: string | null; is_active: boolean };

const SEP = " › ";

const byName = (a: KategoriRow, b: KategoriRow) => a.name.localeCompare(b.name, "id");

// Anak yang induknya sudah hilang diperlakukan sebagai induk: lebih baik tampil
// salah tempat daripada hilang dari daftar tanpa jejak.
function indukEfektif(r: KategoriRow, byId: Map<string, KategoriRow>): string | null {
  return r.parent_id && byId.has(r.parent_id) ? r.parent_id : null;
}

export function buildTree(rows: KategoriRow[]): { induk: KategoriRow; anak: KategoriRow[] }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const induk = rows.filter((r) => indukEfektif(r, byId) === null).sort(byName);
  return induk.map((p) => ({
    induk: p,
    anak: rows.filter((r) => indukEfektif(r, byId) === p.id).sort(byName),
  }));
}

export function labelPath(id: string, rows: KategoriRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const r = byId.get(id);
  if (!r) return "";
  const p = indukEfektif(r, byId);
  return p ? `${byId.get(p)!.name}${SEP}${r.name}` : r.name;
}

// Kembalikan pesan Indonesia kalau melanggar, null kalau boleh.
export function validateParent(id: string, parentId: string | null, rows: KategoriRow[]): string | null {
  if (!parentId) return null;
  if (parentId === id) return "Kategori tidak boleh jadi induk dirinya sendiri";

  const byId = new Map(rows.map((r) => [r.id, r]));
  const calon = byId.get(parentId);
  if (!calon) return "Kategori induk tidak ditemukan";

  if (indukEfektif(calon, byId) !== null) {
    return "Kategori hanya boleh dua tingkat — induk yang dipilih sudah jadi anak";
  }
  if (id && rows.some((r) => indukEfektif(r, byId) === id)) {
    return "Kategori ini sudah punya anak, jadi tidak boleh dipindah ke bawah kategori lain";
  }
  return null;
}

// Dropdown pemilihan kategori barang: nonaktif dibuang, anak dari induk yang
// nonaktif ikut dibuang (kalau tidak, barang bisa nyangkut di cabang mati).
export function flatOptions(rows: KategoriRow[]): { id: string; label: string }[] {
  const aktif = rows.filter((r) => r.is_active);
  const out: { id: string; label: string }[] = [];
  for (const { induk, anak } of buildTree(aktif)) {
    if (induk.parent_id && !aktif.some((r) => r.id === induk.parent_id)) continue;
    out.push({ id: induk.id, label: induk.name });
    for (const a of anak) out.push({ id: a.id, label: `${induk.name}${SEP}${a.name}` });
  }
  return out;
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npx vitest run src/lib/kategori.test.ts`
Expected: PASS (12 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kategori.ts src/lib/kategori.test.ts
git commit -m "feat(master-data): logika kategori barang bertingkat 2 tingkat"
```

---

### Task 6: Halaman Kategori Barang (`/pos/kategori`)

**Files:**
- Create: `src/app/(app)/pos/kategori/page.tsx`
- Create: `src/app/(app)/pos/kategori/actions.ts`
- Modify: `src/lib/nav.ts:187` (tambah `href` tile "Kategori Barang")

**Interfaces:**
- Consumes: `assertMasterAdmin`, `bolehKelolaMaster`, `MasterPage`, `pesanSimpanGagal`, dan dari Task 5: `buildTree`, `validateParent`, `type KategoriRow`.
- Produces: `simpanKategori(formData)`, `toggleKategori(formData)`; route `/pos/kategori`.

- [ ] **Step 1: Tulis server action**

Buat `src/app/(app)/pos/kategori/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { validateParent, type KategoriRow } from "@/lib/kategori";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/kategori";

export async function simpanKategori(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori barang");
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const parentId = String(formData.get("parent_id") ?? "").trim() || null;

  if (!name) redirect(`${BACK}?error=${encodeURIComponent("Nama kategori wajib diisi")}`);

  // Batas 2 tingkat divalidasi terhadap kondisi DB saat ini, bukan kiriman form.
  const { data } = await supabase.from("item_categories").select("id, name, parent_id, is_active");
  const salah = validateParent(id, parentId, (data ?? []) as KategoriRow[]);
  if (salah) redirect(`${BACK}?error=${encodeURIComponent(salah)}`);

  const { error } = id
    ? await supabase.from("item_categories").update({ name, parent_id: parentId }).eq("id", id)
    : await supabase.from("item_categories").insert({ name, parent_id: parentId });

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Kategori tidak dihapus: barang & laporan lama masih menunjuk ke sini.
export async function toggleKategori(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori barang");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Kategori tidak valid")}`);

  const { error } = await supabase.from("item_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
```

- [ ] **Step 2: Tulis halaman**

Buat `src/app/(app)/pos/kategori/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { buildTree, type KategoriRow } from "@/lib/kategori";
import { simpanKategori, toggleKategori } from "./actions";

export default async function KategoriBarangPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: itemRows }] = await Promise.all([
    supabase.from("item_categories").select("id, name, parent_id, is_active").order("name"),
    supabase.from("items").select("category_id").not("category_id", "is", null),
  ]);

  const rows = (data ?? []) as KategoriRow[];
  const tree = buildTree(rows);
  const editing = edit ? rows.find((r) => r.id === edit) ?? null : null;

  // Dihitung LANGSUNG (barang yang kategorinya persis baris ini), tidak termasuk
  // anak — supaya jelas kategori mana yang benar-benar masih dipakai.
  const pakai = new Map<string, number>();
  for (const r of itemRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  // Pilihan induk: hanya kategori yang belum jadi anak & bukan dirinya sendiri.
  const calonInduk = rows.filter((r) => !r.parent_id && r.id !== editing?.id);

  const baris: { r: KategoriRow; anak: boolean }[] = [];
  for (const t of tree) {
    baris.push({ r: t.induk, anak: false });
    for (const a of t.anak) baris.push({ r: a, anak: true });
  }

  return (
    <MasterPage
      back="/pos" icon="ti-category" title="KATEGORI BARANG"
      desc="Dua tingkat: induk → anak. Dipakai master Barang & Jasa"
      error={error} success={success} successMsg="Kategori tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah kategori barang."
    >
      {bolehKelola && (
        <form action={simpanKategori} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="flab">{editing ? "Ubah nama kategori" : "Kategori baru"}</label>
              <input className="fi" name="name" defaultValue={editing?.name ?? ""} maxLength={100} placeholder="mis. Makanan Kucing" required />
            </div>
            <div style={{ width: 220 }}>
              <label className="flab">Induk</label>
              <select className="fi" name="parent_id" defaultValue={editing?.parent_id ?? ""}>
                <option value="">— jadi kategori induk —</option>
                {calonInduk.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pos/kategori" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Kategori</th>
                <th style={{ width: 110 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {baris.map(({ r, anak }) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5, fontWeight: anak ? 500 : 700, paddingLeft: anak ? 26 : undefined }}>
                    {anak && <span style={{ color: "var(--td)", marginRight: 5 }}>└</span>}
                    {r.name}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(r.id) ?? 0} barang</td>
                  <td><span className={`bge ${r.is_active ? "g" : "x"}`}>{r.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pos/kategori?edit=${r.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleKategori}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="aktif" value={r.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {baris.length === 0 && (
                <tr><td colSpan={bolehKelola ? 4 : 3} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada kategori.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
```

- [ ] **Step 3: Sambungkan tile nav**

Di `src/lib/nav.ts`, ganti:

```ts
    { label: "Kategori Barang", icon: "ti-category", ...B },
```

jadi:

```ts
    { label: "Kategori Barang", icon: "ti-category", ...B, href: "/pos/kategori" },
```

- [ ] **Step 4: Verifikasi**

Run: `npx tsc --noEmit && npm test`
Expected: bersih, semua test lolos.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/pos/kategori" src/lib/nav.ts
git commit -m "feat(persediaan): halaman master Kategori Barang bertingkat"
```

---

### Task 7: Form barang pakai satuan & kategori dari master

**Files:**
- Modify: `src/app/(app)/pos/sku/data.ts:20-25` (query dropdown)
- Modify: `src/app/(app)/pos/sku/BarangForm.tsx:26-30, 78-84, 119-127, 179-183`
- Modify: `src/app/(app)/pos/sku/page.tsx` (teruskan prop `units`)
- Modify: `src/app/(app)/pos/sku/baru/page.tsx` dan `src/app/(app)/pos/sku/[id]/page.tsx` (teruskan prop `units`)

**Interfaces:**
- Consumes: `flatOptions`, `type KategoriRow` (Task 5); tabel `units` (Task 1).
- Produces: `BarangForm` menerima prop baru `units: { id: string; nama: string }[]` dan `categories: KategoriRow[]` (menggantikan `{ id, name }[]`).

- [ ] **Step 1: Ubah query dropdown di `data.ts`**

Ganti blok baris 20-25 `src/app/(app)/pos/sku/data.ts` jadi:

```ts
  const [{ data: categories }, { data: brands }, { data: units }] = await Promise.all([
    // parent_id & is_active dipakai flatOptions() utk label bertingkat + buang cabang mati.
    supabase.from("item_categories").select("id, name, parent_id, is_active").order("name"),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("units").select("id, nama").eq("is_active", true).order("nama"),
  ]);

  return { supabase, categories: categories ?? [], brands: brands ?? [], units: units ?? [] };
```

- [ ] **Step 2: Ubah tanda tangan & dropdown kategori di `BarangForm.tsx`**

Ganti blok props (baris 26-30):

```tsx
export function BarangForm({ categories, brands, units, editing }: {
  categories: KategoriRow[];
  brands: { id: string; name: string }[];
  units: { id: string; nama: string }[];
  editing: BarangRow | null;
}) {
```

Tambah import di bagian atas file:

```tsx
import { flatOptions, type KategoriRow } from "@/lib/kategori";
```

Ganti dropdown kategori (baris 78-84) jadi:

```tsx
          <div>
            <label className="flab">Kategori barang *</label>
            <select className="fi" name="category_id" defaultValue={editing?.category_id ?? ""} required>
              <option value="">— pilih —</option>
              {flatOptions(categories).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Belum ada? Tambah di <Link href="/pos/kategori" style={{ color: "#2563eb" }}>Kategori Barang</Link>.
            </div>
          </div>
```

- [ ] **Step 3: Ganti input satuan dasar jadi dropdown**

Ganti blok satuan dasar (baris 119-127) jadi:

```tsx
        <div className="frow">
          <div>
            <label className="flab">Satuan dasar *</label>
            <select className="fi" name="unit" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} required>
              {/* Satuan lama yang sudah dinonaktifkan tetap ditawarkan saat mengedit
                  barang yang memakainya — kalau tidak, nilainya hilang diam-diam. */}
              {!units.some((u) => u.nama === baseUnit) && baseUnit && (
                <option value={baseUnit}>{baseUnit} (nonaktif)</option>
              )}
              {units.map((u) => <option key={u.id} value={u.nama}>{u.nama}</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Satuan terkecil — stok selalu dihitung di sini. Daftarnya diatur di{" "}
              <Link href="/pos/satuan" style={{ color: "#2563eb" }}>Satuan Barang</Link>.
            </div>
          </div>
```

Biarkan blok "Stok minimum" di bawahnya apa adanya.

- [ ] **Step 4: Ganti input satuan turunan jadi dropdown**

Ganti blok input satuan turunan (baris 179-183) jadi:

```tsx
                  <div style={{ width: 110, flexShrink: 0 }}>
                    {i === 0 && <label className="flab">Satuan</label>}
                    <select className="fi" value={u.unit} onChange={(e) => setUnit(i, { unit: e.target.value })}>
                      <option value="">— pilih —</option>
                      {u.unit && !units.some((x) => x.nama === u.unit) && (
                        <option value={u.unit}>{u.unit} (nonaktif)</option>
                      )}
                      {units.filter((x) => x.nama !== dasar).map((x) => (
                        <option key={x.id} value={x.nama}>{x.nama}</option>
                      ))}
                    </select>
                  </div>
```

- [ ] **Step 5: Teruskan prop `units` dari ketiga halaman pemanggil**

Di `src/app/(app)/pos/sku/baru/page.tsx` dan `src/app/(app)/pos/sku/[id]/page.tsx`, ambil `units` dari `siapkanFormBarang()` dan teruskan ke `<BarangForm ... units={units} />`. Kalau `src/app/(app)/pos/sku/page.tsx` juga merender `BarangForm`, lakukan hal yang sama di sana. Baca ketiga file dulu; jangan mengubah bagian lain.

- [ ] **Step 6: Verifikasi**

Run: `npx tsc --noEmit && npm test`
Expected: bersih. Kalau `tsc` mengeluh `categories` tidak cocok tipe di salah satu pemanggil, itu tandanya satu pemanggil belum ikut diperbarui — perbaiki di sana, jangan melemahkan tipe.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/pos/sku"
git commit -m "feat(persediaan): form barang pilih satuan & kategori dari master"
```

---

### Task 8: Kategori Pemasok (halaman + kolom di pemasok)

**Files:**
- Create: `src/app/(app)/pembelian/kategori-pemasok/page.tsx`
- Create: `src/app/(app)/pembelian/kategori-pemasok/actions.ts`
- Modify: `src/app/(app)/pembelian/page.tsx:56-63` (query), `:228-252` (tabel), `:259-275` (form)
- Modify: `src/app/(app)/pembelian/actions.ts:88-95` (`tambahSupplier`)
- Modify: `src/lib/nav.ts:170` (tambah `href` tile "Kategori Pemasok")

**Interfaces:**
- Consumes: `assertMasterAdmin`, `bolehKelolaMaster`, `MasterPage`, `pesanSimpanGagal`; tabel `supplier_categories`, kolom `suppliers.category_id` (Task 1).
- Produces: `simpanKategoriPemasok(formData)`, `toggleKategoriPemasok(formData)`; route `/pembelian/kategori-pemasok`.

- [ ] **Step 1: Tulis server action master**

Buat `src/app/(app)/pembelian/kategori-pemasok/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pembelian/kategori-pemasok";

export async function simpanKategoriPemasok(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori pemasok");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama kategori wajib diisi")}`);

  const { error } = id
    ? await supabase.from("supplier_categories").update({ nama }).eq("id", id)
    : await supabase.from("supplier_categories").insert({ nama });

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Tidak dihapus: pemasok lama masih menunjuk ke sini.
export async function toggleKategoriPemasok(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori pemasok");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Kategori tidak valid")}`);

  const { error } = await supabase.from("supplier_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
```

- [ ] **Step 2: Tulis halaman master**

Buat `src/app/(app)/pembelian/kategori-pemasok/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanKategoriPemasok, toggleKategoriPemasok } from "./actions";

type Kat = { id: string; nama: string; is_active: boolean };

export default async function KategoriPemasokPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: supRows }] = await Promise.all([
    supabase.from("supplier_categories").select("id, nama, is_active").order("nama"),
    supabase.from("suppliers").select("category_id").not("category_id", "is", null),
  ]);

  const kategori = (data ?? []) as Kat[];
  const editing = edit ? kategori.find((k) => k.id === edit) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of supRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/pembelian" icon="ti-tag" title="KATEGORI PEMASOK"
      desc="Golongkan pemasok — dipakai daftar pemasok & laporan hutang"
      error={error} success={success} successMsg="Kategori tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah kategori pemasok."
    >
      {bolehKelola && (
        <form action={simpanKategoriPemasok} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="flab">{editing ? "Ubah nama kategori" : "Kategori baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={60} placeholder="mis. Pakan" required />
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pembelian/kategori-pemasok" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Kategori</th>
                <th style={{ width: 120 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {kategori.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(k.id) ?? 0} pemasok</td>
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pembelian/kategori-pemasok?edit=${k.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleKategoriPemasok}>
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {kategori.length === 0 && (
                <tr><td colSpan={bolehKelola ? 5 : 4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada kategori.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
```

- [ ] **Step 3: Tampilkan & isi kategori di tab Pemasok**

Di `src/app/(app)/pembelian/page.tsx`:

1. Tambah query kategori ke `Promise.all` yang sudah ada (baris ~56), dan ubah query supplier agar ikut membawa kategori:

```ts
    supabase.from("suppliers").select("id, nama, kontak, telp, supplier_categories(nama)").order("nama"),
    supabase.from("supplier_categories").select("id, nama").eq("is_active", true).order("nama"),
```

Tambahkan variabel hasilnya (mis. `supCatData`) dan `const supplierCategories = supCatData ?? [];`. Perbarui tipe `Supplier` supaya punya `supplier_categories: Rel<{ nama: string }>`.

2. Tambah kolom Kategori di tabel daftar supplier (baris ~228-252): tambah `<th>Kategori</th>` sesudah `<th>Nama</th>`, dan di baris data tambah sesudah kolom nama:

```tsx
                      <td style={{ fontSize: 11.5 }}>
                        {one(s.supplier_categories)?.nama ?? <span style={{ color: "var(--td)" }}>—</span>}
                      </td>
```

Naikkan `colSpan` baris "Belum ada supplier" dari `3` jadi `4`.

3. Tambah dropdown kategori di form tambah supplier (sesudah field Nama, baris ~263):

```tsx
              <div className="fg" style={{ marginBottom: 10 }}>
                <label className="flab">Kategori</label>
                <select className="fi" name="category_id" defaultValue="">
                  <option value="">— tanpa kategori —</option>
                  {supplierCategories.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
                </select>
                <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                  Daftarnya diatur di <Link href="/pembelian/kategori-pemasok" style={{ color: "#2563eb" }}>Kategori Pemasok</Link>.
                </div>
              </div>
```

Pastikan `Link` sudah diimpor di file itu; kalau belum, tambahkan `import Link from "next/link";`.

- [ ] **Step 4: Simpan kategori di `tambahSupplier`**

Di `src/app/(app)/pembelian/actions.ts`, di dalam `tambahSupplier` tambahkan setelah pembacaan `alamat`:

```ts
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
```

dan sertakan `category_id: categoryId` di objek `insert` ke tabel `suppliers`. Jangan ubah bagian lain fungsi itu.

- [ ] **Step 5: Sambungkan tile nav**

Di `src/lib/nav.ts`, ganti:

```ts
    { label: "Kategori Pemasok", icon: "ti-tag", ...B },
```

jadi:

```ts
    { label: "Kategori Pemasok", icon: "ti-tag", ...B, href: "/pembelian/kategori-pemasok" },
```

- [ ] **Step 6: Verifikasi**

Run: `npx tsc --noEmit && npm test`
Expected: bersih.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/pembelian" src/lib/nav.ts
git commit -m "feat(pembelian): master Kategori Pemasok + kolom kategori di daftar pemasok"
```

---

### Task 9: Logika diskon golongan (`src/lib/harga-golongan.ts`)

**Files:**
- Create: `src/lib/harga-golongan.ts`
- Test: `src/lib/harga-golongan.test.ts`

**Interfaces:**
- Produces: `diskonGolongan(subtotal: number, persen: number): number` — nominal rupiah, dibulatkan, selalu di dalam `[0, subtotal]`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/harga-golongan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diskonGolongan } from "./harga-golongan";

describe("diskonGolongan", () => {
  it("persen normal dihitung dari subtotal", () => {
    expect(diskonGolongan(100000, 10)).toBe(10000);
    expect(diskonGolongan(150000, 2.5)).toBe(3750);
  });

  it("nol persen atau tanpa golongan = tidak ada diskon", () => {
    expect(diskonGolongan(100000, 0)).toBe(0);
  });

  it("seratus persen mentok di subtotal, tidak lebih", () => {
    expect(diskonGolongan(100000, 100)).toBe(100000);
  });

  it("pecahan rupiah dibulatkan, tidak menghasilkan sen", () => {
    expect(diskonGolongan(1005, 10)).toBe(101);
    expect(Number.isInteger(diskonGolongan(333, 33.33))).toBe(true);
  });

  it("subtotal nol atau negatif tidak pernah jadi diskon negatif", () => {
    expect(diskonGolongan(0, 25)).toBe(0);
    expect(diskonGolongan(-5000, 25)).toBe(0);
  });

  it("persen kotor dari data tetap ter-cap di [0, subtotal]", () => {
    expect(diskonGolongan(100000, -10)).toBe(0);
    expect(diskonGolongan(100000, 400)).toBe(100000);
    expect(diskonGolongan(100000, Number.NaN)).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run src/lib/harga-golongan.test.ts`
Expected: FAIL — "Failed to resolve import ./harga-golongan".

- [ ] **Step 3: Tulis implementasi**

Buat `src/lib/harga-golongan.ts`:

```ts
// Diskon golongan pelanggan (customer_categories.diskon_persen), migrasi 0066.
// Dipakai KLIEN untuk menampilkan dan SERVER sebagai satu-satunya sumber angka
// yang disimpan — kasir tidak boleh bisa mengarang diskon golongan.
//
// Persen sengaja di-cap di sini, bukan hanya di constraint DB: data lama atau
// data yang masuk lewat jalur lain tidak boleh bikin total transaksi negatif.
export function diskonGolongan(subtotal: number, persen: number): number {
  const sub = Number(subtotal);
  const p = Number(persen);
  if (!Number.isFinite(sub) || sub <= 0) return 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const capPersen = Math.min(p, 100);
  return Math.min(sub, Math.round((sub * capPersen) / 100));
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npx vitest run src/lib/harga-golongan.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/harga-golongan.ts src/lib/harga-golongan.test.ts
git commit -m "feat(crm): logika diskon golongan pelanggan"
```

---

### Task 10: Kategori Pelanggan (halaman master + halaman pelanggan pakai master)

**Files:**
- Create: `src/app/(app)/crm/kategori-pelanggan/page.tsx`
- Create: `src/app/(app)/crm/kategori-pelanggan/actions.ts`
- Delete: `src/app/(app)/crm/pelanggan/kategori.ts`
- Modify: `src/app/(app)/crm/pelanggan/page.tsx:11-19` (query + kirim prop)
- Modify: `src/app/(app)/crm/pelanggan/PelangganClient.tsx:6, 20, 65-67, 129, 247, 282, 287-288`
- Modify: `src/app/(app)/crm/pelanggan/actions.ts` (`updateKategoriPelanggan` tulis `category_id`)
- Modify: `src/lib/nav.ts:91` (tile "Kategori Pelanggan" → route baru)

**Interfaces:**
- Consumes: `assertMasterAdmin`, `bolehKelolaMaster`, `MasterPage`, `pesanSimpanGagal`; tabel `customer_categories` + `customers.category_id` (Task 1).
- Produces:
  - `simpanKategoriPelanggan(formData)`, `toggleKategoriPelanggan(formData)`; route `/crm/kategori-pelanggan`.
  - `PelangganClient` menerima prop baru `categories: { id: string; nama: string; diskon_persen: number }[]`.
  - `CustomerRow` punya field baru `category_id: string | null` dan `customer_categories: { nama: string; diskon_persen: number } | null`.

- [ ] **Step 1: Tulis server action master**

Buat `src/app/(app)/crm/kategori-pelanggan/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/crm/kategori-pelanggan";

export async function simpanKategoriPelanggan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "golongan pelanggan");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);
  const persen = Number(formData.get("diskon_persen"));

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama golongan wajib diisi")}`);
  if (!Number.isFinite(persen) || persen < 0 || persen > 100) {
    redirect(`${BACK}?error=${encodeURIComponent("Diskon harus antara 0 dan 100 persen")}`);
  }

  const patch = { nama, diskon_persen: persen };
  const { error } = id
    ? await supabase.from("customer_categories").update(patch).eq("id", id)
    : await supabase.from("customer_categories").insert(patch);

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Tidak dihapus: pelanggan & riwayat transaksi masih menunjuk ke sini.
export async function toggleKategoriPelanggan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "golongan pelanggan");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Golongan tidak valid")}`);

  const { error } = await supabase.from("customer_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
```

- [ ] **Step 2: Tulis halaman master**

Buat `src/app/(app)/crm/kategori-pelanggan/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanKategoriPelanggan, toggleKategoriPelanggan } from "./actions";

type Kat = { id: string; nama: string; diskon_persen: number; is_active: boolean };

export default async function KategoriPelangganPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: custRows }] = await Promise.all([
    supabase.from("customer_categories").select("id, nama, diskon_persen, is_active").order("nama"),
    supabase.from("customers").select("category_id").not("category_id", "is", null),
  ]);

  const kategori = (data ?? []).map((k) => ({ ...k, diskon_persen: Number(k.diskon_persen) })) as Kat[];
  const editing = edit ? kategori.find((k) => k.id === edit) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of custRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/crm" icon="ti-crown" iconBg="#fef3c7" iconFg="#b45309"
      title="KATEGORI PELANGGAN"
      desc="Golongan pelanggan + diskon otomatis di kasir petshop"
      error={error} success={success} successMsg="Golongan tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah golongan pelanggan."
    >
      <div className="p2ban" style={{ marginBottom: 14 }}>
        <i className="ti ti-info-circle" /> Diskon di sini langsung dipakai kasir petshop begitu
        pelanggannya dipilih. Strata belanja otomatis (Bronze/Gold/VIP) diatur terpisah di{" "}
        <Link href="/pengaturan/tier" style={{ color: "#2563eb" }}>Konfigurasi loyalty</Link>.
      </div>

      {bolehKelola && (
        <form action={simpanKategoriPelanggan} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="flab">{editing ? "Ubah nama golongan" : "Golongan baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={60} placeholder="mis. Reseller" required />
            </div>
            <div style={{ width: 150 }}>
              <label className="flab">Diskon (%)</label>
              <input className="fi" name="diskon_persen" type="number" min={0} max={100} step="0.01"
                defaultValue={editing?.diskon_persen ?? 0} required />
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/crm/kategori-pelanggan" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Golongan</th>
                <th style={{ width: 90 }}>Diskon</th>
                <th style={{ width: 120 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {kategori.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ fontSize: 11.5 }}>{k.diskon_persen > 0 ? `${k.diskon_persen}%` : <span style={{ color: "var(--td)" }}>—</span>}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(k.id) ?? 0} pelanggan</td>
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/crm/kategori-pelanggan?edit=${k.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleKategoriPelanggan}>
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {kategori.length === 0 && (
                <tr><td colSpan={bolehKelola ? 6 : 5} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada golongan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
```

- [ ] **Step 3: Ganti daftar hardcoded di halaman pelanggan**

1. Hapus file `src/app/(app)/crm/pelanggan/kategori.ts`.

2. Di `src/app/(app)/crm/pelanggan/page.tsx`, tambahkan `category_id` + relasi ke `select` customers (baris 14) sehingga menjadi:

```ts
      "id, name, phone, email, dob, address, tier, kategori, category_id, points, total_spending, catatan, pekerjaan, sumber_info, created_at, " +
        "customer_categories(nama, diskon_persen), " +
        "pets(id, name, species, breed, gender, dob, weight, warna, sterilisasi, golongan_darah, status, created_at)"
```

3. Ambil daftar golongan aktif dan kirim ke client. Tambahkan sebelum `return`:

```ts
  const { data: katData } = await supabase
    .from("customer_categories").select("id, nama, diskon_persen").eq("is_active", true).order("nama");
  const categories = (katData ?? []).map((k) => ({ ...k, diskon_persen: Number(k.diskon_persen) }));
```

dan ubah `return` menjadi:

```tsx
  return <PelangganClient customers={enriched} isAdmin={isAdmin} categories={categories} />;
```

4. Di `src/app/(app)/crm/pelanggan/PelangganClient.tsx`:
   - Hapus `import { KATEGORI_OPTIONS } from "./kategori";` (baris 6).
   - Di tipe `CustomerRow` (baris ~20), tambah:
     ```ts
     category_id: string | null;
     customer_categories: { nama: string; diskon_persen: number } | { nama: string; diskon_persen: number }[] | null;
     ```
   - Tambah prop `categories` di tanda tangan komponen:
     ```ts
     categories: { id: string; nama: string; diskon_persen: number }[];
     ```
   - Tambah helper di file itu (dekat helper `one` kalau ada, kalau tidak ada buat baru):
     ```ts
     // Golongan pelanggan sekarang datang dari master (customer_categories);
     // customers.kategori (teks) tinggal jejak historis dan tidak dibaca lagi.
     const namaGolongan = (c: CustomerRow) => {
       const k = Array.isArray(c.customer_categories) ? c.customer_categories[0] : c.customer_categories;
       return k?.nama ?? "—";
     };
     ```
   - Baris 129: ganti `c.kategori === "Member"` jadi `namaGolongan(c) === "Member"`.
   - Baris 247 & 282: ganti `<KategoriBadge v={c.kategori} />` / `<KategoriBadge v={sel.kategori} />` jadi `<KategoriBadge v={namaGolongan(c)} />` / `<KategoriBadge v={namaGolongan(sel)} />`.
   - Baris 287-288: ganti isi `<select>` jadi:
     ```tsx
                        <select name="category_id" defaultValue={sel.category_id ?? ""} className="fi" style={{ width: "auto", fontSize: 11, padding: "4px 8px" }} key={`kat-${sel.id}`}>
                          <option value="">— tanpa golongan —</option>
                          {categories.map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.nama}{k.diskon_persen > 0 ? ` (${k.diskon_persen}%)` : ""}
                            </option>
                          ))}
                        </select>
     ```

- [ ] **Step 4: Ubah `updateKategoriPelanggan` supaya menulis `category_id`**

Ganti seluruh isi `src/app/(app)/crm/pelanggan/actions.ts` jadi:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Golongan pelanggan hanya boleh diubah OWNER/ADMIN (pola crm/promo).
export async function updateKategoriPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah golongan")}`);
  }

  const id = String(formData.get("id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  if (!id) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak valid")}`);

  // Id golongan dari form diverifikasi ada & aktif — jangan percaya kiriman klien.
  if (categoryId) {
    const { data: kat } = await supabase
      .from("customer_categories").select("id").eq("id", categoryId).eq("is_active", true).maybeSingle();
    if (!kat) redirect(`/crm/pelanggan?error=${encodeURIComponent("Golongan tidak valid")}`);
  }

  await supabase.from("customers").update({ category_id: categoryId }).eq("id", id);
  revalidatePath("/crm/pelanggan");
}
```

- [ ] **Step 5: Sambungkan tile nav**

Di `src/lib/nav.ts`, ganti:

```ts
    { label: "Kategori Pelanggan", icon: "ti-crown", ...B, href: "/pengaturan/tier" },
```

jadi:

```ts
    { label: "Kategori Pelanggan", icon: "ti-crown", ...B, href: "/crm/kategori-pelanggan" },
```

Tile "Konfigurasi loyalty" di modul Pengaturan **tetap** menunjuk `/pengaturan/tier` — jangan diubah.

- [ ] **Step 6: Verifikasi**

Run: `npx tsc --noEmit && npm test`
Expected: bersih. `tsc` akan menangkap sisa pemakaian `KATEGORI_OPTIONS` atau `c.kategori` yang belum diganti.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/crm" src/lib/nav.ts
git commit -m "feat(crm): master Kategori Pelanggan berdiskon + pelanggan pakai golongan dari master"
```

---

### Task 11: Diskon golongan di kasir & struk

**Files:**
- Modify: `src/app/(app)/pos/transaksi/page.tsx:16` (query pelanggan)
- Modify: `src/app/(app)/pos/transaksi/PosClient.tsx:10, 30, 75-78, 91, 189-200`
- Modify: `src/app/(app)/pos/transaksi/actions.ts:21-25, 47-49, 65-72`
- Modify: `src/app/(app)/pos/struk/[saleId]/page.tsx:18, 57-58`

**Interfaces:**
- Consumes: `diskonGolongan` (Task 9); kolom `sales.diskon_kategori` + `customers.category_id` (Task 1).
- Produces: `Cust` di `PosClient` punya field `golongan: { nama: string; diskon_persen: number } | null`; `sales.diskon_kategori` terisi server-side.

- [ ] **Step 1: Kirim golongan pelanggan ke kasir**

Di `src/app/(app)/pos/transaksi/page.tsx`, ganti query customers (baris 16) jadi:

```ts
    supabase.from("customers").select("id, name, phone, points, customer_categories(nama, diskon_persen), pets(id, name, species)").order("name"),
```

Tambahkan pemetaan sebelum `return` (relasi Supabase bisa datang sebagai objek atau array — normalkan sekali di sini):

Perhatikan: baris mentah dari Supabase **belum** punya field `golongan`, jadi cast-nya
harus `Omit<Cust, "golongan">` — kalau di-cast ke `Cust` langsung, `tsc` benar-benar
salah menganggap datanya sudah lengkap.

```ts
  const pelanggan = ((customers ?? []) as unknown as (Omit<Cust, "golongan"> & {
    customer_categories: { nama: string; diskon_persen: number } | { nama: string; diskon_persen: number }[] | null;
  })[]).map((c) => {
    const k = Array.isArray(c.customer_categories) ? c.customer_categories[0] : c.customer_categories;
    return { ...c, golongan: k ? { nama: k.nama, diskon_persen: Number(k.diskon_persen) } : null };
  });
```

dan ganti prop `customers={(customers ?? []) as unknown as Cust[]}` jadi `customers={pelanggan}`.

- [ ] **Step 2: Tampilkan baris diskon golongan di keranjang**

Di `src/app/(app)/pos/transaksi/PosClient.tsx`:

1. Tambah import:
```tsx
import { diskonGolongan } from "@/lib/harga-golongan";
```

2. Ubah tipe `Cust` (baris 10):
```tsx
export type Cust = {
  id: string; name: string; phone: string; points: number; pets: Pet[];
  golongan: { nama: string; diskon_persen: number } | null;
};
```

3. Ganti blok hitungan total (baris 75-78) jadi:
```tsx
  const subtotal = cart.reduce((a, l) => a + l.qty * l.harga, 0);
  // Diskon golongan dihitung di sini HANYA untuk ditampilkan; angka yang disimpan
  // dihitung ulang di server dari master (kasir tidak boleh bisa mengaraninya).
  const diskonKategori = diskonGolongan(subtotal, cust?.golongan?.diskon_persen ?? 0);
  const total = Math.max(0, subtotal - diskonKategori - discount);
  const kembali = Math.max(0, bayar - total);
  const poin = cust ? Math.floor(total / 1000) : 0;
```

4. Ganti blok Totals (baris 189-200) jadi:
```tsx
          <div style={{ borderTop: ".5px solid var(--bd)", paddingTop: 7 }}>
            <Row k="Subtotal" v={rp(subtotal)} />
            {diskonKategori > 0 && cust?.golongan && (
              <Row k={`Diskon ${cust.golongan.nama} (${cust.golongan.diskon_persen}%)`} v={`-${rp(diskonKategori)}`} />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, color: "var(--tm)", margin: "3px 0" }}>
              <span>Diskon manual / promo</span>
              <input className="fi" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 90, textAlign: "right", padding: "3px 6px" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0" }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>Total</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: "var(--acc)" }}>{rp(total)}</span>
            </div>
            {cust && <div style={{ fontSize: 9.5, color: "#16a34a", textAlign: "right" }}>+{poin} poin untuk {cust.name.split(" ")[0]}</div>}
          </div>
```

`diskon_kategori` **tidak** dikirim sebagai hidden input — server menghitungnya sendiri.

- [ ] **Step 3: Hitung & simpan diskon golongan di server action**

Di `src/app/(app)/pos/transaksi/actions.ts`:

1. Tambah import:
```ts
import { diskonGolongan } from "@/lib/harga-golongan";
```

2. Ganti blok hitungan total (baris 47-49) jadi:
```ts
  const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);

  // Diskon golongan diambil dari master lewat customer_id — BUKAN dari form.
  // Kalau dibaca dari form, kasir bisa mengarang diskon golongan sesukanya.
  let diskonKategori = 0;
  if (customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("customer_categories(diskon_persen, is_active)")
      .eq("id", customerId)
      .maybeSingle();
    const rel = cust?.customer_categories as { diskon_persen: number; is_active: boolean } | { diskon_persen: number; is_active: boolean }[] | null | undefined;
    const kat = Array.isArray(rel) ? rel[0] : rel;
    if (kat?.is_active) diskonKategori = diskonGolongan(subtotal, Number(kat.diskon_persen));
  }

  const total = Math.max(0, subtotal - diskonKategori - discount);
  const kembali = Math.max(0, bayar - total);
```

3. Sertakan kolomnya di `insert` ke `sales` (baris ~69) — ganti baris field jadi:
```ts
      subtotal, discount, diskon_kategori: diskonKategori, total, metode_bayar: metode, bayar, kembali, poin_earned: poin,
```

Sisa fungsi (stok FIFO, poin, jurnal) tidak diubah: semuanya sudah menghitung dari `total`, jadi otomatis ikut benar.

- [ ] **Step 4: Tampilkan di struk**

Di `src/app/(app)/pos/struk/[saleId]/page.tsx`:

1. Tambah `diskon_kategori` dan relasi golongan ke `select` (baris 18) — sisipkan `diskon_kategori` setelah `discount`, dan tambahkan `customers(customer_categories(nama, diskon_persen))` ke daftar select kalau relasi customers belum ada di query itu. Kalau query sudah mengambil `customers(...)`, cukup tambahkan relasi bersarangnya.

2. Sisipkan baris diskon golongan **di atas** baris diskon manual (baris 57-58):

```tsx
        <Row k="Subtotal" v={rp(sale.subtotal)} />
        {Number(sale.diskon_kategori) > 0 && (
          <Row k={`Diskon ${namaGolonganStruk ?? "golongan"}`} v={`-${rp(Number(sale.diskon_kategori))}`} />
        )}
        {sale.discount > 0 && <Row k="Diskon" v={`-${rp(sale.discount)}`} />}
```

Definisikan `namaGolonganStruk` di atas `return` dengan pola normalisasi relasi yang sama seperti Step 1 (objek-atau-array → nama, `null` kalau tidak ada). Struk lama (`diskon_kategori = 0`) tampil sama seperti sebelumnya.

- [ ] **Step 5: Verifikasi**

Run: `npx tsc --noEmit && npm test`
Expected: bersih.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/pos/transaksi" "src/app/(app)/pos/struk"
git commit -m "feat(pos): diskon golongan pelanggan otomatis di kasir + baris sendiri di struk"
```

---

### Task 12: Kategori Aset (halaman master + form aset)

**Files:**
- Create: `src/app/(app)/keuangan/kategori-aset/page.tsx`
- Create: `src/app/(app)/keuangan/kategori-aset/actions.ts`
- Modify: `src/app/(app)/keuangan/aset/page.tsx:117-122` (dropdown kategori), `:139-142` (umur)
- Modify: `src/app/(app)/keuangan/aset/actions.ts:16, 31-34` (simpan `category_id`)
- Modify: `src/lib/nav.ts:199` (tambah `href` tile "Kategori Aset")

**Interfaces:**
- Consumes: `assertMasterAdmin`, `bolehKelolaMaster`, `MasterPage`, `pesanSimpanGagal`; tabel `asset_categories` + `fixed_assets.category_id` (Task 1); tabel `coa_accounts` (kolom `code`, `name`).
- Produces: `simpanKategoriAset(formData)`, `toggleKategoriAset(formData)`; route `/keuangan/kategori-aset`.

- [ ] **Step 1: Tulis server action master**

Buat `src/app/(app)/keuangan/kategori-aset/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/keuangan/kategori-aset";

export async function simpanKategoriAset(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori aset");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);
  const umurBulan = Number(formData.get("umur_bulan"));
  const akunBeban = String(formData.get("akun_beban") ?? "").trim();
  const akunAkumulasi = String(formData.get("akun_akumulasi") ?? "").trim();

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama kategori wajib diisi")}`);
  if (!Number.isInteger(umurBulan) || umurBulan <= 0) {
    redirect(`${BACK}?error=${encodeURIComponent("Umur penyusutan harus lebih dari 0 bulan")}`);
  }
  if (!akunBeban || !akunAkumulasi) {
    redirect(`${BACK}?error=${encodeURIComponent("Akun beban & akun akumulasi wajib dipilih")}`);
  }

  // Kode akun berasal dari dropdown COA, tetap diverifikasi ada di coa_accounts —
  // jurnal penyusutan gagal total kalau akunnya tidak ada.
  const { data: akun } = await supabase.from("coa_accounts").select("code").in("code", [akunBeban, akunAkumulasi]);
  if ((akun ?? []).length < 2) {
    redirect(`${BACK}?error=${encodeURIComponent("Akun yang dipilih tidak ada di daftar akun")}`);
  }

  const patch = { nama, umur_bulan: umurBulan, akun_beban: akunBeban, akun_akumulasi: akunAkumulasi };
  const { error } = id
    ? await supabase.from("asset_categories").update(patch).eq("id", id)
    : await supabase.from("asset_categories").insert(patch);

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Tidak dihapus: aset lama & jurnal penyusutan masih menunjuk ke sini.
export async function toggleKategoriAset(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori aset");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Kategori tidak valid")}`);

  const { error } = await supabase.from("asset_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
```

- [ ] **Step 2: Tulis halaman master**

Buat `src/app/(app)/keuangan/kategori-aset/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanKategoriAset, toggleKategoriAset } from "./actions";

type Kat = {
  id: string; nama: string; umur_bulan: number;
  akun_beban: string; akun_akumulasi: string; is_active: boolean;
};

export default async function KategoriAsetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: asetRows }, { data: akunRows }] = await Promise.all([
    supabase.from("asset_categories").select("id, nama, umur_bulan, akun_beban, akun_akumulasi, is_active").order("nama"),
    supabase.from("fixed_assets").select("category_id").not("category_id", "is", null),
    supabase.from("coa_accounts").select("code, name").order("code"),
  ]);

  const kategori = (data ?? []) as Kat[];
  const akun = (akunRows ?? []) as { code: string; name: string }[];
  const editing = edit ? kategori.find((k) => k.id === edit) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of asetRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/aset-tetap" icon="ti-category" title="KATEGORI ASET"
      desc="Umur penyusutan & akun jurnal otomatis per kategori"
      error={error} success={success} successMsg="Kategori tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah kategori aset."
    >
      {bolehKelola && (
        <form action={simpanKategoriAset} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="frow">
            <div>
              <label className="flab">{editing ? "Ubah nama kategori" : "Kategori baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={60} placeholder="mis. Peralatan Medis" required />
            </div>
            <div>
              <label className="flab">Umur penyusutan (bulan) *</label>
              <input className="fi" name="umur_bulan" type="number" min={1} step={1}
                defaultValue={editing?.umur_bulan ?? 48} required />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>48 bulan = 4 tahun.</div>
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">Akun beban penyusutan *</label>
              <select className="fi" name="akun_beban" defaultValue={editing?.akun_beban ?? "5601"} required>
                {akun.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Akun akumulasi penyusutan *</label>
              <select className="fi" name="akun_akumulasi" defaultValue={editing?.akun_akumulasi ?? "1509"} required>
                {akun.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            {editing && <Link href="/keuangan/kategori-aset" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan
            </SubmitButton>
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 660 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Kategori</th>
                <th style={{ width: 90 }}>Umur</th>
                <th style={{ width: 90 }}>Beban</th>
                <th style={{ width: 100 }}>Akumulasi</th>
                <th style={{ width: 90 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {kategori.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ fontSize: 11 }}>{k.umur_bulan} bln</td>
                  <td style={{ fontSize: 11 }}>{k.akun_beban}</td>
                  <td style={{ fontSize: 11 }}>{k.akun_akumulasi}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(k.id) ?? 0} aset</td>
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/keuangan/kategori-aset?edit=${k.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleKategoriAset}>
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {kategori.length === 0 && (
                <tr><td colSpan={bolehKelola ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada kategori.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
```

- [ ] **Step 3: Form aset pakai kategori master + umur terisi otomatis**

`src/app/(app)/keuangan/aset/page.tsx` sekarang server component dengan `<select name="kategori">` hardcoded. Autofill umur butuh state klien, jadi:

1. Di `page.tsx`, ambil kategori aktif:
```ts
  const { data: asetKategori } = await supabase
    .from("asset_categories").select("id, nama, umur_bulan").eq("is_active", true).order("nama");
```

2. Buat komponen klien kecil `src/app/(app)/keuangan/aset/KategoriUmur.tsx`:
```tsx
"use client";

import { useState } from "react";
import Link from "next/link";

// Kategori + umur berpasangan: memilih kategori mengisi umur dari standarnya,
// tapi umurnya tetap bisa ditimpa — umur riil sebuah aset bisa beda dari standar.
export function KategoriUmur({ kategori }: { kategori: { id: string; nama: string; umur_bulan: number }[] }) {
  const [catId, setCatId] = useState(kategori[0]?.id ?? "");
  const [umur, setUmur] = useState<number>(kategori[0]?.umur_bulan ?? 48);

  const ganti = (id: string) => {
    setCatId(id);
    const k = kategori.find((x) => x.id === id);
    if (k) setUmur(k.umur_bulan);
  };

  return (
    <>
      <div>
        <label className="flab">Kategori *</label>
        <select className="fi" name="category_id" value={catId} onChange={(e) => ganti(e.target.value)} required>
          <option value="">— pilih —</option>
          {kategori.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
        </select>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
          Daftarnya diatur di <Link href="/keuangan/kategori-aset" style={{ color: "#2563eb" }}>Kategori Aset</Link>.
        </div>
      </div>
      <div>
        <label className="flab">Umur ekonomis (bulan) *</label>
        <input className="fi" name="umur_bulan" type="number" min={1} value={umur}
          onChange={(e) => setUmur(Number(e.target.value))} required />
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
          Terisi otomatis dari kategori; boleh diubah kalau umur aset ini beda.
        </div>
      </div>
    </>
  );
}
```

3. Di `page.tsx`, hapus blok `<select name="kategori">` (baris 117-122) dan blok input `umur_bulan` (baris 139-142), ganti dengan `<KategoriUmur kategori={asetKategori ?? []} />` di posisi kategori. Perhatikan pembungkus `frow`: `KategoriUmur` merender **dua** `<div>` bersaudara, jadi tempatkan supaya tata letak dua kolom tetap benar (kalau perlu, letakkan di dalam satu `frow` tersendiri).

- [ ] **Step 4: Simpan `category_id` di action aset**

Di `src/app/(app)/keuangan/aset/actions.ts` fungsi `tambahAset`:

1. Ganti baris 16 (`const kategori = ...`) jadi:
```ts
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
```

2. Ambil nama kategori untuk kolom teks historis, dan sertakan keduanya di `insert`:
```ts
  let kategori = "Peralatan";
  if (categoryId) {
    const { data: kat } = await supabase.from("asset_categories").select("nama").eq("id", categoryId).maybeSingle();
    if (!kat) redirect(`${back}?error=${encodeURIComponent("Kategori aset tidak valid")}`);
    kategori = kat.nama;
  }

  const { error } = await supabase.from("fixed_assets").insert({
    nama, kategori, category_id: categoryId, tanggal_perolehan: tanggal, harga_perolehan: harga,
    nilai_sisa: nilaiSisa, umur_bulan: umurBulan, branch_id: branchId,
  });
```

- [ ] **Step 5: Sambungkan tile nav**

Di `src/lib/nav.ts`, ganti:

```ts
    { label: "Kategori Aset", icon: "ti-category", ...B },
```

jadi:

```ts
    { label: "Kategori Aset", icon: "ti-category", ...B, href: "/keuangan/kategori-aset" },
```

- [ ] **Step 6: Verifikasi**

Run: `npx tsc --noEmit && npm test`
Expected: bersih.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/keuangan/kategori-aset" "src/app/(app)/keuangan/aset" src/lib/nav.ts
git commit -m "feat(aset): master Kategori Aset + umur penyusutan terisi otomatis"
```

---

### Task 13: Jurnal penyusutan pecah per kategori

**Files:**
- Modify: `src/lib/depreciation.ts:14-55`
- Test: `src/lib/depreciation.test.ts`

**Interfaces:**
- Consumes: `asset_categories.akun_beban` / `.akun_akumulasi`, `fixed_assets.category_id` (Task 1); `postJournal` dari `@/lib/posting`.
- Produces: `groupDepreciationLines(entries): { code: string; debit: number; credit: number }[]` — fungsi murni baru yang diekspor dari `src/lib/depreciation.ts`, plus `runDepreciationPeriod` memakainya. Tanda tangan `runDepreciationPeriod(supabase, periode)` dan `DepreciationRun` **tidak berubah**.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/depreciation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupDepreciationLines } from "./depreciation";

const seimbang = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((a, l) => a + l.debit, 0) === lines.reduce((a, l) => a + l.credit, 0);

describe("groupDepreciationLines", () => {
  it("dua kategori dgn akun berbeda jadi dua pasang baris yang tetap seimbang", () => {
    const lines = groupDepreciationLines([
      { amount: 100000, akunBeban: "5601", akunAkumulasi: "1509" },
      { amount: 250000, akunBeban: "5602", akunAkumulasi: "1510" },
    ]);
    expect(lines).toEqual([
      { code: "5601", debit: 100000, credit: 0 },
      { code: "1509", debit: 0, credit: 100000 },
      { code: "5602", debit: 250000, credit: 0 },
      { code: "1510", debit: 0, credit: 250000 },
    ]);
    expect(seimbang(lines)).toBe(true);
  });

  it("aset tanpa kategori jatuh ke akun default 5601/1509", () => {
    const lines = groupDepreciationLines([{ amount: 50000, akunBeban: null, akunAkumulasi: null }]);
    expect(lines).toEqual([
      { code: "5601", debit: 50000, credit: 0 },
      { code: "1509", debit: 0, credit: 50000 },
    ]);
  });

  it("aset sekategori digabung jadi satu pasang baris, bukan satu pasang per aset", () => {
    const lines = groupDepreciationLines([
      { amount: 10000, akunBeban: "5601", akunAkumulasi: "1509" },
      { amount: 15000, akunBeban: "5601", akunAkumulasi: "1509" },
    ]);
    expect(lines).toEqual([
      { code: "5601", debit: 25000, credit: 0 },
      { code: "1509", debit: 0, credit: 25000 },
    ]);
  });

  it("jumlah nol dilewati supaya tidak ada baris jurnal kosong", () => {
    expect(groupDepreciationLines([{ amount: 0, akunBeban: "5601", akunAkumulasi: "1509" }])).toEqual([]);
    expect(groupDepreciationLines([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run src/lib/depreciation.test.ts`
Expected: FAIL — `groupDepreciationLines` belum diekspor.

- [ ] **Step 3: Tambah fungsi murni + pakai di `runDepreciationPeriod`**

Di `src/lib/depreciation.ts`, tambahkan sesudah definisi `DepreciationRun`:

```ts
export const AKUN_BEBAN_DEFAULT = "5601";
export const AKUN_AKUM_DEFAULT = "1509";

export type DepEntry = { amount: number; akunBeban: string | null; akunAkumulasi: string | null };

// Baris jurnal penyusutan dikelompokkan per pasangan akun kategori. Satu jurnal,
// beberapa pasang baris — jadi laporan penyusutan rinci per jenis aset tanpa
// mengubah total. Aset tanpa kategori memakai akun default lama.
export function groupDepreciationLines(entries: DepEntry[]): { code: string; debit: number; credit: number }[] {
  const perPasangan = new Map<string, { beban: string; akum: string; total: number }>();
  for (const e of entries) {
    const amount = Number(e.amount) || 0;
    if (amount <= 0) continue;
    const beban = e.akunBeban || AKUN_BEBAN_DEFAULT;
    const akum = e.akunAkumulasi || AKUN_AKUM_DEFAULT;
    const key = `${beban}::${akum}`;
    const cur = perPasangan.get(key) ?? { beban, akum, total: 0 };
    cur.total += amount;
    perPasangan.set(key, cur);
  }

  const out: { code: string; debit: number; credit: number }[] = [];
  for (const { beban, akum, total } of perPasangan.values()) {
    out.push({ code: beban, debit: total, credit: 0 });
    out.push({ code: akum, debit: 0, credit: total });
  }
  return out;
}
```

Lalu di `runDepreciationPeriod`:

1. Ganti query aset (baris 15-18) supaya membawa akun kategori:
```ts
  const { data: assets } = await supabase
    .from("fixed_assets")
    .select("id, nama, tanggal_perolehan, harga_perolehan, nilai_sisa, umur_bulan, asset_categories(akun_beban, akun_akumulasi)")
    .eq("is_active", true);
```

2. Di dalam loop aset, sesudah `total += amount; jumlahAset += 1;` kumpulkan entri:
```ts
    const rel = a.asset_categories as { akun_beban: string; akun_akumulasi: string } | { akun_beban: string; akun_akumulasi: string }[] | null;
    const kat = Array.isArray(rel) ? rel[0] : rel;
    entries.push({ amount, akunBeban: kat?.akun_beban ?? null, akunAkumulasi: kat?.akun_akumulasi ?? null });
```
Deklarasikan `const entries: DepEntry[] = [];` sebelum loop.

3. Ganti blok `postJournal` (baris 41-53) jadi:
```ts
  if (total > 0) {
    await postJournal(supabase, {
      tanggal: `${periode}-28`,
      deskripsi: `Penyusutan aset tetap periode ${periode} (${jumlahAset} aset)`,
      source: "depreciation",
      sourceRef: periode,
      branchId: null,
      lines: groupDepreciationLines(entries),
    });
  }
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npx vitest run src/lib/depreciation.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Verifikasi seluruh suite & tipe**

Run: `npx tsc --noEmit && npm test`
Expected: bersih; seluruh test (termasuk 170 yang sudah ada) lolos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/depreciation.ts src/lib/depreciation.test.ts
git commit -m "feat(aset): jurnal penyusutan pecah per pasangan akun kategori"
```

---

### Task 14: Uji manual, perbarui dokumen, rilis

**Files:**
- Modify: `docs/GAP-MENU-ACCURATE-2026-07.md`
- Modify: `docs/RINGKASAN-KLONING-ACCURATE-2026-07.md`

**Interfaces:**
- Consumes: seluruh hasil Task 1-13.
- Produces: dokumen status terbaru + `main` ter-push (membawa juga commit merek `7fcbe74` yang belum live).

- [ ] **Step 1: Jalankan verifikasi otomatis**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: semua lolos. Jangan lanjut kalau ada yang merah.

- [ ] **Step 2: Uji manual (§8 spec) — catat hasil tiap poin**

Jalankan dev server lewat preview tool (JANGAN `npm run build`), lalu uji sebagai OWNER:

1. Enam halaman master: tambah, ubah, nonaktifkan, aktifkan lagi. Nama kembar → pesan Indonesia yang jelas, bukan error mentah.
2. Kategori barang: bikin induk + 2 anak; coba jadikan anak sebagai induk kategori lain → ditolak "dua tingkat".
3. Satuan: buka `/pos/satuan`, pastikan tidak ada satuan kembar beda huruf besar-kecil; buka satu barang di `/pos/sku/[id]` → satuan dasar & turunan terisi benar dari dropdown.
4. Kasir: pelanggan bergolongan diskon 10% → baris "Diskon <nama> (10%)" muncul, total = subtotal − diskon golongan − diskon manual, poin dihitung dari total akhir, struk mencetak dua baris diskon terpisah.
5. Kasir: pelanggan tanpa golongan → tampilan & total sama seperti sebelum rilis ini.
6. Aset: bikin kategori umur 96 bulan → form aset terisi 96 otomatis; jalankan penyusutan satu periode → cek di `/keuangan/jurnal` bahwa jurnalnya seimbang dan akunnya sesuai kategori.
7. Login sebagai role non-OWNER/ADMIN (mis. STAFF) → enam halaman tetap bisa dilihat, form tidak ada, tombol aksi tidak ada.

Kalau ada temuan, perbaiki dulu dan ulangi poin yang gagal. **Jangan** lanjut ke Step 3 dengan temuan terbuka.

- [ ] **Step 3: Hapus data uji**

Hapus transaksi/aset/kategori yang dibuat khusus untuk pengujian di Step 2 (pola sesi sebelumnya: data uji selalu dibersihkan). Kategori seed dari migrasi (Obat/Pakan/Alat/Jasa, Peralatan/Inventaris/Kendaraan/Bangunan, Umum/Member/B2B/Rescuer) **tetap tinggal** — itu bukan data uji.

- [ ] **Step 4: Perbarui dokumen status**

Di `docs/GAP-MENU-ACCURATE-2026-07.md`, perbarui skor & status tile:
- §7 Persediaan: 9/14 → **11/14** (Satuan Barang ✅ master global, Kategori Barang ✅ CRUD bertingkat).
- §6 Pembelian: 5/9 → **6/9** (Kategori Pemasok ✅).
- §8 Aset Tetap: 1/6 → **2/6** (Kategori Aset ✅).
- CRM: 2/4 → **3/4** (Kategori Pelanggan ✅ + diskon).
- Skor kasar total: dari ±30/81 jadi angka barunya (hitung ulang, jangan tebak).
- Tambah satu baris di "Usulan urutan garap": tandai butir 1 (Master data & kategori) **SELESAI 2026-07-28**, sisakan Kategori Aset Tetap Pajak di butir 7.

Di `docs/RINGKASAN-KLONING-ACCURATE-2026-07.md`, tambah baris tabel roadmap:
`| 14 | Master Data & Kategori (satuan global, kategori barang bertingkat, kategori pemasok/aset/pelanggan + diskon golongan) | ✅ | Persediaan → Satuan/Kategori · Pembelian → Kategori Pemasok · Aset Tetap → Kategori Aset · CRM → Kategori Pelanggan |`
dan catat hasil uji manual Step 2 secara ringkas (pola entri Penjualan Online), termasuk migrasi `0066`.

- [ ] **Step 5: Commit dokumen**

```bash
git add docs/GAP-MENU-ACCURATE-2026-07.md docs/RINGKASAN-KLONING-ACCURATE-2026-07.md
git commit -m "docs: master data & kategori selesai — perbarui skor gap menu & ringkasan"
```

- [ ] **Step 6: Push ke production**

```bash
git push origin main
```

Ini juga membawa commit `7fcbe74` (master Barang & Jasa + Merek) yang sebelumnya belum live. Vercel (kamo-group/kamo-vet-os) auto-deploy dari `main`.

- [ ] **Step 7: Pastikan deploy hijau**

Cek `https://kamo-vet-os.vercel.app` — buka satu halaman master baru dan halaman kasir. Kalau build gagal, baca log deploy di dashboard Vercel (MCP Vercel di sesi ini tidak bisa melihat team kamo-group) dan perbaiki sebelum melapor selesai.

---

## Catatan urutan & ketergantungan

- Task 1 wajib pertama (semua tergantung tabelnya).
- Task 2 wajib sebelum Task 4, 6, 8, 10, 12.
- Task 3 → 4 → 7 (satuan). Task 5 → 6 → 7 (kategori barang). Task 7 butuh dua-duanya.
- Task 9 → 10 → 11 (golongan pelanggan → kasir).
- Task 12 → 13 (kategori aset → jurnal penyusutan).
- Task 14 terakhir, sesudah semua hijau.
- Task 4, 8, 10, 12 sama-sama mengubah `src/lib/nav.ts` di baris berbeda. Kalau dikerjakan paralel di worktree terpisah, `nav.ts` akan konflik — kerjakan berurutan atau gabungkan seluruh perubahan `nav.ts` ke satu task.
