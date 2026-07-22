import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sisaRetur } from "@/lib/retur";
import { ReturBeliForm, type PoOption } from "./ReturBeliForm";

type PoRow = {
  id: string;
  no_po: string | null;
  tanggal: string;
  suppliers: { nama: string } | null;
  purchase_order_items: { item_id: string | null; qty: number; harga_beli: number; nama: string }[] | null;
};

export default async function ReturBeliBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: pos }, { data: returns }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, no_po, tanggal, suppliers(nama), purchase_order_items(item_id, qty, harga_beli, nama)")
      .eq("status", "Diterima")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("purchase_returns").select("po_id, purchase_return_items(item_id, qty)"),
  ]);

  // akumulasi retur per PO per item
  const returned: Record<string, Record<string, number>> = {};
  for (const d of (returns ?? []) as unknown as { po_id: string; purchase_return_items: { item_id: string | null; qty: number }[] | null }[]) {
    const m = (returned[d.po_id] ??= {});
    for (const r of d.purchase_return_items ?? [])
      if (r.item_id) m[r.item_id] = (m[r.item_id] ?? 0) + Number(r.qty);
  }

  const options: PoOption[] = ((pos ?? []) as unknown as PoRow[]).map((p) => {
    const sumber: Record<string, number> = {};
    const meta: Record<string, { nama: string; harga: number }> = {};
    for (const r of p.purchase_order_items ?? []) {
      if (!r.item_id) continue;
      sumber[r.item_id] = (sumber[r.item_id] ?? 0) + Number(r.qty);
      meta[r.item_id] = { nama: r.nama, harga: Number(r.harga_beli) || 0 };
    }
    const sisa = sisaRetur(sumber, returned[p.id] ?? {});
    return {
      id: p.id,
      label: `${p.no_po ?? p.id.slice(0, 8)} — ${p.suppliers?.nama ?? "Tanpa pemasok"} (${p.tanggal})`,
      items: Object.entries(sisa).map(([item_id, qty]) => ({
        item_id, sisa: qty, nama: meta[item_id]?.nama ?? "—", harga: meta[item_id]?.harga ?? 0,
      })),
    };
  }).filter((o) => o.items.length > 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian/retur" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buat Retur Pembelian</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <ReturBeliForm options={options} />
    </>
  );
}
