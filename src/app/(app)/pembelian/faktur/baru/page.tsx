import Link from "next/link";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { readCompleteList, readListPage } from "@/lib/checked-list";
import { createClient } from "@/lib/supabase/server";
import { sisaFakturablePerBaris } from "@/lib/faktur-beli";
import { FakturForm, type PoOption, type PoInvoiceInitial } from "./FakturForm";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;

type PoRow = {
  id: string;
  no_po: string | null;
  tanggal: string;
  purchase_order_receipt_closures?: Rel<{ po_id: string }>;
  suppliers: Rel<{ nama: string; termin_hari: number | null }>;
  purchase_order_items: {
    id: string; item_id: string | null; qty: number; qty_terima: number | null;
    harga_beli: number; nama: string; satuan: string | null; faktor: number | null;
    items: Rel<{ unit: string | null }>;
  }[] | null;
};

type InvoiceRow = {
  id: string;
  po_id: string | null;
  purchase_invoice_items: { po_item_id: string | null; item_id: string | null; qty: number; faktor: number | null }[] | null;
};
type PoHeader = Omit<PoRow, "purchase_order_items">;
type PoItem = NonNullable<PoRow["purchase_order_items"]>[number] & { po_id: string };
type InvoiceItem = NonNullable<InvoiceRow["purchase_invoice_items"]>[number] & { id: string; invoice_id: string };

export default async function FakturBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; replace_invoice?: string; po_no?: string; hal?: string }>;
}) {
  const { error, replace_invoice, po_no, hal } = await searchParams;
  const poNo = (po_no ?? "").trim().slice(0, 24);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  let initial: PoInvoiceInitial | undefined;
  if (replace_invoice) {
    const { data: source, error: sourceError } = await supabase.from("purchase_invoices").select("id,po_id,tanggal,jatuh_tempo,no_faktur_pemasok,keterangan,purchase_invoice_items(po_item_id,qty,harga)").eq("id", replace_invoice).not("po_id", "is", null).not("voided_at", "is", null).maybeSingle();
    if (sourceError || !source) return <div role="alert" className="p2ban">Faktur sumber pembatalan belum dapat dibaca. Kembali ke riwayat faktur.</div>;
    initial = source as PoInvoiceInitial;
  }

  let poPage: Awaited<ReturnType<typeof readListPage<PoHeader>>> | undefined;
  let loadError: unknown;
  let pos: PoRow[] = [];
  let invoiceRows: InvoiceRow[] = [];
  try {
    poPage = await readListPage<PoHeader>((from, to) => {
      let query = supabase.from("purchase_orders")
        .select("id, no_po, tanggal, purchase_order_receipt_closures(po_id), suppliers(nama, termin_hari)", { count: "exact" })
        .eq("status", "Diterima");
      if (initial) query = query.eq("id", initial.po_id);
      else if (poNo) query = query.eq("no_po", poNo);
      return query.order("created_at", { ascending: false }).order("id").range(from, to);
    }, "Daftar PO untuk faktur", initial || poNo ? "1" : hal);
    const poIds = poPage.rows.map(po => po.id);
    if (poIds.length) {
      const [poItems, invoices] = await Promise.all([
        readCompleteList<PoItem>((from, to) => supabase.from("purchase_order_items")
          .select("id, po_id, item_id, qty, qty_terima, harga_beli, nama, satuan, faktor, items(unit)", { count: "exact" })
          .in("po_id", poIds).order("id").range(from, to), "Baris PO untuk faktur", { maxRows: null }),
        readCompleteList<{ id: string; po_id: string | null }>((from, to) => supabase.from("purchase_invoices")
          .select("id, po_id", { count: "exact" }).in("po_id", poIds).is("voided_at", null)
          .order("id").range(from, to), "Faktur terkait PO", { maxRows: null }),
      ]);
      const itemsByPo = new Map<string, PoItem[]>();
      for (const item of poItems) itemsByPo.set(item.po_id, [...(itemsByPo.get(item.po_id) ?? []), item]);
      pos = poPage.rows.map(po => ({ ...po, purchase_order_items: itemsByPo.get(po.id) ?? [] }));
      const invoiceIds = invoices.map(invoice => invoice.id);
      const items = invoiceIds.length ? await readCompleteList<InvoiceItem>((from, to) => supabase.from("purchase_invoice_items")
        .select("id, invoice_id, po_item_id, item_id, qty, faktor", { count: "exact" })
        .in("invoice_id", invoiceIds).order("id").range(from, to), "Baris faktur terkait PO", { maxRows: null }) : [];
      const itemsByInvoice = new Map<string, InvoiceItem[]>();
      for (const item of items) itemsByInvoice.set(item.invoice_id, [...(itemsByInvoice.get(item.invoice_id) ?? []), item]);
      invoiceRows = invoices.map(invoice => ({ ...invoice, purchase_invoice_items: itemsByInvoice.get(invoice.id) ?? [] }));
    }
  } catch (cause) { loadError = cause; }

  const invoicesByPo = new Map<string, InvoiceRow[]>();
  for (const invoice of invoiceRows) {
    if (!invoice.po_id) continue;
    const rows = invoicesByPo.get(invoice.po_id) ?? [];
    rows.push(invoice);
    invoicesByPo.set(invoice.po_id, rows);
  }

  const options: PoOption[] = loadError ? [] : pos.map((p) => {
    const poItems = (p.purchase_order_items ?? []).map((r) => ({
      id: r.id,
      item_id: r.item_id,
      diterima: Number(r.qty_terima ?? r.qty) || 0,
      faktor: Number(r.faktor),
    }));
    const billed = (invoicesByPo.get(p.id) ?? []).flatMap((invoice) => invoice.purchase_invoice_items ?? []);
    const remaining = sisaFakturablePerBaris(poItems, billed);
    const ambiguousIds = new Set(remaining.legacyAmbiguousItemIds);
    const invalidIds = new Set(remaining.invalidPoItemIds);
    const itemName = new Map((p.purchase_order_items ?? []).map((r) => [r.item_id ?? r.id, r.nama]));
    const warningParts = [
      ...(remaining.invalidLinkedLines ? ["Ada baris faktur lama dengan tautan PO tidak valid; minta keuangan meninjau PO ini."] : []),
      ...remaining.legacyAmbiguousItemIds.map((id) => `${itemName.get(id) ?? "Barang"}: faktur lama tidak dapat dipetakan ke satuan/baris PO karena SKU muncul lebih dari sekali.`),
    ];
    return {
      id: p.id,
      label: `${p.no_po ?? p.id.slice(0, 8)} — ${one(p.suppliers)?.nama ?? "Tanpa pemasok"} (${p.tanggal})${one(p.purchase_order_receipt_closures ?? null) ? " — Selesai parsial" : ""}`,
      terminHari: Number(one(p.suppliers)?.termin_hari ?? 30),
      warning: warningParts.join(" ") || null,
      items: (p.purchase_order_items ?? []).flatMap((r) => {
        if (!r.item_id) return [];
        const blockedReason = remaining.invalidLinkedLines
          ? "Tertahan karena ada tautan faktur PO yang tidak valid."
          : ambiguousIds.has(r.item_id)
            ? "Tertahan: faktur lama tidak menyimpan baris PO dan satuan SKU ini ambigu."
            : invalidIds.has(r.id)
              ? "Tertahan: faktor satuan PO atau faktur tidak valid."
              : null;
        const qtyLeft = remaining.sisaPerBaris[r.id] ?? 0;
        if (!blockedReason && qtyLeft <= 0) return [];
        const factor = Number(r.faktor);
        const satuan = r.satuan || one(r.items)?.unit || "unit";
        return [{
          po_item_id: r.id, item_id: r.item_id, sisa: qtyLeft, nama: r.nama,
          harga_po: Number(r.harga_beli) || 0, satuan, faktor: factor, blockedReason,
        }];
      }),
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
      {!initial && <form method="get" style={{ display: "flex", alignItems: "end", gap: 8, marginBottom: 12 }}>
        <div><label className="flab" htmlFor="po_no">Cari nomor PO tepat</label><input className="fi" id="po_no" name="po_no" defaultValue={poNo} maxLength={24} placeholder="Mis. PO.2026.10.00001" /></div>
        <button type="submit" className="btn-def">Cari PO</button>
        {poNo && <Link href="/pembelian/faktur/baru" className="btn-def">Lihat terbaru</Link>}
      </form>}
      {loadError !== undefined && <ListLoadFailure error={loadError} label="Daftar PO untuk faktur" />}
      {!loadError && poNo && poPage?.count === 0 && <div role="status" className="p2ban">PO diterima dengan nomor itu tidak ditemukan.</div>}
      {!initial && !poNo && poPage && loadError === undefined && <ListPagination path="/pembelian/faktur/baru" query={{}} total={poPage.count} pageInfo={poPage.pageInfo} />}

      <FakturForm initial={initial} options={options} userId={userId} />
    </>
  );
}
