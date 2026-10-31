import { describe, it, expect } from "vitest";
import { bacaCsvUmum } from "../impor-csv";
import {
  KOLOM_PELANGGAN, WAJIB_PELANGGAN, periksaPelanggan, normalTelp,
  KOLOM_PEMASOK, WAJIB_PEMASOK, periksaPemasok,
} from "../impor-master";

const bacaPelanggan = (isi: string) => {
  const r = bacaCsvUmum(isi, KOLOM_PELANGGAN, WAJIB_PELANGGAN);
  if (!r.ok) throw new Error(r.pesan);
  return r.baris;
};

describe("normalTelp", () => {
  it("menyamakan bentuk nomor yang sama", () => {
    expect(normalTelp("0812-3456-7890")).toBe("081234567890");
    expect(normalTelp("+62 812 3456 7890")).toBe("081234567890");
    expect(normalTelp("81234567890")).toBe("081234567890");
  });
  it("kosong tetap kosong", () => expect(normalTelp("")).toBe(""));
});

describe("periksaPelanggan", () => {
  const master = () => ({ kategori: new Map([["member", "kat-1"]]), telpTerpakai: new Set(["081200000000"]) });

  it("menerima baris lengkap", () => {
    const baris = bacaPelanggan("nama,telp,kategori\nBudi,0812-3456-7890,Member");
    const { siap, salah } = periksaPelanggan(baris, master());
    expect(salah).toHaveLength(0);
    expect(siap[0]).toMatchObject({ name: "Budi", phone: "081234567890", category_id: "kat-1" });
  });

  it("menolak nomor kembar di file maupun yang sudah terdaftar", () => {
    const baris = bacaPelanggan(
      "nama,telp\nBudi,081234567890\nBudi Lagi,+6281234567890\nSiti,081200000000",
    );
    const { siap, salah } = periksaPelanggan(baris, master());
    expect(siap).toHaveLength(1);
    expect(salah.map((s) => s.pesan)).toEqual([
      "Nomor HP kembar di dalam file ini",
      "Nomor HP sudah terdaftar di sistem",
    ]);
  });

  it("menolak golongan yang belum terdaftar tanpa menggugurkan baris lain", () => {
    const baris = bacaPelanggan("nama,telp,kategori\nAni,081111111111,Reseller\nBudi,082222222222,");
    const { siap, salah } = periksaPelanggan(baris, master());
    expect(siap).toHaveLength(1);
    expect(siap[0].category_id).toBeNull();
    expect(salah[0].pesan).toContain("Reseller");
  });
});

describe("periksaPemasok", () => {
  const master = () => ({ kategori: new Map([["distributor", "kp-1"]]), namaTerpakai: new Set(["pt lama"]) });
  const baca = (isi: string) => {
    const r = bacaCsvUmum(isi, KOLOM_PEMASOK, WAJIB_PEMASOK);
    if (!r.ok) throw new Error(r.pesan);
    return r.baris;
  };

  it("termin kosong jadi 30 hari", () => {
    const { siap } = periksaPemasok(baca("nama\nPT Baru"), master());
    expect(siap[0].termin_hari).toBe(30);
  });

  it("menolak nama yang sudah ada & termin di luar batas", () => {
    const { siap, salah } = periksaPemasok(
      baca("nama,termin_hari\nPT Lama,30\nPT Aneh,400\nPT Oke,14"),
      master(),
    );
    expect(siap).toHaveLength(1);
    expect(siap[0]).toMatchObject({ nama: "PT Oke", termin_hari: 14 });
    expect(salah).toHaveLength(2);
  });
});
