const rupiah2 = (value: unknown) => `Rp${(Number(value) || 0).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NAMA_AKUN: Record<string, string> = { "600001": "HPP", "170001": "Persediaan" };
type Efek = { name?: string; delta?: number; cost?: number; direction?: string };
type BarisJurnal = { code?: string; debit?: number; credit?: number };

/** Pratinjau koreksi racikan yang SUDAH di baris tagihan: HPP sebelum/sesudah/selisih, harga dan tagihan tetap, jurnal selisih hari ini, efek stok. */
export function PratinjauTagihan({ hasil }: { hasil: Record<string, unknown> }) {
  const delta = Number(hasil.hpp_delta) || 0;
  const jurnal = (hasil.journal ?? {}) as { date?: string; lines?: BarisJurnal[] };
  const baris = Array.isArray(jurnal.lines) ? jurnal.lines : [];
  const stok = Array.isArray(hasil.stock) ? (hasil.stock as Efek[]) : [];
  return <div role="status" style={{ fontSize: 11.5, marginTop: 8, borderTop: ".5px solid #fcd34d", paddingTop: 8 }}>
    <div>Tagihan <b>{String(hasil.invoice_no ?? "-")}</b> · {String(hasil.paid_status ?? "")} · total {rupiah2(hasil.invoice_total)} (tidak berubah)</div>
    <div>HPP racikan di tagihan: <b>{rupiah2(hasil.cost_before)}</b> → <b>{rupiah2(hasil.cost_after)}</b> ({delta === 0 ? "tidak berubah" : delta < 0 ? `turun ${rupiah2(-delta)}` : `naik ${rupiah2(delta)}`})</div>
    <div>Harga jual di tagihan tetap <b>{rupiah2(hasil.price)}</b>: harga dan tagihan tidak berubah.</div>
    {hasil.price_below_hpp_after === true && <div role="alert" style={{ color: "#b91c1c", fontWeight: 600 }}>
      Setelah koreksi HPP berada di atas harga jual di tagihan ({rupiah2(hasil.net_price)}): penjualan ini rugi. Harga tidak diubah dan aturan P03 hanya menilai saat tagihan diterbitkan, jadi koreksi tetap bisa disimpan. Periksa angkanya sebelum menyimpan.
    </div>}
    {baris.length === 0
      ? <div style={{ color: "var(--tm)" }}>Selisih HPP nol: tidak ada jurnal yang dicatat.</div>
      : <div style={{ color: "var(--tm)" }}>
        Jurnal selisih HPP bertanggal hari ini ({jurnal.date ?? ""}):
        {baris.map((b, i) => <div key={i} style={{ paddingLeft: 10 }}>
          {Number(b.debit) > 0 ? "Debit" : "Kredit"} {NAMA_AKUN[String(b.code)] ?? String(b.code)} ({String(b.code)}) {rupiah2(Number(b.debit) > 0 ? b.debit : b.credit)}
        </div>)}
      </div>}
    {stok.map((efek, i) => <div key={i} style={{ color: "var(--tm)" }}>
      {efek.name}: {efek.direction === "keluar" ? "keluar dari stok" : "kembali ke stok"} {Math.abs(Number(efek.delta) || 0)} (nilai {rupiah2(efek.cost)})
    </div>)}
  </div>;
}
