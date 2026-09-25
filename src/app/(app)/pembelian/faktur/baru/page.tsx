import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sisaFakturablePerBaris } from "@/lib/faktur-beli";
import { FakturForm, type PoOption } from "./FakturForm";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;

type PoRow = {
  id: string;
  no_po: string | null;
  tanggal: string;
  suppliers: { nama: string; termin_hari: number | null } | null;
  purchase_order_items: {
    id: string; item_id: string | null; qty: number; qty_terima: number | null;
    harga_beli: number; nama: string; satuan: string | null; faktor: number | null;
    items: Rel<{ unit: string | null }>;
  }[] | null;
};

type InvoiceRow = {
  po_id: string | null;
  purchase_invoice_items: { po_item_id: string | null; item_id: string | null; qty: number; faktor: number | null }[] | null;
};

export default async function FakturBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: pos, error: poError }, { data: invs, error: invoiceReadError }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, no_po, tanggal, suppliers(nama, termin_hari), purchase_order_items(id, item_id, qty, qty_terima, harga_beli, nama, satuan, faktor, items(unit))")
      .eq("status", "Diterima")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("purchase_invoices").select("po_id, purchase_invoice_items(po_item_id, item_id, qty, faktor)"),
  ]);

  const loadError = poError
    ? "Daftar PO tidak dapat dimuat. Muat ulang sebelum membuat faktur."
    : invoiceReadError
      ? "Faktur lama tidak dapat diperiksa. Muat ulang sebelum membuat faktur."
      : null;

  const invoiceRows = (invs ?? []) as unknown as InvoiceRow[];
  const invoicesByPo = new Map<string, InvoiceRow[]>();
  for (const invoice of invoiceRows) {
    if (!invoice.po_id) continue;
    const rows = invoicesByPo.get(invoice.po_id) ?? [];
    rows.push(invoice);
    invoicesByPo.set(invoice.po_id, rows);
  }

  const options: PoOption[] = loadError ? [] : ((pos ?? []) as unknown as PoRow[]).map((p) => {
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
      label: `${p.no_po ?? p.id.slice(0, 8)} — ${p.suppliers?.nama ?? "Tanpa pemasok"} (${p.tanggal})`,
      terminHari: Number(p.suppliers?.termin_hari ?? 30),
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
      {loadError && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {loadError}
        </div>
      )}

      <FakturForm options={options} />
    </>
  );
}
