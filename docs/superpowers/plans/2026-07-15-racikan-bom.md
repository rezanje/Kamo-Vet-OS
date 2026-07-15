# Racikan Obat ala BOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dokter bisa merakit obat racikan (BOM) dari SKU bahan baku dengan harga otomatis Σ(harga×dosis), masuk keranjang POS sebagai 1 baris + worklist apoteker, dan tercetak di struk hanya sebagai nama racikan.

**Architecture:** Reuse tabel `compounding_recipes`/`compounding_ingredients` yang ada. Bahan baku = item `items` diflag `is_compound_material`. Racikan disimpan sebagai `prescription_item` biasa (jenis "obat") supaya alur invoice/struk existing tak berubah (nama-only otomatis), plus record compounding untuk apoteker, plus potong stok bahan saat simpan rekam medis. Pola stok/warehouse mengikuti `createCompounding` yang sudah ada.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + RLS), TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-racikan-bom-design.md`
**Branch:** `feat/racikan-bom`

---

## File Structure

| File | Aksi | Tanggung jawab |
|------|------|----------------|
| `supabase/migrations/0042_racikan_bom.sql` | Create | Flag bahan baku + compounding fields opsional + kolom harga |
| `src/lib/racikan.ts` | Create | Pure helper `racikanTotal()` (hitung Σ harga×dosis) |
| `src/lib/racikan.test.ts` | Create | Unit test helper harga |
| `src/app/(app)/klinik/bahan-baku/page.tsx` | Create | Halaman toggle bahan baku (admin) |
| `src/app/(app)/klinik/bahan-baku/BahanBakuClient.tsx` | Create | Client: search + toggle per item |
| `src/app/(app)/klinik/bahan-baku/actions.ts` | Create | Server action `setBahanBaku` |
| `src/app/(app)/klinik/racik/page.tsx` | Modify | Tambah tombol link "Kelola Bahan Baku" |
| `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx` | Modify | Query `is_compound_material`, split obat vs bahan, kirim ke form |
| `src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx` | Modify | Tab Racikan builder + CartRow racikan + expand di keranjang |
| `src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts` | Modify | Simpan racikan → prescription + compounding + potong stok |

---

## Task 1: Migration — flag bahan baku + kolom harga compounding

**Files:**
- Create: `supabase/migrations/0042_racikan_bom.sql`

- [ ] **Step 1: Tulis file migration**

```sql
-- Racikan obat ala BOM (spec 2026-07-15):
-- 1) flag bahan baku racikan di master barang
-- 2) compounding_recipes: field instruksi jadi opsional + simpan total harga
-- 3) compounding_ingredients: snapshot harga bahan saat racik

alter table items
  add column is_compound_material boolean not null default false;

alter table compounding_recipes
  alter column dosage_instruction drop not null,
  alter column total_volume       drop not null,
  alter column dosage_form         drop not null,
  alter column compounding_steps   drop not null,
  add column total_price numeric(15,2) not null default 0;

alter table compounding_ingredients
  add column unit_price numeric(15,2) not null default 0;
```

- [ ] **Step 2: Terapkan migration ke database**

Gunakan Supabase MCP `apply_migration` (name: `racikan_bom`, query: isi file di atas), ATAU jalankan `supabase db push` bila pakai CLI lokal.

Expected: sukses tanpa error. `dosage_form` punya CHECK enum — `drop not null` aman karena NULL lolos CHECK.

- [ ] **Step 3: Verifikasi kolom ada**

Jalankan (via MCP `execute_sql` atau psql):
```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'compounding_recipes' and column_name in ('dosage_instruction','total_price');
select column_name from information_schema.columns
where table_name = 'items' and column_name = 'is_compound_material';
```
Expected: `dosage_instruction` → `YES`; `total_price` ada; `is_compound_material` ada.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0042_racikan_bom.sql
git commit -m "feat(racikan): migration flag bahan baku + harga compounding"
```

---

## Task 2: Helper harga racikan + unit test

**Files:**
- Create: `src/lib/racikan.ts`
- Test: `src/lib/racikan.test.ts`

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/racikan.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { racikanTotal, type RacikanIngredient } from "./racikan";

describe("racikanTotal", () => {
  it("menjumlahkan harga × dosis tiap bahan", () => {
    const ings: RacikanIngredient[] = [
      { item_id: "a", nama: "Amoxicillin", qty: 10, satuan: "tablet", harga: 2000 },
      { item_id: "b", nama: "Sirup", qty: 1, satuan: "botol", harga: 25000 },
    ];
    expect(racikanTotal(ings)).toBe(45000); // 10*2000 + 1*25000
  });

  it("mengabaikan qty/harga negatif atau NaN (dianggap 0)", () => {
    const ings: RacikanIngredient[] = [
      { item_id: "a", nama: "x", qty: -5, satuan: "ml", harga: 1000 },
      { item_id: "b", nama: "y", qty: 2, satuan: "ml", harga: Number.NaN },
    ];
    expect(racikanTotal(ings)).toBe(0);
  });

  it("racikan kosong = 0", () => {
    expect(racikanTotal([])).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- src/lib/racikan.test.ts`
Expected: FAIL — module `./racikan` belum ada.

- [ ] **Step 3: Tulis implementasi minimal**

`src/lib/racikan.ts`:
```ts
// Bahan baku racikan (BOM line). harga = sell_price snapshot per satuan.
export type RacikanIngredient = {
  item_id: string;
  nama: string;
  qty: number;    // dosis
  satuan: string;
  harga: number;  // sell_price per satuan
};

const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

// Total racikan = Σ(harga × dosis). Tanpa jasa/markup (spec §3).
export function racikanTotal(ings: RacikanIngredient[]): number {
  return ings.reduce((a, i) => a + safe(i.harga) * safe(i.qty), 0);
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npm test -- src/lib/racikan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/racikan.ts src/lib/racikan.test.ts
git commit -m "feat(racikan): helper racikanTotal + test"
```

---

## Task 3: Halaman toggle bahan baku (admin)

**Files:**
- Create: `src/app/(app)/klinik/bahan-baku/actions.ts`
- Create: `src/app/(app)/klinik/bahan-baku/BahanBakuClient.tsx`
- Create: `src/app/(app)/klinik/bahan-baku/page.tsx`
- Modify: `src/app/(app)/klinik/racik/page.tsx` (link)

- [ ] **Step 1: Server action `setBahanBaku`**

`src/app/(app)/klinik/bahan-baku/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Tandai / lepas flag bahan baku racikan pada satu item.
export async function setBahanBaku(itemId: string, value: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ is_compound_material: value })
    .eq("id", itemId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/klinik/bahan-baku");
  return { ok: true as const };
}
```

- [ ] **Step 2: Client component (search + toggle)**

`src/app/(app)/klinik/bahan-baku/BahanBakuClient.tsx`:
```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { setBahanBaku } from "./actions";

export type ItemRow = { id: string; code: string; name: string; kategori: string; sell_price: number; is_compound_material: boolean };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function BahanBakuClient({ items }: { items: ItemRow[] }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(items);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => !s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, q]);

  const toggle = (id: string, value: boolean) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, is_compound_material: value } : r))); // optimistik
    start(async () => {
      const res = await setBahanBaku(id, value);
      if (!res.ok) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, is_compound_material: !value } : r))); // rollback
    });
  };

  return (
    <>
      <div style={{ position: "relative", width: 280, maxWidth: "100%", marginBottom: 12 }}>
        <input className="fi" placeholder="Cari nama / kode barang..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingRight: 28 }} />
        <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead><tr><th>Kode</th><th>Nama Barang</th><th>Kategori</th><th style={{ textAlign: "right" }}>Harga Jual</th><th style={{ textAlign: "center" }}>Bahan Baku Racikan</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{r.code}</td>
                <td style={{ fontSize: 11.5, fontWeight: 500 }}>{r.name}</td>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.kategori}</td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.sell_price)}</td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={r.is_compound_material} disabled={pending}
                    onChange={(e) => toggle(r.id, e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Barang tidak ditemukan.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Page (server, role-gated)**

`src/app/(app)/klinik/bahan-baku/page.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { BahanBakuClient, type ItemRow } from "./BahanBakuClient";

type CatRel = { name: string } | { name: string }[] | null;

export default async function BahanBakuPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role === "STAFF") redirect("/klinik"); // master data admin-only

  const { data } = await supabase
    .from("items")
    .select("id, code, name, sell_price, is_compound_material, item_categories(name)")
    .eq("is_active", true)
    .order("name");

  const items: ItemRow[] = (data ?? []).map((i) => ({
    id: i.id as string, code: i.code as string, name: i.name as string,
    sell_price: Number(i.sell_price),
    is_compound_material: Boolean(i.is_compound_material),
    kategori: (Array.isArray(i.item_categories) ? i.item_categories[0]?.name : (i.item_categories as CatRel && !Array.isArray(i.item_categories) ? (i.item_categories as { name: string }).name : null)) ?? "Lainnya",
  }));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/racik" className="back-btn"><i className="ti ti-arrow-left" /> Racik Obat</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Bahan Baku Racikan</span>
      </div>
      <div className="crm-sec">
        <SecHeader num="01" title="BAHAN BAKU RACIKAN" desc="Tandai barang yang jadi bahan baku racikan. Barang bertanda hanya muncul di builder racikan dokter, bukan di daftar obat jadi." />
        <BahanBakuClient items={items} />
      </div>
    </>
  );
}
```

Catatan: mapping kategori disederhanakan — kalau `item_categories` join mengembalikan objek/array, ambil `.name`. Bila TS rewel, samakan dengan pola `one()` di file lain (mis. `terima/[id]/page.tsx`): buat helper `one<T>()` lokal dan `one(i.item_categories)?.name ?? "Lainnya"`.

- [ ] **Step 4: Link dari halaman Racik Obat**

`src/app/(app)/klinik/racik/page.tsx` — di header (dekat baris back-btn, sekitar baris 38-42), tambah tombol. Ganti blok:
```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Racik Obat</span>
      </div>
```
menjadi:
```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Racik Obat</span>
        <Link href="/klinik/bahan-baku" className="btn-def" style={{ marginLeft: "auto", padding: "5px 12px", fontSize: 11, textDecoration: "none" }}>
          <i className="ti ti-flask-2" /> Kelola Bahan Baku
        </Link>
      </div>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`. (Kalau mapping kategori error, pakai pola `one()` seperti catatan Step 3.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/klinik/bahan-baku" "src/app/(app)/klinik/racik/page.tsx"
git commit -m "feat(racikan): halaman toggle bahan baku + link dari racik"
```

---

## Task 4: Query bahan baku di halaman rekam medis

**Files:**
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx` (blok query items ~baris 84-98 + invocation RekamForm ~baris 319)

- [ ] **Step 1: Ubah query items — sertakan flag + pisah obat vs bahan**

Ganti blok (sekitar baris 84-98):
```tsx
  let items: { id: string; name: string; unit: string; sell_price: number; stok: number }[] = [];
  if (!recorded) {
    const { data: itemRows } = await supabase
      .from("items").select("id, name, unit, sell_price").eq("is_active", true).order("name").limit(200);
    const ids = (itemRows ?? []).map((i) => i.id);
    const { data: stockRows } = ids.length
      ? await supabase.from("stock").select("item_id, qty").in("item_id", ids)
      : { data: [] as { item_id: string; qty: number }[] };
    const stokByItem = new Map<string, number>();
    for (const s of stockRows ?? []) stokByItem.set(s.item_id as string, (stokByItem.get(s.item_id as string) ?? 0) + Number(s.qty));
    items = (itemRows ?? []).map((i) => ({
      id: i.id as string, name: i.name as string, unit: (i.unit as string) ?? "pcs",
      sell_price: Number(i.sell_price), stok: stokByItem.get(i.id as string) ?? 0,
    }));
  }
```
menjadi:
```tsx
  type ItemLiteFull = { id: string; name: string; unit: string; sell_price: number; stok: number; is_compound_material: boolean };
  let obatItems: ItemLiteFull[] = [];
  let bahanItems: ItemLiteFull[] = [];
  if (!recorded) {
    const { data: itemRows } = await supabase
      .from("items").select("id, name, unit, sell_price, is_compound_material").eq("is_active", true).order("name").limit(400);
    const ids = (itemRows ?? []).map((i) => i.id);
    const { data: stockRows } = ids.length
      ? await supabase.from("stock").select("item_id, qty").in("item_id", ids)
      : { data: [] as { item_id: string; qty: number }[] };
    const stokByItem = new Map<string, number>();
    for (const s of stockRows ?? []) stokByItem.set(s.item_id as string, (stokByItem.get(s.item_id as string) ?? 0) + Number(s.qty));
    const all: ItemLiteFull[] = (itemRows ?? []).map((i) => ({
      id: i.id as string, name: i.name as string, unit: (i.unit as string) ?? "pcs",
      sell_price: Number(i.sell_price), stok: stokByItem.get(i.id as string) ?? 0,
      is_compound_material: Boolean(i.is_compound_material),
    }));
    obatItems = all.filter((i) => !i.is_compound_material);
    bahanItems = all.filter((i) => i.is_compound_material);
  }
```

- [ ] **Step 2: Ubah invocation RekamForm — kirim obatItems + bahanItems**

Di JSX (sekitar baris 319), ganti `items={items}` menjadi:
```tsx
          items={obatItems}
          bahanItems={bahanItems}
```

- [ ] **Step 3: Typecheck (akan error di RekamForm — belum ada prop `bahanItems`)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: error "Property 'bahanItems' does not exist" pada RekamForm — normal, diperbaiki di Task 5. Jangan commit dulu; lanjut Task 5.

---

## Task 5: Tab Racikan builder + cart di RekamForm

**Files:**
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx`

- [ ] **Step 1: Perluas tipe + state + props**

Di bagian atas file, ganti tipe `CartRow` (baris 8):
```tsx
type CartRow = { key: string; item_id: string | null; nama_obat: string; qty: number; satuan: string; harga: number; jenis: "obat" | "jasa" };
```
menjadi:
```tsx
import { racikanTotal, type RacikanIngredient } from "@/lib/racikan";

type CartRow = {
  key: string; item_id: string | null; nama_obat: string; qty: number; satuan: string; harga: number;
  jenis: "obat" | "jasa" | "racikan";
  ingredients?: RacikanIngredient[]; dosage_form?: string; aturan_pakai?: string;
};
```

Ganti signature komponen (baris 25) untuk terima `bahanItems`:
```tsx
export function RekamForm({ visitId, petId, patient, items, bahanItems, currentWeight }: {
  visitId: string; petId: string;
  patient: { name: string; species: string; breed: string | null; noRM: string; tglPeriksa: string; dokter: string; owner: string; phone: string; address: string; tier: string; keluhan: string | null; photo: string | null };
  items: ItemLite[];
  bahanItems: ItemLite[];
  currentWeight: number | null;
}) {
```

Ganti tipe tab (baris 31) + tambah state builder racikan:
```tsx
  const [tab, setTab] = useState<"Obat" | "Jasa" | "Paket" | "Racikan">("Obat");
```
Tambah setelah baris state `jasaHarga` (sekitar baris 37):
```tsx
  // Builder racikan
  const [racikNama, setRacikNama] = useState("");
  const [racikForm, setRacikForm] = useState("sirup");
  const [racikAturan, setRacikAturan] = useState("");
  const [racikBahan, setRacikBahan] = useState<RacikanIngredient[]>([]);
  const [bahanSearch, setBahanSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const bahanFiltered = useMemo(
    () => bahanItems.filter((it) => it.name.toLowerCase().includes(bahanSearch.toLowerCase())).slice(0, 40),
    [bahanItems, bahanSearch],
  );
  const racikSubtotal = racikanTotal(racikBahan);

  const addBahan = (it: ItemLite) => {
    setRacikBahan((b) => {
      const ex = b.find((r) => r.item_id === it.id);
      if (ex) return b.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
      return [...b, { item_id: it.id, nama: it.name, qty: 1, satuan: it.unit, harga: it.sell_price }];
    });
  };
  const setBahanQty = (id: string, qty: number) => setRacikBahan((b) => b.map((r) => (r.item_id === id ? { ...r, qty: Math.max(1, qty) } : r)));
  const delBahan = (id: string) => setRacikBahan((b) => b.filter((r) => r.item_id !== id));

  const addRacikanToCart = () => {
    if (!racikNama.trim() || racikBahan.length === 0) return;
    const key = `racik-${cart.length}-${racikNama}`;
    setCart((c) => [...c, {
      key, item_id: null, nama_obat: racikNama.trim(), qty: 1, satuan: "racikan",
      harga: racikanTotal(racikBahan), jenis: "racikan",
      ingredients: racikBahan, dosage_form: racikForm, aturan_pakai: racikAturan.trim() || undefined,
    }]);
    setRacikNama(""); setRacikAturan(""); setRacikBahan([]); setBahanSearch("");
  };
```

- [ ] **Step 2: Tambah tab "Racikan" ke daftar tab**

Ganti array tab (di blok tab, sekitar baris 137):
```tsx
            {([["Obat", "ti-pill"], ["Jasa", "ti-stethoscope"], ["Paket", "ti-package"]] as const).map(([t, ic]) => (
```
menjadi:
```tsx
            {([["Obat", "ti-pill"], ["Jasa", "ti-stethoscope"], ["Paket", "ti-package"], ["Racikan", "ti-flask"]] as const).map(([t, ic]) => (
```

- [ ] **Step 3: Tambah panel builder Racikan**

Setelah blok `{tab === "Paket" && (...)}` (sekitar baris 176), tambah panel baru:
```tsx
              {tab === "Racikan" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input className="fi" placeholder="Nama racikan (mis. Puyer Batuk)" value={racikNama} onChange={(e) => setRacikNama(e.target.value)} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <select className="fi" value={racikForm} onChange={(e) => setRacikForm(e.target.value)} style={{ fontSize: 11.5 }}>
                      {["sirup", "nebul", "salep", "puyer", "kapsul", "lainnya"].map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input className="fi" placeholder="Aturan pakai (opsional)" value={racikAturan} onChange={(e) => setRacikAturan(e.target.value)} />
                  </div>
                  <div style={{ position: "relative" }}>
                    <input className="fi" placeholder="Cari bahan baku..." value={bahanSearch} onChange={(e) => setBahanSearch(e.target.value)} style={{ paddingRight: 28 }} />
                    <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
                  </div>
                  <div style={{ maxHeight: 140, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
                    {bahanItems.length === 0 && <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 10px" }}>Belum ada bahan baku. Tandai di menu Kelola Bahan Baku.</div>}
                    {bahanFiltered.map((it) => (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderBottom: ".5px solid var(--bd)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 500 }}>{it.name}</div>
                          <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Stok {it.stok} {it.unit} · {rp(it.sell_price)}</div>
                        </div>
                        <button type="button" onClick={() => addBahan(it)} className="btn-acc" style={{ padding: "2px 7px", fontSize: 11, background: "#16a34a" }}><i className="ti ti-plus" /></button>
                      </div>
                    ))}
                  </div>
                  {racikBahan.length > 0 && (
                    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 8 }}>
                      {racikBahan.map((b) => (
                        <div key={b.item_id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ flex: 1, fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.nama}</span>
                          <input className="fi" type="number" min={1} value={b.qty} onChange={(e) => setBahanQty(b.item_id, Number(e.target.value))} style={{ width: 46, padding: "2px 4px", textAlign: "center", fontSize: 10.5 }} />
                          <span style={{ fontSize: 10, color: "var(--tm)" }}>{b.satuan}</span>
                          <span style={{ fontSize: 10.5, width: 62, textAlign: "right" }}>{rp(b.qty * b.harga)}</span>
                          <i className="ti ti-x" onClick={() => delBahan(b.item_id)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} />
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: ".5px solid var(--bd)", paddingTop: 5, marginTop: 3, fontSize: 11.5, fontWeight: 700 }}>
                        <span>Estimasi</span><span style={{ color: "#2563eb" }}>{rp(racikSubtotal)}</span>
                      </div>
                    </div>
                  )}
                  <button type="button" onClick={addRacikanToCart} disabled={!racikNama.trim() || racikBahan.length === 0}
                    className="btn-acc" style={{ justifyContent: "center", background: "#2563eb", opacity: (!racikNama.trim() || racikBahan.length === 0) ? .5 : 1 }}>
                    <i className="ti ti-plus" /> Tambah racikan ke keranjang
                  </button>
                </div>
              )}
```

- [ ] **Step 4: Keranjang — baris racikan + expand bahan**

Di dalam `cart.map((r) => (...))` (baris tabel keranjang, sekitar baris 190-210), ganti sel nama supaya racikan bisa di-expand. Ganti `<td>` nama:
```tsx
                          <td style={{ fontSize: 10.5 }}>
                            {r.nama_obat}
                            <div style={{ fontSize: 9, color: "var(--tm)" }}>{rp(r.harga)} · {r.satuan}</div>
                          </td>
```
menjadi:
```tsx
                          <td style={{ fontSize: 10.5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              {r.jenis === "racikan" && (
                                <i className={`ti ti-chevron-${expanded[r.key] ? "down" : "right"}`} style={{ cursor: "pointer", fontSize: 12, color: "var(--tm)" }}
                                  onClick={() => setExpanded((e) => ({ ...e, [r.key]: !e[r.key] }))} />
                              )}
                              <span>{r.nama_obat}</span>
                              {r.jenis === "racikan" && <span className="bge b" style={{ fontSize: 8 }}>racikan</span>}
                            </div>
                            <div style={{ fontSize: 9, color: "var(--tm)" }}>{rp(r.harga)} · {r.satuan}</div>
                            {r.jenis === "racikan" && expanded[r.key] && (
                              <div style={{ marginTop: 4, paddingLeft: 14, borderLeft: "2px solid var(--bd)" }}>
                                {(r.ingredients ?? []).map((b) => (
                                  <div key={b.item_id} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 9, color: "var(--tm)" }}>
                                    <span>{b.nama} × {b.qty} {b.satuan}</span><span>{rp(b.qty * b.harga)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
```

Catatan: baris racikan qty terkunci 1 (qty racikan selalu 1; komposisi diatur lewat bahan). Input qty existing tetap ada; racikan qty=1 dan boleh dibiarkan editable atau di-disable — biarkan editable (sederhana). Tombol hapus `del(r.key)` existing sudah menghapus seluruh racikan.

- [ ] **Step 5: Kirim ingredients ke server saat submit**

Cart sudah diserialisasi via hidden input `resep` (`JSON.stringify(cart)`), dan CartRow racikan sudah membawa `ingredients`/`dosage_form`/`aturan_pakai`. **Tidak ada perubahan** di bagian hidden input — verifikasi baris ini masih ada (sekitar baris 67):
```tsx
      <input type="hidden" name="resep" value={JSON.stringify(cart)} />
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`.

- [ ] **Step 7: Commit (Task 4 + 5 bersama — saling bergantung)**

```bash
git add "src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx" "src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx"
git commit -m "feat(racikan): tab builder racikan + bahan baku di rekam medis"
```

---

## Task 6: Simpan racikan (prescription + compounding + potong stok)

**Files:**
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts`

- [ ] **Step 1: Perluas tipe ResepItem + import helper**

Di atas `simpanRekamMedis`, ganti tipe (baris 6):
```ts
type ResepItem = { nama_obat: string; qty: number; satuan?: string; harga?: number; aturan_pakai?: string; jenis?: string };
```
menjadi:
```ts
import { stockDeductions } from "@/lib/compounding";

type RacikBahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };
type ResepItem = {
  nama_obat: string; qty: number; satuan?: string; harga?: number; aturan_pakai?: string; jenis?: string;
  ingredients?: RacikBahan[]; dosage_form?: string;
};
```
(Import `createClient` sudah ada; tambahkan baris import `stockDeductions` di grup import atas.)

- [ ] **Step 2: Ubah pemetaan prescription_items — racikan tetap masuk sebagai baris obat**

Ganti blok `.map` (baris 48-58) yang membuat `rows`:
```ts
  const rows = resep
    .filter((r) => r.nama_obat?.trim())
    .map((r) => ({
      medical_record_id: mr!.id,
      nama_obat: r.nama_obat.trim(),
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.satuan?.trim() || "pcs",
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
    }));
```
menjadi:
```ts
  const rows = resep
    .filter((r) => r.nama_obat?.trim())
    .map((r) => ({
      medical_record_id: mr!.id,
      nama_obat: r.nama_obat.trim(),
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.jenis === "racikan" ? "racikan" : (r.satuan?.trim() || "pcs"),
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      // racikan ditagih sebagai baris "obat" (invoice/struk existing tak berubah, nama-only otomatis).
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
    }));
```

- [ ] **Step 3: Setelah insert prescription_items, buat compounding record + potong stok**

Sisipkan blok baru SEBELUM update berat pasien (sebelum baris `if (petId && berat...`, sekitar baris 66). Kode:
```ts
  // Racikan → compounding_recipes (worklist apoteker) + BOM + potong stok bahan (spec §4).
  const racikan = resep.filter((r) => r.jenis === "racikan" && (r.ingredients ?? []).length > 0);
  if (racikan.length) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: visitRow } = await supabase.from("visits").select("branch_id").eq("id", visitId).maybeSingle();
    const { data: wh } = visitRow
      ? await supabase.from("warehouses").select("id").eq("branch_id", visitRow.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle()
      : { data: null };

    for (const r of racikan) {
      const ings = (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0);
      if (ings.length === 0) continue;
      const total = ings.reduce((a, b) => a + (Number(b.harga) || 0) * (Number(b.qty) || 0), 0);

      const { data: recipe } = await supabase
        .from("compounding_recipes")
        .insert({
          medical_record_id: mr!.id, recipe_name: r.nama_obat.trim(),
          dosage_instruction: r.aturan_pakai?.trim() || null,
          dosage_form: r.dosage_form || null, total_price: total,
          status: "pending", created_by: user?.id ?? null,
        })
        .select("id").single();
      if (!recipe) continue;

      await supabase.from("compounding_ingredients").insert(
        ings.map((b) => ({
          recipe_id: recipe.id, ingredient_name: b.nama, item_id: b.item_id,
          quantity: Number(b.qty), unit: b.satuan || "pcs", unit_price: Number(b.harga) || 0,
        })),
      );

      // potong stok bahan di gudang cabang (pola createCompounding).
      if (wh) {
        for (const d of stockDeductions(ings.map((b) => ({ item_id: b.item_id, quantity: Number(b.qty) })))) {
          const { data: st } = await supabase.from("stock").select("qty").eq("warehouse_id", wh.id).eq("item_id", d.item_id).maybeSingle();
          if (st) await supabase.from("stock").update({ qty: Number(st.qty) - d.qty, updated_at: new Date().toISOString() }).eq("warehouse_id", wh.id).eq("item_id", d.item_id);
        }
      }
    }
  }
```

Catatan: `stockDeductions` (dari `@/lib/compounding`) menerima `{item_id, quantity}[]` dan mengembalikan `{item_id, qty}[]` (menggabungkan item_id yang sama, membuang null). Sudah dipakai `createCompounding`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts"
git commit -m "feat(racikan): simpan racikan ke compounding + potong stok bahan"
```

---

## Task 7: Verifikasi end-to-end (browser)

**Files:** none (verifikasi manual via preview).

- [ ] **Step 1: Jalankan seluruh test + typecheck**

Run:
```bash
npm test
npx tsc --noEmit -p tsconfig.json
```
Expected: semua test PASS, `No errors found`.

- [ ] **Step 2: Tandai bahan baku**

Buka `http://localhost:3000/klinik/bahan-baku` (login admin/owner). Centang 2-3 item sebagai bahan baku (mis. Ivermectin, Grooming Shampoo). Reload → centang tetap tersimpan.

- [ ] **Step 3: Buat racikan di rekam medis**

Buka antrian → pasien "Sedang Diperiksa" → Rekam medis. Tab **Racikan**:
- Isi nama racikan "Puyer Batuk", bentuk "puyer".
- Cari bahan baku (yang tadi diflag) → tambah 2 bahan, set dosis.
- Cek estimasi = Σ(harga×dosis).
- Klik "Tambah racikan ke keranjang" → muncul 1 baris di keranjang dengan tag "racikan".
- Klik chevron → expand menampilkan bahan. TOTAL keranjang bertambah sebesar harga racikan.

- [ ] **Step 4: Simpan + verifikasi DB**

Klik "Simpan & Lanjut Rawat Inap" (atau Simpan & Cetak Resep). Lalu cek via SQL (MCP `execute_sql`):
```sql
select nama_obat, harga, jenis from prescription_items order by created_at desc limit 5;
select recipe_name, total_price, status from compounding_recipes order by created_at desc limit 3;
select ingredient_name, quantity, unit_price from compounding_ingredients order by ctid desc limit 6;
```
Expected: prescription_item racikan (jenis "obat", harga=total); compounding_recipe (status pending, total_price benar); ingredients dengan unit_price; dan stok bahan berkurang (cek `stock`).

- [ ] **Step 5: Verifikasi struk name-only**

Lanjut ke `/klinik/pembayaran/[visitId]` → proses bayar → struk. Konfirmasi baris racikan tampil sebagai **nama racikan + harga** saja, tanpa rincian bahan.

- [ ] **Step 6: Verifikasi worklist apoteker**

Buka `/klinik/racik` → racikan baru muncul status "Menunggu diracik". Klik Detail → BOM bahan tampil.

- [ ] **Step 7: Commit catatan verifikasi (opsional) + selesai**

Bila semua lolos, fitur selesai. Merge branch `feat/racikan-bom` sesuai alur finishing.

---

## Self-Review (penulis plan)

- **Spec coverage:** §1 data model → Task 1. §2 builder → Task 4+5. §3 keranjang expand → Task 5 Step 4. §4 simpan+stok → Task 6. §5 struk zero-change → Task 7 Step 5 (verifikasi). Halaman bahan baku (§5 flag UI) → Task 3. Helper harga → Task 2. ✔ Semua tercakup.
- **Placeholder scan:** tak ada TBD/TODO; semua step berisi kode konkret. ✔
- **Type consistency:** `RacikanIngredient` (lib/racikan) dipakai di RekamForm; `RacikBahan` (actions) struktur identik (item_id, nama, qty, satuan, harga) — sengaja lokal agar action tak import tipe client; field cocok. `racikanTotal` konsisten. `stockDeductions` signature cocok dengan pemakaian existing. Cart `jenis` "racikan" konsisten antara RekamForm & actions. ✔
