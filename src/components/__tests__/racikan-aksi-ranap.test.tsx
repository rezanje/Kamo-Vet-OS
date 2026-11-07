import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/klinik/racik/actions", () => ({ ubahKomposisiRacikan: vi.fn(), kembalikanBahanRacikan: vi.fn() }));
import { RacikanAksi } from "@/app/(app)/klinik/racik/[recipeId]/RacikanAksi";

const props = { recipeId: "r1", visitId: "v1", ingredients: [{ item_id: "i1", nama: "Bahan", qty: 2, satuan: "ml" }], materials: [] };
const detailsTag = (html: string) => /<details[^>]*>/.exec(html)![0];

describe("RacikanAksi — mudah ditemukan untuk rawat inap", () => {
  it("rawat inap: kotak Aksi terbuka sejak awal", () => {
    expect(detailsTag(renderToStaticMarkup(<RacikanAksi {...props} rawatInap />))).toMatch(/\sopen(=""|\s|>)/);
  });
  it("bukan rawat inap / tidak diketahui: tetap tertutup (perilaku lama)", () => {
    expect(detailsTag(renderToStaticMarkup(<RacikanAksi {...props} />))).not.toMatch(/\sopen/);
    expect(detailsTag(renderToStaticMarkup(<RacikanAksi {...props} rawatInap={false} />))).not.toMatch(/\sopen/);
  });
  it("anchor id='aksi' ada (tujuan tautan #aksi)", () => {
    expect(detailsTag(renderToStaticMarkup(<RacikanAksi {...props} />))).toContain('id="aksi"');
  });
  it("label terlihat: 'Kembalikan bahan (void racikan)' pada judul bagian dan tombol", () => {
    const html = renderToStaticMarkup(<RacikanAksi {...props} rawatInap />);
    expect(html.match(/Kembalikan bahan \(void racikan\)/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Koreksi / Kembalikan bahan");
    expect(html).toContain("Ubah komposisi");
  });
  it("tanpa alasan wajib tetap ada pada kedua form (tidak ada pelonggaran)", () => {
    const html = renderToStaticMarkup(<RacikanAksi {...props} rawatInap />);
    expect(html.match(/<textarea[^>]*required/g)).toHaveLength(2);
  });
});
