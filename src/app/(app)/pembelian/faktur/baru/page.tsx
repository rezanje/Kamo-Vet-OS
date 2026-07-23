import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sisaFakturable } from "@/lib/faktur-beli";
import { FakturForm, type PoOption } from "./FakturForm";

type PoRow = {
  id: string;
  no_po: string | null;
  tanggal: string;
  suppliers: { nama: string } | null;
  purchase_order_items: { item_id: string | null; qty: number; harga_beli: number; nama: string }[] | null;
};

export default async function FakturBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: pos }, { data: invs }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, no_po, tanggal, suppliers(nama), purchase_order_items(item_id, qty, harga_beli, nama)")
      .eq("status", "Diterima")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("purchase_invoices").select("po_id, purchase_invoice_items(item_id, qty)"),
  ]);

  // akumulasi qty terfakturkan per PO per item
  const invoiced: Record<string, Record<string, number>> = {};
  for (const d of (invs ?? []) as unknown as { po_id: string; purchase_invoice_items: { item_id: string | null; qty: number }[] | null }[]) {
    const m = (invoiced[d.po_id] ??= {});
    for (const r of d.purchase_invoice_items ?? [])
      if (r.item_id) m[r.item_id] = (m[r.item_id] ?? 0) + Number(r.qty);
  }

  const options: PoOption[] = ((pos ?? []) as unknown as PoRow[]).map((p) => {
    const qtyPO: Record<string, number> = {};
    const meta: Record<string, { nama: string; harga: number }> = {};
    for (const r of p.purchase_order_items ?? []) {
      if (!r.item_id) continue;
      qtyPO[r.item_id] = (qtyPO[r.item_id] ?? 0) + Number(r.qty);
      meta[r.item_id] = { nama: r.nama, harga: Number(r.harga_beli) || 0 };
    }
    const sisa = sisaFakturable(qtyPO, invoiced[p.id] ?? {});
    return {
      id: p.id,
      label: `${p.no_po ?? p.id.slice(0, 8)} — ${p.suppliers?.nama ?? "Tanpa pemasok"} (${p.tanggal})`,
      items: Object.entries(sisa).map(([item_id, qty]) => ({
        item_id, sisa: qty, nama: meta[item_id]?.nama ?? "—", harga_po: meta[item_id]?.harga ?? 0,
      })),
    };
  }).filter((o) => o.items.length > 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian/faktur" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buat Faktur Pembelian</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <FakturForm options={options} />
    </>
  );
}
