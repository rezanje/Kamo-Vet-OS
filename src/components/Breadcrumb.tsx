"use client";

// Jejak lokasi di topbar. Tiap ruas yang PUNYA halaman sungguhan bisa diklik —
// yang tidak, tetap teks biasa. Menautkan semuanya secara buta akan mengantar
// orang ke 404: sebagian jalur cuma "wadah" tanpa halaman sendiri, mis.
// /klinik/pembayaran yang isinya hanya detail per kunjungan.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODULE_LABEL, MODULES } from "@/lib/nav";
import { daftarMenu } from "@/lib/cari-global";

/** Ruas yang berupa id (uuid / angka panjang) tidak ada artinya buat dibaca. */
const idMentah = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^\d{6,}$/.test(s);

const cantik = (s: string) =>
  s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

export function Breadcrumb() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  // Halaman yang benar-benar ada: akar tiap modul + seluruh menu yang punya href.
  // Dua tile boleh menunjuk href yang sama (mis. Perintah & Hasil Stok Opname);
  // yang dipakai jejak lokasi adalah yang PERTAMA, sesuai urutan menunya.
  const menu = daftarMenu();
  const labelPerHref = new Map<string, string>();
  for (const m of menu) if (!labelPerHref.has(m.href)) labelPerHref.set(m.href, m.label);
  const adaHalaman = new Set<string>([
    ...MODULES.map((m) => `/${m.id}`),
    ...Object.keys(MODULE_LABEL).map((id) => `/${id}`),
    ...menu.map((m) => m.href),
  ]);

  const ruas = parts.map((part, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    const label = i === 0
      ? (MODULE_LABEL[part] ?? cantik(part))
      : idMentah(part) ? "Detail" : (labelPerHref.get(href) ?? cantik(part));
    // Ruas terakhir = halaman yang sedang dibuka; tidak perlu ditautkan ke dirinya.
    const bolehKlik = adaHalaman.has(href) && i < parts.length - 1;
    return { href, label, bolehKlik, terakhir: i === parts.length - 1 };
  });

  return (
    <div className="bc">
      <Link href="/" title="Dashboard" style={{ color: "inherit", display: "inline-flex" }}>
        <i className="ti ti-home" style={{ fontSize: 14 }} />
      </Link>
      {pathname === "/" ? (
        <>
          <span>/</span>
          <span style={{ color: "var(--tx)", fontWeight: 500 }}>Dashboard</span>
        </>
      ) : (
        ruas.map((r) => (
          <span key={r.href} style={{ display: "contents" }}>
            <span>/</span>
            {r.bolehKlik ? (
              <Link href={r.href}
                style={{ color: "var(--tx)", fontWeight: 500, textDecoration: "none", borderBottom: "1px dotted var(--td)" }}>
                {r.label}
              </Link>
            ) : (
              <span style={r.terakhir
                ? { color: "var(--acc)" }
                : { color: "var(--tx)", fontWeight: 500 }}>
                {r.label}
              </span>
            )}
          </span>
        ))
      )}
    </div>
  );
}
