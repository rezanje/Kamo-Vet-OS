import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TerimaForm, type BarisPO } from "./TerimaForm";

// ponytail: halaman terima barang — qty datang bisa ≠ qty PO (kurang/lebih kirim).

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type PoItem = {
  id: string;
  nama: string;
  qty: number;
  qty_terima: number | null;   // sudah pernah diterima (penerimaan bertahap)
  harga_beli: number;
  satuan: string | null;   // satuan yang dipilih saat PO (bisa box/sak)
  items: Rel<{ unit: string }>;
};

export default async function TerimaBarangPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, tanggal, status, total, suppliers(nama), warehouses(name), purchase_order_items(id, nama, qty, qty_terima, satuan, harga_beli, items(unit))")
    .eq("id", id)
    .maybeSingle();

  if (!po) notFound();
  if (po.status === "Diterima" || po.status === "Batal") {
    redirect("/pembelian?error=" + encodeURIComponent(`PO ini berstatus ${po.status}.`));
  }

  // Yang ditawarkan untuk diterima adalah SISA yang belum datang, bukan qty PO
  // penuh — pemasok sering mengirim bertahap dan sisanya dicatat menyusul.
  const rows: BarisPO[] = ((po.purchase_order_items ?? []) as unknown as PoItem[])
    .map((r) => ({
      id: r.id,
      nama: r.nama,
      qty: Math.max(0, (Number(r.qty) || 0) - (Number(r.qty_terima) || 0)),
      harga_beli: Number(r.harga_beli) || 0,
      satuan: r.satuan || one(r.items)?.unit || "",
    }))
    .filter((r) => r.qty > 0);

  const supplier = one(po.suppliers as Rel<{ nama: string }>)?.nama ?? "Tanpa supplier";
  const gudang = one(po.warehouses as Rel<{ name: string }>)?.name ?? "—";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Terima Barang · {po.no_po ?? id.slice(0, 8)}</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <TerimaForm
        poId={po.id as string}
        noPo={(po.no_po as string | null) ?? id.slice(0, 8)}
        supplier={supplier}
        gudang={gudang}
        totalPO={Number(po.total) || 0}
        rows={rows}
      />
    </>
  );
}
