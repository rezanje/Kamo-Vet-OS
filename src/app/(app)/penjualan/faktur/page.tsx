import { NumberInput } from "@/components/NumberInput";
import {readCompleteList} from "@/lib/checked-list";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { loadSalesChannelTrace } from "@/lib/sales-channel-trace";
import {loadSalesInvoicePayments} from "@/lib/sales-invoice-payments-server";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { agingFaktur, AGING_LABEL, TANPA_TANGGAL } from "@/lib/aging";
import { sisaTagihan } from "@/lib/penjualan-dokumen";
import { terimaPembayaranJual } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import Link from "next/link";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string | null) => !s ? "Tidak ada" : new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Faktur = {
  /** Kosong hanya pada faktur saldo awal yang di Accurate tidak punya tanggal ini (M05). */
  id: string; no_faktur: string; tanggal: string | null; jatuh_tempo: string | null;
  dpp: number; ppn: number; total: number; carried_paid: number; status: string; customer_id: string | null;
  kategori: string | null;
  catatan: string | null;
  opening_batch_id: string | null;
  customers: Rel<{ name: string }>;
  sales_orders: Rel<{ no_pesanan: string }>;
  sales_receipts: { jumlah: number }[] | null;
};

type FakturKlinik = {
  id: string; visit_id: string; invoice_no: string; created_at: string;
  total: number; dp_amount: number; paid_status: string;
  visits: Rel<{ pets: Rel<{ name: string }>; customers: Rel<{ name: string }>; branches: Rel<{ name: string }> }>;
  invoice_payments: { amount: number }[] | null;
};

export default async function FakturJualPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; hal?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const boleh = await bolehTransaksiKas();
  const today = hariIniWIB();
  const strukPromise = loadSalesChannelTrace(supabase, user?.id ?? null, sp.hal)
    .then(page => ({ page, error: null as unknown }))
    .catch(error => ({ page: null, error }));

  type Advance={id:string;no_um:string;customer_id:string|null;jumlah:number;terpakai:number};
  type Credit={id:string;tanggal:string;customer_credit:number;sales_invoices:Rel<{id:string;no_faktur:string;customers:Rel<{name:string}>}>};
  const [invData,klinikData,umData,rekening,credits]=await Promise.all([
    readCompleteList<Omit<Faktur,'sales_receipts'>>((from,to)=>supabase.from('sales_invoices')
      .select('id,no_faktur,tanggal,jatuh_tempo,dpp,ppn,total,carried_paid,status,customer_id,kategori,catatan,opening_batch_id,customers(name),sales_orders(no_pesanan)',{count:'exact'})
      .order('jatuh_tempo').order('id').range(from,to),'Faktur penjualan',{maxRows:null}),
    readCompleteList<Omit<FakturKlinik,'invoice_payments'>>((from,to)=>supabase.from('invoices')
      .select('id,visit_id,invoice_no,created_at,total,dp_amount,paid_status,visits(pets(name),customers(name),branches(name))',{count:'exact'})
      .is('voided_at',null).order('created_at',{ascending:false}).order('id').range(from,to),'Faktur klinik',{maxRows:null}),
    readCompleteList<Advance>((from,to)=>supabase.from('sales_advances').select('id,no_um,customer_id,jumlah,terpakai',{count:'exact'})
      .eq('status','aktif').order('id').range(from,to),'Uang muka pelanggan',{maxRows:null}),
    loadRekeningAktif(supabase),
    readCompleteList<Credit>((from,to)=>supabase.from('wholesale_invoice_corrections')
      .select('id,tanggal,customer_credit,sales_invoices!invoice_id(id,no_faktur,customers(name))',{count:'exact'})
      .gt('customer_credit',0).order('tanggal').order('id').range(from,to),'Kredit pelanggan',{maxRows:null}),
  ]);
  const {receipts,payments}=await loadSalesInvoicePayments(supabase,invData.map(row=>row.id),klinikData.map(row=>row.id));
  const faktur:Faktur[]=invData.map(row=>({...row,sales_receipts:receipts.get(row.id)??[]}));
  const fakturKlinik:FakturKlinik[]=klinikData.map(row=>({...row,invoice_payments:payments.get(row.id)??[]}));
  const { page: strukPage, error: strukError } = await strukPromise;

  // Uang muka aktif per pelanggan, supaya DP yang sudah masuk tidak terlupa saat menagih.
  const umPerPelanggan = new Map<string, { id: string; no_um: string; sisa: number }[]>();
  for (const u of umData) {
    const sisa = Number(u.jumlah) - Number(u.terpakai);
    if (!u.customer_id || sisa <= 0) continue;
    const arr = umPerPelanggan.get(u.customer_id) ?? [];
    arr.push({ id: u.id, no_um: u.no_um, sisa });
    umPerPelanggan.set(u.customer_id, arr);
  }

  const rows = faktur.map((f) => {
    const sisa = f.status === "batal" ? 0 : sisaTagihan(Number(f.total) - Number(f.carried_paid ?? 0), (f.sales_receipts ?? []) as { jumlah: number }[]);
    const { days: hari, bucket } = agingFaktur(f.jatuh_tempo, today);
    return { f, sisa, hari, bucket };
  });
  const berjalan = rows.filter((r) => r.sisa > 0 && r.f.status !== "batal");
  const totalPiutang = berjalan.reduce((a, r) => a + r.sisa, 0);

  return (
    <MasterPage
      back="/penjualan" icon="ti-receipt-2" title="FAKTUR & PENERIMAAN PENJUALAN"
      desc="Tagihan ke pelanggan dan pelunasannya"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mencatat penerimaan."
    >
      <div className="crm-sec">
        <SecHeader num="01" title="TAGIHAN KLINIK" desc="Semua tagihan hasil pemeriksaan, termasuk yang belum lunas dan sudah lunas." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 850 }}>
            <thead><tr><th>No. tagihan</th><th>Pelanggan / hewan</th><th>Cabang</th><th>Tanggal</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Sisa</th><th>Status</th><th /></tr></thead>
            <tbody>
              {fakturKlinik.map((invoice) => {
                const visit = one(invoice.visits);
                // Initial single-method payment is recorded on the invoice itself;
                // it does not create invoice_payments rows.
                const paid = invoice.paid_status === "Lunas" ? Number(invoice.total)
                  : Number(invoice.dp_amount) + (invoice.invoice_payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
                const remaining = Math.max(0, Number(invoice.total) - paid);
                return <tr key={invoice.id}>
                  <td style={{ fontWeight: 600 }}>{invoice.invoice_no}</td>
                  <td>{one(visit?.customers ?? null)?.name ?? "—"}<div style={{ fontSize: 10, color: "var(--td)" }}>{one(visit?.pets ?? null)?.name ?? "—"}</div></td>
                  <td>{one(visit?.branches ?? null)?.name ?? "—"}</td>
                  <td>{new Date(invoice.created_at).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                  <td style={{ textAlign: "right" }}>{rp(Number(invoice.total))}</td>
                  <td style={{ textAlign: "right", color: remaining > 0 ? "#b45309" : "#15803d", fontWeight: 600 }}>{remaining > 0 ? rp(remaining) : "lunas"}</td>
                  <td><span className={`bge ${remaining > 0 ? "o" : "g"}`}>{remaining > 0 ? invoice.paid_status : "Lunas"}</span></td>
                  <td><Link className="btn-def" href={`/klinik/pembayaran/${invoice.visit_id}`} style={{ fontSize: 10 }}>Buka</Link></td>
                </tr>;
              })}
              {fakturKlinik.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: 18 }}>Belum ada tagihan klinik.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {credits.length > 0 && <div className="crm-sec">
        <SecHeader num="02" title="KREDIT PELANGGAN DARI KOREKSI GROSIR" desc="Kewajiban pelanggan pada akun 2103; perlu tinjauan keuangan untuk penyelesaian. Tidak ada refund/transfer otomatis." />
        <table className="tbl"><thead><tr><th>Tanggal</th><th>Pelanggan</th><th>Faktur asal</th><th>Kredit</th></tr></thead><tbody>
          {credits.map(c => { const f = one(c.sales_invoices); return <tr key={c.id}><td>{c.tanggal}</td><td>{one(f?.customers ?? null)?.name ?? "—"}</td><td><Link href={`/penjualan/faktur/${f?.id}`}>{f?.no_faktur}</Link></td><td>{rp(Number(c.customer_credit))}</td></tr>; })}
        </tbody></table>
      </div>}
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num={credits.length > 0 ? "03" : "02"} title="FAKTUR PENJUALAN RESELLER"
          desc={`Piutang berjalan ${rp(totalPiutang)} dari ${berjalan.length} faktur. Faktur diterbitkan dari halaman pesanan.`}
        />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. faktur</th>
                <th style={{ width: 120 }}>Pesanan</th>
                <th>Pelanggan</th>
                <th style={{ width: 110 }}>Jatuh tempo</th>
                <th style={{ width: 130, textAlign: "right" }}>Total</th>
                <th style={{ width: 130, textAlign: "right" }}>Sisa</th>
                <th style={{ width: 110 }}>Umur</th>
                {boleh && <th style={{ width: 120 }}>Terima</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ f, sisa, bucket }) => {
                const um = umPerPelanggan.get(f.customer_id ?? "") ?? [];
                return (
                  <tr key={f.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      <Link href={`/penjualan/faktur/${f.id}`}>{f.no_faktur}</Link>
                      {f.status === "batal" && <div className="bge x">Batal · riwayat disimpan</div>}
                      {Number(f.carried_paid) > 0 && <div style={{ fontSize: 10 }}>Pembayaran terbawa {rp(Number(f.carried_paid))}</div>}
                      {f.opening_batch_id && <div><span className="bge b">Saldo awal</span> <span style={{ fontSize: 9.5, fontWeight: 400, color: "var(--td)" }}>{f.catatan}</span></div>}
                      {f.kategori !== "selisih_stok" && !f.opening_batch_id && (
                        <div style={{ marginTop: 4 }}>
                          <Link href={`/keuangan/buku-besar/hpp/${encodeURIComponent(f.no_faktur)}`} style={{ fontSize: 9.5, fontWeight: 500 }}>
                            Lihat rincian HPP
                          </Link>
                        </div>
                      )}
                      {/* Faktur selisih stok lahir otomatis dari hasil opname, bukan dari
                          pesanan pelanggan — dibedakan supaya tidak dibaca sebagai penjualan. */}
                      {f.kategori === "selisih_stok" && (
                        <span className="bge o" style={{ marginLeft: 5 }}>Selisih stok</span>
                      )}
                      {Number(f.ppn) > 0 && (
                        <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>
                          DPP {rp(Number(f.dpp))} + PPN {rp(Number(f.ppn))}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{one(f.sales_orders)?.no_pesanan ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{one(f.customers)?.name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{tgl(f.jatuh_tempo)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(f.total))}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: sisa > 0 ? "#b45309" : "#15803d" }}>
                      {f.status === "batal" ? "batal" : sisa > 0 ? rp(sisa) : "lunas"}
                    </td>
                    <td style={{ fontSize: 10.5 }}>
                      {sisa > 0
                        ? bucket === TANPA_TANGGAL
                          ? <span className="bge x">Tanpa jatuh tempo</span>
                          : <span className={`bge ${bucket === "current" ? "g" : bucket === "d1_30" ? "o" : "r"}`}>{AGING_LABEL[bucket]}</span>
                        : <span className={`bge ${f.status === "batal" ? "x" : "g"}`}>{f.status === "batal" ? "Batal" : "Lunas"}</span>}
                    </td>
                    {boleh && (
                      <td>
                        {(
                          <details>
                            <summary className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
                              {sisa > 0 && f.status !== "batal" ? "Terima / periksa" : "Periksa penerimaan"}
                            </summary>
                            <TransactionForm userId={user?.id ?? ""} scope={`sales-payment:${f.id}`} action={terimaPembayaranJual} style={{ display: "flex", gap: 6, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
                              <input type="hidden" name="invoice_id" value={f.id} />
                              <div>
                                <label className="flab">Nominal (maks {rp(sisa)})</label>
                                <NumberInput className="fi" type="number" name="jumlah" min={1} max={sisa} step="any" defaultValue={sisa} style={{ width: 140 }} />
                              </div>
                              <div>
                                <label className="flab">Metode</label>
                                <select className="fi" name="metode" defaultValue="Transfer" style={{ width: 110 }}>
                                  {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                              </div>
                              <PilihRekening rekening={rekening} label="Masuk ke" width={150} />
                              {um.length > 0 && (
                                <div>
                                  <label className="flab">Potong uang muka</label>
                                  <select className="fi" name="advance_id" defaultValue="" style={{ width: 190 }}>
                                    <option value="">— tidak pakai —</option>
                                    {um.map((u) => <option key={u.id} value={u.id}>{u.no_um} · sisa {rp(u.sisa)}</option>)}
                                  </select>
                                </div>
                              )}
                              <div>
                                <label className="flab">Tanggal</label>
                                <input className="fi" type="date" name="tanggal" defaultValue={today} style={{ width: 140 }} />
                              </div>
                              {sisa > 0 && f.status !== "batal" && <SubmitButton className="btn-acc" name="tindakan" value="simpan" icon="ti-cash" pendingText="Menyimpan…" style={{ padding: "7px 12px", fontSize: 11 }}>Simpan</SubmitButton>}
                              <button type="submit" className="btn-def" name="tindakan" value="periksa" formNoValidate>Periksa hasil terakhir</button>
                            </TransactionForm>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={boleh ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada faktur penjualan. Terbitkan dari halaman pesanan setelah barangnya dikirim.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="crm-sec">
        <SecHeader num={credits.length > 0 ? "04" : "03"} title="STRUK POS & ONLINE · BUKAN FAKTUR"
          desc="Jejak kanal lain untuk ditelusuri pada dokumen asal. Koreksi harga, jumlah, atau penerimaan tidak dilakukan dari daftar ini." />
        {strukError ? <ListLoadFailure error={strukError} label="Struk POS dan Online" /> : <>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 700 }}>
              <thead><tr><th>No. struk</th><th>Kanal</th><th>Pelanggan</th><th>Cabang</th><th>Tanggal</th><th /></tr></thead>
              <tbody>
                {strukPage?.rows.map(struk => <tr key={struk.id}>
                  <td style={{ fontWeight: 600 }}>{struk.no_struk ?? "Struk belum bernomor"}</td>
                  <td>{struk.channel ?? "POS"}</td>
                  <td>{one(struk.customers)?.name ?? "Pelanggan umum"}</td>
                  <td>{one(struk.branches)?.name ?? "—"}</td>
                  <td>{new Date(struk.created_at).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                  <td><Link href={`/penjualan/${struk.id}`} className="btn-def">Buka struk asal</Link></td>
                </tr>)}
                {strukPage?.rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 18 }}>Belum ada struk POS atau Online yang dapat diakses.</td></tr>}
              </tbody>
            </table>
          </div>
          {strukPage && <ListPagination path="/penjualan/faktur" query={{}} total={strukPage.count} pageInfo={strukPage.pageInfo} />}
        </>}
      </div>
    </MasterPage>
  );
}
