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
    color: "var(--posb)",
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
  // Booking online sudah jalan sejak migrasi 0105, tapi tidak pernah ditautkan dari
  // sini — staf harus hafal URL-nya. Dilaporkan tim 2026-08-11.
  { label: "Booking online", href: "/klinik/booking" },
  { label: "Jadwal dokter", href: "/klinik/jadwal-dokter" },
  { label: "Maintenance alat medis", href: "/klinik/maintenance" },
  { label: "Pengeluaran", href: "/klinik/pengeluaran" },
  { label: "Permintaan barang", href: "/klinik/permintaan" },
  { label: "Penerimaan barang", href: "/klinik/penerimaan" },
];

// Follow up dari dokter (kontrol / vaksin berikutnya) → daftar kirim WhatsApp. Dulu hanya
// ada di tile admin, sehingga staf front desk tidak menemukannya (Aldi, 5 Nov).
function followUpHero(perlu: number | null, hariIngat: number): Hero {
  return {
    label: "FOLLOW UP",
    desc: perlu == null
      ? "Ingatkan pelanggan jadwal kontrol & vaksin lewat WhatsApp"
      : perlu > 0
        ? `${perlu} pasien perlu diingatkan via WhatsApp (H-${hariIngat})`
        : "Belum ada pasien yang perlu diingatkan",
    icon: "ti-brand-whatsapp",
    color: "#0f766e",
    tint: "#ecfdf5",
    href: `/klinik/follow-up?tab=perlu&h=${hariIngat}`,
  };
}

function HeroCard({ h, badge }: { h: Hero; badge?: number | null }) {
  const body = (
    <>
      <div
        className="skl-icon"
        style={{ background: h.tint, color: h.color, position: "relative" }}
      >
        <i className={`ti ${h.icon}`} />
        {badge ? (
          <span aria-label={`${badge} perlu diingatkan`} style={{
            position: "absolute", top: -2, right: -2, minWidth: 24, height: 24, borderRadius: 12, padding: "0 6px",
            background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
          }}>{badge > 99 ? "99+" : badge}</span>
        ) : null}
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

export function StaffKlinikHome({ fullName, followUpPerlu = null, hariIngat = 3 }: {
  fullName: string;
  /** Jumlah follow up yang perlu diingatkan; null = belum terbaca (kartu tetap tampil). */
  followUpPerlu?: number | null;
  hariIngat?: number;
}) {
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
        <HeroCard h={followUpHero(followUpPerlu, hariIngat)} badge={followUpPerlu} />

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
