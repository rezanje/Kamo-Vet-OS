import type { HistoryEvent } from "@/lib/transaction-history";

const toneClass: Record<HistoryEvent["tone"], string> = { info: "b", warn: "o", danger: "r", ok: "g" };

function when(at: string | null): string {
  if (!at) return "—";
  if (at.length === 10) {
    return new Date(`${at}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Garis waktu perubahan satu transaksi. Hanya menampilkan; semua teks dari data dilepas oleh React. */
export function TransactionHistoryPanel({ title, events, error = false, hint }: {
  title: string; events: readonly HistoryEvent[]; error?: boolean; hint?: string;
}) {
  const unresolved = events.some((event) => event.actor === "Pengguna lain");
  return (
    <div className="crm-sec" id="riwayat-perubahan" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em", marginBottom: 8 }}>
        <i className="ti ti-history" /> {title}
      </div>
      {hint && <p style={{ fontSize: 10.5, color: "var(--tm)", margin: "0 0 8px" }}>{hint}</p>}
      {error ? (
        <p role="alert" style={{ fontSize: 11.5 }}>
          <i className="ti ti-alert-circle" /> Riwayat perubahan belum dapat dimuat lengkap. Muat ulang halaman sebelum mengandalkan daftar ini.
        </p>
      ) : events.length === 0 ? (
        <p style={{ fontSize: 11.5, color: "var(--tm)" }}>Belum ada perubahan tercatat pada transaksi ini.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead><tr><th>Waktu</th><th>Oleh</th><th>Perubahan</th></tr></thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.key}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)", whiteSpace: "nowrap", verticalAlign: "top" }}>{when(event.at)}</td>
                  <td style={{ fontSize: 11, verticalAlign: "top" }}>{event.actor}</td>
                  <td style={{ fontSize: 11 }}>
                    <span className={`bge ${toneClass[event.tone]}`}>{event.label}</span>
                    {event.detail.map((line) => <div key={line} style={{ fontSize: 10.5, wordBreak: "break-word" }}>{line}</div>)}
                    {event.reason && <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Alasan: {event.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!error && unresolved && (
        <p style={{ fontSize: 10, color: "var(--td)", marginTop: 6 }}>Nama pelaku lain hanya terlihat oleh Owner/Admin.</p>
      )}
    </div>
  );
}
