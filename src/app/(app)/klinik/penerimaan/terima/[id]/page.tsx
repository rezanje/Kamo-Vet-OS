import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import Link from "next/link";
import { readCompleteList } from "@/lib/checked-list";
import { TerimaForm } from "@/app/kasir/persediaan/terima/[id]/TerimaForm";
import { terimaBarangKlinik } from "../../actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null { return Array.isArray(r) ? (r[0] ?? null) : r; }

type ReqDetail = {
  id: string; no_request: string | null; status: string; from_branch_id: string;
  warehouses: Rel<{ name: string }>;
};
type RequestLine = { id: string; item_id: string | null; nama: string; qty_diminta: number; qty_disetujui: number | null; satuan: string | null; catatan: string | null };

export default async function KlinikTerimaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift) redirect("/klinik/shift");

  const unavailable = <div role="alert" className="p2ban">Data penerimaan belum dapat dimuat lengkap. Muat ulang sebelum menerima barang. <Link href="/klinik/penerimaan">Kembali ke penerimaan</Link></div>;
  const { data, error } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, from_branch_id, warehouses!stock_requests_to_warehouse_id_fkey(name)")
    .eq("id", id).maybeSingle();

  if (error) return unavailable;
  const req = data as unknown as ReqDetail | null;
  if (!req || req.from_branch_id !== shift.branch_id) redirect("/klinik/penerimaan");
  if (!["Disetujui", "Dikirim"].includes(req.status)) redirect("/klinik/penerimaan");

  type CatRel = { name: string } | { name: string }[] | null;
  type CatalogRow = { id: string; code: string; name: string; unit: string; upc: string | null; item_categories: CatRel };
  let catalogRaw: CatalogRow[];
  let requestItems: RequestLine[];
  try {
    requestItems = await readCompleteList<RequestLine>((from, to) => supabase.from("stock_request_items")
      .select("id, item_id, nama, qty_diminta, qty_disetujui, satuan, catatan", { count: "exact" })
      .eq("request_id", req.id).order("id").range(from, to), "Baris permintaan penerimaan");
    catalogRaw = await readCompleteList<CatalogRow>((from, to) => supabase.from("items")
      .select("id, code, name, unit, upc, item_categories(name)", { count: "exact" })
      .eq("is_active", true).order("id").range(from, to), "Katalog penerimaan");
  } catch { return unavailable; }
  const catalog = catalogRaw.map((c) => ({
    id: c.id, code: c.code, name: c.name, unit: c.unit, upc: c.upc,
    kategori: (Array.isArray(c.item_categories) ? c.item_categories[0]?.name : c.item_categories?.name) ?? "Lainnya",
  }));

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  return (
    <TerimaForm
      requestId={req.id}
      noRequest={req.no_request ?? "—"}
      whName={one(req.warehouses)?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "Staff"}
      items={requestItems}
      catalog={catalog}
      action={terimaBarangKlinik}
      backHref="/klinik/penerimaan"
    />
  );
}
