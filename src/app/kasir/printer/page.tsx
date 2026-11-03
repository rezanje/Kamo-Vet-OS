import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { formatPosMoney } from "@/lib/pos-money";
import { PrintButton } from "@/components/PrintButton";
import { KasirReceiptPaper, ReceiptHr as Hr, ReceiptRow as Row } from "@/components/KasirReceiptPaper";

type RecentSale = { id: string; no_struk: string | null; total: number; created_at: string; voided_at: string | null };

const rp = formatPosMoney;
const jam = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Tes printer kasir (laporan Kamo Petshop Muara, 3 Nov 2026): kasir bisa memeriksa
// dan menyetel printer struk tanpa harus membuat penjualan dulu, lalu mencetak ulang
// struk terakhirnya sendiri. Struk contoh memakai bingkai cetak yang sama dengan
// struk asli, jadi hasil tes = hasil struk penjualan.
export default async function KasirPrinterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  const { data } = await supabase
    .from("sales")
    .select("id, no_struk, total, created_at, voided_at")
    .eq("cashier_id", user.id).is("channel", null)
    .order("created_at", { ascending: false }).limit(5);
  const recent = (data ?? []) as RecentSale[];
  const now = new Date().toISOString();

  return (
    <>
      <div className="no-print" style={{ maxWidth: 560, margin: "0 auto 14px" }}>
        <Link href="/kasir" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke kasir</Link>
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Tes printer struk</div>
          <p style={{ fontSize: 12.5, color: "var(--tm)", margin: "6px 0 12px", lineHeight: 1.5 }}>
            Cetak struk contoh untuk memeriksa printer tanpa membuat penjualan. Kalau tulisan
            <b> KANAN</b> di baris paling bawah tercetak utuh, printer sudah siap. Kalau terpotong,
            pilih printer struk dan ukuran kertas 58 mm di jendela cetak, lalu cetak contoh lagi.
          </p>
          <PrintButton label="Cetak struk contoh" />
        </div>
      </div>

      <KasirReceiptPaper>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>{shift?.branchName && shift.branchName !== "—" ? shift.branchName : "Kamo Petshop"}</div>
          <div style={{ fontWeight: 700 }}>TES PRINTER</div>
          <div style={{ fontSize: 10 }}>Bukan transaksi</div>
        </div>
        <Hr />
        <Row k="No" v="TES-CETAK" />
        <Row k="Tgl" v={new Date(now).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
        <Hr />
        <div>Barang contoh</div>
        <Row k="1 pcs x Rp 1.250.000" v={rp(1250000)} />
        <Hr />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}><span>TOTAL</span><span>{rp(1250000)}</span></div>
        <Hr />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>KIRI</span><span>KANAN</span></div>
      </KasirReceiptPaper>

      <div className="no-print card" style={{ maxWidth: 560, margin: "14px auto 0", padding: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 8 }}>Cetak ulang struk terakhir saya</div>
        {recent.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--tm)" }}>Belum ada struk penjualan atas nama Anda.</div>
        ) : recent.map(sale => (
          <div key={sale.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
            <div style={{ fontSize: 12.5, minWidth: 0 }}>
              <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{sale.no_struk ?? "Struk"}{sale.voided_at ? " · dibatalkan" : ""}</div>
              <div style={{ color: "var(--tm)" }}>{jam(sale.created_at)} · {rp(Number(sale.total))}</div>
            </div>
            <Link href={`/kasir/struk/${encodeURIComponent(sale.id)}?print=1`} className="btn-def" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
              <i className="ti ti-printer" /> Cetak ulang
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
