import { NumberInput } from "@/components/NumberInput";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { AGING_BUCKETS, AGING_LABEL, TANPA_TANGGAL, agingFaktur, type AgingBucket, type AgingBucketFaktur } from "@/lib/aging";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { terimaPelunasan } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" }) : "—");

type Row = {
  /** Kosong hanya pada faktur saldo awal yang di Accurate tidak punya tanggal faktur (M05). */
  id: string; invoice_no: string | null; tanggal: string | null; customer: string;
  total: number; dibayar: number; sisa: number; days: number | null; bucket: AgingBucketFaktur;
  /** klinik = tagihan kunjungan (dilunasi di layar ini) · reseller = faktur penjualan B2B
   *  · ranap = tagihan rawat inap (dilunasi di layar Tagihan rawat inap supaya jadi kwitansi). */
  sumber: "klinik" | "reseller" | "ranap";
  /** id rawat inap untuk baris `ranap`. */
  recordId?: string | null;
  visitId?: string | null;
  /** Faktur saldo awal impor Accurate (M05): nomor faktur Accurate ada di catatan. */
  saldoAwal?: string | null;
};

export default async function PiutangPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();
  const today = hariIniWIB();
  const rekening = await loadRekeningAktif(supabase);

  // Invoice aktif yang belum lunas + pembayaran yang sudah masuk.
  // Faktur penjualan reseller (rantai dokumen, migrasi 0098) ikut ditarik: piutangnya
  // masuk akun 1201 yang sama, jadi kalau tidak dijumlah di sini umur piutang perusahaan
  // terbaca lebih kecil dari yang sebenarnya.
  const [{ data: invs }, { data: fjs }, { data: rcs }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, visit_id, invoice_no, total, dp_amount, paid_status, created_at, visits(customers(name), inpatient_records(id))")
      .is("voided_at", null)
      .neq("paid_status", "Lunas")
      .order("created_at"),
    supabase
      .from("sales_invoices")
      .select("id, no_faktur, tanggal, total, carried_paid, returned_ar, opening_batch_id, catatan, customers(name)")
      .neq("status", "batal")
      .order("tanggal"),
    supabase.from("sales_receipts").select("invoice_id, jumlah"),
  ]);

  const ids = (invs ?? []).map((i) => i.id);
  const { data: pays } = ids.length
    ? await supabase.from("invoice_payments").select("invoice_id, amount").in("invoice_id", ids)
    : { data: [] as { invoice_id: string; amount: number }[] };

  const paidMap = new Map<string, number>();
  for (const p of pays ?? []) paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + Number(p.amount));

  const fjPaid = new Map<string, number>();
  for (const r of (rcs ?? []) as { invoice_id: string; jumlah: number }[]) {
    fjPaid.set(r.invoice_id, (fjPaid.get(r.invoice_id) ?? 0) + Number(r.jumlah));
  }

  const barisReseller: Row[] = ((fjs ?? []) as unknown as {
    id: string; no_faktur: string; tanggal: string | null; total: number; carried_paid: number; returned_ar?: number | null;
    opening_batch_id: string | null; catatan: string | null;
    customers: { name: string } | { name: string }[] | null;
  }[])
    .map((f) => {
      const cust = Array.isArray(f.customers) ? f.customers[0] : f.customers;
      // Retur faktur grosir mengurangi piutang tanpa uang masuk; dihitung sebagai bagian yang sudah selesai.
      const dibayar = Number(f.carried_paid ?? 0) + Number(f.returned_ar ?? 0) + (fjPaid.get(f.id) ?? 0);
      return {
        id: f.id, invoice_no: f.no_faktur, tanggal: f.tanggal,
        customer: cust?.name ?? "—",
        total: Number(f.total), dibayar, sisa: Math.max(0, Number(f.total) - dibayar),
        ...agingFaktur(f.tanggal, today),
        sumber: "reseller" as const,
        saldoAwal: f.opening_batch_id ? (f.catatan ?? "Saldo awal") : null,
      };
    })
    .filter((r) => r.sisa > 0);

  const barisKlinik: Row[] = (invs ?? [])
    .map((i): Row => {
      const visit = Array.isArray(i.visits) ? i.visits[0] : i.visits;
      const cust = visit && (Array.isArray(visit.customers) ? visit.customers[0] : visit.customers);
      const tanggal = String(i.created_at).slice(0, 10);
      const dibayar = Number(i.dp_amount) + (paidMap.get(i.id) ?? 0);
      const sisa = Math.max(0, Number(i.total) - dibayar);
      // Tagihan rawat inap tidak dilunasi di layar ini: uangnya harus jadi kwitansi
      // kunjungan di dalam shift klinik (riwayat DP + rekonsiliasi laci kasir).
      const ranapRel = visit && (visit as { inpatient_records?: { id: string }[] | { id: string } | null }).inpatient_records;
      const record = Array.isArray(ranapRel) ? ranapRel[0] : ranapRel;
      return {
        id: i.id, invoice_no: i.invoice_no, tanggal,
        customer: cust?.name ?? "—",
        total: Number(i.total), dibayar, sisa,
        ...agingFaktur(tanggal, today),
        sumber: record?.id ? "ranap" : "klinik",
        recordId: record?.id ?? null,
        visitId: i.visit_id ?? null,
      };
    })
    .filter((r) => r.sisa > 0);

  // Tanpa tanggal faktur diletakkan paling bawah: urutannya tidak ditebak.
  const rows: Row[] = [...barisKlinik, ...barisReseller].sort((a, b) =>
    a.tanggal === null || b.tanggal === null ? Number(a.tanggal === null) - Number(b.tanggal === null) : a.tanggal.localeCompare(b.tanggal));

  const totalSisa = rows.reduce((a, r) => a + r.sisa, 0);
  const sisaReseller = barisReseller.reduce((a, r) => a + r.sisa, 0);
  const perBucket = Object.fromEntries(AGING_BUCKETS.map((b) => [b, rows.filter((r) => r.bucket === b).reduce((a, r) => a + r.sisa, 0)])) as Record<AgingBucket, number>;
  // Faktur saldo awal tanpa tanggal faktur: ikut total piutang, tapi tidak dimasukkan ke kelompok umur mana pun.
  const tanpaTanggal = rows.filter((r) => r.bucket === TANPA_TANGGAL);
  const sisaTanpaTanggal = tanpaTanggal.reduce((a, r) => a + r.sisa, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Piutang Usaha (AR)</span>
        <Link href="/keuangan/piutang/pembantu" className="back-btn" style={{ marginLeft: "auto" }}>
          <i className="ti ti-book-2" /> Buku Besar Pembantu
        </Link>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Pelunasan tersimpan & sudah dijurnal.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-triangle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="UMUR PIUTANG (AR AGING)" desc="Piutang dikelompokkan menurut umur faktur." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
          {AGING_BUCKETS.map((b) => (
            <div key={b} className="card" style={{ textAlign: "center", background: b === "d90plus" && perBucket[b] > 0 ? "#fef2f2" : "var(--sf1)" }}>
              <div style={{ fontSize: 10, color: "var(--tm)", fontWeight: 600 }}>{AGING_LABEL[b]}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{rp(perBucket[b])}</div>
            </div>
          ))}
          {tanpaTanggal.length > 0 && (
            <div className="card" style={{ textAlign: "center", background: "#f3f4f6" }}
              title="Faktur saldo awal yang di Accurate tidak punya tanggal faktur. Umurnya belum dihitung sampai ada keputusan aturan.">
              <div style={{ fontSize: 10, color: "var(--tm)", fontWeight: 600 }}>Tanpa tanggal faktur · {tanpaTanggal.length}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{rp(sisaTanpaTanggal)}</div>
            </div>
          )}
          <div className="card" style={{ textAlign: "center", background: "#eff6ff" }}>
            <div style={{ fontSize: 10, color: "#2563eb", fontWeight: 600 }}>TOTAL PIUTANG</div>
            <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2, color: "#2563eb" }}>{rp(totalSisa)}</div>
          </div>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="02" title="DAFTAR PIUTANG & PELUNASAN"
          desc={
            sisaReseller > 0
              ? `Terima pembayaran sisa tagihan — jurnal kas & piutang otomatis. Termasuk ${rp(sisaReseller)} piutang reseller (dilunasi di layar Faktur Penjualan). Tagihan rawat inap dilunasi di layar Tagihan rawat inap.`
              : "Terima pembayaran sisa tagihan — jurnal kas & piutang otomatis. Tagihan rawat inap dilunasi di layar Tagihan rawat inap."
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr><th>Invoice</th><th>Sumber</th><th>Tanggal</th><th>Pelanggan</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Dibayar</th><th style={{ textAlign: "right" }}>Sisa</th><th>Umur</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{r.invoice_no ?? "—"}{r.saldoAwal && <div style={{ fontFamily: "inherit", fontSize: 9.5, color: "var(--td)" }}>{r.saldoAwal}</div>}</td>
                  <td><span className={`bge ${r.sumber === "reseller" ? "b" : ""}`}>{r.saldoAwal ? "Saldo awal" : r.sumber === "reseller" ? "Reseller" : r.sumber === "ranap" ? "Rawat inap" : "Klinik"}</span></td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.tanggal ? fmtDate(r.tanggal) : "Tidak ada"}</td>
                  <td style={{ fontSize: 12 }}>{r.customer}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.total)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.dibayar)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(r.sisa)}</td>
                  <td>{r.days === null
                    ? <span className="bge x">Tanpa tanggal</span>
                    : <span className={`bge ${r.bucket === "current" || r.bucket === "d1_30" ? "g" : "r"}`}>{r.days} hari</span>}</td>
                  <td>
                    {/* Faktur reseller dilunasi di layar Faktur Penjualan — di sana pelunasan
                        bisa memotong uang muka pelanggan, yang form ini tidak tahu. */}
                    {r.sumber === "reseller" ? (
                      <Link href="/penjualan/faktur" className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, display: "inline-block" }}>
                        Terima bayar <i className="ti ti-arrow-right" />
                      </Link>
                    ) : r.sumber === "ranap" ? (
                      <Link href={`/klinik/pembayaran/${r.visitId}`} className="btn-def"
                        title="Uang rawat inap diterima sebagai kwitansi kunjungan di dalam shift klinik."
                        style={{ padding: "3px 9px", fontSize: 10.5, display: "inline-block" }}>
                        Bayar tagihan <i className="ti ti-arrow-right" />
                      </Link>
                    ) : (
                    <details>
                      <summary className="btn-def" style={{ cursor: "pointer", padding: "3px 9px", fontSize: 10.5, listStyle: "none", display: "inline-block" }}>Terima bayar</summary>
                      <TransactionForm userId={user?.id ?? ""} scope={`receivable-settle:${r.id}`} action={terimaPelunasan} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
                        <input type="hidden" name="invoice_id" value={r.id} />
                        <div>
                          <label className="flab">Tanggal</label>
                          <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} style={{ width: 130 }} />
                        </div>
                        <div>
                          <label className="flab">Nominal (maks {rp(r.sisa)})</label>
                          <NumberInput className="fi" type="number" name="amount" min={1} max={r.sisa} step="any" defaultValue={r.sisa} style={{ width: 140 }} />
                        </div>
                        <div>
                          <label className="flab">Metode</label>
                          <select className="fi" name="metode" defaultValue="Tunai" style={{ width: 110 }}>
                            <option>Tunai</option><option>QRIS</option><option>Transfer</option><option>Debit</option>
                          </select>
                        </div>
                        <PilihRekening rekening={rekening} width={150} />
                        <button type="submit" className="pay-btn" style={{ padding: "7px 12px", fontSize: 11 }}>Simpan</button>
                      </TransactionForm>
                    </details>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Tidak ada piutang — semua invoice lunas. 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
