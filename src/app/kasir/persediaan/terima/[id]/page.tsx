import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
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
    .select("id, no_request, status, from_branch_id, warehouses(name), stock_request_items(id, item_id, nama, qty_diminta, catatan)")
    .eq("id", id)
    .maybeSingle();

  // katalog barang: barcode scan + detail (kode/kategori/satuan) per item penerimaan.
  const { data: catalogRaw } = await supabase
    .from("items").select("id, code, name, unit, upc, item_categories(name)").eq("is_active", true);
  type CatRel = { name: string } | { name: string }[] | null;
  const catalog = ((catalogRaw ?? []) as { id: string; code: string; name: string; unit: string; upc: string | null; item_categories: CatRel }[]).map((c) => ({
    id: c.id, code: c.code, name: c.name, unit: c.unit, upc: c.upc,
    kategori: (Array.isArray(c.item_categories) ? c.item_categories[0]?.name : c.item_categories?.name) ?? "Lainnya",
  }));

  const req = data as unknown as ReqDetail | null;

  // hanya request cabang shift ini, dan hanya yg berstatus Dikirim yang bisa diterima.
  if (!req || req.from_branch_id !== shift.branch_id) redirect("/kasir/persediaan?tab=penerimaan");
  if (req.status !== "Dikirim") redirect("/kasir/persediaan?tab=penerimaan");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const wh = one(req.warehouses);
  const items = req.stock_request_items ?? [];

  return (
    <TerimaForm
      requestId={req.id}
      noRequest={req.no_request ?? "—"}
      whName={wh?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "Frontliner"}
      items={items}
      catalog={catalog}
    />
  );
}
