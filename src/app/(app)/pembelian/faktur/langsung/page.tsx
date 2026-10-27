import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadUnitOptions } from "@/lib/satuan";
import { readCompleteList } from "@/lib/checked-list";
import { loadItemHpp } from "@/lib/purchase-price-check";
import { FakturLangsungForm, type DirectInvoiceInitial } from "./FakturLangsungForm";

// Faktur Pembelian Langsung — beli barang tanpa PO, barang masuk di dokumen yang sama.
type SourceLine = { id: string; item_id: string | null; qty: number; harga: number; satuan: string | null; faktor: number; exp_date: string | null };

export default async function FakturLangsungPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; replace_invoice?: string }>;
}) {
  const { error, replace_invoice } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let initial: DirectInvoiceInitial | undefined;
  let sourceLines: SourceLine[] = [];
  if (replace_invoice) {
    const { data: source, error: sourceError } = await supabase.from("purchase_invoices")
      .select("id,supplier_id,warehouse_id,tanggal,jatuh_tempo,no_faktur_pemasok,surat_jalan,keterangan")
      .eq("id", replace_invoice).is("po_id", null).not("voided_at", "is", null).maybeSingle();
    if (sourceError || !source) return <div role="alert" className="p2ban">Faktur sumber pembatalan belum dapat dibaca. Kembali ke riwayat faktur.</div>;
    try {
      const [lines, attachments] = await Promise.all([
        readCompleteList<SourceLine>((from, to) =>
          supabase.from("purchase_invoice_items").select("id,item_id,qty,harga,satuan,faktor,exp_date", { count: "exact" })
            .eq("invoice_id", source.id).order("id").range(from, to), "Baris faktur sumber"),
        readCompleteList<{ id: string; path: string; nama: string; mime: string | null; ukuran: number | null }>((from, to) =>
          supabase.from("document_attachments").select("id,path,nama,mime,ukuran", { count: "exact" })
            .eq("modul", "pembelian").eq("ref_id", source.id).order("id").range(from, to), "Lampiran faktur sumber"),
      ]);
      sourceLines = lines;
      initial = { ...source, purchase_invoice_items: lines.map(line => ({
        item_id: line.item_id, qty: line.qty, harga: line.harga, satuan: line.satuan, exp_date: line.exp_date,
      })), lampiran: attachments } as DirectInvoiceInitial;
    } catch {
      return <div role="alert" className="p2ban">Faktur sumber pembatalan belum dapat dibaca lengkap. Kembali ke riwayat faktur.</div>;
    }
    if (initial.purchase_invoice_items.length > 500) return <div role="alert" className="p2ban">Faktur sumber melebihi batas 500 baris. Faktur pengganti belum dapat disiapkan otomatis.</div>;
    if (initial.lampiran.length > 100) return <div role="alert" className="p2ban">Faktur sumber melebihi batas 100 lampiran. Faktur pengganti belum dapat disiapkan otomatis.</div>;
    if (!initial.purchase_invoice_items.length || initial.purchase_invoice_items.some(line => !line.item_id)) return <div role="alert" className="p2ban">Barang sumber tidak tersedia untuk faktur pengganti. Periksa faktur asal sebelum melanjutkan.</div>;
    if (initial.lampiran.some(file => !file.path?.startsWith("pembelian/") || file.path.includes("..") || file.path.length > 500
      || !file.nama || file.nama.length > 200 || (file.mime != null && file.mime.length > 120)
      || (file.ukuran != null && (!Number.isFinite(Number(file.ukuran)) || Number(file.ukuran) <= 0 || Number(file.ukuran) > 10485760)))) {
      return <div role="alert" className="p2ban">Referensi lampiran sumber tidak valid untuk faktur pengganti. Periksa faktur asal sebelum melanjutkan.</div>;
    }
  }

  const [suppliers, warehouses, items, hpp] = await Promise.all([
    readCompleteList<{ id: string; nama: string; termin_hari: number }>((from, to) => supabase.from("suppliers")
      .select("id, nama, termin_hari", { count: "exact" }).eq("is_active", true)
      .order("nama").order("id").range(from, to), "Pemasok faktur langsung", { maxRows: null }),
    readCompleteList<{ id: string; code: string; name: string; branches: { name: string } | { name: string }[] | null }>((from, to) => supabase.from("warehouses")
      .select("id, code, name, branches(name)", { count: "exact" }).eq("is_active", true)
      .order("code").order("id").range(from, to), "Gudang faktur langsung", { maxRows: null }),
    readCompleteList<{ id: string; code: string; name: string; buy_price: number; unit: string; track_expiry: boolean | null }>((from, to) => supabase
      .from("items").select("id, code, name, buy_price, unit, track_expiry", { count: "exact" })
      .eq("is_active", true).eq("item_type", "Persediaan").order("name").order("id").range(from, to),
      "Daftar barang faktur langsung", { maxRows: null }),
    loadItemHpp(supabase),
  ]);

  const daftar = items ?? [];
  let unitMap;
  try { unitMap = await loadUnitOptions(supabase, daftar.map((i) => i.id)); }
  catch (cause) {
    if (initial) return <div role="alert" className="p2ban">Satuan barang tidak tersedia untuk faktur pengganti. Muat ulang atau periksa master barang.</div>;
    throw cause;
  }
  if (initial) {
    const selectable = new Set(daftar.map(item => item.id));
    if (sourceLines.some(line => {
      const options = unitMap.get(line.item_id ?? "") ?? [];
      const unit = line.satuan ? options.find(option => option.unit === line.satuan) : options[0];
      return !line.item_id || !selectable.has(line.item_id) || !unit || !Number.isFinite(Number(line.faktor))
        || Number(line.faktor) !== Number(unit.factor);
    })) {
      return <div role="alert" className="p2ban">Barang, satuan, atau faktor stok sumber tidak tersedia untuk faktur pengganti. Periksa master barang sebelum melanjutkan.</div>;
    }
  }

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
          hpp: hpp.get(i.id) ?? null,
          satuan: (unitMap.get(i.id) ?? []).map((u) => ({
            unit: u.unit, factor: u.factor, buy_price: u.buy_price,
          })),
        }))}
      />
    </>
  );
}
