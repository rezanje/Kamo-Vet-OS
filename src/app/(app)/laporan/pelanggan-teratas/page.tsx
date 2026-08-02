import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { tanggalIndo, hariIniWIB } from "@/lib/followup";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Awal bulan berjalan (WIB) — default rentang yang paling sering dipakai.
function awalBulan(): string {
  return hariIniWIB().slice(0, 8) + "01";
}

type Baris = {
  id: string; nama: string; hp: string; golongan: string;
  trx: number; total: number; terakhir: string | null;
};

export default async function PelangganTeratasPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();

  const supabase = await createClient();

  // Belanja pelanggan datang dari DUA pintu: penjualan petshop/online (sales)
  // dan tagihan klinik yang sudah lunas (invoices lewat visits). Menghitung
  // salah satunya saja bikin pelanggan klinik terlihat tidak pernah belanja.
  const [{ data: sales }, { data: invoices }, { data: customers }] = await Promise.all([
    supabase.from("sales")
      .select("customer_id, total, created_at")
      .gte("created_at", `${dari}T00:00:00`).lte("created_at", `${sampai}T23:59:59`),
    supabase.from("invoices")
      .select("total, created_at, visits!inner(customer_id)")
      .eq("paid_status", "Lunas").is("voided_at", null)
      .gte("created_at", `${dari}T00:00:00`).lte("created_at", `${sampai}T23:59:59`),
    supabase.from("customers")
      .select("id, name, phone, customer_categories(nama)"),
  ]);

  const agg = new Map<string, { trx: number; total: number; terakhir: string | null }>();
  const catat = (custId: string | null, total: number, tanggal: string) => {
    if (!custId) return;
    const a = agg.get(custId) ?? { trx: 0, total: 0, terakhir: null };
    a.trx++;
    a.total += Number(total) || 0;
    if (!a.terakhir || tanggal > a.terakhir) a.terakhir = tanggal;
    agg.set(custId, a);
  };

  for (const s of (sales ?? []) as { customer_id: string | null; total: number; created_at: string }[]) {
    catat(s.customer_id, s.total, s.created_at);
  }
  for (const iv of (invoices ?? []) as unknown as
    { total: number; created_at: string; visits: Rel<{ customer_id: string | null }> }[]) {
    catat(one(iv.visits)?.customer_id ?? null, iv.total, iv.created_at);
  }

  type CustRow = { id: string; name: string; phone: string; customer_categories: Rel<{ nama: string }> };
  const rows: Baris[] = ((customers ?? []) as unknown as CustRow[])
    .map((c) => {
      const a = agg.get(c.id);
      return {
        id: c.id, nama: c.name, hp: c.phone,
        golongan: one(c.customer_categories)?.nama ?? "—",
        trx: a?.trx ?? 0, total: a?.total ?? 0, terakhir: a?.terakhir ?? null,
      };
    })
    // Pelanggan tanpa transaksi di rentang ini tidak ditampilkan — laporannya
    // soal "siapa yang paling banyak belanja", bukan daftar pelanggan.
    .filter((r) => r.trx > 0)
    .sort((a, b) => b.total - a.total);

  const totalOmset = rows.reduce((a, r) => a + r.total, 0);
  const totalTrx = rows.reduce((a, r) => a + r.trx, 0);

  return (
    <LaporanPage
      icon="ti-trophy" title="PELANGGAN TERATAS"
      desc="Peringkat pelanggan berdasarkan total belanja — petshop, online, dan klinik digabung."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Pelanggan belanja", nilai: `${rows.length} orang` },
          { label: "Jumlah transaksi", nilai: `${totalTrx}x` },
          { label: "Total belanja", nilai: rp(totalOmset), warna: "#15803d" },
          { label: "Rata-rata per pelanggan", nilai: rp(rows.length ? totalOmset / rows.length : 0) },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th><th>Pelanggan</th><th style={{ width: 130 }}>No. HP</th>
                <th style={{ width: 90 }}>Golongan</th>
                <th style={{ width: 80, textAlign: "center" }}>Transaksi</th>
                <th style={{ width: 120, textAlign: "right" }}>Total belanja</th>
                <th style={{ width: 120, textAlign: "right" }}>Rata-rata</th>
                <th style={{ width: 110 }}>Terakhir</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, fontWeight: i < 3 ? 800 : 400, color: i < 3 ? "#b45309" : "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.hp}</td>
                  <td style={{ fontSize: 10.5 }}>{r.golongan}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.trx}x</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.total)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(r.total / r.trx)}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.terakhir ? tanggalIndo(r.terakhir) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <TabelKosong kolom={8} pesan="Belum ada transaksi di rentang tanggal ini." />}
            </tbody>
          </table>
        </div>
      </div>
    </LaporanPage>
  );
}
