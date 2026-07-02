import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { SecHeader } from "@/components/SecHeader";
import { TerimaForm } from "./TerimaForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type ReqDetail = {
  id: string;
  no_request: string | null;
  status: string;
  from_branch_id: string;
  warehouses: Rel<{ name: string }>;
  stock_request_items: {
    id: string;
    item_id: string | null;
    nama: string;
    qty_diminta: number;
  }[] | null;
};

export default async function TerimaBarangPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, from_branch_id, warehouses(name), stock_request_items(id, item_id, nama, qty_diminta)")
    .eq("id", id)
    .maybeSingle();

  const req = data as unknown as ReqDetail | null;

  // hanya request cabang shift ini, dan hanya yg berstatus Dikirim yang bisa diterima.
  if (!req || req.from_branch_id !== shift.branch_id) redirect("/kasir/persediaan?tab=penerimaan");
  if (req.status !== "Dikirim") redirect("/kasir/persediaan?tab=penerimaan");

  const wh = one(req.warehouses);
  const items = req.stock_request_items ?? [];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/kasir/persediaan?tab=penerimaan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penerimaan Barang — {req.no_request ?? "—"}</span>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="TERIMA BARANG"
          desc={`Dari gudang ${wh?.name ?? "—"} · cabang ${shift.branchName} (PRD §2.4)`}
        />
        <TerimaForm requestId={req.id} items={items} />
      </div>
    </>
  );
}
