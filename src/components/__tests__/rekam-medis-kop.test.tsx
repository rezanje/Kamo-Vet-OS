import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KOP_NAMA_CADANGAN, KOP_TAGLINE, RekamMedisKop } from "@/components/RekamMedisKop";

const html = (p: React.ComponentProps<typeof RekamMedisKop>) => renderToStaticMarkup(<RekamMedisKop {...p} />);

describe("RekamMedisKop", () => {
  it("cabang lengkap: logo cabang, nama cabang, alamat + telepon; tanpa tagline lama dan tanpa logo cakar", () => {
    const h = html({ nama: "Kamo Pets Clinic Cimanggu", alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: "0251 8888", logoUrl: "https://x.test/logo.png?token=abc" });
    expect(h).toContain("Kamo Pets Clinic Cimanggu");
    expect(h).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
    expect(h).toContain('src="https://x.test/logo.png?token=abc"');
    expect(h).toContain("data-kop-logo");
    expect(h).not.toContain("data-kop-logo-bawaan");
    expect(h).not.toContain(KOP_TAGLINE);
    expect(h).not.toContain(KOP_NAMA_CADANGAN);
  });
  it("cabang tanpa logo: logo cakar bawaan; nama cabang tetap tampil", () => {
    const h = html({ nama: "Kamo Pets Clinic Ciawi", alamat: "Jl. Ciawi 1", telepon: null, logoUrl: null });
    expect(h).toContain("data-kop-logo-bawaan");
    expect(h).toContain("ti-paw");
    expect(h).not.toContain("<img");
    expect(h).toContain("Kamo Pets Clinic Ciawi");
    expect(h).toContain("Jl. Ciawi 1");
    expect(h).not.toContain("Telp.");
  });
  it("cabang tanpa alamat dan telepon: tagline lama dipertahankan", () => {
    const h = html({ nama: "Hpy Pets Clinic Pejuang", alamat: null, telepon: "  ", logoUrl: null });
    expect(h).toContain("Hpy Pets Clinic Pejuang");
    expect(h).toContain(KOP_TAGLINE);
    expect(h).toContain("data-kop-tagline");
    expect(h).not.toContain("data-kop-kontak");
  });
  it("hanya telepon: baris kontak berisi telepon", () => {
    const h = html({ nama: "Kamo Pets Clinic Garuda", telepon: "0251 1234" });
    expect(h).toContain("Telp. 0251 1234");
    expect(h).not.toContain(KOP_TAGLINE);
  });
  it("kunjungan tanpa cabang (impor lama): nama cadangan KAMO PET CARE + tagline + logo cakar", () => {
    for (const nama of [null, undefined, "", "   "]) {
      const h = html({ nama });
      expect(h).toContain(KOP_NAMA_CADANGAN);
      expect(h).toContain(KOP_TAGLINE);
      expect(h).toContain("data-kop-logo-bawaan");
    }
  });
  it("teks cabang dilepas dari HTML (tidak menyisipkan markup)", () => {
    const h = html({ nama: "<b>Klinik</b>", alamat: "<script>alert(1)</script>" });
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<b>Klinik</b>");
    expect(h).toContain("&lt;b&gt;Klinik&lt;/b&gt;");
  });
  it("logo memakai alt kosong (dekoratif) dan ukuran tetap 46x46 agar kop tetap satu halaman A4", () => {
    const h = html({ nama: "A", logoUrl: "https://x.test/l.png" });
    expect(h).toContain('alt=""');
    expect(h).toContain("width:46px;height:46px");
    expect(h).toContain("object-fit:contain");
  });
});
