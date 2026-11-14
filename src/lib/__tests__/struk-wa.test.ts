import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kirimStrukWa, pesanStrukWa, strukWaAktif } from "../wa-engine";
import { kirimStrukWaInvoiceKlinik, kirimStrukWaPenjualan } from "../struk-wa";
import { sendWA } from "../fonnte";

vi.mock("../fonnte", () => ({ sendWA: vi.fn(async () => ({ ok: true })) }));
vi.mock("next/server", () => ({ after: () => { throw new Error("outside request"); } }));

type Row = Record<string, unknown>;

/** Fiksi Supabase: tabel baca + dua fungsi struk WA (seperti kasir non-admin yang tak bisa menulis log langsung). */
function db(tables: Record<string, Row | Row[] | null>, opts: { rpcMissing?: boolean; directDenied?: boolean } = {}) {
  const logs: Row[] = [];
  const rpcCalls: { fn: string; args: Row }[] = [];
  return {
    logs, rpcCalls,
    async rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args });
      if (opts.rpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      if (fn === "wa_struk_catat") {
        const key = `receipt:${args.p_ref}`;
        if (logs.some((l) => l.idempotency_key === key)) return { data: null, error: null };
        const log = { id: `log-${logs.length + 1}`, idempotency_key: key, phone: args.p_phone, message: args.p_message, status: "queued" };
        logs.push(log);
        return { data: log.id, error: null };
      }
      const log = logs.find((l) => l.id === args.p_log_id && l.status === "queued");
      if (log) Object.assign(log, { status: args.p_sent ? "sent" : "failed", error: args.p_error });
      return { data: !!log, error: null };
    },
    from(table: string) {
      let inserted: Row | undefined, updated = false;
      const q = {
        select: () => q, eq: () => q, order: () => q,
        insert: (row: Row) => { inserted = row; return q; },
        update: () => { updated = true; return q; },
        maybeSingle: async () => {
          if (updated) return { data: { id: "direct" }, error: null };
          if (inserted) return opts.directDenied ? { data: null, error: { code: "42501", message: "rls" } } : { data: { id: "direct" }, error: null };
          const v = tables[table];
          return { data: Array.isArray(v) ? v[0] ?? null : v ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
      };
      return q;
    },
  };
}

const settings = { id: true, is_enabled: false, receipt_enabled: true };
const sale = {
  no_struk: "POS-20261114-0001", total: 90000, customer_id: "c1", branch_id: "b1", voided_at: null,
  customers: { name: "Budi", phone: "08123456789" }, branches: { name: "Kamo Petshop" },
};
const saleItems = [{ nama: "Royal Canin 2kg", qty: 1, harga: 100000 }];

beforeEach(() => { vi.mocked(sendWA).mockClear(); vi.mocked(sendWA).mockResolvedValue({ ok: true }); });

describe("struk WA otomatis setelah bayar", () => {
  it("kasir toko: struk terkirim lewat fungsi database (kasir non-admin), sekali saja", async () => {
    const d = db({ wa_engine_settings: settings, sales: sale, sale_items: saleItems }, { directDenied: true });
    expect(await kirimStrukWaPenjualan(d, "sale-1")).toEqual({ ok: true });
    expect(sendWA).toHaveBeenCalledTimes(1);
    const [phone, message] = vi.mocked(sendWA).mock.calls[0];
    expect(phone).toBe("08123456789");
    expect(message).toContain("berbelanja di Kamo Petshop");
    expect(message).toContain("Royal Canin 2kg x1 — Rp 100.000");
    expect(message).toContain("Potongan — -Rp 10.000");
    expect(message).toContain("Total: Rp 90.000");
    expect(d.logs[0]).toMatchObject({ idempotency_key: "receipt:POS-20261114-0001", status: "sent" });
    // Bayar diulang / tombol ditekan dua kali → tidak dikirim lagi.
    expect((await kirimStrukWaPenjualan(d, "sale-1")).ok).toBe(false);
    expect(sendWA).toHaveBeenCalledTimes(1);
  });

  it("pelanggan umum tanpa nomor dilewati tanpa mencatat apa pun", async () => {
    const d = db({ wa_engine_settings: settings, sales: { ...sale, customers: { name: "Umum", phone: "" } }, sale_items: saleItems });
    expect(await kirimStrukWaPenjualan(d, "sale-1")).toMatchObject({ ok: false, reason: expect.stringMatching(/nomor/) });
    expect(d.rpcCalls).toEqual([]);
    expect(sendWA).not.toHaveBeenCalled();
  });

  it("saklar struk mati → tidak dikirim walau pengingat retensi menyala", async () => {
    const d = db({ wa_engine_settings: { ...settings, is_enabled: true, receipt_enabled: false }, sales: sale, sale_items: saleItems });
    expect(await kirimStrukWaPenjualan(d, "sale-1")).toMatchObject({ ok: false });
    expect(sendWA).not.toHaveBeenCalled();
  });

  it("struk punya saklar sendiri; sebelum migrasi ikut saklar utama", () => {
    expect(strukWaAktif({ is_enabled: false, receipt_enabled: true })).toBe(true);
    expect(strukWaAktif({ is_enabled: true })).toBe(true);
    expect(strukWaAktif({ is_enabled: false })).toBe(false);
    expect(strukWaAktif(null)).toBe(false);
  });

  it("klinik: hanya invoice lunas; isi paket tampil satu baris nama paket", async () => {
    const invoice = {
      invoice_no: "INV-001", total: 150000, paid_status: "Lunas",
      visits: { customer_id: "c1", branch_id: "b1", customers: { name: "Sari", phone: "0812" }, pets: { name: "Mochi" }, branches: { name: "Kamo Vet" } },
    };
    const items = [
      { invoice_id: "i1", deskripsi: "Vaksin", qty: 1, harga: 100000, diskon_persen: 0, jenis: "obat", package_item_id: "p1", package_qty: 1, paket: { name: "Paket Sehat" } },
      { invoice_id: "i1", deskripsi: "Konsultasi", qty: 1, harga: 50000, diskon_persen: 0, jenis: "jasa", package_item_id: "p1", package_qty: 1, paket: { name: "Paket Sehat" } },
    ];
    const d = db({ wa_engine_settings: settings, invoices: invoice, invoice_items: items });
    expect(await kirimStrukWaInvoiceKlinik(d, "i1")).toEqual({ ok: true });
    const message = vi.mocked(sendWA).mock.calls[0][1];
    expect(message).toContain("bersama Mochi ke Kamo Vet");
    expect(message).toContain("Paket Sehat x1 — Rp 150.000");
    expect(message).not.toContain("Vaksin");

    vi.mocked(sendWA).mockClear();
    const dp = db({ wa_engine_settings: settings, invoices: { ...invoice, paid_status: "DP" }, invoice_items: items });
    expect(await kirimStrukWaInvoiceKlinik(dp, "i1")).toMatchObject({ ok: false });
    expect(sendWA).not.toHaveBeenCalled();
  });

  it("migrasi belum terpasang → tetap jalan dengan cara lama (tulis langsung)", async () => {
    const d = db({ wa_engine_settings: { is_enabled: true } }, { rpcMissing: true });
    const input = { invoiceNo: "X-1", customerId: "c1", phone: "0812", customerName: "A", total: 1000, items: [{ deskripsi: "A", qty: 1, harga: 1000 }] };
    expect(await kirimStrukWa(d, input)).toEqual({ ok: true });
  });

  it("biaya tambahan (mis. biaya admin) tampil sebagai Biaya lain", () => {
    const pesan = pesanStrukWa({ invoiceNo: "X", customerId: "c", phone: "1", customerName: "A", total: 1500, items: [{ deskripsi: "A", qty: 1, harga: 1000 }] });
    expect(pesan).toContain("Biaya lain — Rp 500");
  });
});

describe("kabel ke tombol Bayar", () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  it.each([
    ["app/kasir/checkout.ts", "kirimStrukWaPenjualan"],
    ["app/(app)/pos/transaksi/actions.ts", "kirimStrukWaPenjualan"],
    ["app/(app)/klinik/pembayaran/[visitId]/actions.ts", "kirimStrukWaInvoiceKlinik"],
    ["app/(app)/klinik/pembayaran/[visitId]/pelunasan-actions.ts", "kirimStrukWaInvoiceKlinik"],
    ["app/(app)/klinik/rawat-inap/[id]/tagihan/actions.ts", "kirimStrukWaInvoiceKlinik"],
  ])("%s mengirim struk WA setelah respons", (file, fn) => {
    const src = read(file);
    expect(src).toContain(`setelahResponsStruk(`);
    expect(src).toContain(`${fn}(supabase`);
  });

  it("migrasi: fungsi pencatat struk terbuka untuk akun aktif, riwayat WA tetap tertutup", () => {
    const sql = read("../supabase/migrations/20261119100000_struk_wa_semua_kasir.sql");
    expect(sql).toMatch(/add column if not exists receipt_enabled boolean not null default true/);
    expect(sql).toMatch(/function public\.wa_struk_catat[\s\S]*security definer set search_path = public/);
    expect(sql).toMatch(/grant execute on function public\.wa_struk_catat\(text, uuid, uuid, text, text\) to authenticated/);
    expect(sql).toMatch(/revoke all on function public\.wa_struk_tandai\(uuid, boolean, text\) from public, anon/);
    expect(sql).not.toMatch(/policy/i);
  });
});
