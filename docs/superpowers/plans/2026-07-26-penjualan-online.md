# Penjualan Online / B2C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jalur penjualan online terpisah (Shopee/Tokopedia/TikTok Shop/WA) yang potong stok dari gudang tipe `ONLINE` dan menjurnal marketplace lewat Piutang Marketplace + komisi saat pencairan.

**Architecture:** Tidak ada tabel order baru — `sales` existing ditambah kolom channel (semua nullable, `channel is null` = POS retail lama). Order online tidak memakai cashier shift (`shift_id` tetap null). Logika murni (nomor dokumen, komisi, klasifikasi channel) hidup di `src/lib/online.ts` + unit test; server action mengorkestrasi Supabase, `stockOut` FIFO, dan `postJournal` yang sudah ada.

**Tech Stack:** Next.js 15 App Router (Server Components + server actions), Supabase Postgres, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-penjualan-online-design.md`

## Global Constraints

- Migrasi Supabase berikutnya = **0062** (terakhir yang ada: `0061_auto_confirm_users.sql`). Terapkan lewat MCP `apply_migration`, dan simpan file yang sama di `supabase/migrations/`.
- Kolom baru di `sales` **wajib nullable / punya default** — 100% baris POS & klinik existing tidak boleh terpengaruh.
- Channel valid persis 4 nilai: `'Shopee'`, `'Tokopedia'`, `'TikTok Shop'`, `'WA'`. Marketplace = 3 yang pertama; `WA` bukan marketplace.
- Marketplace **tidak** link ke `customers` (tanpa poin/tier). Channel `WA` boleh link `customer_id` (dapat poin/tier).
- Nomor dokumen: `ONL-YYYYMMDD-NNNN`, seq per hari, via `count+1` (pola yang sama dengan `no_struk` POS — ponytail).
- Akun baru: `1202` Piutang Marketplace (ASET/D), `5305` Beban Komisi Marketplace (BEBAN/D).
- Order online **tidak** membuka/menutup shift kasir — `shift_id` selalu null.
- Jangan seed cabang/gudang `ONLINE` apa pun. Kalau tidak ada gudang tipe `ONLINE` aktif, UI menampilkan pesan jelas, bukan error.
- Tes: `npm test` (Vitest). Logika murni di `src/lib/*.ts` + test di `src/lib/__tests__/*.test.ts`. Server action & page TIDAK di-unit-test (pola repo).
- Jangan jalankan `npm run build` selagi dev server preview nyala (merusak `.next`).
- Semua teks UI Bahasa Indonesia, ikut gaya halaman existing (`crm-sec`, `SecHeader`, `tbl`, `btn-acc`, `btn-def`, `fi`, `flab`).

---

### Task 1: Migrasi DB — kolom channel di `sales` + 2 akun COA

**Files:**
- Create: `supabase/migrations/0062_penjualan_online.sql`

**Interfaces:**
- Consumes: tabel `sales` (0010), `coa_accounts` (seed), enum `warehouse_type` yang sudah punya nilai `'ONLINE'` (0001).
- Produces: kolom `sales.channel`, `sales.external_ref`, `sales.buyer_name`, `sales.marketplace_status`, `sales.komisi`, `sales.disbursed_at`; akun `1202` & `5305`.

- [ ] **Step 1: Tulis file migrasi**

Buat `supabase/migrations/0062_penjualan_online.sql`:

```sql
-- Penjualan Online / B2C — Fase 5, penutup roadmap paritas Accurate
-- (spec: docs/superpowers/specs/2026-07-23-penjualan-online-design.md)

-- Akun: dana marketplace yang belum cair + beban komisi platform.
insert into coa_accounts (code, name, type, normal_balance) values
  ('1202', 'Piutang Marketplace', 'ASET', 'D'),
  ('5305', 'Beban Komisi Marketplace', 'BEBAN', 'D')
on conflict (code) do nothing;

-- Semua kolom nullable / berdefault: baris POS & klinik lama tidak tersentuh.
-- channel null = penjualan POS retail (perilaku lama, tetap default).
alter table sales
  add column if not exists channel varchar(20),
  add column if not exists external_ref varchar(60),
  add column if not exists buyer_name varchar(120),
  add column if not exists marketplace_status varchar(16),
  add column if not exists komisi numeric not null default 0,
  add column if not exists disbursed_at timestamptz;

alter table sales drop constraint if exists sales_channel_check;
alter table sales add constraint sales_channel_check
  check (channel is null or channel in ('Shopee','Tokopedia','TikTok Shop','WA'));

alter table sales drop constraint if exists sales_marketplace_status_check;
alter table sales add constraint sales_marketplace_status_check
  check (marketplace_status is null or marketplace_status in ('piutang','cair'));

create index if not exists sales_channel_idx on sales(channel) where channel is not null;
```

- [ ] **Step 2: Terapkan migrasi ke Supabase**

Pakai MCP `apply_migration` dengan `name: "penjualan_online"` dan isi SQL persis dari Step 1.

Expected: sukses tanpa error.

- [ ] **Step 3: Verifikasi kolom & akun benar-benar ada**

Pakai MCP `execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='sales'
  and column_name in ('channel','external_ref','buyer_name','marketplace_status','komisi','disbursed_at')
order by column_name;

select code, name, type, normal_balance from coa_accounts where code in ('1202','5305') order by code;

select count(*) as sales_lama_masih_null from sales where channel is not null;
```

Expected: 6 baris kolom (semua `is_nullable = YES` kecuali `komisi` yang `NO` karena punya default), 2 baris akun (`1202` Piutang Marketplace / `5305` Beban Komisi Marketplace), dan `sales_lama_masih_null = 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0062_penjualan_online.sql
git commit -m "feat(penjualan): skema kolom channel online + akun piutang marketplace"
```

---

### Task 2: Logika murni `src/lib/online.ts` (TDD)

**Files:**
- Create: `src/lib/online.ts`
- Test: `src/lib/__tests__/online.test.ts`

**Interfaces:**
- Consumes: tidak ada (murni, tanpa dependency).
- Produces:
  - `CHANNELS: readonly ["Shopee","Tokopedia","TikTok Shop","WA"]`
  - `type Channel = (typeof CHANNELS)[number]`
  - `isChannel(v: string): v is Channel`
  - `isMarketplace(channel: string): boolean`
  - `prefixNoOnline(date: Date): string` → `"ONL-YYYYMMDD"`
  - `formatNoOnline(date: Date, seq: number): string` → `"ONL-YYYYMMDD-NNNN"`
  - `totalOnline(rows: { qty: number; harga: number }[]): number`
  - `hitungKomisi(total: number, nominalCair: number): number`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/__tests__/online.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatNoOnline,
  hitungKomisi,
  isChannel,
  isMarketplace,
  prefixNoOnline,
  totalOnline,
} from "../online";

describe("isChannel", () => {
  it("hanya 4 channel yang diakui", () => {
    expect(isChannel("Shopee")).toBe(true);
    expect(isChannel("WA")).toBe(true);
    expect(isChannel("Lazada")).toBe(false);
    expect(isChannel("")).toBe(false);
  });
});

describe("isMarketplace", () => {
  it("marketplace = Shopee/Tokopedia/TikTok Shop, WA bukan", () => {
    expect(isMarketplace("Shopee")).toBe(true);
    expect(isMarketplace("Tokopedia")).toBe(true);
    expect(isMarketplace("TikTok Shop")).toBe(true);
    expect(isMarketplace("WA")).toBe(false);
    expect(isMarketplace("Lazada")).toBe(false);
  });
});

describe("prefixNoOnline / formatNoOnline", () => {
  it("format ONL-YYYYMMDD-NNNN", () => {
    expect(prefixNoOnline(new Date(2026, 6, 26))).toBe("ONL-20260726");
    expect(formatNoOnline(new Date(2026, 6, 26), 1)).toBe("ONL-20260726-0001");
    expect(formatNoOnline(new Date(2026, 11, 3), 42)).toBe("ONL-20261203-0042");
  });
});

describe("totalOnline", () => {
  it("jumlahkan qty x harga", () => {
    expect(totalOnline([{ qty: 2, harga: 5000 }, { qty: 1, harga: 2500 }])).toBe(12500);
  });
  it("baris kosong = 0", () => {
    expect(totalOnline([])).toBe(0);
  });
});

describe("hitungKomisi", () => {
  it("komisi = total - dana cair", () => {
    expect(hitungKomisi(100000, 94000)).toBe(6000);
  });
  it("cair penuh = tanpa komisi", () => {
    expect(hitungKomisi(100000, 100000)).toBe(0);
  });
  it("cair lebih besar dari total tidak bikin komisi negatif", () => {
    expect(hitungKomisi(100000, 110000)).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
npm test -- online
```

Expected: FAIL — `Failed to resolve import "../online"`.

- [ ] **Step 3: Tulis implementasi minimal**

Buat `src/lib/online.ts`:

```ts
// Penjualan Online / B2C — logika murni, dites di __tests__/online.test.ts
// (spec: docs/superpowers/specs/2026-07-23-penjualan-online-design.md)

export const CHANNELS = ["Shopee", "Tokopedia", "TikTok Shop", "WA"] as const;
export type Channel = (typeof CHANNELS)[number];

// Marketplace = dana ditahan platform lalu cair belakangan (lahir sebagai piutang).
// WA = transfer langsung ke bank, lunas seketika.
const MARKETPLACE: readonly string[] = ["Shopee", "Tokopedia", "TikTok Shop"];

export function isChannel(v: string): v is Channel {
  return (CHANNELS as readonly string[]).includes(v);
}

export function isMarketplace(channel: string): boolean {
  return MARKETPLACE.includes(channel);
}

// Nomor dokumen ONL-YYYYMMDD-NNNN, seq per hari (ponytail: count+1, sama seperti no_struk POS).
export function prefixNoOnline(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `ONL-${y}${m}${d}`;
}

export function formatNoOnline(date: Date, seq: number): string {
  return `${prefixNoOnline(date)}-${String(seq).padStart(4, "0")}`;
}

export function totalOnline(rows: { qty: number; harga: number }[]): number {
  return rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);
}

// Komisi marketplace tidak ditebak di depan — dihitung dari selisih order vs dana yang benar-benar cair.
export function hitungKomisi(total: number, nominalCair: number): number {
  return Math.max(0, Math.round(total) - Math.round(nominalCair));
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
npm test -- online
```

Expected: PASS, semua test di `online.test.ts` hijau.

- [ ] **Step 5: Commit**

```bash
git add src/lib/online.ts src/lib/__tests__/online.test.ts
git commit -m "feat(penjualan): logika murni penjualan online (nomor, channel, komisi)"
```

---

### Task 3: Server actions — buat order & tandai cair

**Files:**
- Create: `src/app/(app)/penjualan/online/actions.ts`

**Interfaces:**
- Consumes: `formatNoOnline`, `prefixNoOnline`, `isChannel`, `isMarketplace`, `totalOnline`, `hitungKomisi` dari `@/lib/online` (Task 2); `postJournal` dari `@/lib/posting`; `stockOut` dari `@/lib/inventory`; `getPajakSettings`/`splitPpnInklusif` dari `@/lib/pajak`; `recomputeCustomerTier` dari `@/lib/customer-tier`; kolom dari Task 1.
- Produces: `buatPenjualanOnline(formData: FormData): Promise<void>` dan `tandaiCair(formData: FormData): Promise<void>` — dua-duanya server action yang dipakai Task 4.

- [ ] **Step 1: Tulis server actions**

Buat `src/app/(app)/penjualan/online/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { stockOut } from "@/lib/inventory";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import {
  formatNoOnline,
  hitungKomisi,
  isChannel,
  isMarketplace,
  prefixNoOnline,
  totalOnline,
} from "@/lib/online";

const BACK = "/penjualan/online";
const POIN_PER_RUPIAH = 1000; // earn: 1 poin / Rp1.000 (sama dengan POS)

type ItemInput = { item_id: string; nama: string; qty: number; harga: number };

// Order online: TANPA shift kasir (shift_id null) — settlement bukan tunai fisik.
// Marketplace → Dr 1202 Piutang Marketplace; WA → Dr 1102 Bank (lunas seketika).
export async function buatPenjualanOnline(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const fail = (msg: string) => redirect(`${BACK}/baru?error=${encodeURIComponent(msg)}`);

  const channel = String(formData.get("channel") ?? "");
  if (!isChannel(channel)) fail("Pilih channel penjualan yang valid.");

  const warehouseId = String(formData.get("warehouse_id") ?? "");
  if (!warehouseId) fail("Pilih gudang online.");

  const buyerName = String(formData.get("buyer_name") ?? "").trim() || null;
  const externalRef = String(formData.get("external_ref") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  // Marketplace tidak masuk CRM/poin (keputusan spec); hanya WA yang boleh link pelanggan.
  const customerId = channel === "WA" ? (String(formData.get("customer_id") ?? "") || null) : null;

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0);
  if (items.length === 0) fail("Minimal 1 barang.");

  // Gudang online menentukan cabang (sales.branch_id NOT NULL).
  const { data: wh } = await supabase
    .from("warehouses").select("id, branch_id")
    .eq("id", warehouseId).eq("type", "ONLINE").eq("is_active", true).maybeSingle();
  if (!wh) fail("Gudang online tidak ditemukan atau tidak aktif.");
  const branchId = wh!.branch_id;

  const total = totalOnline(items);
  if (total <= 0) fail("Total order harus lebih dari nol.");

  const d = new Date(tanggal + "T00:00:00");
  const { count } = await supabase
    .from("sales").select("*", { count: "exact", head: true })
    .like("no_struk", `${prefixNoOnline(d)}-%`);
  const noStruk = formatNoOnline(d, (count ?? 0) + 1);

  const marketplace = isMarketplace(channel);
  const poinEarned = customerId ? Math.floor(total / POIN_PER_RUPIAH) : 0;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      branch_id: branchId, customer_id: customerId, no_struk: noStruk,
      subtotal: total, discount: 0, total,
      metode_bayar: channel, bayar: total, kembali: 0,
      poin_earned: poinEarned, cashier_id: user?.id ?? null,
      channel, external_ref: externalRef, buyer_name: buyerName,
      marketplace_status: marketplace ? "piutang" : null,
      created_at: `${tanggal}T00:00:00Z`,
    })
    .select("id").single();
  if (saleErr || !sale) fail(saleErr?.message ?? "Gagal simpan order online.");

  const { error: itErr } = await supabase.from("sale_items").insert(
    items.map((l) => ({
      sale_id: sale!.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
    })),
  );
  if (itErr) fail(itErr.message);

  // Stok gudang online berkurang lewat FIFO — cost jadi HPP riil (PRD §10.2).
  let hppFifo = 0;
  for (const l of items) {
    const { cost } = await stockOut(supabase, {
      warehouseId, itemId: l.item_id, qty: l.qty, source: "sale-online", ref: noStruk,
    });
    hppFifo += cost;
  }

  // Poin & tier hanya untuk order WA yang dilink ke pelanggan.
  if (customerId && poinEarned > 0) {
    const { data: cust } = await supabase
      .from("customers").select("points").eq("id", customerId).maybeSingle();
    const saldo = (cust?.points ?? 0) + poinEarned;
    await supabase.from("point_ledger").insert({
      customer_id: customerId, delta: poinEarned, saldo, ref: noStruk,
      description: `Penjualan online ${noStruk}`,
    });
    await supabase.from("customers").update({ points: saldo }).eq("id", customerId);
    await recomputeCustomerTier(supabase, customerId);
  }

  // Jurnal pendapatan. Marketplace ditahan platform → piutang; WA langsung ke bank.
  const debitCode = marketplace ? "1202" : "1102";
  const { dpp, ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  await postJournal(supabase, {
    tanggal, deskripsi: `Penjualan online ${channel} ${noStruk}`,
    source: "sale-online", sourceRef: noStruk, branchId,
    lines: [
      { code: debitCode, debit: total, credit: 0 },
      { code: "4101", debit: 0, credit: dpp },
      ...(ppn > 0 ? [{ code: "2201", debit: 0, credit: ppn }] : []),
    ],
  });

  // HPP = cost FIFO riil dari layer yang terkonsumsi.
  if (hppFifo > 0) {
    await postJournal(supabase, {
      tanggal, deskripsi: `HPP penjualan online ${noStruk}`,
      source: "sale-online-hpp", sourceRef: noStruk, branchId,
      lines: [
        { code: "5101", debit: hppFifo, credit: 0 },
        { code: "1301", debit: 0, credit: hppFifo },
      ],
    });
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Order ${noStruk} tersimpan.`)}`);
}

// Pencairan marketplace: input dana yang benar-benar masuk bank; selisihnya = komisi platform.
// ponytail: 1 order = 1 pencairan. Kalau volume naik dan platform mencairkan
// banyak order sekaligus, naikkan ke pencairan batch (tabel disbursements).
export async function tandaiCair(formData: FormData) {
  const supabase = await createClient();
  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const saleId = String(formData.get("sale_id") ?? "");
  const nominal = Number(formData.get("nominal")) || 0;
  if (!saleId) fail("Order tidak dikenali.");
  if (nominal <= 0) fail("Nominal pencairan harus lebih dari nol.");

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, total, channel, marketplace_status, branch_id")
    .eq("id", saleId).maybeSingle();
  if (!sale) fail("Order tidak ditemukan.");
  if (!sale!.channel || !isMarketplace(sale!.channel)) fail("Order ini bukan order marketplace.");
  if (sale!.marketplace_status !== "piutang") fail("Order ini sudah dicairkan.");

  const total = Number(sale!.total);
  const komisi = hitungKomisi(total, nominal);
  const now = new Date();
  const tanggal = now.toISOString().slice(0, 10);

  const { error: updErr } = await supabase
    .from("sales")
    .update({ marketplace_status: "cair", komisi, disbursed_at: now.toISOString() })
    .eq("id", saleId);
  if (updErr) fail(updErr.message);

  // Dr Bank (dana masuk) + Dr Beban Komisi (potongan platform) / Cr Piutang Marketplace (nilai order).
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pencairan ${sale!.channel} ${sale!.no_struk}`,
    source: "sale-online-cair", sourceRef: sale!.no_struk, branchId: sale!.branch_id,
    lines: [
      { code: "1102", debit: Math.min(nominal, total), credit: 0 },
      ...(komisi > 0 ? [{ code: "5305", debit: komisi, credit: 0 }] : []),
      { code: "1202", debit: 0, credit: total },
    ],
  });

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Pencairan ${sale!.no_struk} tercatat.`)}`);
}
```

> Catatan implementasi: `Math.min(nominal, total)` menjaga jurnal tetap seimbang kalau operator salah ketik nominal lebih besar dari nilai order — `hitungKomisi` sudah meng-clamp komisi ke 0 di kasus itu, jadi Dr = Cr = `total`.

- [ ] **Step 2: Verifikasi tipe bersih**

```bash
npx tsc --noEmit
```

Expected: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/penjualan/online/actions.ts"
git commit -m "feat(penjualan): server action order online + pencairan marketplace"
```

---

### Task 4: UI — form order, halaman list, entri navigasi

**Files:**
- Create: `src/app/(app)/penjualan/online/baru/OnlineForm.tsx`
- Create: `src/app/(app)/penjualan/online/baru/page.tsx`
- Create: `src/app/(app)/penjualan/online/page.tsx`
- Modify: `src/lib/nav.ts` (bagian `penjualan`, sekitar baris 87–97)

**Interfaces:**
- Consumes: `buatPenjualanOnline`, `tandaiCair` dari `../actions` / `./actions` (Task 3); `CHANNELS` dari `@/lib/online` (Task 2); `SecHeader` dari `@/components/SecHeader`.
- Produces: rute `/penjualan/online` dan `/penjualan/online/baru`.

- [ ] **Step 1: Tulis komponen form (client)**

Buat `src/app/(app)/penjualan/online/baru/OnlineForm.tsx`:

```tsx
"use client";

// ponytail: baris item dinamis diserialisasi ke hidden JSON — pola sama dengan POForm.
import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { CHANNELS } from "@/lib/online";
import { buatPenjualanOnline } from "../actions";

type Warehouse = { id: string; name: string; branch_name: string };
type Item = { id: string; code: string; name: string; sell_price: number };
type Customer = { id: string; name: string; phone: string | null };
type Row = { item_id: string; nama: string; qty: number; harga: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const blank: Row = { item_id: "", nama: "", qty: 1, harga: 0 };
const itemLabel = (it: Item) => `${it.code} — ${it.name}`;
const custLabel = (c: Customer) => (c.phone ? `${c.name} (${c.phone})` : c.name);

export function OnlineForm({
  warehouses,
  items,
  customers,
}: {
  warehouses: Warehouse[];
  items: Item[];
  customers: Customer[];
}) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);
  const [channel, setChannel] = useState<string>("Shopee");
  const [custText, setCustText] = useState("");

  const byLabel = new Map(items.map((it) => [itemLabel(it), it]));
  const custByLabel = new Map(customers.map((c) => [custLabel(c), c]));
  const customerId = custByLabel.get(custText)?.id ?? "";

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Wajib pilih dari master SKU — stok & HPP FIFO butuh item_id (teks bebas ditolak server).
  const setNama = (i: number, v: string) => {
    const it = byLabel.get(v);
    set(i, it
      ? { nama: it.name, item_id: it.id, harga: Number(it.sell_price) || 0 }
      : { nama: v, item_id: "" });
  };
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={buatPenjualanOnline}>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <input type="hidden" name="customer_id" value={customerId} />
      <datalist id="onl-items">
        {items.map((it) => <option key={it.id} value={itemLabel(it)} />)}
      </datalist>
      <datalist id="onl-customers">
        {customers.map((c) => <option key={c.id} value={custLabel(c)} />)}
      </datalist>

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL ORDER" desc="Channel, gudang online & data pembeli." />

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Channel *</label>
            <select
              className="fi"
              name="channel"
              required
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c === "WA" ? "WA / Transfer Manual" : c}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang online *</label>
            <select className="fi" name="warehouse_id" required>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name} · {w.branch_name}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Nama pembeli</label>
            <input className="fi" name="buyer_name" placeholder="Nama pembeli di marketplace" />
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">No. order / referensi</label>
            <input className="fi" name="external_ref" placeholder="Contoh: 250726ABCDEFG" />
          </div>

          {channel === "WA" && (
            <div className="fg" style={{ marginBottom: 10 }}>
              <label className="flab">Link pelanggan (opsional)</label>
              <input
                className="fi"
                list="onl-customers"
                value={custText}
                onChange={(e) => setCustText(e.target.value)}
                placeholder="Cari nama / no HP pelanggan"
              />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Kalau dilink, order ini menambah poin &amp; tier pelanggan. Order marketplace tidak masuk CRM.
              </div>
            </div>
          )}

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal order</label>
            <input className="fi" type="date" name="tanggal" defaultValue={today} />
          </div>

          {total > 0 && (
            <div style={{
              marginTop: 14, padding: "10px 14px", background: "var(--bg2, #f9fafb)",
              borderRadius: 6, border: ".5px solid var(--bd)", fontSize: 13, fontWeight: 700,
              display: "flex", justifyContent: "space-between",
            }}>
              <span style={{ color: "var(--tm)", fontWeight: 500 }}>Total Order</span>
              <span>{rp(total)}</span>
            </div>
          )}
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader
            num="02"
            title="DAFTAR BARANG"
            desc="Pilih dari master SKU — stok gudang online otomatis berkurang."
            action={
              <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah baris
              </button>
            }
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="fi"
                  list="onl-items"
                  placeholder="Kode / nama barang"
                  defaultValue={r.nama}
                  onChange={(e) => setNama(i, e.target.value)}
                  style={{ flex: 2 }}
                />
                <input
                  className="fi" type="number" min={0} step="any" value={r.qty}
                  onChange={(e) => set(i, { qty: Number(e.target.value) })}
                  style={{ width: 70 }} title="Qty" placeholder="Qty"
                />
                <input
                  className="fi" type="number" min={0} step="any" value={r.harga}
                  onChange={(e) => set(i, { harga: Number(e.target.value) })}
                  style={{ width: 110 }} title="Harga jual" placeholder="Harga"
                />
                <button
                  type="button" onClick={() => del(i)} className="btn-def"
                  style={{ padding: "0 9px", color: "#b91c1c", flexShrink: 0 }} title="Hapus baris"
                >
                  <i className="ti ti-trash" />
                </button>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Baris tanpa barang dari master SKU diabaikan (stok &amp; HPP butuh SKU terdaftar).
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <a href="/penjualan/online" className="btn-def" style={{ textDecoration: "none" }}>Batal</a>
        <button type="submit" className="btn-acc">
          <i className="ti ti-device-floppy" /> Simpan order
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Tulis halaman form (server)**

Buat `src/app/(app)/penjualan/online/baru/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OnlineForm } from "./OnlineForm";

type WhRow = { id: string; name: string; branches: { name: string } | { name: string }[] | null };

export default async function OnlineBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: whRaw }, { data: items }, { data: customers }] = await Promise.all([
    supabase
      .from("warehouses").select("id, name, branches(name)")
      .eq("type", "ONLINE").eq("is_active", true).order("name"),
    supabase.from("items").select("id, code, name, sell_price").eq("is_active", true).order("name").limit(2000),
    supabase.from("customers").select("id, name, phone").order("name").limit(2000),
  ]);

  const warehouses = ((whRaw ?? []) as unknown as WhRow[]).map((w) => {
    const br = Array.isArray(w.branches) ? w.branches[0] : w.branches;
    return { id: w.id, name: w.name, branch_name: br?.name ?? "—" };
  });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan/online" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Order Online Baru</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {warehouses.length === 0 ? (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#b45309" }}>
          <i className="ti ti-alert-triangle" /> Belum ada gudang bertipe ONLINE yang aktif. Minta admin
          membuat cabang &amp; gudang online dulu sebelum mencatat order.
        </div>
      ) : (
        <OnlineForm
          warehouses={warehouses}
          items={(items ?? []) as { id: string; code: string; name: string; sell_price: number }[]}
          customers={(customers ?? []) as { id: string; name: string; phone: string | null }[]}
        />
      )}
    </>
  );
}
```

> Kolom `items.sell_price` dan `items.is_active` sudah diverifikasi ada di `supabase/migrations/0001_core.sql:52-64`. `customers.phone` juga `not null` di sana.

- [ ] **Step 3: Tulis halaman list + tombol pencairan**

Buat `src/app/(app)/penjualan/online/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { tandaiCair } from "./actions";

type Row = {
  id: string;
  no_struk: string | null;
  created_at: string;
  channel: string | null;
  buyer_name: string | null;
  external_ref: string | null;
  total: number;
  komisi: number;
  marketplace_status: string | null;
  customers: { name: string } | { name: string }[] | null;
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const fmtD = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

const CHANNEL_STYLE: Record<string, { bg: string; fg: string }> = {
  "Shopee": { bg: "#fff1eb", fg: "#ea580c" },
  "Tokopedia": { bg: "#e8f5ee", fg: "#16a34a" },
  "TikTok Shop": { bg: "#f4f4f5", fg: "#3f3f46" },
  "WA": { bg: "#e8f5ee", fg: "#15803d" },
};

export default async function PenjualanOnlinePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales")
    .select("id, no_struk, created_at, channel, buyer_name, external_ref, total, komisi, marketplace_status, customers(name)")
    .not("channel", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  const piutang = rows
    .filter((r) => r.marketplace_status === "piutang")
    .reduce((a, r) => a + Number(r.total), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penjualan Online</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="ORDER ONLINE"
          desc={`Marketplace & WA. Dana marketplace belum cair: ${rp(piutang)}.`}
          action={
            <Link href="/penjualan/online/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Buat order
            </Link>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Nomor #</th>
                <th>Tanggal</th>
                <th>Channel</th>
                <th>Pembeli</th>
                <th>Ref. order</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Komisi</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cust = Array.isArray(r.customers) ? r.customers[0] : r.customers;
                const st = CHANNEL_STYLE[r.channel ?? ""] ?? { bg: "#f4f4f5", fg: "#3f3f46" };
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500, fontSize: 11.5 }}>{r.no_struk ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtD(r.created_at)}</td>
                    <td>
                      <span
                        className="bge"
                        style={{ background: st.bg, color: st.fg, fontSize: 10 }}
                      >
                        {r.channel}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5 }}>{cust?.name ?? r.buyer_name ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.external_ref ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(r.total))}</td>
                    <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                      {Number(r.komisi) > 0 ? rp(Number(r.komisi)) : "—"}
                    </td>
                    <td>
                      {r.marketplace_status === "piutang" ? (
                        <form action={tandaiCair} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <input type="hidden" name="sale_id" value={r.id} />
                          <input
                            className="fi" type="number" name="nominal" min={1} step="any" required
                            placeholder="Dana cair" style={{ width: 110, padding: "3px 6px", fontSize: 10.5 }}
                          />
                          <button type="submit" className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }}>
                            Tandai cair
                          </button>
                        </form>
                      ) : r.marketplace_status === "cair" ? (
                        <span className="bge g" style={{ fontSize: 10 }}>Cair</span>
                      ) : (
                        <span className="bge b" style={{ fontSize: 10 }}>Lunas</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada order online.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Tambah entri navigasi**

Di `src/lib/nav.ts`, di dalam array `penjualan` (sekitar baris 87–97), sisipkan satu baris tepat SEBELUM baris `Retur penjualan`:

```ts
    { label: "Penjualan online", icon: "ti-shopping-cart", ...G, nw: true, href: "/penjualan/online" },
```

Hasil akhir potongan array `penjualan` harus terlihat begini:

```ts
  penjualan: [
    { label: "Penawaran penjualan", icon: "ti-file-text", ...G },
    { label: "Pesanan penjualan", icon: "ti-shopping-bag", ...G },
    { label: "Pengiriman pesanan", icon: "ti-truck", ...G },
    { label: "Uang muka penjualan", icon: "ti-coin", ...B },
    { label: "Faktur penjualan", icon: "ti-receipt-2", ...G },
    { label: "Penerimaan penjualan", icon: "ti-cash-banknote", ...B },
    { label: "Penjualan online", icon: "ti-shopping-cart", ...G, nw: true, href: "/penjualan/online" },
    { label: "Retur penjualan", icon: "ti-arrow-back-up", ...G, nw: true, href: "/penjualan/retur" },
    { label: "Komisi penjual", icon: "ti-percentage", ...P },
    { label: "Target penjualan", icon: "ti-target", ...A },
  ],
```

- [ ] **Step 5: Verifikasi tipe & lint bersih**

```bash
npx tsc --noEmit && npm run lint
```

Expected: dua-duanya lolos tanpa error.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/penjualan/online" src/lib/nav.ts
git commit -m "feat(penjualan): UI order online, list & pencairan marketplace"
```

---

### Task 5: Integrasi — cegah order online bocor ke alur POS, tambah baris laporan

**Files:**
- Modify: `src/app/(app)/keuangan/sinkron/actions.ts:62-64` (query `sales` pada `findDrift`)
- Modify: `src/app/(app)/penjualan/retur/baru/page.tsx:30` (query daftar struk yang bisa diretur)
- Modify: `src/app/(app)/penjualan/page.tsx` (Seksi 01: pisahkan POS vs Online)
- Modify: `src/lib/laporan.ts:48-54` (`resolveUnitTypes`)
- Modify: `src/lib/__tests__/laporan.test.ts` (test `resolveUnitTypes`)
- Modify: `src/app/(app)/keuangan/PeriodFilter.tsx:35-40` (opsi preset unit)

**Interfaces:**
- Consumes: kolom `sales.channel` (Task 1); order online yang dibuat Task 3.
- Produces: tidak ada API baru — hanya perilaku query & tampilan yang dikoreksi.

- [ ] **Step 1: Tulis test yang gagal untuk preset unit ONLINE**

Di `src/lib/__tests__/laporan.test.ts`, ganti blok `describe("resolveUnitTypes", ...)` yang ada dengan:

```ts
describe("resolveUnitTypes", () => {
  it("unit:KLINIK / unit:PETSHOP / unit:ONLINE / lainnya", () => {
    expect(resolveUnitTypes("unit:KLINIK")).toEqual(["KLINIK", "BOTH"]);
    expect(resolveUnitTypes("unit:PETSHOP")).toEqual(["PETSHOP", "BOTH"]);
    expect(resolveUnitTypes("unit:ONLINE")).toEqual(["ONLINE"]);
    expect(resolveUnitTypes("some-uuid")).toBeNull();
    expect(resolveUnitTypes(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
npm test -- laporan
```

Expected: FAIL — `expected null to deeply equal [ 'ONLINE' ]`.

- [ ] **Step 3: Tambah cabang ONLINE di `resolveUnitTypes`**

Di `src/lib/laporan.ts`, tambahkan satu baris pada fungsi `resolveUnitTypes` sehingga menjadi:

```ts
export function resolveUnitTypes(cabang: string | undefined): string[] | null {
  if (!cabang?.startsWith("unit:")) return null;
  const unit = cabang.slice(5);
  if (unit === "KLINIK") return ["KLINIK", "BOTH"];
  if (unit === "PETSHOP") return ["PETSHOP", "BOTH"];
  if (unit === "ONLINE") return ["ONLINE"];
  return null;
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
npm test -- laporan
```

Expected: PASS.

- [ ] **Step 5: Tambah opsi preset di PeriodFilter**

Di `src/app/(app)/keuangan/PeriodFilter.tsx`, di dalam blok `{unitPresets && (...)}` (sekitar baris 35–40), tambahkan opsi ketiga:

```tsx
            {unitPresets && (
              <>
                <option value="unit:KLINIK">— Semua Klinik —</option>
                <option value="unit:PETSHOP">— Semua Petshop —</option>
                <option value="unit:ONLINE">— Semua Online —</option>
              </>
            )}
```

- [ ] **Step 6: Kecualikan order online dari pemeriksa drift jurnal**

`findDrift` mencocokkan jurnal dengan `source === "sale"`, sedangkan jurnal online memakai `source: "sale-online"`. Tanpa filter, setiap order online akan terbaca "jurnalnya hilang" dan `perbaikiDrift` memposting jurnal ganda dengan akun yang salah (Dr Kas/Bank, bukan Dr Piutang Marketplace).

Di `src/app/(app)/keuangan/sinkron/actions.ts` sekitar baris 62, ubah query dari:

```ts
  const { data: sls } = await supabase
    .from("sales")
    .select("no_struk, total, metode_bayar, branch_id, created_at");
```

menjadi:

```ts
  // Order online punya jurnalnya sendiri (source "sale-online", akun Piutang Marketplace).
  // Ikut terscan di sini = false positive + repost dengan akun salah.
  const { data: sls } = await supabase
    .from("sales")
    .select("no_struk, total, metode_bayar, branch_id, created_at")
    .is("channel", null);
```

- [ ] **Step 7: Kecualikan order online dari pencarian struk retur**

Retur penjualan melakukan refund tunai lewat kasir — tidak berlaku untuk order online. Halaman retur mencari struk berdasarkan nomor (bukan dropdown), jadi filternya disisipkan di query pencarian itu.

Di `src/app/(app)/penjualan/retur/baru/page.tsx` sekitar baris 29–33, ubah dari:

```ts
    const { data } = await supabase
      .from("sales")
      .select("id, no_struk, total, created_at, customers(name), sale_items(item_id, nama, qty, harga)")
      .eq("no_struk", struk.trim())
      .maybeSingle();
```

menjadi:

```ts
    // Order online (channel terisi) tidak bisa diretur lewat jalur ini —
    // refund retur jual keluar dari kas kasir, sedangkan online tidak punya shift kasir.
    const { data } = await supabase
      .from("sales")
      .select("id, no_struk, total, created_at, customers(name), sale_items(item_id, nama, qty, harga)")
      .eq("no_struk", struk.trim())
      .is("channel", null)
      .maybeSingle();
```

- [ ] **Step 8: Pisahkan POS vs Online di Rekap Penjualan**

Di `src/app/(app)/penjualan/page.tsx`:

(a) Tambahkan `channel` ke tipe `SaleRow` (sekitar baris 20–26):

```ts
type SaleRow = {
  id: string;
  branch_id: string | null;
  total: number;
  created_at: string;
  channel: string | null;
  branches: { code: string; name: string } | { code: string; name: string }[] | null;
};
```

(b) Tambahkan `channel` ke `.select(...)` pada query `sales` (sekitar baris 54):

```ts
      .select("id, branch_id, total, created_at, channel, branches(code, name)")
```

(c) Setelah baris `const invoices = invoicesAll.filter((inv) => dalamPeriode(inv.created_at));` (sekitar baris 79), sisipkan pemisahan channel:

```ts
  // channel null = POS retail (perilaku lama); channel terisi = order online.
  const salesPos = sales.filter((s) => !s.channel);
  const salesOnline = sales.filter((s) => !!s.channel);
  const onlineTotalOmzet = salesOnline.reduce((a, s) => a + Number(s.total), 0);
```

(d) Ubah `posTotalOmzet` (sekitar baris 93) agar hanya menghitung POS:

```ts
  const posTotalOmzet = salesPos.reduce((a, s) => a + Number(s.total), 0);
```

(e) Ubah `totalTransaksi` (sekitar baris 106) agar Online ikut terhitung:

```ts
  const totalTransaksi = salesPos.length + salesOnline.length + invoices.length;
```

(f) Ubah loop "per cabang" (sekitar baris 111) agar hanya memakai POS — ganti `for (const s of sales) {` menjadi:

```ts
  for (const s of salesPos) {
```

(g) Di tabel Seksi 01, ubah baris POS agar memakai `salesPos.length`, sisipkan baris Online baru sesudahnya, dan perbaiki total gabungan:

```tsx
            <tr>
              <td>
                <span className="bge g" style={{ marginRight: 6 }}>POS</span>
                Penjualan Retail
              </td>
              <td style={{ textAlign: "right" }}>{salesPos.length.toLocaleString("id-ID")}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{rp(posTotalOmzet)}</td>
            </tr>
            <tr>
              <td>
                <span className="bge" style={{ marginRight: 6, background: "#fff1eb", color: "#ea580c" }}>Online</span>
                Marketplace &amp; WA
              </td>
              <td style={{ textAlign: "right" }}>{salesOnline.length.toLocaleString("id-ID")}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{rp(onlineTotalOmzet)}</td>
            </tr>
            <tr>
              <td>
                <span className="bge b" style={{ marginRight: 6 }}>Klinik</span>
                Invoice Medis
              </td>
              <td style={{ textAlign: "right" }}>{invoices.length.toLocaleString("id-ID")}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{rp(klinikTotalOmzet)}</td>
            </tr>
```

dan di `<tfoot>`, ubah nilai total omzet menjadi:

```tsx
              <td style={{ textAlign: "right", fontWeight: 800, fontSize: 14, color: "var(--acc)" }}>
                {rp(posTotalOmzet + onlineTotalOmzet + klinikTotalOmzet)}
              </td>
```

(h) Ubah kondisi "belum ada data" (sekitar baris 214) agar Online ikut dipertimbangkan:

```tsx
        {salesPos.length === 0 && salesOnline.length === 0 && invoices.length === 0 && (
```

- [ ] **Step 9: Jalankan seluruh test + cek tipe**

```bash
npm test && npx tsc --noEmit
```

Expected: seluruh test lolos (170 lama + test baru dari Task 2 + `resolveUnitTypes` yang diperbarui), `tsc` bersih.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/keuangan/sinkron/actions.ts" "src/app/(app)/penjualan/retur/baru/page.tsx" "src/app/(app)/penjualan/page.tsx" "src/app/(app)/keuangan/PeriodFilter.tsx" src/lib/laporan.ts src/lib/__tests__/laporan.test.ts
git commit -m "feat(penjualan): pisahkan channel online di laporan, drift & retur"
```

---

### Task 6: Verifikasi end-to-end di preview

**Files:** tidak ada perubahan file — hanya verifikasi.

**Interfaces:**
- Consumes: seluruh Task 1–5.
- Produces: bukti bahwa alur lengkap berjalan, plus catatan handoff untuk boss.

- [ ] **Step 1: Nyalakan preview**

Pakai tool `preview_start` (JANGAN jalankan dev server lewat Bash). Kalau `.claude/launch.json` belum ada, buat dengan isi:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "vetos", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3000 }
  ]
}
```

- [ ] **Step 2: Buat data uji cabang & gudang ONLINE**

Fitur ini sengaja tidak menyeed gudang online (keputusan boss belum turun). Untuk pengujian saja, buat lalu HAPUS lagi di Step 6. Pakai MCP `execute_sql`:

```sql
insert into branches (code, name, type, is_active)
values ('ONL-TEST', 'Kamo Online (uji)', 'ONLINE', true)
on conflict (code) do nothing;

insert into warehouses (branch_id, code, name, type, is_active)
select b.id, 'WH-ONL-TEST', 'WH Online (uji)', 'ONLINE', true
from branches b where b.code = 'ONL-TEST'
on conflict (code) do nothing;
```

- [ ] **Step 3: Uji order marketplace (Shopee)**

Buka `/penjualan/online/baru` di preview. Isi: channel Shopee, gudang "WH Online (uji)", nama pembeli bebas, 1 baris barang dari master SKU (qty 1). Simpan.

Verifikasi lewat MCP `execute_sql`:

```sql
select s.no_struk, s.channel, s.marketplace_status, s.total, s.shift_id, s.customer_id
from sales s where s.channel = 'Shopee' order by s.created_at desc limit 1;

select je.no_jurnal, je.source, a.code, jl.debit, jl.credit
from journal_entries je
join journal_lines jl on jl.entry_id = je.id
join coa_accounts a on a.id = jl.account_id
where je.source in ('sale-online','sale-online-hpp')
order by je.created_at desc, a.code limit 10;
```

Expected: `marketplace_status = 'piutang'`, `shift_id` NULL, `customer_id` NULL; jurnal `sale-online` berisi Dr `1202` sebesar total dan Cr `4101`; jurnal `sale-online-hpp` Dr `5101` / Cr `1301` kalau barangnya punya cost layer.

- [ ] **Step 4: Uji pencairan**

Di `/penjualan/online`, pada baris order tadi isi nominal dana cair lebih kecil dari total (misal total 100000 → isi 94000), klik "Tandai cair".

```sql
select no_struk, marketplace_status, komisi, disbursed_at from sales where channel = 'Shopee' order by created_at desc limit 1;

select a.code, jl.debit, jl.credit
from journal_entries je
join journal_lines jl on jl.entry_id = je.id
join coa_accounts a on a.id = jl.account_id
where je.source = 'sale-online-cair' order by a.code;
```

Expected: status `cair`, `komisi = 6000`; jurnal Dr `1102` 94000 + Dr `5305` 6000 / Cr `1202` 100000.

- [ ] **Step 5: Uji order WA + cek laporan & guard**

Buat satu order lagi dengan channel WA (boleh tanpa link pelanggan). Lalu cek:
- `/penjualan/online` → order WA berstatus badge "Lunas" (bukan piutang).
- `/penjualan` → Seksi 01 punya 3 baris (POS / Online / Klinik) dan Total Gabungan = penjumlahan ketiganya.
- `/penjualan/retur/baru` → cari nomor `ONL-*` milik order tadi, harus muncul pesan `Struk "ONL-..." tidak ditemukan.` (bukan form retur).
- `/keuangan/sinkron` → order online TIDAK muncul sebagai jurnal hilang.

Ambil screenshot `/penjualan/online` dan `/penjualan` sebagai bukti.

- [ ] **Step 6: Bersihkan data uji**

```sql
delete from journal_lines where entry_id in (
  select id from journal_entries where source in ('sale-online','sale-online-hpp','sale-online-cair')
);
delete from journal_entries where source in ('sale-online','sale-online-hpp','sale-online-cair');
delete from point_ledger where ref like 'ONL-%';
delete from sale_items where sale_id in (select id from sales where channel is not null);
delete from stock_layers where source_ref like 'ONL-%';
delete from sales where channel is not null;
delete from warehouses where code = 'WH-ONL-TEST';
delete from branches where code = 'ONL-TEST';
```

Verifikasi bersih:

```sql
select count(*) as sisa_order_online from sales where channel is not null;
select count(*) as sisa_gudang_uji from warehouses where code = 'WH-ONL-TEST';
```

Expected: dua-duanya 0.

> Catatan: `stock_layers` yang sudah terkonsumsi `stockOut` tidak dikembalikan qty-nya oleh skrip ini. Karena gudang uji dihapus total dan tidak dipakai gudang produksi mana pun, tidak ada dampak ke stok riil. Kalau pengujian dilakukan di gudang produksi (JANGAN), stok harus dikoreksi lewat Stok Opname.

- [ ] **Step 7: Perbarui dokumen handoff**

Di `docs/RINGKASAN-KLONING-ACCURATE-2026-07.md`:
- Tambahkan baris ke tabel status roadmap: `| 13 | Penjualan Online/B2C (channel Shopee/Tokopedia/TikTok Shop/WA, Piutang Marketplace + komisi saat cair) | ✅ | Penjualan → Penjualan online |`
- Di bagian "Sisa backlog", hapus butir 1 (Online/B2C) dan ganti dengan butir baru: `**Cabang & gudang ONLINE belum dibuat** — fitur Penjualan Online sudah jalan tapi baru bisa dipakai setelah boss menentukan nama & jumlah gudang online (dibuat sebagai master data, bukan kode).`

- [ ] **Step 8: Commit**

```bash
git add docs/RINGKASAN-KLONING-ACCURATE-2026-07.md
git commit -m "docs: tandai Penjualan Online selesai di ringkasan kloning Accurate"
```

---

## Catatan penutup

Setelah Task 6, roadmap paritas Accurate tuntas dari sisi kode. Yang tersisa adalah keputusan/kredensial dari boss (struktur gudang ONLINE, `FONNTE_TOKEN`, status PKP) — bukan pekerjaan engineering.
