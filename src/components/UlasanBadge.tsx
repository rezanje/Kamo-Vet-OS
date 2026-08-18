// Label status ulasan pelanggan. Dipakai dari dunia backoffice maupun layar kasir,
// jadi sengaja tanpa direktif — ikut lingkungan pemanggilnya.
export type StatusUlasan = { nama: string; warna: string; nada: string };

// Warna dipilih sendiri oleh manajemen di master, jadi latarnya diturunkan dari
// warna itu — bukan daftar warna tetap yang harus ikut diubah tiap ada status baru.
export function UlasanBadge({ s, size = 11 }: { s: StatusUlasan; size?: number }) {
  return (
    <span
      className="bge"
      style={{
        background: `color-mix(in srgb, ${s.warna} 13%, transparent)`,
        color: s.warna,
        border: `.5px solid color-mix(in srgb, ${s.warna} 35%, transparent)`,
        fontSize: size,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      <i className={`ti ${s.nada === "negatif" ? "ti-alert-triangle" : s.nada === "positif" ? "ti-thumb-up" : "ti-message-2"}`}
        style={{ marginRight: 4 }} />
      {s.nama}
    </span>
  );
}
