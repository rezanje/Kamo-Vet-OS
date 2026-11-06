import Link from "next/link";

// Pintu ke catatan harian. Pasien aktif: catatan bisa dikoreksi (isi lama tersimpan di riwayat
// koreksi), jadi dilabeli jelas "Lihat / Edit". Pasien pulang: terkunci, hanya "Lihat detail".
export function LogRowAction({ recordId, logId, editable }: { recordId: string; logId: string; editable: boolean }) {
  const label = editable ? "Lihat / Edit" : "Lihat detail";
  return (
    <Link href={`/klinik/rawat-inap/${recordId}/catatan/${logId}`} title={label}
      style={{ display: "inline-flex", gap: 5, padding: "4px 9px", borderRadius: 6, border: "1px solid #bfdbfe", color: "var(--posb)", background: "#fff", alignItems: "center", justifyContent: "center", textDecoration: "none", fontSize: 10.5, whiteSpace: "nowrap" }}>
      <i className={`ti ${editable ? "ti-pencil" : "ti-eye"}`} />
      {label}
    </Link>
  );
}
