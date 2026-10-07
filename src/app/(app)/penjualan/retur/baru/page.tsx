import Link from "next/link";
import { PostingRequestIdentity } from "@/components/PostingRequestIdentity";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { loadSaleReturnRows, type ReturnFormRow } from "@/lib/return-source-units";
import { ReturJualForm } from "./ReturJualForm";

type SaleRow = {
  id: string;
  no_struk: string | null;
  subtotal: number;
  total: number;
  created_at: string;
  customers: { name: string } | null;
  sale_items: {
    id: string; item_id: string | null; nama: string; qty: number; harga: number; satuan: string | null; faktor: number;
    sale_item_group_components: {
      component_item_id: string | null; component_name: string; item_type: string;
      qty_per_group: number; unit: string; sort_order: number;
    }[] | null;
  }[] | null;
};

type FormRow = ReturnFormRow;

export default async function ReturJualBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; request_scope?:string; request_done?:string; success?: string; struk?: string }>;
}) {
  const { error, struk, success, request_scope, request_done } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();

  let sale: SaleRow | null = null;
  let rows: FormRow[] = [];
  let notFoundMsg: string | null = null;

  if (struk?.trim()) {
    // Order online (channel terisi) tidak bisa diretur lewat jalur ini —
    // refund retur jual keluar dari kas kasir, sedangkan online tidak punya shift kasir.
    const { data } = await supabase
      .from("sales")
      .select("id, no_struk, subtotal, total, created_at, customers(name), sale_items(id, item_id, nama, qty, harga, satuan, faktor, sale_item_group_components(component_item_id, component_name, item_type, qty_per_group, unit, sort_order))")
      .eq("no_struk", struk.trim())
      .is("channel", null)
      .maybeSingle();
    sale = data as unknown as SaleRow | null;
    if (!sale) {
      notFoundMsg = `Struk "${struk}" tidak ditemukan.`;
    } else {
      try {
        rows = await loadSaleReturnRows(supabase, sale);
      } catch (e) {
        notFoundMsg = e instanceof Error ? e.message : "Gagal memuat rincian retur.";
      }
      if (rows.length === 0 && !notFoundMsg) notFoundMsg = `Semua barang di struk ${sale.no_struk} sudah diretur.`;
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

      {success && <div className="p2ban">{success}</div>}
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

      {sale && rows.length === 0 && <form>
        <input type="hidden" name="source_ref" value={sale.no_struk ?? ""} />
        <PostingRequestIdentity scope={`sales-return:${sale.id}`} userId={user?.id} confirmedScope={request_scope} confirmedKey={request_done} />
      </form>}

      {sale && rows.length > 0 && (
        <ReturJualForm
          userId={user?.id} confirmedScope={request_scope} confirmedKey={request_done}
          saleId={sale.id}
          info={`${sale.no_struk} — ${sale.customers?.name ?? "Umum"}`}
          rows={rows}
        />
      )}
    </>
  );
}
