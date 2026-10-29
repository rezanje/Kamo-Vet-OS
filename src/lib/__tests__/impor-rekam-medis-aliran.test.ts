import { describe, expect, it, vi } from "vitest";
import {
  BATAS_POTONGAN_AWAL,
  BATAS_POTONGAN_MINIMUM,
  MAKS_BARIS_PER_KIRIMAN,
  PelacakGandaRiwayat,
  bacaTitikSimpan,
  bagiKirimanBaris,
  csvRiwayatDitahan,
  gangguanBolehDiulang,
  hapusTitikSimpan,
  kirimDenganUlangan,
  kunciGandaRiwayat,
  kunciTitikSimpan,
  labelSisaWaktuImpor,
  labelTombolAliran,
  namaBerkasCatatanDitahan,
  perkiraanSisaWaktuImpor,
  rencanakanPotonganImpor,
  saringGandaPotongan,
  sesuaikanBatasPotongan,
  sidikRiwayat,
  sisakanFolderBelumSelesai,
  folderSelesaiTercatat,
  tandaRuangImpor,
  teksProgresImpor,
  tulisTitikSimpan,
  ukurRencanaImpor,
} from "../impor-rekam-medis-aliran";
import { kelompokkanFolderImpor, sumberFolderLokal, type FolderImporRekamMedis } from "../impor-rekam-medis-sumber";
import type { RekamMedisImporRow } from "../impor-rekam-medis";

function folder(nama: string, berkas: Array<[string, number]>): FolderImporRekamMedis {
  return {
    id: nama,
    nama,
    berkas: berkas.map(([file, ukuran]) => ({ id: `${nama}/${file}`, nama: file, jalur: `${nama}/${file}`, ukuran })),
    ukuran: berkas.reduce((jumlah, [, ukuran]) => jumlah + ukuran, 0),
  };
}

function baris(ubah: Partial<RekamMedisImporRow> = {}): RekamMedisImporRow {
  return {
    source_key: "pemilik::0800::anabul::20260101", source_file: "Anabul.xlsx", source_sheet: "01012026",
    record_no: null, record_date: "2026-01-01", patient_name: "Anabul", owner_name: "Pemilik Fiktif",
    phone: "0800000001", address: null, species: null, breed: null, gender: null, dob: null, doctor: null,
    note: null, anamnesis: "Riwayat fiktif", clinical_findings: null, diagnosis: null, therapy: null, warning: [],
    ...ubah,
  };
}

describe("titik simpan hanya mencatat folder yang tuntas", () => {
  it("folder dengan riwayat ditahan atau menunggu keputusan tidak ditandai selesai", () => {
    expect(folderSelesaiTercatat(["A"], "B", 0)).toEqual(["A", "B"]);
    // Bila tab tertutup setelah titik simpan ditulis, catatan ditahan di memori hilang.
    // Folder yang belum tuntas harus dibaca ulang saat dilanjutkan, bukan dilewati.
    expect(folderSelesaiTercatat(["A"], "B", 1)).toEqual(["A"]);
    expect(folderSelesaiTercatat(["A", "B"], "B", 0)).toEqual(["A", "B"]);
  });
});

describe("rencana potongan folder", () => {
  it("tidak pernah mencampur dua folder pemilik dalam satu potongan", () => {
    const potongan = rencanakanPotonganImpor([folder("A", [["a1.xlsx", 10], ["a2.xlsx", 10]]), folder("B", [["b1.xlsx", 10]])], { berkas: 10, bytes: 1_000 });
    expect(potongan).toHaveLength(2);
    expect(potongan.map((item) => item.folderId)).toEqual(["A", "B"]);
    expect(potongan.every((item) => item.akhirFolder)).toBe(true);
  });

  it("memecah folder besar berdasar jumlah berkas maupun total ukuran", () => {
    const perBerkas = rencanakanPotonganImpor([folder("A", Array.from({ length: 5 }, (_, i) => [`a${i}.xlsx`, 1] as [string, number]))], { berkas: 2, bytes: 1_000 });
    expect(perBerkas.map((item) => item.berkas.length)).toEqual([2, 2, 1]);
    expect(perBerkas.filter((item) => item.akhirFolder)).toHaveLength(1);
    const perUkuran = rencanakanPotonganImpor([folder("A", [["a.xlsx", 600], ["b.xlsx", 600], ["c.xlsx", 100]])], { berkas: 50, bytes: 1_000 });
    expect(perUkuran.map((item) => item.bytes)).toEqual([600, 700]);
  });

  it("memberi potongan sendiri untuk berkas yang lebih besar dari batas, tanpa melewatkannya", () => {
    const potongan = rencanakanPotonganImpor([folder("A", [["kecil.xlsx", 10], ["raksasa.xlsx", 99_000], ["kecil2.xlsx", 10]])], { berkas: 50, bytes: 1_000 });
    expect(potongan.flatMap((item) => item.berkas.map((berkas) => berkas.nama))).toEqual(["kecil.xlsx", "raksasa.xlsx", "kecil2.xlsx"]);
    expect(potongan.map((item) => item.berkas.length)).toEqual([1, 1, 1]);
  });

  it("menolak batas yang tidak masuk akal", () => {
    expect(() => rencanakanPotonganImpor([], { berkas: 0, bytes: 10 })).toThrow("Batas berkas");
    expect(() => rencanakanPotonganImpor([], { berkas: 1, bytes: 0 })).toThrow("Batas ukuran");
  });

  it("menomori potongan berurutan lintas folder", () => {
    const potongan = rencanakanPotonganImpor([folder("A", [["a.xlsx", 1], ["b.xlsx", 1]]), folder("B", [["c.xlsx", 1]])], { berkas: 1, bytes: 10 });
    expect(potongan.map((item) => item.urutan)).toEqual([0, 1, 2]);
  });
});

describe("ukuran potongan menyesuaikan kondisi", () => {
  it("mengecil saat gagal dan saat lambat, tidak pernah di bawah minimum", () => {
    const gagal = sesuaikanBatasPotongan(BATAS_POTONGAN_AWAL, { gagal: true });
    expect(gagal.berkas).toBeLessThan(BATAS_POTONGAN_AWAL.berkas);
    const lambat = sesuaikanBatasPotongan(BATAS_POTONGAN_AWAL, { durasiMs: 25_000 });
    expect(lambat.bytes).toBeLessThan(BATAS_POTONGAN_AWAL.bytes);
    let batas = BATAS_POTONGAN_AWAL;
    for (let kali = 0; kali < 12; kali += 1) batas = sesuaikanBatasPotongan(batas, { gagal: true });
    expect(batas).toEqual(BATAS_POTONGAN_MINIMUM);
  });

  it("membesar lagi saat lancar tapi berhenti di batas awal", () => {
    let batas = BATAS_POTONGAN_MINIMUM;
    for (let kali = 0; kali < 20; kali += 1) batas = sesuaikanBatasPotongan(batas, { durasiMs: 1_000 });
    expect(batas).toEqual(BATAS_POTONGAN_AWAL);
  });

  it("membiarkan batas apa adanya saat durasinya wajar", () => {
    expect(sesuaikanBatasPotongan(BATAS_POTONGAN_AWAL, { durasiMs: 10_000 })).toEqual(BATAS_POTONGAN_AWAL);
  });
});

describe("pencegahan riwayat ganda lintas potongan", () => {
  it("melewati salinan persis dan menahan bentrokan isi yang berbeda", () => {
    const pelacak = new PelacakGandaRiwayat();
    const asli = baris();
    const salinan = baris({ source_key: "lain", source_sheet: "01012026-copy" });
    const bentrok = baris({ source_key: "beda", diagnosis: "Diagnosa fiktif berbeda" });
    const hasil = saringGandaPotongan([asli, salinan, bentrok], pelacak);
    expect(hasil.siap).toHaveLength(1);
    expect(hasil.salinan).toBe(1);
    expect(hasil.ditahan).toHaveLength(1);
    expect(hasil.ditahan[0].reason).toContain("ganda");
  });

  it("tetap mengenali ganda walau barisnya datang di potongan berbeda", () => {
    const pelacak = new PelacakGandaRiwayat();
    expect(saringGandaPotongan([baris()], pelacak).siap).toHaveLength(1);
    expect(saringGandaPotongan([baris({ source_key: "lain" })], pelacak).siap).toHaveLength(0);
    expect(pelacak.jumlah).toBe(1);
  });

  it("menyamakan ejaan pemilik dan pasien seperti penilaian lama", () => {
    expect(kunciGandaRiwayat(baris({ owner_name: "Pemilik  Fiktif", phone: "0800-000-001" })))
      .toBe(kunciGandaRiwayat(baris({ owner_name: "pemilik fiktif.", phone: "0800000001" })));
  });

  it("memberi sidik berbeda untuk isi medis berbeda", () => {
    expect(sidikRiwayat(baris())).not.toBe(sidikRiwayat(baris({ therapy: "Terapi fiktif" })));
    expect(sidikRiwayat(baris())).toBe(sidikRiwayat(baris()));
  });
});

describe("titik simpan supaya impor bisa dilanjutkan", () => {
  function penyimpan() {
    const isi = new Map<string, string>();
    return {
      isi,
      getItem: (key: string) => isi.get(key) ?? null,
      setItem: (key: string, value: string) => void isi.set(key, value),
      removeItem: (key: string) => void isi.delete(key),
    };
  }

  it("menyimpan dan membaca folder yang sudah selesai", () => {
    const toko = penyimpan();
    tulisTitikSimpan(toko, "ruang", ["A", "B"]);
    expect(bacaTitikSimpan(toko, "ruang")).toEqual(["A", "B"]);
    expect([...toko.isi.keys()]).toEqual([kunciTitikSimpan("ruang")]);
    hapusTitikSimpan(toko, "ruang");
    expect(bacaTitikSimpan(toko, "ruang")).toEqual([]);
  });

  it("mengabaikan catatan rusak dan penyimpanan yang tidak tersedia", () => {
    const toko = penyimpan();
    toko.isi.set(kunciTitikSimpan("ruang"), "{bukan json");
    expect(bacaTitikSimpan(toko, "ruang")).toEqual([]);
    expect(bacaTitikSimpan(null, "ruang")).toEqual([]);
    expect(() => tulisTitikSimpan(null, "ruang", ["A"])).not.toThrow();
  });

  it("tidak menghentikan impor saat kuota penyimpanan penuh", () => {
    expect(() => tulisTitikSimpan({
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {},
    }, "ruang", ["A"])).not.toThrow();
  });

  it("memisahkan ruang untuk pilihan folder yang berbeda", () => {
    const satu = [folder("A", [["a.xlsx", 10]])];
    const dua = [folder("A", [["a.xlsx", 11]])];
    expect(tandaRuangImpor("akar", satu)).not.toBe(tandaRuangImpor("akar", dua));
    expect(tandaRuangImpor("akar", satu)).toBe(tandaRuangImpor("akar", [folder("A", [["a.xlsx", 10]])]));
  });

  it("membedakan ruang bila satu kartu diedit dengan ukuran sama (waktu ubah berbeda)", () => {
    const diubah = (waktu: number) => [{ ...folder("A", [["a.xlsx", 10]]), berkas: [{ ...folder("A", [["a.xlsx", 10]]).berkas[0], diubah: waktu }] }];
    expect(tandaRuangImpor("akar", diubah(1))).not.toBe(tandaRuangImpor("akar", diubah(2)));
    expect(tandaRuangImpor("akar", diubah(1))).toBe(tandaRuangImpor("akar", diubah(1)));
  });

  it("melewati folder yang sudah selesai tanpa membacanya lagi", () => {
    const semua = [folder("A", [["a.xlsx", 1]]), folder("B", [["b.xlsx", 1]])];
    expect(sisakanFolderBelumSelesai(semua, ["A"]).map((item) => item.id)).toEqual(["B"]);
  });
});

describe("kemajuan yang terbaca pemilik klinik", () => {
  it("menyebut folder, hasil, dan perkiraan sisa waktu dalam satu baris", () => {
    const teks = teksProgresImpor("berjalan", { selesai: 3, total: 10 }, { tersimpan: 120, sudahAda: 5, ditahan: 2, perluKeputusan: 1, dilewati: 0 }, 480_000);
    expect(teks).toContain("3 dari 10 folder");
    expect(teks).toContain("120 tersimpan");
    expect(teks).toContain("5 sudah ada");
    expect(teks).toContain("2 ditahan");
    expect(teks).toContain("1 perlu keputusan");
    expect(teks).toContain("±8 menit lagi");
  });

  it("menandai jeda, selesai, dan gangguan tanpa perkiraan waktu", () => {
    const hitungan = { tersimpan: 1, sudahAda: 0, ditahan: 0, perluKeputusan: 0, dilewati: 0 };
    expect(teksProgresImpor("jeda", { selesai: 1, total: 2 }, hitungan, 1_000)).toContain("dijeda");
    expect(teksProgresImpor("selesai", { selesai: 2, total: 2 }, hitungan, null)).toContain("selesai");
    expect(teksProgresImpor("gagal", { selesai: 1, total: 2 }, hitungan, null)).toContain("gangguan");
    expect(teksProgresImpor("jeda", { selesai: 1, total: 2 }, hitungan, 1_000)).not.toContain("lagi");
  });

  it("memberi label tombol sesuai keadaan", () => {
    expect(labelTombolAliran("siap")).toBe("Mulai impor");
    expect(labelTombolAliran("berjalan")).toBe("Jeda");
    expect(labelTombolAliran("jeda")).toBe("Lanjutkan");
    expect(labelTombolAliran("gagal")).toBe("Coba lagi");
  });

  it("menghitung sisa waktu dari kecepatan nyata, bukan tebakan", () => {
    expect(perkiraanSisaWaktuImpor(60_000, 10, 100)).toBe(540_000);
    expect(perkiraanSisaWaktuImpor(0, 10, 100)).toBeNull();
    expect(perkiraanSisaWaktuImpor(60_000, 0, 100)).toBeNull();
    expect(perkiraanSisaWaktuImpor(60_000, 100, 100)).toBeNull();
    expect(labelSisaWaktuImpor(null)).toBe("menghitung…");
    expect(labelSisaWaktuImpor(30_000)).toBe("±30 detik lagi");
    expect(labelSisaWaktuImpor(5_400_000)).toBe("±1 jam 30 menit lagi");
    expect(labelSisaWaktuImpor(7_200_000)).toBe("±2 jam lagi");
  });
});

describe("kirim ulang tanpa menggandakan", () => {
  it("mengulang gangguan jaringan lalu berhasil", async () => {
    const dicoba: number[] = [];
    const hasil = await kirimDenganUlangan(async (percobaan) => {
      dicoba.push(percobaan);
      if (percobaan < 3) throw new Error("Failed to fetch");
      return "selesai";
    }, { jedaAwalMs: 0, tidur: async () => {} });
    expect(hasil).toBe("selesai");
    expect(dicoba).toEqual([1, 2, 3]);
  });

  it("tidak mengulang penolakan yang jelas supaya tidak menumpuk kiriman", async () => {
    const kerja = vi.fn(async () => { throw new Error("Hanya OWNER/ADMIN yang boleh mengimpor rekam medis."); });
    await expect(kirimDenganUlangan(kerja, { jedaAwalMs: 0, tidur: async () => {} })).rejects.toThrow("OWNER/ADMIN");
    expect(kerja).toHaveBeenCalledTimes(1);
  });

  it("menyerah setelah batas percobaan dan menaikkan jeda antar percobaan", async () => {
    const jeda: number[] = [];
    const kerja = vi.fn(async () => { throw new Error("network error"); });
    await expect(kirimDenganUlangan(kerja, { maksPercobaan: 4, jedaAwalMs: 100, tidur: async (ms) => void jeda.push(ms) })).rejects.toThrow("network");
    expect(kerja).toHaveBeenCalledTimes(4);
    expect(jeda).toEqual([100, 200, 400]);
  });

  it("mengenali batas waktu database sebagai gangguan sementara", () => {
    expect(gangguanBolehDiulang(new Error("canceling statement due to statement timeout"))).toBe(true);
    expect(gangguanBolehDiulang(new Error("503 Service Unavailable"))).toBe(true);
    expect(gangguanBolehDiulang(new Error("Ada tanggal riwayat yang tidak valid."))).toBe(false);
  });
});

describe("catatan riwayat ditahan", () => {
  it("menyusun CSV dengan alasan per baris dan nama berkas bertanggal", () => {
    const csv = csvRiwayatDitahan([{ source_key: "k", source_file: "Anabul.xlsx", source_sheet: "01012026", reason: "Tanggal wajib diisi" }]);
    expect(csv).toContain("File");
    expect(csv).toContain("Alasan ditahan");
    expect(csv).toContain("Anabul.xlsx");
    expect(csv).toContain("Tanggal wajib diisi");
    expect(namaBerkasCatatanDitahan(new Date("2026-10-29T08:09:10Z"))).toBe("riwayat-ditahan-2026-10-29-08-09-10.csv");
  });
});

describe("sumber berkas yang bisa ditukar", () => {
  it("mengelompokkan berkas jadi folder pemilik dan mengurutkannya stabil", () => {
    const folders = kelompokkanFolderImpor([
      { id: "2", nama: "b.xlsx", jalur: "akar/Pemilik B/b.xlsx", ukuran: 2 },
      { id: "1", nama: "a2.xlsx", jalur: "akar/Pemilik A/a2.xlsx", ukuran: 3 },
      { id: "0", nama: "a1.xlsx", jalur: "akar/Pemilik A/a1.xlsx", ukuran: 1 },
    ]);
    expect(folders.map((item) => item.nama)).toEqual(["akar/Pemilik A", "akar/Pemilik B"]);
    expect(folders[0].berkas.map((item) => item.nama)).toEqual(["a1.xlsx", "a2.xlsx"]);
    expect(folders[0].ukuran).toBe(4);
  });

  it("sumber folder lokal menyaring berkas non-kartu dan membaca isi satu per satu", async () => {
    const buat = (name: string, jalur: string, isi: string) => ({
      name, size: isi.length, webkitRelativePath: jalur,
      arrayBuffer: async () => new TextEncoder().encode(isi).buffer as ArrayBuffer,
    });
    const sumber = sumberFolderLokal([
      buat("~$sementara.xlsx", "akar/P/~$sementara.xlsx", "x"),
      buat("catatan.txt", "akar/P/catatan.txt", "x"),
      buat("Anabul.xlsx", "akar/P/Anabul.xlsx", "isi-kartu"),
    ]);
    const folders = await sumber.daftarFolder();
    expect(folders).toHaveLength(1);
    expect(folders[0].berkas.map((item) => item.nama)).toEqual(["Anabul.xlsx"]);
    expect(new TextDecoder().decode(await sumber.bacaBerkas(folders[0].berkas[0]))).toBe("isi-kartu");
    await expect(sumber.bacaBerkas({ ...folders[0].berkas[0], id: "hilang" })).rejects.toThrow("tidak lagi tersedia");
  });

  it("menolak jalur yang mencoba keluar dari folder pilihan", async () => {
    const sumber = sumberFolderLokal([{
      name: "Anabul.xlsx", size: 1, webkitRelativePath: "../../etc/Anabul.xlsx",
      arrayBuffer: async () => new ArrayBuffer(1),
    }]);
    const folders = await sumber.daftarFolder();
    expect(folders[0].berkas[0].jalur).toBe("Anabul.xlsx");
  });
});

/** Dipakai scripts/ukur-impor-rekam-medis.mjs; diam saat vitest biasa. */
function laporkan(judul: string, ukuran: ReturnType<typeof ukurRencanaImpor>) {
  if (!process.env.UKUR_IMPOR_LOG) return;
  const baris = [
    `${judul}`,
    `  folder ${ukuran.folder} · kartu ${ukuran.berkas} · riwayat ${ukuran.baris} · ${(ukuran.bytes / 1024 / 1024).toFixed(0)} MB`,
    `  SEBELUM  permintaan browser ${ukuran.permintaanBrowserLama} · panggilan database ${ukuran.panggilanDatabaseLama}`,
    `  SESUDAH  permintaan browser ${ukuran.permintaanBrowser} · panggilan database ${ukuran.panggilanDatabase} (${ukuran.potongan} potongan)`,
    `  hemat    ${(ukuran.panggilanDatabaseLama / ukuran.panggilanDatabase).toFixed(0)}x panggilan database`,
  ];
  console.log(baris.join("\n"));
}

describe("pengukuran perjalanan bolak-balik", () => {
  it("memecah kiriman baris sesuai batas fungsi database", () => {
    expect(bagiKirimanBaris(Array.from({ length: 320 }, (_, i) => i)).map((item) => item.length)).toEqual([150, 150, 20]);
    expect(MAKS_BARIS_PER_KIRIMAN).toBeLessThanOrEqual(500);
    expect(() => bagiKirimanBaris([1], 0)).toThrow("minimal 1");
  });

  it("2.000 kartu / 20.000 riwayat butuh ratusan perjalanan, bukan puluhan ribu", () => {
    const folders = Array.from({ length: 200 }, (_, pemilik) =>
      folder(`Pemilik ${String(pemilik).padStart(3, "0")}`, Array.from({ length: 10 }, (_, berkas) => [`kartu-${berkas}.xlsx`, 500 * 1024] as [string, number])));
    const ukuran = ukurRencanaImpor(folders, { barisPerBerkas: 10 });
    expect(ukuran).toMatchObject({ folder: 200, berkas: 2_000, baris: 20_000 });
    expect(ukuran.permintaanBrowserLama).toBe(2_400);
    expect(ukuran.panggilanDatabaseLama).toBe(22_000);
    // Potongan dibatasi 8 MB, jadi 10 kartu @500 KB = 1 potongan per folder.
    expect(ukuran.potongan).toBe(200);
    expect(ukuran.permintaanBrowser).toBe(200);
    expect(ukuran.panggilanSimpanMassal).toBe(200);
    expect(ukuran.panggilanDatabase).toBe(400);
    expect(ukuran.panggilanDatabase).toBeLessThan(ukuran.panggilanDatabaseLama / 50);
    laporkan("2.000 kartu / 20.000 riwayat / ~1 GB", ukuran);
  });

  it("kartu kecil dipadatkan sampai batas jumlah berkas, bukan batas ukuran", () => {
    const folders = [folder("Pemilik", Array.from({ length: 100 }, (_, i) => [`k${i}.xlsx`, 1_000] as [string, number]))];
    const ukuran = ukurRencanaImpor(folders, { barisPerBerkas: 1 });
    expect(ukuran.potongan).toBe(Math.ceil(100 / BATAS_POTONGAN_AWAL.berkas));
    expect(ukuran.panggilanSimpanMassal).toBe(ukuran.potongan);
  });
});

describe("pilih beberapa folder", () => {
  const f = (jalur: string, size = 10) => ({ name: jalur.split("/").at(-1)!, size, webkitRelativePath: jalur, arrayBuffer: async () => new ArrayBuffer(0) });
  it("menggabung folder kedua tanpa dobel", async () => {
    const { gabungBerkasPilihan, daftarFolderUtama } = await import("../impor-rekam-medis-sumber");
    const a = [f("Bagian 1/Budi - 0812/Snowy.xlsx"), f("Bagian 1/Ani - 0813/Moly.xlsx")];
    const b = [f("Bagian 2/Cici - 0814/Kiki.xlsx"), f("Bagian 1/Budi - 0812/Snowy.xlsx")];
    const gabung = gabungBerkasPilihan(a, b);
    expect(gabung).toHaveLength(3);
    expect(daftarFolderUtama(gabung)).toEqual(["Bagian 1", "Bagian 2"]);
    const sumber = sumberFolderLokal(gabung);
    const folders = await sumber.daftarFolder();
    expect(folders.map((x) => x.nama)).toEqual(["Bagian 1/Ani - 0813", "Bagian 1/Budi - 0812", "Bagian 2/Cici - 0814"]);
    expect(sumber.akar).toBe("Bagian 1 + Bagian 2");
    // urutan pilih tidak mengubah tanda ruang (lanjut setelah putus tetap cocok)
    expect(sumberFolderLokal(gabungBerkasPilihan(b, a)).akar).toBe("Bagian 1 + Bagian 2");
  });
});
