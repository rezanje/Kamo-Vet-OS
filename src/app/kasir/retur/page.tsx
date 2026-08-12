import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { sisaRetur, rasioBayar, hargaRefund, infoBarangRetur } from "@/lib/retur";
import { ReturJualForm } from "@/app/(app)/penjualan/retur/baru/ReturJualForm";

type SaleRow = {
  id: string;
  no_struk: string | null;
  branch_id: string;
  subtotal: number;
  total: number;
  created_at: string;
  customers: { name: string } | null;
  sale_items: { item_id: string | null; nama: string; qty: number; harga: number; faktor: number }[] | null;
};

type ReturRow = {
  id: string; no_retur: string; tanggal: string; total: number; keterangan: string | null;
  sales: { no_struk: string | null; branch_id: string } | null;
  sales_return_items: { id: string }[] | null;
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

// Retur di layar kasir (spec mba Nissa 2026-07-30): kasir toko bisa proses retur
// sendiri tanpa lewat backoffice. Dibatasi cabang shift-nya — struk cabang lain
// ditolak, karena refund tunai keluar dari kas kasir cabang ini.
export default async function ReturKasirPage({
  searchParams,
}: {
  searchParams: Promise<{ struk?: string; error?: string; success?: string }>;
}) {
  const { struk, error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  let sale: SaleRow | null = null;
  let rows: { item_id: string; nama: string; harga: number; sisa: number; berstok?: boolean; trackExpiry?: boolean }[] = [];
  let pesan: string | null = null;

  if (struk?.trim()) {
    const { data } = await supabase
      .from("sales")
      .select("id, no_struk, branch_id, subtotal, total, created_at, customers(name), sale_items(item_id, nama, qty, harga, faktor)")
      .eq("no_struk", struk.trim())
      .is("channel", null)
      .maybeSingle();
    sale = data as unknown as SaleRow | null;

    if (!sale) {
      pesan = `Struk "${struk}" tidak ditemukan.`;
    } else if (sale.branch_id !== shift.branch_id) {
      pesan = `Struk ${sale.no_struk} bukan penjualan ${shift.branchName} — retur harus di cabang tempat barang dijual.`;
      sale = null;
    } else {
      // Sisa yang bisa diretur dihitung dalam SATUAN DASAR (satu struk bisa memuat
      // item yang sama dalam dua satuan: 1 box + 3 pcs).
      const sumber: Record<string, number> = {};
      const meta: Record<string, { nama: string; harga: number }> = {};
      // Harga yang DITAMPILKAN wajib sama dengan yang nanti dibayar server: sebanding
      // dengan yang benar-benar dikeluarkan pelanggan, bukan harga daftar sebelum
      // promo/diskon/voucher/poin. Layar ini dulu melewatkan rasio itu, jadi struk
      // berdiskon terlihat menjanjikan refund lebih besar daripada yang cair.
      const rasio = rasioBayar(Number(sale.subtotal), Number(sale.total));
      for (const r of sale.sale_items ?? []) {
        if (!r.item_id) continue;
        const f = Number(r.faktor) > 0 ? Number(r.faktor) : 1;
        sumber[r.item_id] = (sumber[r.item_id] ?? 0) + Number(r.qty) * f;
        meta[r.item_id] = { nama: r.nama, harga: hargaRefund((Number(r.harga) || 0) / f, rasio) };
      }
      const { data: prev } = await supabase
        .from("sales_returns").select("sales_return_items(item_id, qty)").eq("sale_id", sale.id);
      const sudah: Record<string, number> = {};
      for (const d of prev ?? [])
        for (const r of d.sales_return_items ?? [])
          if (r.item_id) sudah[r.item_id] = (sudah[r.item_id] ?? 0) + Number(r.qty);

      const sisaMap = sisaRetur(sumber, sudah);
      const info = await infoBarangRetur(supabase, Object.keys(sisaMap));
      rows = Object.entries(sisaMap).map(([item_id, qty]) => ({
        item_id, sisa: qty, nama: meta[item_id]?.nama ?? "—", harga: meta[item_id]?.harga ?? 0,
        ...(info.get(item_id) ?? { berstok: true, trackExpiry: false }),
      }));
      if (rows.length === 0) pesan = `Semua barang di struk ${sale.no_struk} sudah diretur.`;
    }
  }

  // Riwayat retur cabang ini saja.
  const { data: returData } = await supabase
    .from("sales_returns")
    .select("id, no_retur, tanggal, total, keterangan, sales!inner(no_struk, branch_id), sales_return_items(id)")
    .eq("sales.branch_id", shift.branch_id)
    .order("created_at", { ascending: false })
    .limit(30);
  const riwayat = (returData ?? []) as unknown as ReturRow[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--posb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-receipt-refund" style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--posb)", letterSpacing: ".01em" }}>RETUR PENJUALAN</div>
            <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 1 }}>
              Barang kembali dari pelanggan · {shift.branchName}
            </div>
          </div>
        </div>
        <Link href="/kasir" className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
          <i className="ti ti-arrow-left" /> Kembali ke kasir
        </Link>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", marginBottom: 4, letterSpacing: ".03em" }}>CARI STRUK</div>
        <div style={{ fontSize: 10.5, color: "var(--td)", marginBottom: 10 }}>
          Masukkan nomor struk yang tertera di kertas struk pelanggan.
        </div>
        <form method="get" style={{ display: "flex", gap: 6, maxWidth: 420 }}>
          <input className="fi" name="struk" defaultValue={struk ?? ""} placeholder="No. struk (mis. POS-20260720-0001)" style={{ flex: 1 }} />
          <button type="submit" className="btn-acc" style={{ padding: "6px 14px" }}>
            <i className="ti ti-search" /> Cari
          </button>
        </form>
        {pesan && <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 8 }}>{pesan}</div>}
      </div>

      {sale && rows.length > 0 && (
        <ReturJualForm
          saleId={sale.id}
          info={`${sale.no_struk} — ${sale.customers?.name ?? "Umum"}`}
          rows={rows}
          dari="kasir"
          lockBranchId={shift.branch_id}
        />
      )}

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", marginBottom: 12, letterSpacing: ".03em" }}>RETUR TERAKHIR</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>No. Retur</th><th>Tanggal</th><th>Struk</th>
                <th style={{ textAlign: "center" }}>Item</th>
                <th>Keterangan</th>
                <th style={{ textAlign: "right" }}>Total Refund</th>
              </tr>
            </thead>
            <tbody>
              {riwayat.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{r.no_retur}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{fmtD(r.tanggal)}</td>
                  <td style={{ fontSize: 11 }}>{r.sales?.no_struk ?? "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.sales_return_items?.length ?? 0}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.keterangan ?? "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(Number(r.total))}</td>
                </tr>
              ))}
              {riwayat.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada retur di cabang ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 10 }}>
        Refund tunai otomatis tercatat sebagai pengeluaran kasir dan ikut terpotong saat tutup shift.
        Stok barang yang diretur kembali ke gudang cabang ini.
      </div>
    </>
  );
}
