export function ResetSimulasiForm({ role }: { role: string | null | undefined }) {
  if (role !== "OWNER") return null;
  return (
    <div className="crm-sec" style={{ borderColor: "#fecaca", background: "#fffafa" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#991b1b", marginBottom: 5 }}>
        Reset simulasi seluruh cabang
      </div>
      <p style={{ fontSize: 11.5, color: "#7f1d1d", lineHeight: 1.6, margin: 0 }}>
        Reset dijalankan pengelola setelah cadangan berhasil diuji pemulihannya.
        Seluruh transaksi, stok, saldo, pemeriksaan dan rawat inap dikosongkan.
        Akun, barang, COA, pelanggan, pasien, pemasok, karyawan dan pengaturan tetap disimpan.
      </p>
    </div>
  );
}
