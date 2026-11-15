// Kartu dashboard "Perlu follow up": tiga angka (belum dihubungi) + tautan ke halaman. Hanya tampilan; angkanya dari
// fungsi database marketing_followup_ringkas lewat muatKartuMarketing (null = tidak ditampilkan).
import Link from "next/link";
import { HALAMAN_FOLLOWUP } from "@/lib/marketing-followup";
import type { KartuMarketing } from "@/lib/marketing-followup-server";

const angka = (n: number) => n.toLocaleString("id-ID");

export function KartuFollowUpDashboard({ data }: { data: KartuMarketing }) {
  if (!data) return null;
  if (data.galat !== undefined) {
    return (
      <div className="card" role="alert" data-kartu-followup-galat style={{ marginBottom: 13 }}>
        <div className="card-hd"><i className="ti ti-alert-triangle" style={{ color: "#d97706" }} /> Perlu follow up</div>
        <p style={{ fontSize: 11.5, margin: 0, color: "var(--tm)" }}>{data.galat}</p>
      </div>
    );
  }
  const butir = [
    { id: "lama", label: "Lama tidak balik", nilai: data.lama, href: `${HALAMAN_FOLLOWUP}?tab=lama`, ket: "90 hari+" },
    { id: "grooming", label: "Waktunya grooming", nilai: data.grooming, href: `${HALAMAN_FOLLOWUP}?tab=grooming`, ket: "30 hari+" },
    { id: "hari_ini", label: "Follow up hari ini", nilai: data.hariIni, href: `${HALAMAN_FOLLOWUP}?tab=hari_ini`, ket: "jadwal klinik" },
  ];
  return (
    <div className="card" data-kartu-followup style={{ marginBottom: 13 }}>
      <div className="card-hd"><i className="ti ti-message-heart" style={{ color: "#16a34a" }} /> Perlu follow up</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {butir.map(b => (
          <Link key={b.id} href={b.href} data-butir={b.id} style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{angka(b.nilai)}</div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{b.label}</div>
            <div style={{ fontSize: 10, color: "var(--tm)" }}>{b.ket}</div>
          </Link>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Yang belum dihubungi. <Link href={HALAMAN_FOLLOWUP}>Buka daftar</Link></div>
    </div>
  );
}
