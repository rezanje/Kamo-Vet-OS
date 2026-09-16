export default function Loading() {
  return (
    <div className="crm-sec" style={{ maxWidth: 720 }}>
      <div className="p2ban" role="status" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af" }}>
        <span className="btn-spin" /> Menyiapkan impor rekam medis… Belum ada data yang disimpan.
      </div>
    </div>
  );
}
