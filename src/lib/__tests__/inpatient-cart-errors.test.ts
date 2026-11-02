import { expect, it } from "vitest";
import { parseClinicPostingError } from "../klinik-posting";
const uncertain = "Hasil penyimpanan belum dapat dipastikan.";
it.each([
  ["CART_INVALID: pilih item master aktif", "Keranjang rawat inap ditolak: pilih item master aktif"],
  ["COMPOUND_LOCKED: racikan harus lewat koreksi asli", "Racikan tersimpan terkunci: racikan harus lewat koreksi asli"],
  ["BMHP_LOCKED: ganti item ber-BMHP lewat dokter", "BMHP tersimpan terkunci: ganti item ber-BMHP lewat dokter"],
])("preserves the known atomic rejection rather than hiding %s behind uncertain save status", (message, expected) => {
  expect(parseClinicPostingError({ code:"P0001",message },uncertain)).toBe(expected);
});
it("gives a safe retry instruction for explicit PostgreSQL NOWAIT denial without leaking internals", () => {
  expect(parseClinicPostingError({ code:"55P03",message:'could not obtain lock on row in relation "items"' },uncertain))
    .toBe("Data sedang dipakai proses lain. Muat ulang tagihan, periksa hasil sebelumnya, lalu coba lagi.");
});
it("explains authoritative package-origin rejection instead of uncertain save status", () => {
  expect(parseClinicPostingError({ code:"P0001",message:"PACKAGE_INVALID: jumlah komponen tidak sesuai resep paket" },uncertain))
    .toBe("Isi atau asal paket tidak sesuai resep yang berlaku. Muat ulang tagihan lalu pilih kembali paket; jangan ubah harga bahan untuk melewati pengaman.");
});
it("retains uncertainty for transport and unknown failures, never claims a failed payment from missing response", () => {
  expect(parseClinicPostingError({ code:"504",message:"Gateway timeout" },uncertain)).toBe(uncertain);
  expect(parseClinicPostingError({ code:"P0001",message:"UNRECOGNIZED_INTERNAL_ERROR" },uncertain)).toBe(uncertain);
});
