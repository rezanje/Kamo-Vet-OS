import Link from "next/link";
import { notFound } from "next/navigation";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { KONFIG, isJenisImpor } from "@/lib/impor-jenis";
import { ImporMasterForm } from "./ImporMasterForm";

// Satu layar untuk semua impor master data; jenisnya dari alamat halaman.
// Tombol masuknya ditaruh di masing-masing menu datanya.
export default async function ImporMasterPage({
  params, searchParams,
}: {
  params: Promise<{ jenis: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { jenis } = await params;
  const { error } = await searchParams;
  if (!isJenisImpor(jenis)) notFound();

  const konfig = KONFIG[jenis];
  const boleh = await bolehKelolaMaster();

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href={konfig.kembali} className="back-btn">
          <i className="ti ti-arrow-left" /> {konfig.kembaliLabel}
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`ti ${konfig.ikon}`} style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>{konfig.judul}</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>{konfig.desc}</div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {!boleh ? (
        <div className="p2ban">
          <i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang boleh mengimpor data.
        </div>
      ) : (
        <>
          <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af" }}>
            <i className="ti ti-bulb" /> Dari Excel: <b>File → Save As → CSV</b>, lalu pilih filenya di bawah.
            Baris yang bermasalah dilewati dan dilaporkan — sisanya tetap masuk.
          </div>
          <ImporMasterForm jenis={jenis} konfig={konfig} />
        </>
      )}
    </>
  );
}
