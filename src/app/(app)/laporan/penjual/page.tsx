import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { kumpulkanBarisKomisi } from "@/lib/komisi-data";
import { labelBulan } from "@/lib/pertumbuhan";
import { tanggalIndo } from "@/lib/followup";
import { hariIniWIB } from "@/lib/tanggal";
import type { SumberJual } from "@/lib/komisi";

// Penjualan per Tenaga Penjual — permintaan Kamo Group 24 Agu 2026, tiga baris sekaligus:
// "penjualan barang per penjual", "faktur penjualan per penjual", dan
// "faktur belum lunas per penjual".
//
// Periodenya bulanan supaya angkanya persis sama dengan layar Komisi dan Target —
// tiga layar yang membicarakan hal yang sama tidak boleh menunjuk angka berbeda.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const num = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

const periodeSekarang = () => hariIniWIB().slice(0, 7);

const LABEL_SUMBER: Record<SumberJual, string> = {
  kasir: "Kasir / petshop", klinik: "Klinik", reseller: "Reseller B2B",
};
const SUMBER: SumberJual[] = ["kasir", "klinik", "reseller"];

export default async function PenjualPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const sp = await searchParams;
  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : periodeSekarang();
  const awal = `${periode}-01`;
  const akhir = new Date(Date.UTC(Number(periode.slice(0, 4)), Number(periode.slice(5, 7)), 0))
    .toISOString().slice(0, 10);

  const supabase = await createClient();
  const [{ baris, omzetTanpaPenjual }, { data: empData }, { data: itemData }, { data: fjData }, { data: rcData }] =
    await Promise.all([
      kumpulkanBarisKomisi(supabase, periode),
      supabase.from("employees").select("id, nama, profile_id, status"),
      supabase.from("items").select("id, name, unit"),
      supabase.from("sales_invoices")
        .select("id, no_faktur, tanggal, jatuh_tempo, total, status, created_by, customers(name)")
        .neq("status", "batal").gte("tanggal", awal).lte("tanggal", akhir),
      supabase.from("sales_receipts").select("invoice_id, jumlah"),
    ]);

  type Emp = { id: string; nama: string; profile_id: string | null; status: string | null };
  const karyawan = (empData ?? []) as Emp[];
  const namaEmp = new Map(karyawan.map((e) => [e.id, e.nama]));
  const empPerProfile = new Map(karyawan.filter((e) => e.profile_id).map((e) => [e.profile_id as string, e.id]));
  const namaItem = new Map(((itemData ?? []) as { id: string; name: string; unit: string | null }[])
    .map((i) => [i.id, i]));

  // ── Rekap per penjual + rincian barangnya ──────────────────────────────────
  type Rekap = {
    employeeId: string; nama: string;
    omzet: number; laba: number; adaLabaTakDiketahui: boolean; qty: number; barisJual: number;
    perSumber: Record<SumberJual, number>;
    perBarang: Map<string, { nama: string; satuan: string; qty: number; omzet: number }>;
  };
  const perPenjual = new Map<string, Rekap>();

  for (const b of baris) {
    if (!b.employeeId) continue;
    const row = perPenjual.get(b.employeeId) ?? {
      employeeId: b.employeeId,
      nama: namaEmp.get(b.employeeId) ?? "(karyawan terhapus)",
      omzet: 0, laba: 0, adaLabaTakDiketahui: false, qty: 0, barisJual: 0,
      perSumber: { kasir: 0, klinik: 0, reseller: 0 },
      perBarang: new Map(),
    };
    row.omzet += b.omzet;
    row.qty += b.qty;
    row.barisJual++;
    row.perSumber[b.sumber] += b.omzet;
    if (b.laba === null) row.adaLabaTakDiketahui = true; else row.laba += b.laba;

    const master = b.itemId ? namaItem.get(b.itemId) : undefined;
    const kunci = b.itemId ?? "jasa";
    const brg = row.perBarang.get(kunci) ?? {
      nama: master?.name ?? "Jasa / tanpa master barang",
      satuan: master?.unit ?? "—", qty: 0, omzet: 0,
    };
    brg.qty += b.qty;
    brg.omzet += b.omzet;
    row.perBarang.set(kunci, brg);
    perPenjual.set(b.employeeId, row);
  }
  const penjualRows = [...perPenjual.values()].sort((a, b) => b.omzet - a.omzet);

  // ── Faktur penjualan per penjual ───────────────────────────────────────────
  const dibayarPer = new Map<string, number>();
  for (const r of (rcData ?? []) as { invoice_id: string; jumlah: number }[]) {
    dibayarPer.set(r.invoice_id, (dibayarPer.get(r.invoice_id) ?? 0) + (Number(r.jumlah) || 0));
  }

  type Fj = {
    id: string; no_faktur: string; tanggal: string; jatuh_tempo: string | null; total: number;
    status: string | null; created_by: string | null; customers: Rel<{ name: string }>;
  };
  const faktur = ((fjData ?? []) as unknown as Fj[]).map((f) => {
    const empId = f.created_by ? empPerProfile.get(f.created_by) ?? null : null;
    const dibayar = dibayarPer.get(f.id) ?? 0;
    return {
      ...f,
      empId,
      penjual: empId ? namaEmp.get(empId) ?? "(karyawan terhapus)" : "(tanpa penjual)",
      pelanggan: one(f.customers)?.name ?? "—",
      dibayar,
      sisa: Math.max(0, (Number(f.total) || 0) - dibayar),
    };
  }).sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.no_faktur.localeCompare(b.no_faktur));

  type Outstanding = { penjual: string; faktur: number; nilai: number; lunas: number; belum: number; sisa: number };
  const perPenjualFaktur = new Map<string, Outstanding>();
  for (const f of faktur) {
    const kunci = f.penjual;
    const row = perPenjualFaktur.get(kunci) ?? { penjual: kunci, faktur: 0, nilai: 0, lunas: 0, belum: 0, sisa: 0 };
    row.faktur++;
    row.nilai += Number(f.total) || 0;
    row.sisa += f.sisa;
    if (f.sisa > 0) row.belum++; else row.lunas++;
    perPenjualFaktur.set(kunci, row);
  }
  const fakturRows = [...perPenjualFaktur.values()].sort((a, b) => b.sisa - a.sisa || b.nilai - a.nilai);

  const totalOmzet = penjualRows.reduce((a, r) => a + r.omzet, 0);
  const totalSisaFaktur = fakturRows.reduce((a, r) => a + r.sisa, 0);

  return (
    <LaporanPage
      icon="ti-user-dollar" title="PENJUALAN PER TENAGA PENJUAL"
      desc="Siapa menjual apa, berapa fakturnya, dan berapa yang tagihannya belum tertagih."
      filter={
        <>
          <div style={{ minWidth: 170 }}>
            <label className="flab">Periode</label>
            <input className="fi" type="month" name="periode" defaultValue={periode} />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Periode", nilai: labelBulan(periode) },
          { label: "Penjual aktif", nilai: `${penjualRows.length} orang` },
          { label: "Omzet ternisbahkan", nilai: rp(totalOmzet), warna: "#15803d" },
          { label: "Omzet tanpa penjual", nilai: rp(omzetTanpaPenjual), warna: omzetTanpaPenjual ? "#b45309" : undefined },
          { label: "Faktur reseller", nilai: `${faktur.length} faktur` },
          { label: "Faktur belum lunas", nilai: rp(totalSisaFaktur), warna: totalSisaFaktur ? "#b91c1c" : "#15803d" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · REKAP PER PENJUAL</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Penjual</th>
                {SUMBER.map((s) => <th key={s} style={{ width: 130, textAlign: "right" }}>{LABEL_SUMBER[s]}</th>)}
                <th style={{ width: 140, textAlign: "right" }}>Omzet</th>
                <th style={{ width: 130, textAlign: "right" }}>Laba kotor</th>
                <th style={{ width: 90, textAlign: "center" }}>Unit terjual</th>
              </tr>
            </thead>
            <tbody>
              {penjualRows.map((r) => (
                <tr key={r.employeeId}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  {SUMBER.map((s) => (
                    <td key={s} style={{ textAlign: "right", fontSize: 11, color: r.perSumber[s] ? "var(--tm)" : "var(--td)" }}>
                      {r.perSumber[s] ? rp(r.perSumber[s]) : "—"}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.omzet)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "#15803d" }}>
                    {rp(r.laba)}{r.adaLabaTakDiketahui && <span style={{ color: "#b45309" }}> *</span>}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{num(r.qty)}</td>
                </tr>
              ))}
              {penjualRows.length === 0 && (
                <TabelKosong kolom={7} pesan="Belum ada penjualan yang bisa dinisbahkan ke karyawan di periode ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Penjualnya dikenali lewat akun yang menutup transaksi: kasir untuk struk POS, dokter
          untuk tagihan klinik yang sudah lunas, dan pembuat faktur untuk penjualan reseller.
          Akun yang belum dihubungkan ke kartu karyawan masuk ke &quot;omzet tanpa penjual&quot;
          di kartu ringkasan — omzetnya nyata, cuma belum bisa dinisbahkan ke orang.<br />
          Tanda <b style={{ color: "#b45309" }}>*</b> berarti ada baris yang modalnya tidak
          diketahui, jadi laba kotornya lebih tinggi dari yang sebenarnya.
        </div>
      </div>

      {penjualRows.map((r) => (
        <details key={r.employeeId} className="crm-sec" style={{ marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>Barang yang dijual {r.nama}</span>
            <span style={{ fontWeight: 600, color: "var(--tm)" }}>
              {r.perBarang.size} jenis · {rp(r.omzet)}
            </span>
          </summary>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table className="tbl" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Barang</th>
                  <th style={{ width: 130, textAlign: "right" }}>Jumlah</th>
                  <th style={{ width: 150, textAlign: "right" }}>Omzet</th>
                </tr>
              </thead>
              <tbody>
                {[...r.perBarang.values()].sort((a, b) => b.omzet - a.omzet).map((b) => (
                  <tr key={b.nama}>
                    <td style={{ fontSize: 11 }}>{b.nama}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{num(b.qty)} {b.satuan}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(b.omzet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · FAKTUR BELUM LUNAS PER PENJUAL</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Penjual</th>
                <th style={{ width: 80, textAlign: "center" }}>Faktur</th>
                <th style={{ width: 80, textAlign: "center" }}>Lunas</th>
                <th style={{ width: 100, textAlign: "center" }}>Belum lunas</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai faktur</th>
                <th style={{ width: 140, textAlign: "right" }}>Belum tertagih</th>
              </tr>
            </thead>
            <tbody>
              {fakturRows.map((r) => (
                <tr key={r.penjual}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.penjual}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.faktur}</td>
                  <td style={{ textAlign: "center", fontSize: 11, color: "#15803d" }}>{r.lunas}</td>
                  <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: r.belum ? "#b91c1c" : "var(--td)" }}>{r.belum}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.nilai)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: r.sisa ? "#b91c1c" : "var(--td)" }}>
                    {r.sisa ? rp(r.sisa) : "lunas semua"}
                  </td>
                </tr>
              ))}
              {fakturRows.length === 0 && (
                <TabelKosong kolom={6} pesan="Belum ada faktur penjualan reseller di periode ini." />
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · RINCIAN FAKTUR PENJUALAN</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. faktur</th>
                <th style={{ width: 95 }}>Tanggal</th>
                <th style={{ width: 95 }}>Jatuh tempo</th>
                <th>Pelanggan</th>
                <th style={{ width: 160 }}>Penjual</th>
                <th style={{ width: 130, textAlign: "right" }}>Nilai</th>
                <th style={{ width: 130, textAlign: "right" }}>Dibayar</th>
                <th style={{ width: 130, textAlign: "right" }}>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {faktur.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontSize: 11, fontWeight: 700 }}>{f.no_faktur}</td>
                  <td style={{ fontSize: 10.5 }}>{tanggalIndo(f.tanggal)}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{f.jatuh_tempo ? tanggalIndo(f.jatuh_tempo) : "—"}</td>
                  <td style={{ fontSize: 11 }}>{f.pelanggan}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{f.penjual}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(f.total) || 0)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: f.dibayar ? "#15803d" : "var(--td)" }}>
                    {f.dibayar ? rp(f.dibayar) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: f.sisa ? "#b91c1c" : "var(--td)" }}>
                    {f.sisa ? rp(f.sisa) : "lunas"}
                  </td>
                </tr>
              ))}
              {faktur.length === 0 && <TabelKosong kolom={8} pesan="Belum ada faktur penjualan reseller di periode ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Yang masuk di sini hanya faktur penjualan reseller (B2B). Struk kasir dan tagihan klinik
          tidak berbentuk faktur berjangka, jadi tidak punya sisa tagihan per penjual —
          keduanya sudah terhitung di rekap omzet paling atas.
        </div>
      </div>
    </LaporanPage>
  );
}
