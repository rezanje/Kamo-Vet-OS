import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buatPenguraiKartuMedis } from "../impor-rekam-medis-pengurai";
import { tanganiUraiRekamMedis } from "../impor-rekam-medis-urai";
import { bacaWorkbooksRekamMedis } from "../impor-rekam-medis";

async function kartu(sheet: string, isi: Array<[string, unknown]>) {
  const book = new ExcelJS.Workbook();
  const lembar = book.addWorksheet(sheet);
  lembar.getCell("A1").value = "KARTU MEDIS PASIEN";
  isi.forEach(([label, nilai], index) => {
    lembar.getCell(`A${index + 2}`).value = label;
    lembar.getCell(`B${index + 2}`).value = nilai as ExcelJS.CellValue;
  });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function berkasContoh() {
  return [
    {
      fileName: "Snowy.xlsx",
      sourcePath: "Pemilik Fiktif - 0800000001/Snowy.xlsx",
      bytes: await kartu("01012026", [
        ["Nama pasien", "Snowy"], ["Nama pemilik", "Pemilik Fiktif"], ["No telepon", "0800000001"],
        ["Tanggal", "01/01/2026"], ["Jenis hewan", "Kucing"], ["Diagnosa", "Diagnosa fiktif"], ["Terapi", "Terapi fiktif"],
      ]),
    },
    {
      fileName: "Snowy.xlsx",
      sourcePath: "Pemilik Fiktif - 0800000001/Snowy.xlsx",
      bytes: await kartu("02012026", [
        ["Nama pasien", "Snowy"], ["Nama pemilik", "Pemilik Fiktif"], ["No telepon", "0800000001"],
        ["Tanggal", "02/01/2026"], ["Anamnesa", "Anamnesa fiktif"],
      ]),
    },
  ];
}

/** Worker palsu: menjalankan penangan worker yang sebenarnya lewat struktur pesan yang sama. */
function workerPalsu() {
  const pendengar = new Map<string, Array<(event: unknown) => void>>();
  const pesanTerkirim: number[] = [];
  return {
    pesanTerkirim,
    pekerja: {
      postMessage(pesan: Parameters<typeof tanganiUraiRekamMedis>[0]) {
        pesanTerkirim.push(pesan.id);
        // Tiruan structured clone: data menyeberang sebagai salinan, bukan rujukan.
        const salinan = { id: pesan.id, berkas: pesan.berkas.map((item) => ({ ...item, bytes: Uint8Array.from(item.bytes) })) };
        void tanganiUraiRekamMedis(salinan).then((jawaban) => {
          for (const dengar of pendengar.get("message") ?? []) dengar({ data: jawaban });
        });
      },
      terminate() {},
      addEventListener(tipe: string, dengar: (event: unknown) => void) {
        pendengar.set(tipe, [...(pendengar.get(tipe) ?? []), dengar]);
      },
    },
    picu(tipe: string, event: unknown) {
      for (const dengar of pendengar.get(tipe) ?? []) dengar(event);
    },
  };
}

describe("pengurai kartu medis di worker", () => {
  it("memberi hasil persis sama dengan pembacaan langsung yang dipakai server", async () => {
    const berkas = await berkasContoh();
    const langsung = await bacaWorkbooksRekamMedis(berkas.map((item) => ({ ...item, bytes: Uint8Array.from(item.bytes) })));
    const palsu = workerPalsu();
    const pengurai = buatPenguraiKartuMedis({ buatWorker: () => palsu.pekerja });
    expect(pengurai.diWorker).toBe(true);
    const lewatWorker = await pengurai.urai(berkas.map((item) => ({ ...item, bytes: Uint8Array.from(item.bytes) })));
    expect(lewatWorker).toEqual(langsung);
    expect(lewatWorker.rows).toHaveLength(2);
    expect(lewatWorker.rows.map((row) => row.record_date)).toEqual(["2026-01-01", "2026-01-02"]);
    // Profil anabul dilengkapi lintas kartu dalam folder pemilik yang sama.
    expect(lewatWorker.rows[1].species).toBe("Kucing");
  });

  it("jatuh ke pembacaan di tab saat worker tidak tersedia, dengan hasil yang sama", async () => {
    const berkas = await berkasContoh();
    const pengurai = buatPenguraiKartuMedis({ buatWorker: () => null });
    expect(pengurai.diWorker).toBe(false);
    const hasil = await pengurai.urai(berkas.map((item) => ({ ...item, bytes: Uint8Array.from(item.bytes) })));
    const langsung = await bacaWorkbooksRekamMedis(berkas.map((item) => ({ ...item, bytes: Uint8Array.from(item.bytes) })));
    expect(hasil).toEqual(langsung);
  });

  it("menahan berkas rusak tanpa menjatuhkan potongan lainnya", async () => {
    const berkas = await berkasContoh();
    const pengurai = buatPenguraiKartuMedis({ buatWorker: () => null });
    const hasil = await pengurai.urai([
      { fileName: "Rusak.xlsx", sourcePath: "Pemilik Fiktif - 0800000001/Rusak.xlsx", bytes: new Uint8Array([1, 2, 3]) },
      ...berkas.slice(0, 1).map((item) => ({ ...item, bytes: Uint8Array.from(item.bytes) })),
    ]);
    expect(hasil.rows).toHaveLength(1);
    expect(hasil.held.map((item) => item.reason)).toEqual([expect.stringContaining("gagal dibaca")]);
  });

  it("melayani beberapa potongan berurutan dan mengembalikan tiap jawaban ke peminta yang benar", async () => {
    const berkas = await berkasContoh();
    const palsu = workerPalsu();
    const pengurai = buatPenguraiKartuMedis({ buatWorker: () => palsu.pekerja });
    const [satu, dua] = await Promise.all([
      pengurai.urai([{ ...berkas[0], bytes: Uint8Array.from(berkas[0].bytes) }]),
      pengurai.urai([{ ...berkas[1], bytes: Uint8Array.from(berkas[1].bytes) }]),
    ]);
    expect(palsu.pesanTerkirim).toEqual([1, 2]);
    expect(satu.rows[0].record_date).toBe("2026-01-01");
    expect(dua.rows[0].record_date).toBe("2026-01-02");
  });

  it("menggagalkan potongan yang menunggu bila worker mati, bukan menggantung selamanya", async () => {
    const palsu = workerPalsu();
    const pengurai = buatPenguraiKartuMedis({ buatWorker: () => palsu.pekerja });
    const tertahan = { pekerja: palsu.pekerja };
    void tertahan;
    const menunggu = new Promise<unknown>((resolve) => {
      pengurai.urai([{ fileName: "A.xlsx", sourcePath: "P/A.xlsx", bytes: new Uint8Array([1]) }]).catch(resolve);
    });
    palsu.picu("error", {});
    await expect(menunggu).resolves.toBeInstanceOf(Error);
  });

  it("menolak pekerjaan baru setelah ditutup", async () => {
    const palsu = workerPalsu();
    const pengurai = buatPenguraiKartuMedis({ buatWorker: () => palsu.pekerja });
    pengurai.tutup();
    await expect(pengurai.urai([])).rejects.toThrow("sudah ditutup");
  });
});
