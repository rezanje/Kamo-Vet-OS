import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

// ponytail: format rupiah helper
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// ponytail: one() helper untuk nested Supabase relation (object atau array)
type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// ponytail: tanggal referensi — hari ini 2026-07-01
const TODAY_STR = "2026-07-01";
const MONTH_START = "2026-07-01";
const MONTH_END = "2026-07-31";

type SaleRow = {
  id: string;
  branch_id: string | null;
  total: number;
  created_at: string;
  branches: { code: string; name: string } | { code: string; name: string }[] | null;
};

type SaleItemRow = {
  sale_id: string;
  nama: string;
  qty: number;
  harga: number;
};

type InvoiceRow = {
  id: string;
  total: number;
  paid_status: string;
  created_at: string;
};

export default async function PenjualanPage() {
  const supabase = await createClient();

  // ponytail: fetch semua sales + cabang; invoice tanpa nested branch (join visits→branches awkward, skip per spec)
  const [{ data: salesRaw }, { data: saleItemsRaw }, { data: invoicesRaw }] = await Promise.all([
    supabase
      .from("sales")
      .select("id, branch_id, total, created_at, branches(code, name)")
      .order("created_at", { ascending: false }) as unknown as Promise<{ data: SaleRow[] | null }>,
    supabase
      .from("sale_items")
      .select("sale_id, nama, qty, harga") as unknown as Promise<{ data: SaleItemRow[] | null }>,
    // ponytail: invoice tidak perlu join branch (visit→branch nested dalam invoices tidak bersih); hanya total & tanggal
    supabase
      .from("invoices")
      .select("id, total, paid_status, created_at").is("voided_at", null) as unknown as Promise<{ data: InvoiceRow[] | null }>,
  ]);

  const sales = (salesRaw ?? []) as SaleRow[];
  const saleItems = (saleItemsRaw ?? []) as SaleItemRow[];
  const invoices = (invoicesRaw ?? []) as InvoiceRow[];

  // ponytail: helper cek tanggal dalam rentang string YYYY-MM-DD
  const inRange = (iso: string, start: string, end: string) => {
    const d = iso.slice(0, 10);
    return d >= start && d <= end;
  };

  // ponytail: agregat POS
  const posHariIni = sales.filter((s) => inRange(s.created_at, TODAY_STR, TODAY_STR));
  const posBulanIni = sales.filter((s) => inRange(s.created_at, MONTH_START, MONTH_END));

  const posOmzetHariIni = posHariIni.reduce((a, s) => a + Number(s.total), 0);
  const posOmzetBulanIni = posBulanIni.reduce((a, s) => a + Number(s.total), 0);
  const posTotalOmzet = sales.reduce((a, s) => a + Number(s.total), 0);

  // ponytail: agregat Klinik (invoices lunas / DP dihitung — semua yg ada)
  const klinikHariIni = invoices.filter((inv) => inRange(inv.created_at, TODAY_STR, TODAY_STR));
  const klinikBulanIni = invoices.filter((inv) => inRange(inv.created_at, MONTH_START, MONTH_END));

  const klinikOmzetHariIni = klinikHariIni.reduce((a, inv) => a + Number(inv.total), 0);
  const klinikOmzetBulanIni = klinikBulanIni.reduce((a, inv) => a + Number(inv.total), 0);
  const klinikTotalOmzet = invoices.reduce((a, inv) => a + Number(inv.total), 0);

  // ponytail: kartu summary — kombinasi POS + Klinik
  const omzetHariIni = posOmzetHariIni + klinikOmzetHariIni;
  const omzetBulanIni = posOmzetBulanIni + klinikOmzetBulanIni;
  const totalTransaksi = sales.length + invoices.length;

  // ponytail: Seksi 02 — penjualan per cabang (POS only; klinik per-branch dihilangkan karena join invoices→visits→branches tidak clean)
  type BranchStat = { name: string; omzet: number; trx: number };
  const branchMap = new Map<string, BranchStat>();
  for (const s of sales) {
    const br = one(s.branches as Rel<{ code: string; name: string }>);
    const key = s.branch_id ?? "__unknown__";
    const name = br?.name ?? "Cabang tidak diketahui";
    const prev = branchMap.get(key) ?? { name, omzet: 0, trx: 0 };
    branchMap.set(key, { name, omzet: prev.omzet + Number(s.total), trx: prev.trx + 1 });
  }
  const branchStats = Array.from(branchMap.values()).sort((a, b) => b.omzet - a.omzet);

  // ponytail: Seksi 03 — produk terlaris dari sale_items
  type ProdStat = { nama: string; qty: number; omzet: number };
  const prodMap = new Map<string, ProdStat>();
  for (const si of saleItems) {
    const prev = prodMap.get(si.nama) ?? { nama: si.nama, qty: 0, omzet: 0 };
    prodMap.set(si.nama, {
      nama: si.nama,
      qty: prev.qty + Number(si.qty),
      omzet: prev.omzet + Number(si.qty) * Number(si.harga),
    });
  }
  const topProduk = Array.from(prodMap.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  return (
    <>
      {/* ponytail: judul halaman tanpa back-link (ini root /penjualan) */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#141413" }}>Rekap Penjualan</div>
        <div style={{ fontSize: 11, color: "var(--td)", marginTop: 3 }}>
          Gabungan omzet POS &amp; Klinik · data real-time
        </div>
      </div>

      {/* Kartu summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
        <StatCard label="Omzet Hari Ini" value={rp(omzetHariIni)} sub={TODAY_STR} accent />
        <StatCard label="Omzet Bulan Ini" value={rp(omzetBulanIni)} sub="Juli 2026" />
        <StatCard label="Total Transaksi" value={String(totalTransaksi)} sub="POS + Klinik (semua)" />
      </div>

      {/* Seksi 01 — Ringkasan per channel */}
      <div className="crm-sec">
        <SecHeader
          num="01"
          title="RINGKASAN PENJUALAN"
          desc="Perbandingan omzet POS retail vs Klinik (seluruh periode)."
        />
        <table className="tbl" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Channel</th>
              <th style={{ textAlign: "right" }}>Jumlah Transaksi</th>
              <th style={{ textAlign: "right" }}>Omzet</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="bge g" style={{ marginRight: 6 }}>POS</span>
                Penjualan Retail
              </td>
              <td style={{ textAlign: "right" }}>{sales.length.toLocaleString("id-ID")}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{rp(posTotalOmzet)}</td>
            </tr>
            <tr>
              <td>
                <span className="bge b" style={{ marginRight: 6 }}>Klinik</span>
                Invoice Medis
              </td>
              <td style={{ textAlign: "right" }}>{invoices.length.toLocaleString("id-ID")}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{rp(klinikTotalOmzet)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700 }}>Total Gabungan</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{totalTransaksi.toLocaleString("id-ID")}</td>
              <td style={{ textAlign: "right", fontWeight: 800, fontSize: 14, color: "var(--acc)" }}>
                {rp(posTotalOmzet + klinikTotalOmzet)}
              </td>
            </tr>
          </tfoot>
        </table>
        {sales.length === 0 && invoices.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 12 }}>
            Belum ada data penjualan.
          </div>
        )}
      </div>

      {/* Seksi 02 — Penjualan per cabang */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="PENJUALAN PER CABANG"
          desc="Rekap POS per cabang. Invoice klinik per-cabang tidak ditampilkan (join invoice→visit→branch dilewati)."
        />
        {branchStats.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 12 }}>
            Belum ada data penjualan POS per cabang.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cabang</th>
                  <th style={{ textAlign: "right" }}>Transaksi</th>
                  <th style={{ textAlign: "right" }}>Omzet POS</th>
                </tr>
              </thead>
              <tbody>
                {branchStats.map((b, i) => (
                  <tr key={b.name}>
                    <td style={{ color: "var(--td)", fontSize: 11 }}>{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>{b.name}</td>
                    <td style={{ textAlign: "right", fontSize: 12 }}>{b.trx.toLocaleString("id-ID")}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{rp(b.omzet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Seksi 03 — Produk terlaris */}
      <div className="crm-sec">
        <SecHeader
          num="03"
          title="PRODUK TERLARIS"
          desc="Top 10 produk berdasarkan jumlah qty terjual di POS (dari sale_items)."
        />
        {topProduk.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 12 }}>
            Belum ada item penjualan tercatat.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama Produk</th>
                  <th style={{ textAlign: "right" }}>Qty Terjual</th>
                  <th style={{ textAlign: "right" }}>Omzet</th>
                </tr>
              </thead>
              <tbody>
                {topProduk.map((p, i) => (
                  <tr key={p.nama}>
                    <td style={{ color: "var(--td)", fontSize: 11 }}>{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>{p.nama}</td>
                    <td style={{ textAlign: "right", fontSize: 12 }}>
                      {p.qty.toLocaleString("id-ID")}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{rp(p.omzet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ponytail: kartu statistik ringkas
function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="card" style={{ padding: "13px 15px" }}>
      <div style={{ fontSize: 9.5, color: "var(--tm)", letterSpacing: ".04em" }}>{label}</div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 800,
          color: accent ? "var(--acc)" : "#141413",
          marginTop: 4,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: "var(--td)", marginTop: 3 }}>{sub}</div>
      )}
    </div>
  );
}
