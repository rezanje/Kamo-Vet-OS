// U07: umpan balik instan saat pindah halaman rawat inap (pola loading rekam medis).
// Murni tampilan; tidak membaca data apa pun.
const shimmer = {
  borderRadius: 10,
  background: "linear-gradient(90deg, #f3f4f6 25%, #fafafa 50%, #f3f4f6 75%)",
  backgroundSize: "200% 100%",
  animation: "loading-shimmer 1.2s infinite",
} as const;

export function MemuatRawatInap({ judul, keterangan }: { judul: string; keterangan: string }) {
  return (
    <div className="crm-sec" aria-busy="true" aria-live="polite">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <i className="ti ti-loader-2" style={{ fontSize: 22, color: "var(--posb)", animation: "spin 1s linear infinite" }} />
        <div>
          <div style={{ fontWeight: 800, color: "var(--sb)" }}>{judul}</div>
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{keterangan}</div>
        </div>
      </div>
      <div style={{ ...shimmer, height: 88 }} />
      <div style={{ ...shimmer, height: 190, marginTop: 12 }} />
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}@keyframes loading-shimmer{to{background-position:-200% 0}}"}</style>
    </div>
  );
}
