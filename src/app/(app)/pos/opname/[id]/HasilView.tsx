import { readCompleteList } from "@/lib/checked-list";
import { ListLoadFailure } from "@/components/ListPagination";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { StockCorrectionPanel } from "../../koreksi-stok/StockCorrectionPanel";

// Hasil opname yang sudah tersimpan. Dipakai modul Persediaan DAN layar kasir,
// jadi isinya sengaja tanpa harga — kasir tidak perlu melihat modal barang.

type ResultItem = {
  id: string;
  item_id: string;
  qty_sistem: number;
  qty_fisik: number;
  selisih: number;
  items: { code: string; name: string; unit: string } | null;
};

type Faktur = { no_faktur: string; total: number };

export async function HasilView({ orderId, allowCorrections = false }: { orderId: string; allowCorrections?: boolean }) {
  const supabase = await createClient();
  const { data: result, error: resultError } = await supabase
    .from("opname_results")
    .select("id, no_hasil, tanggal, sales_invoices(no_faktur, total)")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (resultError || !result) return <div id="hasil"><ListLoadFailure error={resultError} label="Hasil stok opname" /></div>;
  let sourceItems: ResultItem[];
  try {
    sourceItems = await readCompleteList<ResultItem>(async (from, to) => {
      const response = await supabase.from("opname_result_items")
        .select("id, item_id, qty_sistem, qty_fisik, selisih, items(code, name, unit)", { count: "exact" })
        .eq("result_id", result.id).order("id").range(from, to);
      return { ...response, data: response.data as unknown as ResultItem[] | null };
    }, "Rincian hasil stok opname", { maxRows: null });
  } catch (error) {
    return <div id="hasil"><ListLoadFailure error={error} label="Rincian hasil stok opname" /></div>;
  }
  const { data: effective, error: effectiveError } = result ? await supabase.rpc("read_stock_document_effective", { p_kind: "opname", p_ids: [result.id] }) : { data: null, error: null };
  const current = effective?.[result?.id ?? ""] as { revision: number; rows: { item_id: string; qty: number; selisih: number }[] } | undefined;

  // Selisih terbesar di atas — yang perlu ditindak kantor pusat itu barang yang
  // hilang paling banyak, bukan barang yang kebetulan huruf depannya A.
  const items = sourceItems
    .map(row => { const replacement = current?.rows.find(r => r.item_id === row.item_id);return replacement ? { ...row, qty_fisik: replacement.qty, selisih: replacement.selisih } : row; })
    .sort((a, b) =>
      Math.abs(Number(b.selisih)) - Math.abs(Number(a.selisih)) ||
      (a.items?.name ?? "").localeCompare(b.items?.name ?? ""));
  const beda = items.filter((r) => Number(r.selisih) !== 0);

  const invRaw = (result as unknown as { sales_invoices: Faktur | Faktur[] | null } | null)?.sales_invoices;
  const faktur = Array.isArray(invRaw) ? invRaw[0] ?? null : invRaw ?? null;

  return (
    <><div id="hasil" className="crm-sec">
      <SecHeader
        num="02"
        title={`HASIL ${result?.no_hasil ?? ""}`}
        desc={`${items.length} barang dihitung, ${beda.length} barang selisih. Hasil tersimpan; pemeriksaan jurnal dilakukan terpisah.`}
      />
      {effectiveError && <div className="p2ban" role="status">Hasil koreksi belum dapat diperiksa. Angka di bawah adalah dokumen asal; muat ulang sebelum menggunakannya.</div>}
      {current && <div className="p2ban">Hasil efektif setelah koreksi revisi {current.revision}.</div>}

      {faktur && (
        <div className="p2ban" style={{ background: "#fff7ed", border: ".5px solid #fdba74", color: "#b45309" }}>
          <i className="ti ti-file-invoice" /> Selisih kurang ditagihkan lewat faktur{" "}
          <b>{faktur.no_faktur}</b> senilai Rp {Math.round(Number(faktur.total)).toLocaleString("id-ID")} (harga jual).
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Kode #</th>
              <th>Nama Barang</th>
              <th style={{ textAlign: "right" }}>Sistem</th>
              <th style={{ textAlign: "right" }}>Fisik</th>
              <th style={{ textAlign: "right" }}>Selisih</th>
              <th>Satuan</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i} style={Number(r.selisih) !== 0 ? { background: "#fffbeb" } : undefined}>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.items?.code ?? "—"}</td>
                <td style={{ fontSize: 11.5 }}>{r.items?.name ?? "—"}</td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(r.qty_sistem)}</td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(r.qty_fisik)}</td>
                <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: Number(r.selisih) === 0 ? "var(--tm)" : Number(r.selisih) > 0 ? "#15803d" : "#b91c1c" }}>
                  {Number(r.selisih) > 0 ? "+" : ""}{Number(r.selisih)}
                </td>
                <td style={{ fontSize: 11 }}>{r.items?.unit ?? ""}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Tidak ada rincian hasil.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    {allowCorrections && result?.id && <StockCorrectionPanel kind="opname" documentId={result.id} />}</>
  );
}
