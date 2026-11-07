// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner mengoreksi bahan racikan yang SUDAH di baris tagihan (migrasi 20261107160000): kartu di halaman racikan menggantikan
// penjelasan 'sudah masuk invoice' dengan formulir koreksi bertagihan, aksi server, pratinjau HPP/jurnal, pesan galat, tautan dari ranap.
const fixture = vi.hoisted(() => ({
  status: "handed_over", role: "OWNER", ranap: true, official: false, invoiceLines: [] as unknown[], user: true as boolean, lookupFails: false,
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
        if (table === "invoice_items" && fixture.lookupFails) return Promise.resolve({ data: null, count: null, error: { message: "gagal baca" } }).then(resolve);
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));
vi.mock("@/lib/clinic-compound-skus", () => ({ loadClinicCompoundSkus: async () => [], loadClinicSkuDetails: async () => ({ stock: new Map(), prices: [] }) }));
import Page from "@/app/(app)/klinik/racik/[recipeId]/page";
import { koreksiKomposisiOwnerTagihan, pratinjauKoreksiOwnerTagihan } from "@/app/(app)/klinik/racik/actions";
import { PratinjauTagihan } from "@/app/(app)/klinik/racik/[recipeId]/PratinjauTagihan";
import { pesanRacikanError, KODE_RACIKAN_DITERJEMAHKAN } from "@/app/(app)/klinik/racik/racikan-error";
import { RacikanPasien } from "@/app/(app)/klinik/rawat-inap/[id]/RacikanPasien";

const barisAktif = { id: "il", invoice_id: "inv", invoices: { id: "inv", visit_id: "visit", invoice_no: "INV-202611-0089", voided_at: null } };
const barisVoid = { id: "il2", invoice_id: "inv2", invoices: { id: "inv2", visit_id: "visit", invoice_no: "INV-202611-0001", voided_at: "2026-11-05T00:00:00Z" } };
beforeEach(() => {
  Object.assign(fixture, { status: "handed_over", role: "OWNER", ranap: true, official: false, invoiceLines: [], user: true, lookupFails: false, calls: [], rpcError: null, rpcData: null });
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
const baik = { recipeId: "recipe", visitId: "visit", ingredients: JSON.stringify([{ item_id: "bahan", quantity: 1 }]), reason: "Bahan ditimbang ulang", requestKey: "kunci-t1" };
const NOTICE = "Tagihan sudah terbit: HPP dan jurnal dikoreksi, harga dan tagihan tidak berubah";

describe("kartu Owner untuk racikan yang SUDAH di baris tagihan", () => {
  it("baris tagihan aktif: formulir koreksi bertagihan (bukan lagi penjelasan 'tidak bisa'), notice jelas, nomor tagihan, alasan wajib", async () => {
    fixture.invoiceLines = [barisAktif];
    const card = kartu(await render())!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain(NOTICE);
    expect(card.textContent).toContain("INV-202611-0089");
    expect(card.textContent).not.toMatch(/tidak bisa dikoreksi dari sini/);
    expect(card.querySelector("form")).not.toBeNull();
    const reason = card.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
    expect(reason.required).toBe(true);
    expect(reason.minLength).toBe(5);
    expect(card.querySelector<HTMLInputElement>('input[name="ingredients"]')?.value).toBe(JSON.stringify([{ item_id: "bahan", quantity: 2 }]));
    expect(card.querySelector<HTMLInputElement>('input[name="recipeId"]')?.value).toBe("recipe");
    expect(card.getAttribute("data-mode")).toBe("tagihan");
    expect(Array.from(card.querySelectorAll("button")).map(b => b.textContent).join("|")).toMatch(/Lihat dampak HPP dan jurnal/);
  });
  it("sebelum ditagih: kartu biasa TANPA notice tagihan (perilaku lama tetap)", async () => {
    const card = kartu(await render())!;
    expect(card).not.toBeNull();
    expect(card.textContent).not.toContain(NOTICE);
    expect(card.getAttribute("data-mode")).toBe("biasa");
  });
  it("hanya baris di invoice yang dibatalkan: tanpa form, penjelasan 'dibatalkan'", async () => {
    fixture.invoiceLines = [barisVoid];
    const doc = await render();
    expect(doc.querySelector("#koreksi-owner form")).toBeNull();
    expect(kartu(doc)!.textContent).toMatch(/dibatalkan/i);
  });
  it("campuran invoice dibatalkan + aktif: form untuk yang aktif", async () => {
    fixture.invoiceLines = [barisVoid, barisAktif];
    const card = kartu(await render())!;
    expect(card.querySelector("form")).not.toBeNull();
    expect(card.textContent).toContain("INV-202611-0089");
  });
  it("gagal membaca tautan invoice: tanpa form, minta muat ulang", async () => {
    fixture.lookupFails = true;
    const doc = await render();
    expect(doc.querySelector("#koreksi-owner form")).toBeNull();
    expect(kartu(doc)!.textContent).toMatch(/muat ulang/i);
  });
  it.each([
    ["bukan Owner (ADMIN)", () => { fixture.role = "ADMIN"; }],
    ["tidak login", () => { fixture.user = false; }],
    ["bukan rawat inap", () => { fixture.ranap = false; }],
    ["racikan void", () => { fixture.status = "void"; }],
    ["racikan resep resmi", () => { fixture.official = true; }],
  ])("tanpa kartu walau sudah ditagih: %s", async (_label, set) => {
    fixture.invoiceLines = [barisAktif];
    set();
    expect(kartu(await render())).toBeNull();
  });
});

describe("aksi server koreksiKomposisiOwnerTagihan", () => {
  it("memanggil clinic_owner_correct_compound_invoiced dengan alasan, kunci, hanya item_id + jumlah; kembali ke kartu dengan success", async () => {
    await expect(koreksiKomposisiOwnerTagihan(form({ ...baik, ingredients: JSON.stringify([{ item_id: "bahan", quantity: "1.5", harga: 99 }]) }))).rejects.toThrow(/REDIRECT \/klinik\/racik\/recipe\?success=koreksi-owner-tagihan/);
    expect(fixture.calls).toEqual([{ name: "clinic_owner_correct_compound_invoiced", args: { p_recipe_id: "recipe", p_ingredients: [{ item_id: "bahan", quantity: 1.5 }], p_reason: "Bahan ditimbang ulang", p_request_key: "kunci-t1" } }]);
  });
  it.each([["kosong", ""], ["4 huruf", "a b c d"], ["spasi", "      "]])("alasan %s ditolak tanpa memanggil RPC", async (_l, reason) => {
    await expect(koreksiKomposisiOwnerTagihan(form({ ...baik, reason }))).rejects.toThrow(/REDIRECT .*error=.*Alasan/);
    expect(fixture.calls).toHaveLength(0);
  });
  it.each([
    ["tanpa kunci permintaan", { requestKey: "" }],
    ["bahan kosong", { ingredients: "[]" }],
    ["jumlah nol", { ingredients: JSON.stringify([{ item_id: "bahan", quantity: 0 }]) }],
    ["bahan ganda", { ingredients: JSON.stringify([{ item_id: "bahan", quantity: 1 }, { item_id: "bahan", quantity: 2 }]) }],
    ["JSON rusak", { ingredients: "{" }],
  ])("%s ditolak tanpa memanggil RPC", async (_l, extra) => {
    await expect(koreksiKomposisiOwnerTagihan(form({ ...baik, ...extra }))).rejects.toThrow(/REDIRECT .*error=/);
    expect(fixture.calls).toHaveLength(0);
  });
  it("penolakan database jadi pesan Indonesia (kode asli di 'kode')", async () => {
    fixture.rpcError = { code: "P0001", message: "INVOICE_VOID: tagihan racikan ini sudah dibatalkan (void), HPP-nya tidak dikoreksi" };
    const thrown = await koreksiKomposisiOwnerTagihan(form(baik)).catch(e => String(e.message));
    expect(thrown).toMatch(/REDIRECT \/klinik\/racik\/recipe\?error=/);
    expect(decodeURIComponent(thrown)).toMatch(/dibatalkan/i);
    expect(thrown).toContain("kode=");
  });
});

describe("pratinjau dampak HPP + jurnal (baca-saja)", () => {
  it("memanggil clinic_owner_compound_invoiced_correction_quote dan meneruskan hasilnya", async () => {
    fixture.rpcData = { cost_before: 50901, cost_after: 41800.75, hpp_delta: -9100.25, price: 80000, invoice_no: "INV-202611-0089", stock: [] };
    const res = await pratinjauKoreksiOwnerTagihan("recipe", [{ item_id: "bahan", quantity: 1 }]);
    expect(res).toEqual({ ok: true, data: fixture.rpcData });
    expect(fixture.calls[0]).toEqual({ name: "clinic_owner_compound_invoiced_correction_quote", args: { p_recipe_id: "recipe", p_ingredients: [{ item_id: "bahan", quantity: 1 }] } });
  });
  it("galat database jadi pesan Indonesia, bukan lemparan", async () => {
    fixture.rpcError = { code: "P0001", message: "Periode akuntansi sampai 2026-11-07 sudah ditutup." };
    const res = await pratinjauKoreksiOwnerTagihan("recipe", [{ item_id: "bahan", quantity: 1 }]);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.pesan).toMatch(/periode.*(ditutup|terkunci)/i);
  });
  it("input tidak valid tidak memanggil RPC", async () => {
    const res = await pratinjauKoreksiOwnerTagihan("recipe", [{ item_id: "bahan", quantity: 0 }]);
    expect(res.ok).toBe(false);
    expect(fixture.calls).toHaveLength(0);
  });
});

describe("tampilan pratinjau PratinjauTagihan", () => {
  const dasar = {
    invoice_no: "INV-202611-0089", paid_status: "Belum Lunas", price: 80000, net_price: 80000, invoice_total: 875000,
    cost_before: 50901, cost_after: 41800.75, hpp_delta: -9100.25, price_below_hpp_before: false, price_below_hpp_after: false,
    journal: { date: "2026-11-07", source: "klinik-hpp-edit", lines: [{ code: "170001", debit: 9100.25, credit: 0 }, { code: "600001", debit: 0, credit: 9100.25 }] },
    stock: [{ name: "Bahan B", delta: -1, cost: 9100.25, direction: "kembali" }],
  };
  const out = (data: Record<string, unknown>) => { document.body.innerHTML = renderToStaticMarkup(<PratinjauTagihan hasil={data} />); return document.body; };
  it("HPP sebelum/sesudah/selisih, harga & tagihan tetap, jurnal selisih bertanggal hari ini, efek stok", () => {
    const text = out(dasar).textContent ?? "";
    expect(text).toContain("INV-202611-0089");
    expect(text).toContain("Belum Lunas");
    expect(text).toMatch(/Rp50\.901,00/);
    expect(text).toMatch(/Rp41\.800,75/);
    expect(text).toMatch(/turun/i);
    expect(text).toMatch(/Rp80\.000,00/);
    expect(text).toMatch(/harga.*tidak berubah/i);
    expect(text).toMatch(/Rp9\.100,25/);
    expect(text).toMatch(/Persediaan/);
    expect(text).toMatch(/Dr .*Persediaan|Debit.*Persediaan/);
    expect(text).toMatch(/Kredit.*HPP|Cr .*HPP/);
    expect(text).toContain("2026-11-07");
    expect(text).toMatch(/kembali ke stok/);
  });
  it("HPP naik: 'naik', debit HPP kredit persediaan", () => {
    const text = out({ ...dasar, cost_after: 74901, hpp_delta: 24000, journal: { date: "2026-11-07", source: "klinik-hpp-edit", lines: [{ code: "600001", debit: 24000, credit: 0 }, { code: "170001", debit: 0, credit: 24000 }] } }).textContent ?? "";
    expect(text).toMatch(/naik/i);
    expect(text).toMatch(/Rp24\.000,00/);
  });
  it("HPP baru di atas harga: peringatan tegas, tetap boleh disimpan (P03 tidak diubah)", () => {
    const body = out({ ...dasar, cost_after: 86901, hpp_delta: 36000, price_below_hpp_after: true });
    expect(body.querySelector('[role="alert"]')?.textContent ?? "").toMatch(/di atas harga|di bawah HPP/i);
  });
  it("tanpa selisih HPP: 'tidak ada jurnal'", () => {
    const text = out({ ...dasar, cost_after: 50901, hpp_delta: 0, journal: { date: "2026-11-07", source: "klinik-hpp-edit", lines: [] } }).textContent ?? "";
    expect(text).toMatch(/tidak ada jurnal/i);
  });
});

describe("pesan galat baru (koreksi bertagihan)", () => {
  const err = (message: string) => ({ code: "P0001", message });
  it.each([
    ["NOT_INVOICED: racikan ini belum masuk baris tagihan; pakai Koreksi komposisi (Owner) biasa", "NOT_INVOICED", /belum.*tagihan/i],
    ["INVOICE_VOID: tagihan racikan ini sudah dibatalkan (void), HPP-nya tidak dikoreksi", "INVOICE_VOID", /dibatalkan/i],
    ["INVOICE_PENDING: tagihan ini menunggu koreksi kasir; selesaikan koreksi kasir dulu", "INVOICE_PENDING", /koreksi kasir/i],
    ["HPP_INCONSISTENT: histori stok racikan tidak cocok dengan baris tagihan; hubungi Reza sebelum mengubah apa pun", "HPP_INCONSISTENT", /tidak cocok.*Reza|Reza/i],
    ["ACCESS_DENIED: koreksi racikan yang sudah ditagih hanya untuk Owner", "ACCESS_DENIED", /hanya.*Owner/i],
  ])("%s", (raw, kode, pola) => {
    const hasil = pesanRacikanError(err(raw));
    expect(hasil.pesan).toMatch(pola);
    expect(hasil.pesan).not.toContain(kode);
    expect(hasil.detail).toBe(raw);
    expect(KODE_RACIKAN_DITERJEMAHKAN).toContain(kode);
  });
  it.each([
    ["Periode akuntansi sampai 2026-11-07 sudah ditutup."],
    ["Periode persediaan sampai 2026-11-07 sudah ditutup. Tanggal mutasi atau koreksi harus setelah periode terkunci."],
  ])("periode terkunci: %s", raw => {
    const hasil = pesanRacikanError(err(raw));
    expect(hasil.pesan).toMatch(/periode.*(ditutup|terkunci)/i);
    expect(hasil.pesan).toMatch(/Reza/);
    expect(hasil.pesan).not.toMatch(/belum dikenali/i);
    expect(hasil.detail).toBe(raw);
  });
});

describe("RacikanPasien: tautan Owner juga untuk racikan yang sudah ditagih", () => {
  const baris = (id: string, status: string) => ({ id, recipe_name: `Racikan ${id}`, status, created_at: "2026-11-06T03:00:00Z" });
  it("Owner: penjelasan bahwa racikan yang sudah ditagih tetap bisa dikoreksi (HPP + jurnal, harga tetap)", () => {
    const out = renderToStaticMarkup(<RacikanPasien owner recipes={[baris("a", "handed_over")]} />);
    expect(out).toContain('href="/klinik/racik/a#koreksi-owner"');
    expect(out).toMatch(/sudah ditagih/i);
    expect(out).toMatch(/harga.*tidak berubah/i);
  });
  it("bukan Owner: tanpa penjelasan Owner", () => {
    const out = renderToStaticMarkup(<RacikanPasien recipes={[baris("a", "handed_over")]} />);
    expect(out).not.toMatch(/sudah ditagih/i);
  });
});
