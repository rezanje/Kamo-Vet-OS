import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { sisaRetur } from "@/lib/retur";
import { ReturJualForm } from "./ReturJualForm";

type SaleRow = {
  id: string;
  no_struk: string | null;
  total: number;
  created_at: string;
  customers: { name: string } | null;
  sale_items: { item_id: string | null; nama: string; qty: number; harga: number }[] | null;
};

export default async function ReturJualBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; struk?: string }>;
}) {
  const { error, struk } = await searchParams;
  const supabase = await createClient();

  let sale: SaleRow | null = null;
  let rows: { item_id: string; nama: string; harga: number; sisa: number }[] = [];
  let notFoundMsg: string | null = null;

  if (struk?.trim()) {
    const { data } = await supabase
      .from("sales")
      .select("id, no_struk, total, created_at, customers(name), sale_items(item_id, nama, qty, harga)")
      .eq("no_struk", struk.trim())
      .maybeSingle();
    sale = data as unknown as SaleRow | null;
    if (!sale) {
      notFoundMsg = `Struk "${struk}" tidak ditemukan.`;
    } else {
      const sumber: Record<string, number> = {};
      const meta: Record<string, { nama: string; harga: number }> = {};
      for (const r of sale.sale_items ?? []) {
        if (!r.item_id) continue;
        sumber[r.item_id] = (sumber[r.item_id] ?? 0) + Number(r.qty);
        meta[r.item_id] = { nama: r.nama, harga: Number(r.harga) || 0 };
      }
      const { data: prev } = await supabase
        .from("sales_returns").select("sales_return_items(item_id, qty)").eq("sale_id", sale.id);
      const sudah: Record<string, number> = {};
      for (const d of prev ?? [])
        for (const r of d.sales_return_items ?? [])
          if (r.item_id) sudah[r.item_id] = (sudah[r.item_id] ?? 0) + Number(r.qty);
      const sisa = sisaRetur(sumber, sudah);
      rows = Object.entries(sisa).map(([item_id, qty]) => ({
        item_id, sisa: qty, nama: meta[item_id]?.nama ?? "—", harga: meta[item_id]?.harga ?? 0,
      }));
      if (rows.length === 0) notFoundMsg = `Semua barang di struk ${sale.no_struk} sudah diretur.`;
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan/retur" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buat Retur Penjualan</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="CARI STRUK" desc="Masukkan nomor struk penjualan POS yang barangnya dikembalikan." />
        <form method="get" style={{ display: "flex", gap: 6, maxWidth: 420 }}>
          <input className="fi" name="struk" defaultValue={struk ?? ""} placeholder="No. struk (mis. STR-20260722-0001)" style={{ flex: 1 }} />
          <button type="submit" className="btn-acc" style={{ padding: "6px 14px" }}>
            <i className="ti ti-search" /> Cari
          </button>
        </form>
        {notFoundMsg && (
          <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 8 }}>{notFoundMsg}</div>
        )}
      </div>

      {sale && rows.length > 0 && (
        <ReturJualForm
          saleId={sale.id}
          info={`${sale.no_struk} — ${sale.customers?.name ?? "Umum"}`}
          rows={rows}
        />
      )}
    </>
  );
}
