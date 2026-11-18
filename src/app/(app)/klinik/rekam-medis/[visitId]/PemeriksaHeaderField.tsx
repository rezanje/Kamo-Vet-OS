/** Baris "Dokter pemeriksa" di header Rekam Medis (visits.pemeriksa_id; baca saja). Tidak tampil bila belum ada / gagal dibaca. */
export function PemeriksaHeaderField({ nama }: { nama: string | null }) {
  if (!nama) return null;
  return (
    <div data-testid="rekam-pemeriksa">
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>Dokter pemeriksa</div>
      <div style={{ fontSize: 12 }}>{nama}</div>
    </div>
  );
}
