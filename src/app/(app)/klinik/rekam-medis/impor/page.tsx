import Link from "next/link";
import { RekamMedisImportForm } from "./RekamMedisImportForm";

export default async function ImporRekamMedisPage() {
  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik/antrian" className="back-btn"><i className="ti ti-arrow-left" /> Klinik</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="ti ti-file-import" style={{ fontSize: 22, color: "#15803d" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>IMPOR REKAM MEDIS</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Baca kartu medis Excel, cek hasilnya, lalu simpan setelah disetujui</div>
        </div>
      </div>
      <RekamMedisImportForm />
    </>
  );
}
