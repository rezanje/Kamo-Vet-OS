import Link from "next/link";
import { PAYMENT_METHODS } from "@/lib/shift-calc";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export type ShiftSummaryData = {
  openingBalance: number;
  closingBalance: number;
  expectedCash: number;
  selisih: number;
  breakdown: Record<string, number>;
  cashExpenses: number;
  expenseRows: { kategori: string; deskripsi: string | null; jumlah: number }[];
};

// Kartu rincian kas setelah shift ditutup — dipakai kasir petshop & klinik.
// Kasir buta hanya berlaku SEBELUM submit; setelah kas fisik terkunci breakdown boleh dilihat.
export function ShiftSummaryCard({
  data, accent, masukLabel, doneHref,
}: {
  data: ShiftSummaryData;
  accent: string;          // warna judul section (biru POS / biru klinik)
  masukLabel: string;      // "Penjualan tunai" (petshop) / "Kas dari invoice" (klinik)
  doneHref: string;
}) {
  const { openingBalance, closingBalance, expectedCash, selisih, breakdown, cashExpenses, expenseRows } = data;
  const tunai = Number(breakdown["Tunai"] ?? 0);
  const nonTunai = PAYMENT_METHODS.filter((m) => m !== "Tunai" && Number(breakdown[m] ?? 0) > 0);

  const color = selisih === 0 ? "#15803d" : selisih > 0 ? "#1d4ed8" : "#b91c1c";
  const label = selisih === 0 ? "Kas cocok" : selisih > 0 ? "Kas lebih" : "Kas kurang";

  return (
    <div className="card pshop-card" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 480, padding: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: ".04em", marginBottom: 10 }}>
        <i className="ti ti-cash-banknote" /> RINCIAN KAS LACI
      </div>

      <Baris label="Modal awal" value={rp(openingBalance)} />
      <Baris label={masukLabel} value={`+ ${rp(tunai)}`} color="#15803d" />
      <Baris label="Pengeluaran tunai" value={cashExpenses > 0 ? `− ${rp(cashExpenses)}` : rp(0)} color={cashExpenses > 0 ? "#b91c1c" : undefined} />

      {expenseRows.length > 0 && (
        <div style={{ margin: "2px 0 6px", paddingLeft: 12, borderLeft: "2px solid var(--bd)" }}>
          {expenseRows.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "var(--tm)", padding: "1px 0" }}>
              <span>{e.deskripsi?.trim() || e.kategori}</span>
              <span style={{ whiteSpace: "nowrap" }}>{rp(Number(e.jumlah))}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--bd)", marginTop: 8, paddingTop: 8 }}>
        <Baris label="Kas seharusnya" value={rp(expectedCash)} bold />
        <Baris label="Kas fisik dihitung" value={rp(closingBalance)} bold />
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: selisih === 0 ? "#e8f5ee" : selisih > 0 ? "#eff6ff" : "#fef2f2",
        border: `.5px solid ${selisih === 0 ? "#86efac" : selisih > 0 ? "#bfdbfe" : "#fca5a5"}`,
        borderRadius: 8, padding: "10px 12px", marginTop: 10,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>
          <i className={`ti ti-${selisih === 0 ? "circle-check" : "alert-circle"}`} style={{ marginRight: 5 }} />
          {label}
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, color }}>
          {selisih > 0 ? "+" : ""}{rp(selisih)}
        </span>
      </div>

      {nonTunai.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: ".04em", margin: "16px 0 8px" }}>
            <i className="ti ti-credit-card" /> PEMBAYARAN NON-TUNAI
          </div>
          {nonTunai.map((m) => <Baris key={m} label={m} value={rp(Number(breakdown[m]))} />)}
          <div style={{ fontSize: 9, color: "var(--td)", marginTop: 4 }}>
            Tidak masuk laci — masuk rekening/EDC, bukan bagian hitungan kas fisik.
          </div>
        </>
      )}

      <Link href={doneHref} className="kpos-bayar" style={{ marginTop: 16, textDecoration: "none", background: accent }}>
        <i className="ti ti-check" /> SELESAI
      </Link>
    </div>
  );
}

function Baris({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: color ?? "var(--tx)" }}>{value}</span>
    </div>
  );
}
