import { HPP_CONFIRM_FIELD } from "@/lib/hpp-warning";

/**
 * P03: peringatan jual di bawah HPP untuk back office / grosir. Tidak memblokir, tetapi kotak
 * konfirmasi wajib dicentang sebelum formulir bisa disimpan lagi. Tanpa peringatan → kosong.
 */
export function HppConfirmField({ warning, signature }: { warning?: string | null; signature?: string | null }) {
  if (!warning || !signature) return null;
  return (
    <div role="alert" className="p2ban" style={{ margin: "8px 0", background: "#fef3c7", color: "#92400e", border: "1px solid #f59e0b" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Peringatan: jual di bawah HPP</div>
      <div style={{ fontSize: 12 }}>{warning}</div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontSize: 12, fontWeight: 600 }}>
        <input type="checkbox" name={HPP_CONFIRM_FIELD} value={signature} required data-draft-ignore />
        Saya paham penjualan ini di bawah HPP dan tetap ingin menyimpannya.
      </label>
    </div>
  );
}
