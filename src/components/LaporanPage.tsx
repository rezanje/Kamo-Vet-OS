// Kerangka halaman laporan: tombol kembali, judul, baris filter, dan isi.
// Filter dikirim sebagai children `filter` karena tiap laporan beda —
// sengaja TIDAK bikin komponen filter generik yang harus dipaksa muat semuanya.
import Link from "next/link";
import type { ReactNode } from "react";

export function LaporanPage({
  icon, title, desc, filter, ringkasan, children,
}: {
  icon: string;
  title: string;
  desc: string;
  filter?: ReactNode;
  ringkasan?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/laporan" className="back-btn"><i className="ti ti-arrow-left" /> Daftar Laporan</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`ti ${icon}`} style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>{desc}</div>
        </div>
      </div>

      {filter && (
        <form className="crm-sec" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>{filter}</div>
        </form>
      )}

      {ringkasan && <div style={{ marginBottom: 12 }}>{ringkasan}</div>}

      {children}
    </>
  );
}

// Kartu angka ringkas di atas tabel — yang pertama dilihat sebelum baris detail.
export function KartuAngka({ items }: { items: { label: string; nilai: string; warna?: string }[] }) {
  return (
    <div className="crm-sec" style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 0 }}>
      {items.map((k) => (
        <div key={k.label}>
          <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: .3 }}>{k.label}</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: k.warna ?? "var(--sb)" }}>{k.nilai}</div>
        </div>
      ))}
    </div>
  );
}

export function TabelKosong({ kolom, pesan }: { kolom: number; pesan: string }) {
  return (
    <tr>
      <td colSpan={kolom} style={{ textAlign: "center", color: "var(--td)", padding: "22px 0", fontSize: 11 }}>
        {pesan}
      </td>
    </tr>
  );
}
