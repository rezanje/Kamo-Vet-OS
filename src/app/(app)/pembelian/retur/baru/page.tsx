import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { returnSourceRows, type PriorReturn } from "@/lib/return-source-units";
import { qtyDiterima } from "@/lib/penerimaan";
import { loadUnitOptions } from "@/lib/satuan";
import { ReturBeliForm, type PoOption } from "./ReturBeliForm";

type PoRow = {
  id: string;
  no_po: string | null;
  tanggal: string;
  suppliers: { nama: string } | null;
  purchase_order_items: { id: string; item_id: string | null; qty: number; qty_terima: number | null; harga_beli: number; nama: string; satuan: string | null; faktor: number | null }[] | null;
};

export default async function ReturBeliBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; request_scope?:string; request_done?:string; success?: string }>;
}) {
  const { error, success, request_scope, request_done } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();

  const [{ data: pos }, { data: returns }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, no_po, tanggal, suppliers(nama), purchase_order_items(id, item_id, qty, qty_terima, harga_beli, nama, satuan, faktor)")
      .eq("status", "Diterima")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("purchase_returns").select("po_id, purchase_return_items(source_line_id, item_id, qty)"),
  ]);

  const unitMap = await loadUnitOptions(supabase, ((pos ?? []) as unknown as PoRow[]).flatMap(p => (p.purchase_order_items ?? []).map(r => r.item_id).filter((id): id is string => !!id)), {includeInactive:true});
  const returned = new Map<string, PriorReturn[]>();
  for (const d of (returns ?? []) as unknown as {po_id:string;purchase_return_items:PriorReturn[]|null}[]) {
    returned.set(d.po_id, [...(returned.get(d.po_id) ?? []), ...(d.purchase_return_items ?? [])]);
  }
  const choices = ((pos ?? []) as unknown as PoRow[]).map(p => {
    try {
      const rows = returnSourceRows((p.purchase_order_items ?? []).map(r => ({...r, qty:qtyDiterima(r), harga:Number(r.harga_beli)})), returned.get(p.id) ?? []);
      return {error:null,option:{id:p.id,label:`${p.no_po ?? p.id.slice(0,8)} — ${p.suppliers?.nama ?? "Tanpa pemasok"} (${p.tanggal})`,items:rows.map(r=>({...r,units:unitMap.get(r.item_id) ?? []}))}};
    } catch (e) { return {option:null,error:e instanceof Error ? e.message : "Gagal memuat retur."}; }
  });
  const reconciliation = choices.find(c => c.error)?.error;
  const options: PoOption[] = choices.flatMap(c => c.option && c.option.items.length > 0 ? [c.option] : []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian/retur" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buat Retur Pembelian</span>
      </div>

      {success && <div className="p2ban">{success}</div>}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {reconciliation && <div className="p2ban">{reconciliation}</div>}
      <ReturBeliForm userId={user?.id} confirmedScope={request_scope} confirmedKey={request_done} options={options} />
    </>
  );
}
