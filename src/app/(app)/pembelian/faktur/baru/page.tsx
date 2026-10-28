import Link from "next/link";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { readCompleteList, readListPage } from "@/lib/checked-list";
import { createClient } from "@/lib/supabase/server";
import { sisaFakturablePerBaris } from "@/lib/faktur-beli";
import { loadUnitOptions } from "@/lib/satuan";
import { FakturForm, type PoOption, type PoInvoiceInitial, type PoReceiptOption } from "./FakturForm";

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
type ReceiptRow = { id: string; po_id: string; no_terima: string; tanggal: string; goods_receipt_items: { nama: string; qty_terima: number; satuan: string | null }[] | null };
type ActiveLink = { id: string; invoice_id: string; purchase_invoices: Rel<{ no_faktur: string }> };
type SourceLine = { id: string; po_item_id: string | null; item_id: string | null; qty: number; harga: number; satuan: string | null; faktor: number | null };

export default async function FakturBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; replace_invoice?: string; po_no?: string; hal?: string; harga_cek?: string }>;
}) {
  const { error, replace_invoice, po_no, hal, harga_cek } = await searchParams;
  const poNo = (po_no ?? "").trim().slice(0, 24);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  let initial: PoInvoiceInitial | undefined;
  let sourceLines: SourceLine[] = [];
  if (replace_invoice) {
    const { data: source, error: sourceError } = await supabase.from("purchase_invoices")
      .select("id,po_id,tanggal,jatuh_tempo,no_faktur_pemasok,keterangan")
      .eq("id", replace_invoice).not("po_id", "is", null).not("voided_at", "is", null).maybeSingle();
    if (sourceError || !source) return <div role="alert" className="p2ban">Faktur sumber pembatalan belum dapat dibaca. Kembali ke riwayat faktur.</div>;
    try {
      sourceLines = await readCompleteList<SourceLine>((from, to) => supabase.from("purchase_invoice_items")
        .select("id,po_item_id,item_id,qty,harga,satuan,faktor", { count: "exact" })
        .eq("invoice_id", source.id).order("id").range(from, to), "Baris faktur sumber", { maxRows: null });
    } catch {
      return <div role="alert" className="p2ban">Faktur sumber pembatalan belum dapat dibaca lengkap. Kembali ke riwayat faktur.</div>;
    }
    const linked = sourceLines.map(line => line.po_item_id);
    if (!sourceLines.length || sourceLines.some(line => !line.po_item_id || !line.item_id
      || !Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0
      || !Number.isFinite(Number(line.harga)) || Number(line.harga) < 0)
      || new Set(linked).size !== linked.length) {
      return <div role="alert" className="p2ban">Rincian faktur sumber tidak dapat disiapkan otomatis. Periksa baris dan tautan PO pada faktur asal.</div>;
    }
    // N01: the voided source invoice's stored receipt choice is offered again; never guessed.
    const { data: sourceLinks, error: sourceLinkError } = await supabase.from("purchase_invoice_receipts")
      .select("goods_receipt_id").eq("invoice_id", source.id);
    if (sourceLinkError) return <div role="alert" className="p2ban">Penerimaan faktur sumber belum dapat dibaca. Muat ulang halaman.</div>;
    initial = { ...source, receipt_ids: (sourceLinks ?? []).map(link => String(link.goods_receipt_id)), purchase_invoice_items: sourceLines.map(line => ({
      po_item_id: line.po_item_id, qty: line.qty, harga: line.harga,
    })) } as PoInvoiceInitial;
  }

  let poPage: Awaited<ReturnType<typeof readListPage<PoHeader>>> | undefined;
  let loadError: unknown;
  let pos: PoRow[] = [];
  let invoiceRows: InvoiceRow[] = [];
  let receiptRows: ReceiptRow[] = [];
  let activeLinks: ActiveLink[] = [];
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
      const [poItems, invoices, receipts, links] = await Promise.all([
        readCompleteList<PoItem>((from, to) => supabase.from("purchase_order_items")
          .select("id, po_id, item_id, qty, qty_terima, harga_beli, nama, satuan, faktor, items(unit)", { count: "exact" })
          .in("po_id", poIds).order("id").range(from, to), "Baris PO untuk faktur", { maxRows: null }),
        readCompleteList<{ id: string; po_id: string | null }>((from, to) => supabase.from("purchase_invoices")
          .select("id, po_id", { count: "exact" }).in("po_id", poIds).is("voided_at", null)
          .order("id").range(from, to), "Faktur terkait PO", { maxRows: null }),
        readCompleteList<ReceiptRow>((from, to) => supabase.from("goods_receipts")
          .select("id, po_id, no_terima, tanggal, goods_receipt_items(nama, qty_terima, satuan)", { count: "exact" })
          .in("po_id", poIds).is("voided_at", null).order("tanggal").order("id").range(from, to), "Penerimaan PO untuk faktur", { maxRows: null }),
        readCompleteList<ActiveLink>((from, to) => supabase.from("purchase_invoice_receipts")
          .select("id:goods_receipt_id, invoice_id, purchase_invoices(no_faktur)", { count: "exact" })
          .in("po_id", poIds).eq("active", true).order("goods_receipt_id").range(from, to), "Penerimaan yang sudah difakturkan", { maxRows: null }),
      ]);
      receiptRows = receipts;
      activeLinks = links;
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

  // N01: receipts of each PO, marked when an active invoice already covers them.
  const linkByReceipt = new Map(activeLinks.map(link => [link.id, one(link.purchase_invoices)?.no_faktur ?? "faktur lain"]));
  // An active invoice without stored receipts (older invoice) may cover any receipt of its PO:
  // those receipts are not offered (the database refuses them too).
  const linkedInvoiceIds = new Set(activeLinks.map(link => link.invoice_id));
  const legacyPoIds = new Set(invoiceRows.filter(invoice => invoice.po_id && !linkedInvoiceIds.has(invoice.id)).map(invoice => invoice.po_id as string));
  const receiptsByPo = new Map<string, PoReceiptOption[]>();
  for (const receipt of receiptRows) receiptsByPo.set(receipt.po_id, [...(receiptsByPo.get(receipt.po_id) ?? []), {
    id: receipt.id, no_terima: receipt.no_terima, tanggal: receipt.tanggal,
    ringkas: (receipt.goods_receipt_items ?? []).filter(line => Number(line.qty_terima) > 0)
      .map(line => `${line.nama} ${Number(line.qty_terima)} ${line.satuan ?? ""}`.trim()).join(", "),
    sudahDifaktur: linkByReceipt.get(receipt.id) ?? (legacyPoIds.has(receipt.po_id) ? "faktur lama (PO yang sama)" : null),
  }]);

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
      receipts: receiptsByPo.get(p.id) ?? [],
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

  if (initial) {
    if (loadError || !options.some(option => option.id === initial.po_id)) return <div role="alert" className="p2ban">PO sumber faktur tidak dapat disiapkan otomatis. Muat ulang atau periksa PO asal.</div>;
    let sourceUnits;
    try { sourceUnits = await loadUnitOptions(supabase, sourceLines.map(line => line.item_id as string)); }
    catch { return <div role="alert" className="p2ban">Barang atau satuan faktur sumber tidak dapat disiapkan otomatis. Periksa master barang.</div>; }
    const available = new Map(options.find(option => option.id === initial.po_id)?.items.map(item => [item.po_item_id, item]));
    if (sourceLines.some(line => {
      const item = available.get(line.po_item_id as string);
      const units = sourceUnits.get(line.item_id as string) ?? [];
      const unit = line.satuan ? units.find(option => option.unit === line.satuan) : units[0];
      return !item || item.blockedReason || item.item_id !== line.item_id || !unit
        || line.satuan != null && line.satuan !== "" && line.satuan !== item.satuan
        || !Number.isFinite(Number(line.faktor)) || Number(line.faktor) !== item.faktor
        || Number(line.faktor) !== Number(unit.factor) || Number(line.qty) > item.sisa;
    })) return <div role="alert" className="p2ban">Baris, satuan, atau sisa PO faktur sumber tidak dapat disiapkan otomatis. Periksa PO dan master barang.</div>;
  }

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

      <FakturForm initial={initial} options={options} userId={userId} priceWarning={harga_cek} />
    </>
  );
}
