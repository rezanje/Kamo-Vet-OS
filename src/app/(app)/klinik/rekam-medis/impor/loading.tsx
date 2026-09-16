export default function RekamMedisImportLoading() {
  return (
    <div className="crm-sec" role="status" aria-live="polite" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--posb)", fontWeight: 800, fontSize: 12 }}>
        <span className="btn-spin" /> Menyiapkan impor rekam medis…
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--tm)" }}>Tunggu sebentar. Belum ada data yang disimpan.</div>
    </div>
  );
}
