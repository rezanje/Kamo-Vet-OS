export default function LoadingRiwayatPasien() {
  return (
    <div className="crm-sec" aria-busy="true" aria-live="polite">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <i className="ti ti-loader-2" style={{ fontSize: 22, color: "var(--posb)", animation: "spin 1s linear infinite" }} />
        <div>
          <div style={{ fontWeight: 800, color: "var(--sb)" }}>Memuat riwayat pasien…</div>
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>Mengumpulkan semua kunjungan hewan ini.</div>
        </div>
      </div>
      <div style={{ height: 110, borderRadius: 10, background: "linear-gradient(90deg, #f3f4f6 25%, #fafafa 50%, #f3f4f6 75%)", backgroundSize: "200% 100%", animation: "loading-shimmer 1.2s infinite" }} />
      <div style={{ height: 150, borderRadius: 10, marginTop: 12, background: "linear-gradient(90deg, #f3f4f6 25%, #fafafa 50%, #f3f4f6 75%)", backgroundSize: "200% 100%", animation: "loading-shimmer 1.2s infinite" }} />
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}@keyframes loading-shimmer{to{background-position:-200% 0}}"}</style>
    </div>
  );
}
