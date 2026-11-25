import Link from "next/link";
import { CATATAN_UANG, WARNA_STATUS, WARNA_TINGKAT } from "@/lib/komplain";
import s from "./komplain.module.css";

export function LencanaTingkat({ tingkat }: { tingkat: string }) {
  const w = WARNA_TINGKAT[tingkat] ?? WARNA_TINGKAT.Rendah;
  return <span className="bge" style={{ background: w.latar, color: w.warna }}>{tingkat}</span>;
}
export function LencanaStatus({ status }: { status: string }) {
  const w = WARNA_STATUS[status] ?? WARNA_STATUS.Baru;
  return <span className="bge" style={{ background: w.latar, color: w.warna }}>{status}</span>;
}

export type TabKomplain = "daftar" | "dashboard" | "baru" | "kategori";
const TAB: { id: TabKomplain; label: string; href: string; ikon: string }[] = [
  { id: "daftar", label: "Daftar komplain", href: "/crm/komplain", ikon: "ti-list-details" },
  { id: "dashboard", label: "Dashboard", href: "/crm/komplain/dashboard", ikon: "ti-chart-bar" },
  { id: "baru", label: "Catat komplain", href: "/crm/komplain/baru", ikon: "ti-plus" },
  { id: "kategori", label: "Kategori & pengaturan", href: "/crm/komplain/kategori", ikon: "ti-settings" },
];

/** Kepala halaman Komplain Pelanggan + pindah antar layar. `catatanUang`: tampilkan pengingat bahwa modul ini tidak menggerakkan uang/stok. */
export function KepalaKomplain({ aktif, judul, catatanUang = false }: { aktif: TabKomplain | null; judul: string; catatanUang?: boolean }) {
  return (
    <>
      <div className={s.kepala}>
        <div className={s.judul}><i className="ti ti-message-report" /> {judul}</div>
        {TAB.map(t => (
          <Link key={t.id} href={t.href} prefetch={false} className={`${s.tab}${aktif === t.id ? ` ${s.tabAktif}` : ""}`} aria-current={aktif === t.id ? "page" : undefined}>
            <i className={`ti ${t.ikon}`} /> {t.label}
          </Link>
        ))}
      </div>
      {catatanUang && <div className={s.catatan} role="note"><i className="ti ti-info-circle" /> {CATATAN_UANG}</div>}
    </>
  );
}

export function Galat({ pesan }: { pesan: string }) {
  return <div className="p2ban" role="alert" style={{ color: "#b91c1c" }}>{pesan}</div>;
}
