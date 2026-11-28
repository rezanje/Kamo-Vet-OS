import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Penjaga pola "daftar kehilangan filter saat Kembali": tautan Kembali/Batal ke daftar yang filternya ada di
// alamat (?cari=, ?hal=, ?status= ...) wajib memakai <BackLink> (src/components/BackLink.tsx), bukan <Link>
// berhref polos yang membuang query. Lihat src/lib/back-state.ts.

const ROOT = process.cwd();
/** Parameter sekali pakai (pesan/penanda) — bukan filter. */
const SEKALI_PAKAI = new Set([
  "error", "success", "info", "edit", "sukses", "success_sup", "success_terima", "request_done", "request_scope", "posted", "hapus",
  "koreksi_error", "draft_done", "draft_scope", "draft_used", "completed_sale_id", "replace_sale", "replace_invoice", "replace_payment",
  "import_success", "recover_receipt", "hpp_sig", "hpp_warning", "struk",
]);

/** Pengecualian yang disengaja: "berkas:href" -> alasan. */
export const ALLOWLIST: Record<string, string> = {
  "src/app/(app)/pembelian/page.tsx:/": "Beranda (dashboard) tidak dicatat penjejak; ?sudut= hanya pilihan tampilan",
  "src/app/(app)/pos/struk/[saleId]/page.tsx:/pos/transaksi": "Layar kasir/transaksi (form), bukan daftar; tidak boleh menghidupkan tanggal mundur lama",
  "src/app/(app)/keuangan/persediaan-awal/page.tsx:/pos/sku/impor": "Layar proses impor (run_id) bukan daftar",
};

export function routeOf(file: string): string {
  const rel = path.relative(path.join(ROOT, "src/app"), path.dirname(file)).split(path.sep).join("/");
  return "/" + rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/");
}

export function filterKeys(source: string): string[] {
  const m = source.match(/searchParams\s*:\s*Promise<\{([^}]*)\}>/s);
  if (!m) return [];
  return [...m[1].matchAll(/(\w+)\??\s*:/g)].map((x) => x[1]).filter((k) => !SEKALI_PAKAI.has(k));
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, out); }
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

export function statefulRoutes(files: string[]): Set<string> {
  const routes = new Set<string>();
  for (const f of files) {
    if (path.basename(f) !== "page.tsx") continue;
    const route = routeOf(f);
    if (route.includes("[")) continue;
    if (filterKeys(fs.readFileSync(f, "utf8")).length) routes.add(route);
  }
  return routes;
}

const LINK = /<Link\b((?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)>(.*?)<\/Link>/gs;
const TEKS = /^\s*(<i\b[^>]*\/>\s*)?(←\s*)?(Batal|Kembali)\b/;

/** Tautan kembali/batal berhref literal ke daftar berfilter yang masih memakai <Link> polos. */
export function pelanggaran(source: string, file: string, routes: Set<string>): { href: string; line: number }[] {
  const hasil: { href: string; line: number }[] = [];
  for (const m of source.matchAll(LINK)) {
    const attrs = m[1];
    const href = attrs.match(/\bhref="(\/[^"?#]*)"/)?.[1];
    if (!href || href === "/" || !routes.has(href)) continue;
    if (!attrs.includes("back-btn") && !TEKS.test(m[2])) continue;
    if (path.basename(file) === "page.tsx" && routeOf(file) === href) continue; // tautan ke dirinya sendiri
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (ALLOWLIST[`${rel}:${href}`]) continue;
    hasil.push({ href, line: source.slice(0, m.index).split("\n").length });
  }
  return hasil;
}

describe("pemindai BackLink", () => {
  const routes = new Set(["/pos/sku", "/pembelian/faktur"]);
  const file = path.join(ROOT, "src/app/(app)/pos/sku/[id]/page.tsx");

  it("menandai Link back-btn polos ke daftar berfilter", () => {
    const src = 'a\n<Link href="/pos/sku" className="back-btn"><i className="ti ti-arrow-left" /> Barang</Link>';
    expect(pelanggaran(src, file, routes)).toEqual([{ href: "/pos/sku", line: 2 }]);
  });
  it("menandai tombol Batal/Kembali walau bukan kelas back-btn, urutan atribut bebas", () => {
    expect(pelanggaran('<Link className="btn-def" href="/pos/sku">Batal</Link>', file, routes)).toHaveLength(1);
    expect(pelanggaran('<Link href="/pembelian/faktur" className="btn-def"><i className="ti x" /> Kembali ke daftar</Link>', file, routes)).toHaveLength(1);
  });
  it("tidak menandai BackLink, daftar tanpa filter, tautan biasa, atau href berquery", () => {
    expect(pelanggaran('<BackLink href="/pos/sku" className="back-btn">Barang</BackLink>', file, routes)).toEqual([]);
    expect(pelanggaran('<Link href="/pos/kategori" className="back-btn">Kembali</Link>', file, routes)).toEqual([]);
    expect(pelanggaran('<Link href="/pos/sku" className="btn-acc">Barang Baru</Link>', file, routes)).toEqual([]);
    expect(pelanggaran('<Link href="/pos/sku?view=all" className="back-btn">Kembali</Link>', file, routes)).toEqual([]);
  });
  it("tautan ke dirinya sendiri di page.tsx daftar tidak dihitung, tetapi komponen di folder yang sama tetap", () => {
    const self = path.join(ROOT, "src/app/(app)/pos/sku/page.tsx");
    const src = '<Link href="/pos/sku" className="back-btn">Kembali</Link>';
    expect(pelanggaran(src, self, routes)).toEqual([]);
    expect(pelanggaran(src, path.join(ROOT, "src/app/(app)/pos/sku/BarangForm.tsx"), routes)).toHaveLength(1);
  });
  it("filterKeys membedakan filter dari penanda sekali pakai", () => {
    expect(filterKeys("searchParams: Promise<{ error?: string; cari?: string; success?: string }>")).toEqual(["cari"]);
    expect(filterKeys("searchParams: Promise<{ error?: string; success?: string }>")).toEqual([]);
    expect(filterKeys("tanpa searchParams")).toEqual([]);
  });
});

describe("semua tautan Kembali ke daftar berfilter memakai BackLink", () => {
  const files = [...walk(path.join(ROOT, "src/app")), ...walk(path.join(ROOT, "src/components"))];
  const routes = statefulRoutes(files);

  it("mengenali daftar berfilter yang diketahui (pemindai tidak kosong)", () => {
    for (const r of ["/pos/sku", "/pos/stok", "/pembelian/faktur", "/klinik/rekam-medis", "/crm/pelanggan", "/pengaturan/pengguna", "/crm/promo", "/keuangan/jurnal", "/klinik/antrian"]) {
      expect(routes.has(r), r).toBe(true);
    }
    expect(routes.size).toBeGreaterThan(60);
  });

  it("tidak ada <Link> polos ke daftar berfilter (kecuali yang diizinkan beralasan)", () => {
    const salah: string[] = [];
    for (const f of files) {
      for (const p of pelanggaran(fs.readFileSync(f, "utf8"), f, routes)) salah.push(`${path.relative(ROOT, f)}:${p.line} -> ${p.href}`);
    }
    expect(salah, "Ganti <Link> dengan <BackLink> dari @/components/BackLink").toEqual([]);
  });

  it("kasus Andri: detail Barang & Jasa dan formnya kembali lewat BackLink", () => {
    const detail = fs.readFileSync(path.join(ROOT, "src/app/(app)/pos/sku/[id]/page.tsx"), "utf8");
    expect(detail).toMatch(/<BackLink href="\/pos\/sku" className="back-btn">/);
    expect(detail).not.toMatch(/<Link href="\/pos\/sku"/);
    expect(fs.readFileSync(path.join(ROOT, "src/app/(app)/pos/sku/BarangForm.tsx"), "utf8")).toMatch(/<BackLink href="\/pos\/sku"/);
  });

  it("layout aplikasi dan layout kasir memasang penjejak", () => {
    expect(fs.readFileSync(path.join(ROOT, "src/app/(app)/layout.tsx"), "utf8")).toContain("<JejakDaftar />");
    expect(fs.readFileSync(path.join(ROOT, "src/app/kasir/layout.tsx"), "utf8")).toContain("<JejakDaftar />");
  });

  it("setiap entri allowlist masih menunjuk tautan yang ada", () => {
    for (const key of Object.keys(ALLOWLIST)) {
      const [file, href] = key.split(":");
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(src.includes(`href="${href}"`), key).toBe(true);
    }
  });
});
