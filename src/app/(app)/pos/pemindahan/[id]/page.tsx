import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { sisaTransit } from "@/lib/pemindahan";
import { TerimaForm } from "./TerimaForm";

const STATUS_BADGE: Record<string, string> = {
  "Sedang dikirim": "b",
  "Diterima Sebagian": "o",
  "Diterima Seluruhnya": "g",
  Dibatalkan: "r",
};

type Wh = { code: string; name: string } | null;
type ItemRow = { item_id: string; qty: number; items: { code: string; name: string; unit: string } | null };
type Doc = {
  id: string;
  no_pemindahan: string;
  proses: string;
  tanggal: string;
  status: string | null;
  keterangan: string | null;
  source_transfer_id: string | null;
  from: Wh;
  to: Wh;
  stock_transfer_items: ItemRow[] | null;
};

const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function PemindahanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data: docRaw } = await supabase
    .from("stock_transfers")
    .select(
      "id, no_pemindahan, proses, tanggal, status, keterangan, source_transfer_id, " +
        "from:warehouses!stock_transfers_from_warehouse_id_fkey(code, name), " +
        "to:warehouses!stock_transfers_to_warehouse_id_fkey(code, name), " +
        "stock_transfer_items(item_id, qty, items(code, name, unit))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!docRaw) notFound();
  const doc = docRaw as unknown as Doc;

  const from = doc.from;
  const to = doc.to;
  const items = doc.stock_transfer_items ?? [];
  const isKirim = doc.proses === "Kirim Barang";

  // sisa Transit (hanya relevan utk dokumen Kirim)
  let sisa: Record<string, number> = {};
  let sourceNo: string | null = null;
  if (isKirim) {
    const dikirim: Record<string, number> = {};
    for (const r of items) dikirim[r.item_id] = (dikirim[r.item_id] ?? 0) + Number(r.qty);
    const { data: prev } = await supabase
      .from("stock_transfers")
      .select("stock_transfer_items(item_id, qty)")
      .eq("source_transfer_id", id);
    const diterima: Record<string, number> = {};
    for (const d of prev ?? [])
      for (const r of d.stock_transfer_items ?? []) diterima[r.item_id] = (diterima[r.item_id] ?? 0) + Number(r.qty);
    sisa = sisaTransit(dikirim, diterima);
  } else if (doc.source_transfer_id) {
    const { data: src } = await supabase
      .from("stock_transfers").select("no_pemindahan").eq("id", doc.source_transfer_id).maybeSingle();
    sourceNo = src?.no_pemindahan ?? null;
  }

  const totalQty = items.reduce((a, r) => a + Number(r.qty), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/pemindahan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{doc.no_pemindahan}</span>
        {doc.status && <span className={`bge ${STATUS_BADGE[doc.status] ?? "x"}`}>{doc.status}</span>}
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title={doc.proses.toUpperCase()}
          desc={
            isKirim
              ? "Barang keluar gudang asal, menunggu diterima gudang tujuan (Transit)."
              : `Penerimaan barang${sourceNo ? ` dari dokumen ${sourceNo}` : ""}.`
          }
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: 10, marginBottom: 4 }}>
          <div>
            <div className="flab">Tanggal</div>
            <div style={{ fontSize: 12 }}>{fmtD(doc.tanggal)}</div>
          </div>
          <div>
            <div className="flab">Gudang asal</div>
            <div style={{ fontSize: 12 }}>{from?.name ?? "—"}</div>
          </div>
          <div>
            <div className="flab">Gudang tujuan</div>
            <div style={{ fontSize: 12 }}>{to?.name ?? "—"}</div>
          </div>
          <div>
            <div className="flab">Total</div>
            <div style={{ fontSize: 12 }}>{items.length} barang ({totalQty})</div>
          </div>
        </div>
        {doc.keterangan && (
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 6 }}>{doc.keterangan}</div>
        )}
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="RINCIAN BARANG" desc={`${items.length} barang, total kuantitas ${totalQty}.`} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Nama Barang</th>
                <th>Kode #</th>
                <th style={{ textAlign: "right" }}>Kuantitas</th>
                <th>Satuan</th>
                {isKirim && <th style={{ textAlign: "right" }}>Sisa Transit</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.item_id}>
                  <td style={{ fontSize: 11.5 }}>{r.items?.name ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.items?.code ?? "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(r.qty)}</td>
                  <td style={{ fontSize: 11 }}>{r.items?.unit ?? ""}</td>
                  {isKirim && (
                    <td style={{ textAlign: "right", fontSize: 11.5, color: (sisa[r.item_id] ?? 0) > 0 ? "#b45309" : "#15803d" }}>
                      {sisa[r.item_id] ?? 0}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isKirim && doc.status !== "Dibatalkan" && Object.keys(sisa).length > 0 && (
        <TerimaForm
          sourceTransferId={doc.id}
          rows={items
            .filter((r) => (sisa[r.item_id] ?? 0) > 0)
            .map((r) => ({
              item_id: r.item_id,
              name: r.items?.name ?? "—",
              code: r.items?.code ?? "",
              unit: r.items?.unit ?? "",
              sisa: sisa[r.item_id] ?? 0,
            }))}
        />
      )}
    </>
  );
}
