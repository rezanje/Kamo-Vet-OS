import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

function awalBulan(): string {
  return hariIniWIB().slice(0, 8) + "01";
}

type SaleRow = {
  cashier_id: string | null; total: number; discount: number;
  branches: Rel<{ name: string }>;
};

// Retur penjualan ditarik lewat struknya, supaya uang yang dikembalikan mengurangi
// omzet kasir yang dulu menjualnya — bukan menggantung sebagai angka terpisah.
type ReturRow = {
  total: number;
  sales: Rel<{ cashier_id: string | null; branches: Rel<{ name: string }> }>;
};

export default async function PenjualanKasirPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";

  const supabase = await createClient();
  const [{ data: sales }, { data: returs }, { data: profiles }, { data: cabangList }] = await Promise.all([
    supabase.from("sales")
      .select("cashier_id, total, discount, branches(name)")
      .gte("created_at", `${dari}T00:00:00`).lte("created_at", `${sampai}T23:59:59`),
    supabase.from("sales_returns")
      .select("total, sales(cashier_id, branches(name))")
      .gte("tanggal", dari).lte("tanggal", sampai),
    // Kasir dikenali lewat akun login (sales.cashier_id → profiles), bukan lewat
    // tabel karyawan: tidak semua akun kasir punya kartu karyawan.
    supabase.from("profiles").select("id, full_name, role"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  const namaKasir = new Map((profiles ?? []).map((p) => [p.id, p.full_name || "(tanpa nama)"]));

  type Agg = { trx: number; omset: number; diskon: number; retur: number; cabang: Set<string> };
  const kosong = (): Agg => ({ trx: 0, omset: 0, diskon: 0, retur: 0, cabang: new Set<string>() });
  const agg = new Map<string, Agg>();

  for (const s of (sales ?? []) as unknown as SaleRow[]) {
    if (cabang && one(s.branches)?.name !== cabang) continue;
    const kunci = s.cashier_id ?? "—";
    const a = agg.get(kunci) ?? kosong();
    a.trx++;
    a.omset += Number(s.total) || 0;
    a.diskon += Number(s.discount) || 0;
    const b = one(s.branches)?.name;
    if (b) a.cabang.add(b);
    agg.set(kunci, a);
  }

  // Retur dibebankan ke kasir yang menjual struknya. Kalau strukmya di luar rentang
  // tanggal, kasirnya tetap muncul dengan omzet nol — returnya tidak boleh hilang.
  for (const r of (returs ?? []) as unknown as ReturRow[]) {
    const s = one(r.sales);
    if (!s) continue;
    if (cabang && one(s.branches)?.name !== cabang) continue;
    const kunci = s.cashier_id ?? "—";
    const a = agg.get(kunci) ?? kosong();
    a.retur += Number(r.total) || 0;
    const b = one(s.branches)?.name;
    if (b) a.cabang.add(b);
    agg.set(kunci, a);
  }

  const rows = [...agg.entries()]
    .map(([id, a]) => ({
      id,
      nama: id === "—" ? "(kasir tidak tercatat)" : namaKasir.get(id) ?? "(akun terhapus)",
      ...a,
      bersih: a.omset - a.retur,
      cabangTeks: [...a.cabang].join(", ") || "—",
      rata: a.trx ? (a.omset - a.retur) / a.trx : 0,
    }))
    .sort((x, y) => y.bersih - x.bersih);

  const totalOmset = rows.reduce((a, r) => a + r.omset, 0);
  const totalRetur = rows.reduce((a, r) => a + r.retur, 0);
  const totalBersih = totalOmset - totalRetur;
  const totalTrx = rows.reduce((a, r) => a + r.trx, 0);

  return (
    <LaporanPage
      icon="ti-cash-register" title="PENJUALAN PER KASIR"
      desc="Siapa yang paling produktif — jumlah transaksi, omset, dan rata-rata belanja per struk."
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
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(cabangList ?? []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Kasir aktif", nilai: `${rows.length} orang` },
          { label: "Total transaksi", nilai: `${totalTrx}x` },
          { label: "Omset kotor", nilai: rp(totalOmset) },
          { label: "Retur", nilai: totalRetur ? `− ${rp(totalRetur)}` : "—", warna: totalRetur ? "#b91c1c" : undefined },
          { label: "Omset bersih", nilai: rp(totalBersih), warna: "#15803d" },
          { label: "Rata-rata per struk", nilai: rp(totalTrx ? totalBersih / totalTrx : 0) },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th><th>Kasir</th><th style={{ width: 200 }}>Cabang</th>
                <th style={{ width: 90, textAlign: "center" }}>Transaksi</th>
                <th style={{ width: 130, textAlign: "right" }}>Omset kotor</th>
                <th style={{ width: 110, textAlign: "right" }}>Retur</th>
                <th style={{ width: 130, textAlign: "right" }}>Omset bersih</th>
                <th style={{ width: 120, textAlign: "right" }}>Rata-rata/struk</th>
                <th style={{ width: 110, textAlign: "right" }}>Diskon diberi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, fontWeight: i < 3 ? 800 : 400, color: i < 3 ? "#b45309" : "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.cabangTeks}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.trx}x</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(r.omset)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.retur ? "#b91c1c" : "var(--td)" }}>
                    {r.retur ? `− ${rp(r.retur)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.bersih)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(r.rata)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.diskon ? "#b45309" : "var(--td)" }}>
                    {r.diskon ? rp(r.diskon) : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <TabelKosong kolom={9} pesan="Belum ada transaksi di rentang tanggal ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Omset bersih sudah dikurangi retur penjualan di rentang tanggal ini; peringkat kasir memakai angka bersih.
          Kolom &quot;diskon diberi&quot; berguna untuk melihat siapa yang paling sering memotong harga.
        </div>
      </div>
    </LaporanPage>
  );
}
