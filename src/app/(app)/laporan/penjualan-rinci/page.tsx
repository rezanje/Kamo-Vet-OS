import { formatPosMoney } from "@/lib/pos-money";
import { completeReportQuery } from "@/lib/report-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import { batasTanggalWIB, KANAL_SEMUA, LABEL_KANAL, type Kanal } from "@/lib/laporan-transaksi";
import { fakturGrosirOmzet, omzetDokumenGrosir, SELECT_FAKTUR_GROSIR, type FakturGrosirInti } from "@/lib/laporan-grosir";
import { isCompletedSale, saleMerchandiseTotal, salePaymentDescription, saleRefundMerchantFee, type SalePaymentSource } from "@/lib/sale-payment-reporting";
import { hrefInvoiceKlinik } from "@/lib/tautan-dokumen";

// Rincian penjualan PER DOKUMEN (per struk / per invoice) — pelengkap laporan
// "Penjualan per Kasir" yang hanya menampilkan rekap per orang. Sebelum halaman ini
// ada, satu-satunya jalan melihat struk satuan adalah lewat layar Retur Penjualan.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = formatPosMoney;
const jam = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";
const tanggalDokumen = (t: string) =>
  new Date(`${t}T00:00:00+07:00`).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Jakarta",
  });

type Baris = {
  id: string;
  href: string;
  nomor: string;
  waktu: string;
  kanal: Kanal;
  cabang: string;
  cabangId: string | null;
  pelanggan: string;
  metode: string;
  total: number;
  merchandise: number;
  merchantFee: number;
  refundedFee: number;
  retur: number;
  status: string;
  /** Faktur grosir hanya punya tanggal, bukan jam — jamnya tidak boleh dikarang. */
  hanyaTanggal?: boolean;
};

const BADGE: Record<Kanal, { cls: string; style?: React.CSSProperties }> = {
  POS: { cls: "bge g" },
  Online: { cls: "bge", style: { background: "#fff1eb", color: "#ea580c" } },
  Klinik: { cls: "bge b" },
  Grosir: { cls: "bge", style: { background: "#f1f0ff", color: "#6d28d9" } },
};

export default async function PenjualanRinciPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string; cabang_id?: string; kanal?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";
  const cabangId = sp.cabang_id || "";
  const kanal = sp.kanal || "";

  const supabase = await createClient();
  // Rentang dipakai apa adanya sebagai batas hari WIB. created_at disimpan UTC,
  // jadi batasnya digeser 7 jam supaya struk jam 07:00 WIB tidak jatuh ke hari sebelumnya.
  const {mulai,akhir} = batasTanggalWIB(dari,sampai);

  const [{ data: sales }, { data: invoices }, { data: grosir }, { data: returs }, { data: cabangList }] = await Promise.all([
    completeReportQuery(supabase
      .from("sales")
      .select("id, branch_id, no_struk, total, merchant_fee_total, metode_bayar, channel, marketplace_status, created_at, payment_plan, payments_finalized_at, voided_at, sale_payments(method, amount, fee_percent, fee_amount), branches(name), customers(name)", { count: "exact" })
      .gte("created_at", mulai).lte("created_at", akhir)
      .order("created_at", { ascending: false })),
    completeReportQuery(supabase
      .from("invoices")
      .select("id, invoice_no, total, metode_bayar, paid_status, created_at, visit_id, visits(branch_id, branches(name), customers(name))", { count: "exact" })
      .is("voided_at", null)
      .gte("created_at", mulai).lte("created_at", akhir)
      .order("created_at", { ascending: false })),
    // Faktur grosir disaring memakai kolom tanggal faktur (sudah tanggal WIB),
    // bukan created_at: faktur boleh ditanggali mundur dari saat pengetikannya.
    completeReportQuery(supabase
      .from("sales_invoices")
      .select(`${SELECT_FAKTUR_GROSIR}, branches(name), customers(name)`, { count: "exact" })
      .gte("tanggal", dari).lte("tanggal", sampai)),
    // Retur ditarik tanpa batas tanggal: struk bulan lalu bisa diretur bulan ini,
    // dan omzet struk itu harus terlihat sudah berkurang di daftar ini.
    completeReportQuery(supabase.from("sales_returns").select("id, sale_id, total", { count: "exact" }).is("voided_at", null)),
    completeReportQuery(supabase.from("branches").select("id, name", { count: "exact" }).eq("is_active", true).order("name")),
  ]);

  const returPerStruk = new Map<string, number>();
  for (const r of (returs ?? []) as { sale_id: string; total: number }[]) {
    returPerStruk.set(r.sale_id, (returPerStruk.get(r.sale_id) ?? 0) + (Number(r.total) || 0));
  }

  type SaleRow = SalePaymentSource & {
    id: string; branch_id: string | null; no_struk: string | null; total: number; metode_bayar: string | null;
    channel: string | null; marketplace_status: string | null; created_at: string;
    branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
  };
  type InvRow = {
    id: string; invoice_no: string | null; total: number; metode_bayar: string | null;
    paid_status: string | null; created_at: string; visit_id: string;
    visits: Rel<{ branch_id: string | null; branches: Rel<{ name: string }>; customers: Rel<{ name: string }> }>;
  };

  const barisSales: Baris[] = ((sales ?? []) as unknown as SaleRow[]).filter(isCompletedSale).map((s) => ({
    id: s.id,
    href: `/penjualan/${s.id}`,
    nomor: s.no_struk ?? "—",
    waktu: s.created_at,
    kanal: s.channel ? "Online" : "POS",
    cabang: one(s.branches)?.name ?? "—",
    cabangId: s.branch_id ?? null,
    pelanggan: one(s.customers)?.name ?? "—",
    metode: s.channel ?? salePaymentDescription(s),
    total: Number(s.total) || 0,
    merchandise: saleMerchandiseTotal(s),
    merchantFee: Number(s.merchant_fee_total) || 0,
    refundedFee: saleRefundMerchantFee(s, returPerStruk.get(s.id) ?? 0),
    retur: returPerStruk.get(s.id) ?? 0,
    // Order marketplace baru jadi uang setelah dana cair; POS selalu lunas di kasir.
    status: s.channel ? (s.marketplace_status === "piutang" ? "Belum cair" : "Cair") : "Lunas",
  }));

  const barisKlinik: Baris[] = ((invoices ?? []) as unknown as InvRow[]).map((i) => {
    const v = one(i.visits);
    return {
      id: i.id,
      href: hrefInvoiceKlinik(i.visit_id, i.id),
      nomor: i.invoice_no ?? "—",
      waktu: i.created_at,
      kanal: "Klinik" as const,
      cabang: one(v?.branches ?? null)?.name ?? "—",
      cabangId: v?.branch_id ?? null,
      pelanggan: one(v?.customers ?? null)?.name ?? "—",
      metode: i.metode_bayar ?? "—",
      total: Number(i.total) || 0,
      merchandise: Number(i.total) || 0,
      merchantFee: 0,
      refundedFee: 0,
      retur: 0,               // retur klinik dicatat sebagai pembatalan invoice, bukan retur barang
      status: i.paid_status ?? "—",
    };
  });

  type GrosirRow = FakturGrosirInti & {
    no_faktur: string | null; branch_id: string | null; tanggal: string; total: number;
    branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
  };

  // Grosir tidak punya retur barang: koreksi nilai faktur dikerjakan dengan membatalkan
  // faktur lama dan menerbitkan penggantinya, dan yang batal sudah disaring di sini.
  const barisGrosir: Baris[] = fakturGrosirOmzet((grosir ?? []) as unknown as GrosirRow[]).map((f) => ({
    id: f.id,
    href: `/penjualan/faktur/${f.id}`,
    nomor: f.no_faktur ?? "—",
    waktu: `${f.tanggal}T00:00:00+07:00`,
    hanyaTanggal: true,
    kanal: "Grosir" as const,
    cabang: one(f.branches)?.name ?? "—",
    cabangId: f.branch_id ?? null,
    pelanggan: one(f.customers)?.name ?? "—",
    metode: "Faktur / tempo",
    total: omzetDokumenGrosir(f),
    merchandise: omzetDokumenGrosir(f),
    merchantFee: 0,
    refundedFee: 0,
    retur: 0,
    // Akrual: faktur yang masih berjalan tetap omzet, statusnya saja yang belum lunas.
    status: (f.status ?? "").trim().toLowerCase() === "lunas" ? "Lunas" : "Belum lunas",
  }));

  const rows = [...barisSales, ...barisKlinik, ...barisGrosir]
    .filter((r) => (cabangId ? r.cabangId === cabangId : cabang ? r.cabang === cabang : true))
    .filter((r) => (kanal ? r.kanal === kanal : true))
    // Dibandingkan sebagai waktu, bukan sebagai teks: struk memakai stempel UTC
    // sedangkan faktur grosir memakai awal hari WIB, jadi urutan hurufnya bisa keliru.
    .sort((a, b) => Date.parse(b.waktu) - Date.parse(a.waktu) || a.nomor.localeCompare(b.nomor));

  const totalOmzet = rows.reduce((a, r) => a + r.total, 0);
  const totalRetur = rows.reduce((a, r) => a + r.retur, 0);
  const totalFee = rows.reduce((a, r) => a + r.merchantFee, 0);
  const totalRefundedFee = rows.reduce((a, r) => a + r.refundedFee, 0);
  // Omzet yang dipakai per kanal = bersih setelah retur, supaya angka di kartu
  // ringkasan sama dengan uang yang benar-benar tinggal di perusahaan.
  const perKanal = (k: Kanal) =>
    rows.filter((r) => r.kanal === k).reduce((a, r) => a + r.total - r.retur, 0);

  return (
    <LaporanPage
      icon="ti-list-details" title="RINCIAN PENJUALAN PER TRANSAKSI"
      desc="Semua struk kasir, order online, invoice klinik, dan faktur penjualan grosir dalam satu daftar. Klik nomornya untuk melihat isi transaksi."
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
          <div style={{ minWidth: 190 }}>
            <label className="flab">Cabang</label>
            {cabangId ? <>
              <input type="hidden" name="cabang_id" value={cabangId}/>
              <div>{cabangList.find(b=>b.id===cabangId)?.name ?? rows[0]?.cabang ?? "Cabang tidak tersedia"} · {cabangId.slice(0,8)}</div>
              <Link href={`/laporan/transaksi-cabang?${new URLSearchParams({dari,sampai,...(kanal?{kanal}:{})})}`}>Ganti cabang / semua cabang</Link>
            </> : <>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(cabangList ?? []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
            </>}
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="flab">Jenis</label>
            <select className="fi" name="kanal" defaultValue={kanal}>
              <option value="">Semua jenis</option>
              {KANAL_SEMUA.map((k) => <option key={k} value={k}>{LABEL_KANAL[k]}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Jumlah transaksi", nilai: `${rows.length}x` },
          { label: "Nilai sebelum fee", nilai: rp(totalOmzet - totalFee) },
          { label: "Fee merchant", nilai: rp(totalFee) },
          { label: "Total tagihan", nilai: rp(totalOmzet) },
          { label: "Retur", nilai: totalRetur ? `− ${rp(totalRetur)}` : "—", warna: totalRetur ? "#b91c1c" : undefined },
          { label: "Retur fee", nilai: totalRefundedFee ? `− ${rp(totalRefundedFee)}` : "—" },
          { label: "Tagihan bersih", nilai: rp(totalOmzet - totalRetur), warna: "#15803d" },
          ...KANAL_SEMUA.map((k) => ({ label: LABEL_KANAL[k], nilai: rp(perKanal(k)) })),
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th style={{ width: 160 }}>No. Dokumen</th>
                <th style={{ width: 130 }}>Waktu</th>
                <th style={{ width: 80 }}>Jenis</th>
                <th>Cabang</th>
                <th>Pelanggan</th>
                <th style={{ width: 110 }}>Pembayaran</th>
                <th style={{ width: 90, textAlign: "center" }}>Status</th>
                <th style={{ width: 120, textAlign: "right" }}>Nilai sebelum fee</th>
                <th style={{ width: 110, textAlign: "right" }}>Fee merchant</th>
                <th style={{ width: 110, textAlign: "right" }}>Retur</th>
                <th style={{ width: 100, textAlign: "right" }}>Retur fee</th>
                <th style={{ width: 120, textAlign: "right" }}>Total bersih</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kanal}-${r.id}`}>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                    <Link href={r.href} style={{ color: "#2563eb", textDecoration: "none" }}>{r.nomor}</Link>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.hanyaTanggal ? tanggalDokumen(r.waktu.slice(0, 10)) : jam(r.waktu)}</td>
                  <td>
                    <span className={BADGE[r.kanal].cls} style={{ fontSize: 9, ...BADGE[r.kanal].style }}>{r.kanal}</span>
                  </td>
                  <td style={{ fontSize: 11 }}>{r.cabang}</td>
                  <td style={{ fontSize: 11 }}>{r.pelanggan}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.metode}</td>
                  <td style={{ textAlign: "center", fontSize: 10 }}>
                    <span className={`bge ${r.status === "Lunas" || r.status === "Cair" ? "g" : "r"}`} style={{ fontSize: 9 }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontSize: 10.5 }}>{rp(r.merchandise)}</td>
                  <td style={{ textAlign: "right", fontSize: 10.5 }}>{rp(r.merchantFee)}</td>
                  <td style={{ textAlign: "right", fontSize: 10.5, color: r.retur ? "#b91c1c" : "var(--td)" }}>
                    {r.retur ? `− ${rp(r.retur)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 10.5 }}>{r.refundedFee ? `− ${rp(r.refundedFee)}` : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>
                    {rp(r.total - r.retur)}
                    {r.retur > 0 && (
                      <div style={{ fontSize: 9, fontWeight: 400, color: "var(--td)" }}>dari {rp(r.total)}</div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <TabelKosong kolom={12} pesan="Belum ada transaksi di rentang tanggal ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Invoice klinik yang dibatalkan tidak ditampilkan. Order online berstatus &quot;Belum cair&quot;
          berarti dananya masih ditahan marketplace. Struk yang sebagian barangnya dikembalikan tampil
          dengan nilai bersihnya — retur dihitung berapa pun tanggal returnya. Fee merchant POS
          ditampilkan terpisah dari nilai belanja. Retur sudah termasuk retur fee; total bersih
          dan angka per jenis tetap menunjukkan uang setelah retur.<br />
          Faktur grosir memakai tanggal faktur, bukan jam pengetikannya, dan ikut dihitung sejak
          fakturnya terbit walau pembayarannya belum masuk. Faktur batal, faktur yang sudah diganti
          faktur koreksi, faktur saldo awal, dan faktur selisih stok dari opname tidak ditampilkan.
        </div>
      </div>
    </LaporanPage>
  );
}
