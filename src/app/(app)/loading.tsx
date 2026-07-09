// Instant loading state — muncul begitu klik navigasi (App Router streaming) biar
// gak kelihatan "ngehang" nunggu server. Skeleton netral yang cocok untuk semua page.
export default function Loading() {
  return (
    <div style={{ padding: "4px 0" }}>
      <div className="sk" style={{ width: 180, height: 20, marginBottom: 14 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="sk" style={{ height: 72, borderRadius: 12 }} />)}
      </div>
      <div className="sk" style={{ height: 240, borderRadius: 12 }} />
    </div>
  );
}
