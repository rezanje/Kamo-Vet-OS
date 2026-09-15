import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { agingBucket, agingDays, AGING_LABEL } from "@/lib/aging";
import { sisaTagihan } from "@/lib/penjualan-dokumen";
import { terimaPembayaranJual } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import Link from "next/link";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Faktur = {
  id: string; no_faktur: string; tanggal: string; jatuh_tempo: string;
  dpp: number; ppn: number; total: number; status: string; customer_id: string | null;
  kategori: string | null;
  catatan: string | null;
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
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();
  const today = hariIniWIB();

  const [{ data: invData }, { data: klinikData }, { data: umData }, rekening] = await Promise.all([
    supabase.from("sales_invoices")
      .select("id, no_faktur, tanggal, jatuh_tempo, dpp, ppn, total, status, customer_id, kategori, catatan, customers(name), sales_orders(no_pesanan), sales_receipts(jumlah)")
      .order("jatuh_tempo"),
    supabase.from("invoices")
      .select("id, visit_id, invoice_no, created_at, total, dp_amount, paid_status, visits(pets(name), customers(name), branches(name)), invoice_payments(amount)")
      .is("voided_at", null).order("created_at", { ascending: false }),
    supabase.from("sales_advances").select("id, no_um, customer_id, jumlah, terpakai").eq("status", "aktif"),
    loadRekeningAktif(supabase),
  ]);

  const faktur = (invData ?? []) as unknown as Faktur[];
  const fakturKlinik = (klinikData ?? []) as unknown as FakturKlinik[];

  // Uang muka aktif per pelanggan, supaya DP yang sudah masuk tidak terlupa saat menagih.
  const umPerPelanggan = new Map<string, { id: string; no_um: string; sisa: number }[]>();
  for (const u of (umData ?? []) as { id: string; no_um: string; customer_id: string | null; jumlah: number; terpakai: number }[]) {
    const sisa = Number(u.jumlah) - Number(u.terpakai);
    if (!u.customer_id || sisa <= 0) continue;
    const arr = umPerPelanggan.get(u.customer_id) ?? [];
    arr.push({ id: u.id, no_um: u.no_um, sisa });
    umPerPelanggan.set(u.customer_id, arr);
  }

  const rows = faktur.map((f) => {
    const sisa = sisaTagihan(Number(f.total), (f.sales_receipts ?? []) as { jumlah: number }[]);
    return { f, sisa, hari: agingDays(f.jatuh_tempo, today), bucket: agingBucket(f.jatuh_tempo, today) };
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
                const paid = Number(invoice.dp_amount) + (invoice.invoice_payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
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

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="02" title="FAKTUR PENJUALAN RESELLER"
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
                      {f.no_faktur}
                      {f.kategori !== "selisih_stok" && (
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
                      {sisa > 0 ? rp(sisa) : "lunas"}
                    </td>
                    <td style={{ fontSize: 10.5 }}>
                      {sisa > 0
                        ? <span className={`bge ${bucket === "current" ? "g" : bucket === "d1_30" ? "o" : "r"}`}>{AGING_LABEL[bucket]}</span>
                        : <span className="bge g">Lunas</span>}
                    </td>
                    {boleh && (
                      <td>
                        {sisa > 0 && f.status !== "batal" && (
                          <details>
                            <summary className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
                              Terima
                            </summary>
                            <form action={terimaPembayaranJual} style={{ display: "flex", gap: 6, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
                              <input type="hidden" name="invoice_id" value={f.id} />
                              <div>
                                <label className="flab">Nominal (maks {rp(sisa)})</label>
                                <input className="fi" type="number" name="jumlah" min={1} max={sisa} step="any" defaultValue={sisa} style={{ width: 140 }} />
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
                              <SubmitButton className="btn-acc" icon="ti-cash" pendingText="Menyimpan…" style={{ padding: "7px 12px", fontSize: 11 }}>
                                Simpan
                              </SubmitButton>
                            </form>
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
    </MasterPage>
  );
}
