import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

// Hasil opname yang sudah tersimpan. Dipakai modul Persediaan DAN layar kasir,
// jadi isinya sengaja tanpa harga — kasir tidak perlu melihat modal barang.

type ResultItem = {
  qty_sistem: number;
  qty_fisik: number;
  selisih: number;
  items: { code: string; name: string; unit: string } | null;
};

type Faktur = { no_faktur: string; total: number };

export async function HasilView({ orderId }: { orderId: string }) {
  const supabase = await createClient();
  const { data: result } = await supabase
    .from("opname_results")
    .select("no_hasil, tanggal, sales_invoices(no_faktur, total), opname_result_items(qty_sistem, qty_fisik, selisih, items(code, name, unit))")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Selisih terbesar di atas — yang perlu ditindak kantor pusat itu barang yang
  // hilang paling banyak, bukan barang yang kebetulan huruf depannya A.
  const items = ((result?.opname_result_items ?? []) as unknown as ResultItem[])
    .sort((a, b) =>
      Math.abs(Number(b.selisih)) - Math.abs(Number(a.selisih)) ||
      (a.items?.name ?? "").localeCompare(b.items?.name ?? ""));
  const beda = items.filter((r) => Number(r.selisih) !== 0);

  const invRaw = (result as unknown as { sales_invoices: Faktur | Faktur[] | null } | null)?.sales_invoices;
  const faktur = Array.isArray(invRaw) ? invRaw[0] ?? null : invRaw ?? null;

  return (
    <div className="crm-sec">
      <SecHeader
        num="02"
        title={`HASIL ${result?.no_hasil ?? ""}`}
        desc={`${items.length} barang dihitung, ${beda.length} barang selisih. Stok sudah disesuaikan.`}
      />

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
  );
}
