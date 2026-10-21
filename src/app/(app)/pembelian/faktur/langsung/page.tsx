import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadUnitOptions } from "@/lib/satuan";
import { readCompleteList } from "@/lib/checked-list";
import { FakturLangsungForm, type DirectInvoiceInitial } from "./FakturLangsungForm";

// Faktur Pembelian Langsung — beli barang tanpa PO, barang masuk di dokumen yang sama.

export default async function FakturLangsungPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; replace_invoice?: string }>;
}) {
  const { error, replace_invoice } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let initial: DirectInvoiceInitial | undefined;
  if (replace_invoice) {
    const [{ data: source, error: sourceError }, { data: attachments, error: attachmentError }] = await Promise.all([
      supabase.from("purchase_invoices").select("id,supplier_id,warehouse_id,tanggal,jatuh_tempo,no_faktur_pemasok,surat_jalan,keterangan,purchase_invoice_items(item_id,qty,harga,satuan,exp_date)").eq("id", replace_invoice).is("po_id", null).not("voided_at", "is", null).maybeSingle(),
      supabase.from("document_attachments").select("path,nama,mime,ukuran").eq("modul", "pembelian").eq("ref_id", replace_invoice),
    ]);
    if (sourceError || attachmentError || !source) return <div role="alert" className="p2ban">Faktur sumber pembatalan belum dapat dibaca. Kembali ke riwayat faktur.</div>;
    initial = { ...source, lampiran: attachments ?? [] } as DirectInvoiceInitial;
  }

  const [{ data: suppliers }, { data: warehouses }, items] = await Promise.all([
    // Tabel pemasok tidak punya penanda aktif/nonaktif — jangan saring kolom yang
    // tidak ada, daftarnya jadi kosong tanpa pesan error.
    supabase.from("suppliers").select("id, nama, termin_hari").eq("is_active", true).order("nama"),
    supabase.from("warehouses").select("id, code, name, branches(name)").eq("is_active", true).order("code"),
    readCompleteList<{ id: string; code: string; name: string; buy_price: number; unit: string; track_expiry: boolean | null }>((from, to) => supabase
      .from("items").select("id, code, name, buy_price, unit, track_expiry", { count: "exact" })
      .eq("is_active", true).eq("item_type", "Persediaan").order("name").order("id").range(from, to),
      "Daftar barang faktur langsung", { maxRows: null }),
  ]);

  const daftar = items ?? [];
  const unitMap = await loadUnitOptions(supabase, daftar.map((i) => i.id));

  type Rel<T> = T | T[] | null;
  const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian/faktur" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Faktur Pembelian Langsung</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <FakturLangsungForm initial={initial} userId={user?.id ?? ""}
        suppliers={(suppliers ?? []).map((s) => ({
          id: s.id as string, nama: s.nama as string, terminHari: Number(s.termin_hari) || 0,
        }))}
        warehouses={((warehouses ?? []) as { id: string; code: string; name: string; branches: Rel<{ name: string }> }[])
          .map((w) => ({
            id: w.id, label: `${w.name} — ${one(w.branches)?.name ?? "—"}`,
          }))}
        items={daftar.map((i) => ({
          id: i.id, code: i.code, name: i.name,
          hargaBeli: Number(i.buy_price) || 0,
          trackExpiry: !!i.track_expiry,
          satuan: (unitMap.get(i.id) ?? []).map((u) => ({
            unit: u.unit, factor: u.factor, buy_price: u.buy_price,
          })),
        }))}
      />
    </>
  );
}
