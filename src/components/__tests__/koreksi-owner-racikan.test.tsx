// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner mengoreksi komposisi racikan rawat inap walau sudah DP/bayar (migrasi 20261107120000): kartu di halaman racikan,
// aksi server (alasan >= 5 huruf, kunci permintaan, pesan Indonesia), pratinjau dampak biaya, tautan dari detail rawat inap.
const fixture = vi.hoisted(() => ({
  status: "pending", role: "OWNER", ranap: true, official: false, invoiceLines: [] as unknown[], user: true as boolean,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  rpcError: null as null | { code: string; message: string },
  rpcData: null as unknown,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); },
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user ? { id: "user-1" } : null } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, args });
    return { data: name === "read_compound_trace" ? null : fixture.rpcData, error: name === "read_compound_trace" ? { message: "denied" } : fixture.rpcError };
  },
  from: (table: string) => {
    const record = () => ({ id: "recipe", recipe_name: "Racikan fiktif", dosage_instruction: null,
      compounding_steps: "", total_volume: "7", dosage_form: "kapsul", status: fixture.status,
      compound_official_usage: fixture.official ? [{ recipe_id: "recipe" }] : [], branch_id: "branch",
      compounding_ingredients: [{ ingredient_name: "Bahan fiktif", item_id: "bahan", quantity: 2, unit: "ml" }],
      medical_records: { id: "record", visit_id: "visit", visits: { id: "visit", created_at: "2026-10-24T00:00:00Z" } },
    });
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, in() { return query; },
      range() { return query; }, limit() { return query; },
      maybeSingle: async () => ({ data: table === "clinic_compound_sales" ? null : table === "profiles" ? { role: fixture.role } : record(), error: null }),
      then(resolve: (result: unknown) => unknown) {
        const rows = table === "items"
          ? [{ id: "bahan", name: "Bahan fiktif", unit: "ml", sell_price: 1000 }, { id: "bahan2", name: "Bahan kedua", unit: "ml", sell_price: 2000 }]
          : table === "inpatient_records" ? (fixture.ranap ? [{ id: "stay" }] : [])
          : table === "invoice_items" ? fixture.invoiceLines
          : [record()];
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));
vi.mock("@/lib/clinic-compound-skus", () => ({ loadClinicCompoundSkus: async () => [], loadClinicSkuDetails: async () => ({ stock: new Map(), prices: [] }) }));
import Page from "@/app/(app)/klinik/racik/[recipeId]/page";
import { koreksiKomposisiOwner, pratinjauKoreksiOwner } from "@/app/(app)/klinik/racik/actions";
import { pesanRacikanError, KODE_RACIKAN_DITERJEMAHKAN } from "@/app/(app)/klinik/racik/racikan-error";
import { RacikanPasien } from "@/app/(app)/klinik/rawat-inap/[id]/RacikanPasien";

beforeEach(() => {
  Object.assign(fixture, { status: "pending", role: "OWNER", ranap: true, official: false, invoiceLines: [], user: true, calls: [], rpcError: null, rpcData: null });
});
async function render() {
  document.body.innerHTML = renderToStaticMarkup(await Page({ params: Promise.resolve({ recipeId: "recipe" }), searchParams: Promise.resolve({}) }));
  return document;
}
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const kartu = (doc: Document) => doc.querySelector("#koreksi-owner");
const baik = { recipeId: "recipe", visitId: "visit", ingredients: JSON.stringify([{ item_id: "bahan", quantity: 1 }]), reason: "Dosis disesuaikan", requestKey: "kunci-1" };

describe("kartu 'Koreksi komposisi (Owner)' di /klinik/racik/<id>", () => {
  it("Owner + rawat inap + pending: kartu berlabel jelas, alasan wajib, kunci permintaan, komposisi berjalan", async () => {
    const doc = await render();
    const card = kartu(doc)!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Koreksi komposisi (Owner)");
    expect(card.textContent).toMatch(/DP|pembayaran/);
    const reason = card.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
    expect(reason.required).toBe(true);
    expect(reason.minLength).toBe(5);
    expect(card.querySelector<HTMLInputElement>('input[name="ingredients"]')?.value).toBe(JSON.stringify([{ item_id: "bahan", quantity: 2 }]));
    expect(card.querySelector<HTMLInputElement>('input[name="recipeId"]')?.value).toBe("recipe");
    expect(card.querySelector("form")).not.toBeNull();
    expect(card.textContent).toMatch(/harga jual tidak berubah/i);
    expect(card.textContent).toContain("Lihat dampak biaya");
  });
  it("tetap tampil setelah 'Sudah diserahkan' (Aksi biasa hilang) dan saat ready", async () => {
    for (const status of ["ready", "handed_over"]) {
      fixture.status = status;
      expect(kartu(await render())).not.toBeNull();
    }
    expect((await render()).querySelector('details[aria-label="Aksi racikan"]')).toBeNull();
  });
  it.each([
    ["bukan Owner (ADMIN)", () => { fixture.role = "ADMIN"; }],
    ["bukan Owner (DOCTOR)", () => { fixture.role = "DOCTOR"; }],
    ["tidak login", () => { fixture.user = false; }],
    ["bukan rawat inap", () => { fixture.ranap = false; }],
    ["racikan void", () => { fixture.status = "void"; }],
    ["racikan resep resmi", () => { fixture.official = true; }],
  ])("tanpa kartu: %s", async (_label, set) => {
    set();
    expect(kartu(await render())).toBeNull();
  });
  it("racikan sudah ada di baris invoice: tanpa form, ada penjelasan 'Fase berikutnya'", async () => {
    fixture.invoiceLines = [{ id: "il", invoice_id: "inv", invoices: { id: "inv", visit_id: "visit", invoice_no: "INV-1", voided_at: null } }];
    const doc = await render();
    expect(doc.querySelector("#koreksi-owner form")).toBeNull();
    expect(doc.body.textContent).toMatch(/sudah masuk (baris )?(invoice|tagihan)/i);
  });
});

describe("aksi server koreksiKomposisiOwner", () => {
  it("memanggil clinic_owner_correct_compound dengan alasan, kunci permintaan, dan hanya item_id + jumlah", async () => {
    await expect(koreksiKomposisiOwner(form({ ...baik, ingredients: JSON.stringify([{ item_id: "bahan", quantity: "1.5", harga: 99 }]) }))).rejects.toThrow(/REDIRECT \/klinik\/racik\/recipe\?success=koreksi-owner/);
    expect(fixture.calls).toEqual([{ name: "clinic_owner_correct_compound", args: { p_recipe_id: "recipe", p_ingredients: [{ item_id: "bahan", quantity: 1.5 }], p_reason: "Dosis disesuaikan", p_request_key: "kunci-1" } }]);
  });
  it.each([["kosong", ""], ["4 huruf", "a b c d"], ["spasi", "      "]])("alasan %s ditolak tanpa memanggil RPC", async (_l, reason) => {
    await expect(koreksiKomposisiOwner(form({ ...baik, reason }))).rejects.toThrow(/REDIRECT .*error=.*Alasan/);
    expect(fixture.calls).toHaveLength(0);
  });
  it.each([
    ["tanpa kunci permintaan", { requestKey: "" }],
    ["bahan kosong", { ingredients: "[]" }],
    ["jumlah nol", { ingredients: JSON.stringify([{ item_id: "bahan", quantity: 0 }]) }],
    ["bahan ganda", { ingredients: JSON.stringify([{ item_id: "bahan", quantity: 1 }, { item_id: "bahan", quantity: 2 }]) }],
    ["JSON rusak", { ingredients: "{" }],
  ])("%s ditolak tanpa memanggil RPC", async (_l, extra) => {
    await expect(koreksiKomposisiOwner(form({ ...baik, ...extra }))).rejects.toThrow(/REDIRECT .*error=/);
    expect(fixture.calls).toHaveLength(0);
  });
  it("penolakan database jadi pesan Indonesia (kode asli di 'kode')", async () => {
    fixture.rpcError = { code: "P0001", message: "RECIPE_LINKED: racikan sudah masuk invoice (aktif atau pernah), komposisinya tidak bisa diubah dari sini" };
    const thrown = await koreksiKomposisiOwner(form(baik)).catch(e => String(e.message));
    expect(thrown).toMatch(/REDIRECT \/klinik\/racik\/recipe\?error=/);
    expect(decodeURIComponent(thrown)).toMatch(/sudah masuk invoice/i);
    expect(thrown).toContain("kode=");
  });
});

describe("pratinjau dampak biaya (baca-saja)", () => {
  it("meneruskan hasil quote RPC", async () => {
    fixture.rpcData = { cost_before: 50901, cost_after: 41800.75, price: 50000, stock: [] };
    const res = await pratinjauKoreksiOwner("recipe", [{ item_id: "bahan", quantity: 1 }]);
    expect(res).toEqual({ ok: true, data: fixture.rpcData });
    expect(fixture.calls[0]).toEqual({ name: "clinic_owner_compound_correction_quote", args: { p_recipe_id: "recipe", p_ingredients: [{ item_id: "bahan", quantity: 1 }] } });
  });
  it("galat database jadi pesan Indonesia, bukan lemparan", async () => {
    fixture.rpcError = { code: "P0001", message: "ACCESS_DENIED: koreksi komposisi racikan setelah DP/pembayaran hanya untuk Owner" };
    const res = await pratinjauKoreksiOwner("recipe", [{ item_id: "bahan", quantity: 1 }]);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.pesan).toMatch(/Owner/);
  });
  it("input tidak valid tidak memanggil RPC", async () => {
    const res = await pratinjauKoreksiOwner("recipe", [{ item_id: "bahan", quantity: 0 }]);
    expect(res.ok).toBe(false);
    expect(fixture.calls).toHaveLength(0);
  });
});

describe("pesan galat baru", () => {
  const err = (message: string) => ({ code: "P0001", message });
  it.each([
    ["NOT_INPATIENT: koreksi Owner ini hanya untuk racikan rawat inap; pakai Ubah komposisi biasa", "NOT_INPATIENT", /rawat inap/i],
    ["VISIT_CLOSED: kunjungan sudah selesai/checkout, komposisi racikan tidak bisa diubah lagi", "VISIT_CLOSED", /sudah selesai/i],
    ["NO_CHANGE: komposisi sama dengan yang sekarang, tidak ada yang diubah", "NO_CHANGE", /sama dengan/i],
    ["IDEMPOTENCY_CONFLICT: kunci permintaan sudah dipakai untuk koreksi yang berbeda", "IDEMPOTENCY_CONFLICT", /muat ulang/i],
    ["RECIPE_LINKED: racikan sudah masuk invoice (aktif atau pernah), komposisinya tidak bisa diubah dari sini", "RECIPE_LINKED", /sudah masuk baris invoice/i],
    ["RECIPE_INVALID: racikan sudah dibatalkan (void)", "RECIPE_INVALID", /void|dibatalkan/i],
    ["RECIPE_INVALID: baris racikan sudah ditarik dari tagihan", "RECIPE_INVALID", /ditarik dari tagihan/i],
    ["ACCESS_DENIED: koreksi komposisi racikan setelah DP/pembayaran hanya untuk Owner", "ACCESS_DENIED", /hanya.*Owner/i],
    ["REASON_REQUIRED: alasan koreksi wajib diisi (minimal 5 huruf, maksimal 500)", "REASON_REQUIRED", /5/],
  ])("%s", (raw, kode, pola) => {
    const hasil = pesanRacikanError(err(raw));
    expect(hasil.pesan).toMatch(pola);
    expect(hasil.pesan).not.toContain(kode);
    expect(hasil.detail).toBe(raw);
    expect(KODE_RACIKAN_DITERJEMAHKAN).toContain(kode);
  });
});

describe("RacikanPasien: tautan Owner dari detail rawat inap", () => {
  const baris = (id: string, status: string) => ({ id, recipe_name: `Racikan ${id}`, status, created_at: "2026-11-06T03:00:00Z" });
  it("Owner: tautan 'Koreksi komposisi (Owner)' ke #koreksi-owner untuk pending/ready/handed_over, bukan void", () => {
    const out = renderToStaticMarkup(<RacikanPasien owner recipes={[baris("a", "pending"), baris("b", "ready"), baris("c", "handed_over"), baris("d", "void")]} />);
    for (const id of ["a", "b", "c"]) expect(out).toContain(`href="/klinik/racik/${id}#koreksi-owner"`);
    expect(out).not.toContain("/klinik/racik/d#koreksi-owner");
    expect(out.match(/Koreksi komposisi \(Owner\)/g)).toHaveLength(3);
  });
  it("bukan Owner: tidak ada tautan Owner (perilaku lama tetap)", () => {
    const out = renderToStaticMarkup(<RacikanPasien recipes={[baris("a", "pending"), baris("c", "handed_over")]} />);
    expect(out).not.toContain("koreksi-owner");
    expect(out).toContain('href="/klinik/racik/a#aksi"');
  });
});
