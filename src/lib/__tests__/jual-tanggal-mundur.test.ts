import { describe, expect, it, vi } from "vitest";
import {
  bacaBatasMundurJual, bacaTanggalMundurJual, bannerTanggalMundur, catatanStrukMundur, cetakWaktuMundur, izinkanTanggalMundur, pesanGalatMundur,
  promoKenaPadaKeranjang, tolakKombinasiMundur,
} from "../jual-tanggal-mundur";
import { posCheckoutIdentity } from "../pos-checkout-identity";

const HARI = "2026-11-18";
const form = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f; };

describe("bacaTanggalMundurJual", () => {
  it("kosong atau hari ini = jalur biasa (null)", () => {
    expect(bacaTanggalMundurJual(form({}), HARI)).toEqual({ ok: true, value: null });
    expect(bacaTanggalMundurJual(form({ tanggal_pembukuan: "  " }), HARI)).toEqual({ ok: true, value: null });
    expect(bacaTanggalMundurJual(form({ tanggal_pembukuan: HARI }), HARI)).toEqual({ ok: true, value: null });
  });
  it("kemarin + alasan: nilai terbaca, alasan dipangkas", () => {
    expect(bacaTanggalMundurJual(form({ tanggal_pembukuan: "2026-11-17", alasan_tanggal: "  Barang lupa  " }), HARI)).toEqual({ ok: true, value: { tanggal: "2026-11-17", alasan: "Barang lupa" } });
  });
  it("alasan 3..200 huruf: 2 dan 201 ditolak, 3 dan 200 lolos", () => {
    const r = (alasan: string) => bacaTanggalMundurJual(form({ tanggal_pembukuan: "2026-11-17", alasan_tanggal: alasan }), HARI);
    expect(r("ab").ok).toBe(false); expect(r("x".repeat(201)).ok).toBe(false);
    expect(r("abc").ok).toBe(true); expect(r("x".repeat(200)).ok).toBe(true);
    expect(r("   ").ok).toBe(false);
  });
  it("masa depan, tidak valid, 32 hari ditolak; tepat 31 hari lolos", () => {
    const r = (t: string) => bacaTanggalMundurJual(form({ tanggal_pembukuan: t, alasan_tanggal: "alasan" }), HARI);
    expect(r("2026-11-19")).toMatchObject({ ok: false, message: expect.stringContaining("belum tiba") });
    expect(r("2026-02-30")).toMatchObject({ ok: false, message: expect.stringContaining("tidak valid") });
    expect(r("17/11/2026")).toMatchObject({ ok: false });
    expect(r("2026-10-17")).toMatchObject({ ok: false, message: expect.stringContaining("31 hari") });
    expect(r("2026-10-18")).toMatchObject({ ok: true });
  });
});

describe("kombinasi dan promo", () => {
  it("voucher/kampanye, poin, pengganti ditolak dengan kalimat jelas; kosong = boleh", () => {
    expect(tolakKombinasiMundur({})).toBeNull();
    expect(tolakKombinasiMundur({ kodeMasuk: "HEMAT10" })).toContain("Voucher");
    expect(tolakKombinasiMundur({ poinDipakai: 1 })).toContain("Poin");
    expect(tolakKombinasiMundur({ poinDipakai: 0 })).toBeNull();
    expect(tolakKombinasiMundur({ pengganti: true, kodeMasuk: "X" })).toContain("pengganti");
  });
  it("promo kena: potongan, klaim syarat-hasil, atau hitungan promo > 0", () => {
    expect(promoKenaPadaKeranjang({ potonganPromo: [] })).toBe(false);
    expect(promoKenaPadaKeranjang({ potonganPromo: [{ potongan: 10 }] })).toBe(true);
    expect(promoKenaPadaKeranjang({ potonganPromo: [], adaKlaim: true })).toBe(true);
    expect(promoKenaPadaKeranjang({ potonganPromo: [], hitCount: 2 })).toBe(true);
    expect(promoKenaPadaKeranjang({ potonganPromo: [], hitCount: 0, adaKlaim: false })).toBe(false);
  });
});

describe("stempel, izin-pakai, batas", () => {
  it("waktu struk 23:59 WIB hari itu", () => { expect(cetakWaktuMundur("2026-11-17")).toBe("2026-11-17T23:59:00+07:00"); });
  it("izin-pakai: argumen RPC persis, sukses = null; galat database Indonesia dipakai apa adanya; galat teknis disamarkan", async () => {
    const ok = vi.fn(async () => ({ data: { authorized: true }, error: null }));
    expect(await izinkanTanggalMundur({ rpc: ok }, { branchId: "b", checkoutKey: "k", tanggal: "2026-11-17", alasan: "alasan" })).toBeNull();
    expect(ok).toHaveBeenCalledWith("pos_sale_backdate_authorize", { p_branch: "b", p_checkout_key: "k", p_date: "2026-11-17", p_reason: "alasan" });
    const no = { rpc: async () => ({ data: null, error: { message: "Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini." } }) };
    expect(await izinkanTanggalMundur(no, { branchId: "b", checkoutKey: "k", tanggal: "2026-11-17", alasan: "alasan" })).toContain("tidak punya izin");
    const tech = { rpc: async () => ({ data: null, error: { message: "permission denied for function x" } }) };
    expect(await izinkanTanggalMundur(tech, { branchId: "b", checkoutKey: "k", tanggal: "2026-11-17", alasan: "alasan" })).not.toContain("permission");
    const boom = { rpc: async () => { throw new Error("network"); } };
    expect(await izinkanTanggalMundur(boom, { branchId: "b", checkoutKey: "k", tanggal: "2026-11-17", alasan: "alasan" })).toContain("belum dapat diizinkan");
    const kosong = { rpc: async () => ({ data: { authorized: false }, error: null }) };
    expect(await izinkanTanggalMundur(kosong, { branchId: "b", checkoutKey: "k", tanggal: "2026-11-17", alasan: "alasan" })).not.toBeNull();
    expect(pesanGalatMundur("")).toContain("belum dapat diizinkan");
    expect(pesanGalatMundur("x".repeat(401))).toContain("belum dapat diizinkan");
  });
  it("batas layar: hanya bila can_backdate benar; gagal baca / bentuk aneh / min>max = null (layar tidak menampilkan apa pun)", async () => {
    const rpc = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error: error as null }) });
    const good = { today: "2026-11-18", max_date: "2026-11-17", min_date: "2026-10-18", effective_min: "2026-11-02", closed_until: "2026-11-01", can_backdate: true };
    expect(await bacaBatasMundurJual(rpc(good), "b")).toEqual({ max: "2026-11-17", min: "2026-11-02", canBackdate: true });
    expect(await bacaBatasMundurJual(rpc({ ...good, can_backdate: false }), "b")).toBeNull();
    expect(await bacaBatasMundurJual(rpc(good, { message: "x" }), "b")).toBeNull();
    expect(await bacaBatasMundurJual(rpc("x"), "b")).toBeNull();
    expect(await bacaBatasMundurJual(rpc({ ...good, effective_min: "2026-11-18" }), "b")).toBeNull();
    expect(await bacaBatasMundurJual(rpc(good), null)).toBeNull();
    expect(await bacaBatasMundurJual({ rpc: async () => { throw new Error("x"); } }, "b")).toBeNull();
  });
});

describe("tampilan struk dan banner", () => {
  it("catatan struk: tanggal real + jam WIB hanya bila dicatat beda hari; struk biasa tanpa catatan", () => {
    expect(catatanStrukMundur("2026-11-17T16:59:00Z", "2026-11-18T03:35:00Z")).toBe("Dicatat tanggal real 18/11/2026 10:35 WIB");
    expect(catatanStrukMundur("2026-11-18T03:00:00Z", "2026-11-18T03:00:20Z")).toBeNull();
    expect(catatanStrukMundur("2026-11-17T16:59:30Z", "2026-11-17T17:00:10Z")).toBeNull(); // lewat tengah malam, beberapa detik
    expect(catatanStrukMundur(null, "2026-11-18T03:00:00Z")).toBeNull();
    expect(catatanStrukMundur("2026-11-17T16:59:00Z", null)).toBeNull();
  });
  it("banner menyebut tanggal pembukuan dan hari ini", () => {
    expect(bannerTanggalMundur("2026-11-17", "2026-11-18")).toBe("Struk ini dicatat di tanggal 17/11/2026 (dicatat hari ini 18/11/2026)");
  });
});

describe("sidik jari draft", () => {
  const f = (extra: Record<string, string>) => { const d = new FormData(); d.set("checkout_key", "k"); d.set("cart", JSON.stringify([{ item_id: "i", qty: 1 }])); d.set("metode", "Tunai"); Object.entries(extra).forEach(([k, v]) => d.set(k, v)); return d; };
  it("tanpa tanggal mundur sidik jari tidak berubah; tanggal berbeda = sidik jari berbeda; alasan tidak ikut", () => {
    const a = posCheckoutIdentity(f({}), "b").fingerprint;
    expect(posCheckoutIdentity(f({ tanggal_pembukuan: "" }), "b").fingerprint).toBe(a);
    expect(posCheckoutIdentity(f({ tanggal_pembukuan: "2999-01-01" }), "b").fingerprint).toBe(a); // hari ini/masa depan bukan tanggal mundur
    const b = posCheckoutIdentity(f({ tanggal_pembukuan: "2020-01-01" }), "b").fingerprint;
    const c = posCheckoutIdentity(f({ tanggal_pembukuan: "2020-01-02" }), "b").fingerprint;
    expect(new Set([a, b, c]).size).toBe(3);
    expect(posCheckoutIdentity(f({ tanggal_pembukuan: "2020-01-01", alasan_tanggal: "lain" }), "b").fingerprint).toBe(b);
  });
});
