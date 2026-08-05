import { describe, it, expect } from "vitest";
import { bacaPets, MAKS_HEWAN, petKosong, ringkasRombongan, susunKeluhan } from "../rombongan";

const pet = (o: Partial<ReturnType<typeof petKosong>> = {}) =>
  ({ ...petKosong(), name: "Michi", species: "Kucing", ...o });

const baca = (arr: unknown[]) => bacaPets(JSON.stringify(arr));

describe("bacaPets", () => {
  it("tiga hewan sekali daftar", () => {
    const r = baca([pet({ name: "Michi" }), pet({ name: "Iju" }), pet({ name: "Bruno" })]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pets.map((p) => p.name)).toEqual(["Michi", "Iju", "Bruno"]);
  });

  it("daftar kosong ditolak", () => {
    expect(baca([]).ok).toBe(false);
    expect(bacaPets("bukan json").ok).toBe(false);
  });

  it("nama kosong disebut nomor urutnya, bukan sekadar 'ada yang kosong'", () => {
    const r = baca([pet({ name: "Michi" }), pet({ name: "" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toContain("ke-2");
  });

  it("nama kembar dalam satu pendaftaran ditolak", () => {
    // Diteruskan pun keduanya menunjuk kartu anabul yang sama — dua kunjungan
    // menumpuk di satu hewan dan riwayatnya jadi campur.
    const r = baca([pet({ name: "Michi" }), pet({ name: "michi" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toContain("dua kali");
  });

  it("satu hewan salah menggugurkan seluruh pendaftaran", () => {
    // Sengaja beda dari impor CSV: rombongan yang masuk separuh meninggalkan
    // antrian tidak lengkap dan staf tidak tahu harus mengulang dari mana.
    const r = baca([pet({ name: "Michi" }), pet({ name: "Iju", weight: -3 })]);
    expect(r.ok).toBe(false);
  });

  it("berat kosong boleh, berat ngawur ditolak", () => {
    expect(baca([pet({ weight: null })]).ok).toBe(true);
    expect(baca([pet({ weight: 4.2 })]).ok).toBe(true);
    expect(baca([pet({ weight: "gemuk" as never })]).ok).toBe(false);
  });

  it("jumlah hewan dibatasi", () => {
    const banyak = Array.from({ length: MAKS_HEWAN + 1 }, (_, i) => pet({ name: `Kucing ${i}` }));
    expect(baca(banyak).ok).toBe(false);
  });

  it("anabul lama dibawa lewat id-nya", () => {
    const r = baca([pet({ id: "pet-1", name: "Michi" })]);
    expect(r.ok && r.pets[0].id).toBe("pet-1");
  });
});

describe("susunKeluhan", () => {
  it("kunjungan baru: keluhan apa adanya", () => {
    expect(susunKeluhan("Batuk", "baru", "Kontrol jahitan")).toBe("Batuk");
  });

  it("kontrol: tujuan ditempel di belakang keluhan", () => {
    expect(susunKeluhan("Batuk", "ulang", "Kontrol jahitan")).toBe("Batuk [Kontrol: Kontrol jahitan]");
  });

  it("kontrol tanpa keluhan tetap menyimpan tujuannya", () => {
    expect(susunKeluhan("", "ulang", "Angkat jahitan")).toBe("[Kontrol: Angkat jahitan]");
  });

  it("kosong semua jadi null, bukan string kosong", () => {
    expect(susunKeluhan("", "baru", "")).toBeNull();
  });
});

describe("ringkasRombongan", () => {
  it("satu hewan tampil namanya saja", () => {
    expect(ringkasRombongan(["Michi"])).toBe("Michi");
  });

  it("rombongan tampil jumlah + daftar nama", () => {
    expect(ringkasRombongan(["Michi", "Iju", "Bruno"])).toBe("3 pasien · Michi, Iju, Bruno");
  });
});
