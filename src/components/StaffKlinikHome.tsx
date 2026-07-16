"use client";

import Link from "next/link";

// Layar sambutan staff klinik (design-reference: KAMO CLINIC "Selamat Datang").
// Muncul di /klinik untuk role STAFF setelah mulai shift — 4 kartu besar +
// tombol selesai shift. Admin/owner tetap dapat tile-grid ModuleHome.

type Hero = {
  label: string;
  desc: string;
  icon: string;
  color: string; // warna aksen kartu
  tint: string; // background lingkaran ikon
  href?: string;
};

const HERO: Hero[] = [
  {
    label: "PENDAFTARAN",
    desc: "Tambah & kelola pendaftaran pasien baru",
    icon: "ti-file-plus",
    color: "#2563eb",
    tint: "#eff6ff",
    href: "/klinik/registrasi",
  },
  {
    label: "ANTRIAN",
    desc: "Lihat & kelola antrian pasien",
    icon: "ti-users",
    color: "#16a34a",
    tint: "#e8f5ee",
    href: "/klinik/antrian",
  },
  {
    label: "RAWAT INAP",
    desc: "Kelola pasien rawat inap",
    icon: "ti-bed",
    color: "#d97706",
    tint: "#fffbeb",
    href: "/klinik/rawat-inap",
  },
];

// Kartu "Lain-lain" = fitur klinik sisanya. href kalau sudah ada halaman.
const LAINLAIN: { label: string; href?: string }[] = [
  { label: "Racik obat", href: "/klinik/racik" },
  { label: "Pengeluaran", href: "/klinik/pengeluaran" },
  { label: "Permintaan barang", href: "/klinik/permintaan" },
  { label: "Penerimaan barang", href: "/klinik/penerimaan" },
];

function HeroCard({ h }: { h: Hero }) {
  const body = (
    <>
      <div
        className="skl-icon"
        style={{ background: h.tint, color: h.color }}
      >
        <i className={`ti ${h.icon}`} />
      </div>
      <div className="skl-title" style={{ color: h.color }}>
        {h.label}
      </div>
      <div className="skl-desc">{h.desc}</div>
    </>
  );
  return h.href ? (
    <Link href={h.href} className="skl-card">
      {body}
    </Link>
  ) : (
    <div className="skl-card">{body}</div>
  );
}

export function StaffKlinikHome({ fullName }: { fullName: string }) {
  return (
    <div className="skl-wrap">
      {/* watermark paw + plus (dekoratif, ala referensi KAMO CLINIC) */}
      <i className="ti ti-paw skl-deco" style={{ top: "12%", left: "6%", fontSize: 90 }} />
      <i className="ti ti-paw skl-deco" style={{ bottom: "10%", left: "12%", fontSize: 60 }} />
      <i className="ti ti-paw skl-deco" style={{ bottom: "16%", right: "8%", fontSize: 96 }} />
      <i className="ti ti-plus skl-deco" style={{ top: "18%", right: "10%", fontSize: 54 }} />
      <i className="ti ti-plus skl-deco" style={{ bottom: "8%", right: "26%", fontSize: 40 }} />

      <div className="skl-hero-head">
        <div className="skl-welcome">Selamat Datang!</div>
        <div className="skl-sub">Sistem Informasi Klinik Hewan</div>
        <div className="skl-hint">Silakan pilih menu untuk memulai, {fullName}.</div>
      </div>

      <div className="skl-grid">
        {HERO.map((h) => (
          <HeroCard key={h.label} h={h} />
        ))}

        {/* LAIN-LAIN: kartu ungu berisi daftar fitur klinik lain */}
        <div className="skl-card">
          <div className="skl-icon" style={{ background: "#f3f0ff", color: "#7c3aed" }}>
            <i className="ti ti-shopping-cart" />
          </div>
          <div className="skl-title" style={{ color: "#7c3aed" }}>
            LAIN-LAIN
          </div>
          <ul className="skl-list">
            {LAINLAIN.map((f) =>
              f.href ? (
                <li key={f.label}>
                  <Link href={f.href}>{f.label}</Link>
                </li>
              ) : (
                <li
                  key={f.label}
                  className="skl-soon"
                  onClick={() => alert(`${f.label} — halaman ini dalam pengembangan.`)}
                >
                  {f.label}
                </li>
              ),
            )}
          </ul>
        </div>
      </div>

      <Link href="/klinik/shift" className="skl-selesai">
        <i className="ti ti-logout" /> SELESAI SHIFT
      </Link>
    </div>
  );
}
