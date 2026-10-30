import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Popup } from "@/components/Popup";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { getPajakSettings } from "@/lib/pajak";
import { getDpMinimalPercent, bolehMenerobosDp } from "@/lib/dp-minimal";
import { muatTagihanBerjalan } from "@/lib/tagihan-berjalan-server";
import { nilaiBarisResep, ringkasRekap } from "@/lib/tagihan-berjalan";
import type { RanapPaymentQuote } from "@/lib/ranap-payment";
import { SimpanBayarForm } from "./SimpanBayarForm";
import { BatalKwitansiForm } from "./BatalKwitansiForm";
import { LepasUangMukaForm } from "./LepasUangMukaForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const SUKSES: Record<string, string> = {
  tagih: "Tagihan tahap terbit. Obat dan jasa yang baru ditagih sudah tercatat sebagai omzet.",
  batal: "Kwitansi dibatalkan. Jurnal pembaliknya sudah tercatat.",
  lepas: "Pemakaian uang muka dilepas. Saldo pemilik kembali utuh dan kwitansinya sekarang bisa dibatalkan.",
};

/**
 * Tagihan rawat inap berjalan (keputusan Andri, 29 Oktober 2026).
 *
 * Pasien yang masih dirawat ditagih bertahap, dan pemiliknya boleh membayar kapan saja.
 * Semua uang di layar ini melewati RPC yang memeriksa shift, peran, dan uang muka minimal.
 */
export default async function TagihanRawatInapPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string; receipt?: string; invoice?: string; applications?: string }>;
}) {
  const { id } = await params;
  const { error, success, receipt, invoice, applications } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await muatTagihanBerjalan(supabase, id);
  if (!data) notFound();

  const [pajak, minDpPercent, profil, shift] = await Promise.all([
    getPajakSettings(supabase),
    getDpMinimalPercent(supabase),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    getOpenShift(supabase as never, user.id, "klinik"),
  ]);
  const ppnRate = pajak.mode_pkp ? Number(pajak.ppn_rate) : 0;
  const bolehTerobos = bolehMenerobosDp(profil.data?.role as string | null);
  const estimasi = data.belumDitagih.reduce((sum, b) => sum + nilaiBarisResep(b), 0);
  const estimasiPpn = ppnRate > 0 && estimasi > 0 ? Math.round(estimasi * ppnRate / 100) : 0;
  const rekap = ringkasRekap(data.tahap, estimasi + estimasiPpn, data.saldoUangMuka);
  // Hanya pratinjau; DB memeriksa lagi invoice aktif lain di pembungkus tahap.
  const dpLanjutanOpsional = data.tahap.some((t) => Number(t.total) > 0 && !t.correction_pending);
  const dpAwal = data.tahap.filter((t) => !t.reissued_from && Number(t.dp_amount) > 0);
  // Riwayat kwitansi/uang muka belum tersedia = saldo yang tampil belum bisa dipercaya.
  // Menerima uang atau membatalkan kwitansi di atas angka yang belum lengkap berisiko
  // penerimaan dobel, jadi aksinya dikunci sampai datanya terbaca.
  let quote: RanapPaymentQuote | null = null;
  if (shift && data.riwayatUangTerpasang) {
    try {
      const result = await supabase.rpc("clinic_quote_inpatient_payment", { p_record_id: data.record.id, p_visit_id: data.visit.id, p_parts: [] });
      if (!result.error && result.data) quote = result.data as RanapPaymentQuote;
    } catch { /* No guessed account destination or zero-credit fallback. */ }
  }
  const bolehProsesUang = !!shift && data.riwayatUangTerpasang && !!quote;
  const totalTransaksi = quote ? data.tahap.reduce((sum, t) => sum + Number(t.total), 0) + quote.pending : rekap.total;
  const applied = data.tahap.reduce((sum, t) => sum + t.dibayar, 0);
  const savedReceipt = receipt ? data.kwitansi.find(k => k.id === receipt && k.status === "aktif") : null;
  const savedInvoice = invoice ? data.tahap.find(t => t.id === invoice && !t.correction_pending) : null;
  const applicationIds = applications?.split(",") ?? [];
  let savedApplications = false;
  if (applicationIds.length > 0 && applicationIds.length <= 200 && new Set(applicationIds).size === applicationIds.length
    && applicationIds.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    const proof = await supabase.from("clinic_advance_applications")
      .select("id, invoice_id, amount, released_at").in("id", applicationIds);
    savedApplications = !proof.error && proof.data?.length === applicationIds.length
      && proof.data.every(a => applicationIds.includes(a.id) && Number(a.amount) > 0 && !a.released_at && data.tahap.some(t => t.id === a.invoice_id && !t.correction_pending));
  }
  const successBound = success === "transaksi" && (!receipt || !!savedReceipt) && (!invoice || !!savedInvoice)
    && (!applications || savedApplications) && (!!savedReceipt || !!savedInvoice || savedApplications);
  // Status tampilan dari rekap server, bukan bukti penerimaan baru dari query URL.
  // Piutang invoice nol saja belum lunas bila masih ada biaya pending/koreksi.
  const pembayaranLunas = data.riwayatUangTerpasang && rekap.total > 0 && rekap.sisa === 0
    && data.belumDitagih.length === 0 && !data.tahap.some((t) => t.correction_pending);

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik/rawat-inap" className="back-btn"><i className="ti ti-arrow-left" /> Status Rawat Inap</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-report-money" style={{ fontSize: 22, color: "var(--posb)" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>TAGIHAN RAWAT INAP BERJALAN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
            {data.pasien} · pemilik {data.pemilik}{data.telepon ? ` · ${data.telepon}` : ""}
            {data.record.discharged_at ? " · sudah pulang" : " · masih dirawat"}
          </div>
        </div>
      </div>

      <Popup message={error} />
      {!error && success === "bayar" && data.riwayatUangTerpasang && rekap.dibayar > 0 && (
        <Popup tone="success" title={pembayaranLunas ? "Pembayaran lunas" : "Pembayaran diterima"}
          message={`Total dibayar: ${rp(rekap.dibayar)} · Sisa pembayaran: ${rp(rekap.sisa)}`} />
      )}
      {!error && successBound && <Popup tone="success" title={savedReceipt ? (pembayaranLunas ? "Pembayaran lunas" : "Pembayaran diterima") : savedApplications ? "Saldo pemilik diterapkan" : "Transaksi tersimpan"}
        message={`${savedReceipt ? `${savedReceipt.no_kwitansi}: ${rp(savedReceipt.total)} · ` : ""}${savedInvoice?.invoice_no ?? ""} · Sisa pembayaran: ${rp(quote?.remaining ?? rekap.sisa)}`} />}
      {!error && success && Object.hasOwn(SUKSES, success) && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {SUKSES[success]}
        </div>
      )}
      {!data.riwayatUangTerpasang && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-alert-triangle" /> Riwayat pembayaran dan uang muka belum tersedia di server ini —
          angka di bawah BELUM lengkap. Menerima uang dan membatalkan kwitansi dikunci sampai datanya terbaca.
        </div>
      )}
      {!shift && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", justifyContent: "space-between" }}>
          <span><i className="ti ti-lock" /> Shift klinik belum dibuka — menagih dan menerima uang masih terkunci.</span>
          <Link href="/klinik/shift" className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>Buka shift</Link>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 10 }}>
        <Kartu label="TOTAL TRANSAKSI" value={rp(totalTransaksi)} color="var(--posb)" bg="#eff6ff" icon="ti-file-invoice" />
        <Kartu label="DP" value={data.riwayatUangTerpasang ? rp(applied) : "Belum terbaca"} color="#15803d" bg="#e8f5ee" icon="ti-cash" />
        <Kartu label="SISA PEMBAYARAN" value={quote ? rp(quote.remaining) : "Belum terbaca"} color="#b91c1c" bg="#fef2f2" icon="ti-clock-dollar" />
      </div>

      <section className="crm-sec" style={{ marginBottom: 14, border: "2px solid #bfdbfe" }}>
        <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>TERIMA PEMBAYARAN</h2>
        {quote && <div style={{ fontSize: 17, marginBottom: 10 }}>Saldo pemilik: <b>{rp(quote.credit)}</b> · DP/pembayaran terpakai: <b>{rp(applied)}</b></div>}
        {quote && !dpLanjutanOpsional && <div style={{ fontSize: 14, marginBottom: 8 }}>Uang muka minimal {minDpPercent}% · {rp(Math.ceil(quote.pending * minDpPercent / 100))}</div>}
        {quote && dpLanjutanOpsional && <div style={{ fontSize: 14, marginBottom: 8 }}>DP lanjutan opsional: {rp(Math.round(quote.remaining / 2))}</div>}
        {bolehProsesUang && quote ? <SimpanBayarForm key={`bayar:${data.kwitansi.length}:${data.tahap.length}:${quote.token}`}
          recordId={data.record.id} visitId={data.visit.id} requestKey={randomUUID()} remaining={quote.remaining}
          pendingCount={data.belumDitagih.length} accounts={quote.accounts} applyCredit={quote.apply_credit} bolehTerobos={bolehTerobos}
          dpOpsional={dpLanjutanOpsional ? Math.round(quote.remaining / 2) : undefined} />
          : <div>{shift ? "Rekening atau tagihan terkini belum terbaca — muat ulang sebelum memproses uang." : "Buka shift klinik untuk menerima uang."}</div>}
      </section>

      <section className="crm-sec" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)", marginBottom: 9 }}>
          <i className="ti ti-clipboard-list" /> RINCIAN TAGIHAN
        </div>
        {data.tahap.map((t) => (
          <div key={t.id} style={{ marginBottom: 12 }}>
            <b>{t.invoice_no ?? "(tanpa nomor)"}</b> · {t.correction_pending ? "Koreksi belum selesai" : "Sudah diterbitkan"}
            <table className="tbl" style={{ width: "100%" }}>
              <thead><tr><th>Item</th><th>Qty</th><th>Harga</th><th>Diskon baris</th><th>Nilai baris</th></tr></thead>
              <tbody>{data.rincianDitagih.filter((l) => l.invoice_id === t.id).map((l) => (
                <tr key={l.id}><td>{l.deskripsi}</td><td>{l.qty}</td><td>{rp(Number(l.harga))}</td>
                  <td>{Number(l.diskon_persen)}%</td>
                  <td>{rp(Math.round(Number(l.qty) * Number(l.harga) * (1 - Number(l.diskon_persen) / 100)))}</td></tr>
              ))}</tbody>
            </table>
            <div style={{ fontSize: 11, textAlign: "right" }}>
              Subtotal tersimpan {rp(Number(t.subtotal) || 0)} · Diskon nota {rp(Number(t.discount) || 0)} · PPN {rp(Number(t.tax) || 0)} · <b>Total invoice {rp(Number(t.total))}</b>
            </div>
          </div>
        ))}
        {data.belumDitagih.length > 0 && <>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Belum ditagih</div>
        <table className="tbl" style={{ width: "100%" }}><thead><tr><th>Item</th><th>Qty</th><th>Harga</th><th>Nilai</th></tr></thead>
          <tbody>{data.belumDitagih.map(b => <tr key={b.id}><td>{b.nama_obat}</td><td>{b.qty}</td><td>{rp(Number(b.harga))}</td><td>{rp(nilaiBarisResep(b))}</td></tr>)}</tbody>
        </table>
        </>}
        <div style={{ borderTop: "1px solid var(--bd)", marginTop: 12, paddingTop: 8, textAlign: "right", fontSize: 12 }}>
          <div><b>Total transaksi: {rp(totalTransaksi)}</b></div>
          <div>DP: {data.riwayatUangTerpasang ? rp(applied) : "Belum terbaca"}</div>
          <div><b>Sisa pembayaran: {quote ? rp(quote.remaining) : "Belum terbaca"}</b></div>
        </div>
      </section>

      <section className="crm-sec" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)", marginBottom: 9 }}>
          <i className="ti ti-file-invoice" /> TAGIHAN TAHAP
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>No. tagihan</th><th>Tanggal</th><th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Dibayar</th><th style={{ textAlign: "right" }}>Sisa</th>
                <th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {data.tahap.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{t.invoice_no ?? "—"}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{tgl(t.created_at)}</td>
                  <td style={{ textAlign: "right" }}>{rp(t.total)}</td>
                  <td style={{ textAlign: "right" }}>{rp(t.dibayar)}</td>
                  <td style={{ textAlign: "right", color: t.sisa > 0 ? "#b91c1c" : "#15803d" }}>{rp(t.sisa)}</td>
                  <td><span className={`bge ${t.paid_status === "Lunas" ? "g" : "r"}`}>{t.paid_status}</span></td>
                  <td>
                    <Link href={`/klinik/pembayaran/${data.visit.id}/invoice?invoice_id=${t.id}`} className="btn-def"
                      style={{ padding: "3px 9px", fontSize: 10, textDecoration: "none" }}>
                      <i className="ti ti-printer" /> Invoice
                    </Link>
                  </td>
                </tr>
              ))}
              {!data.tahap.length && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Belum ada tagihan tahap untuk kunjungan ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="crm-sec" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)", marginBottom: 9 }}>
          <i className="ti ti-history" /> RIWAYAT PEMBAYARAN
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th><th>No. kwitansi</th><th>Tanggal</th><th>Metode</th>
                <th style={{ textAlign: "right" }}>Jumlah</th><th>Kasir</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {dpAwal.map((t) => (
                <tr key={`dp-awal:${t.id}`}>
                  <td>DP awal</td><td>{t.invoice_no}</td><td>{tgl(t.created_at)}</td>
                  <td>{t.metode_bayar ?? "Lihat invoice"}</td><td style={{ textAlign: "right" }}>{rp(Number(t.dp_amount))}</td>
                  <td colSpan={3}>Tercatat di kepala invoice, bukan saldo wallet atau kwitansi baru.</td>
                </tr>
              ))}
              {data.kwitansi.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>DP {i + 1}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{k.no_kwitansi}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{tgl(k.created_at)}</td>
                  <td style={{ fontSize: 10.5 }}>
                    {k.bagian.map((b) => `${b.metode} ${rp(b.amount)}`).join(" + ") || "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{rp(k.total)}</td>
                  <td style={{ fontSize: 10.5 }}>{k.kasir ?? "—"}</td>
                  <td>
                    <span className={`bge ${k.status === "aktif" ? "g" : "r"}`}>{k.status === "aktif" ? "Sah" : "Dibatalkan"}</span>
                    {k.void_reason && <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{k.void_reason}</div>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      <Link href={`/klinik/rawat-inap/${data.record.id}/tagihan/kwitansi/${k.id}`} className="btn-def"
                        style={{ padding: "3px 9px", fontSize: 10, textDecoration: "none" }}>
                        <i className="ti ti-receipt" /> Kwitansi
                      </Link>
                      {k.status === "aktif" && bolehProsesUang && (
                        <BatalKwitansiForm recordId={data.record.id} receiptId={k.id} requestKey={randomUUID()} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!data.kwitansi.length && !dpAwal.length && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  {data.riwayatUangTerpasang
                    ? rekap.dibayar > 0 ? "Pembayaran tercatat pada invoice / uang muka di atas; lihat dokumen asal untuk riwayatnya." : "Belum ada pembayaran untuk kunjungan ini."
                    : "Riwayat pembayaran belum dapat dibaca — ini BUKAN berarti belum ada uang masuk."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data.uangMuka.length > 0 && (
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 8, display: "grid", gap: 5 }}>
            {data.uangMuka.map((u) => (
              <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  Uang muka {u.no_uang_muka} {rp(Number(u.amount))} (terpakai {rp(Number(u.applied))}
                  {u.status === "batal" ? ", dibatalkan" : ""})
                </span>
                {/* Salah nominal/metode pada kwitansi yang uang mukanya sudah dipakai dulu
                    terkunci: kwitansinya ditolak ADVANCE_USED dan tidak ada jalan keluar.
                    Pelepasan ini jalurnya — peran, shift, alasan, dan jurnalnya dijaga RPC. */}
                {u.status === "aktif" && Number(u.applied) > 0 && bolehProsesUang && bolehTerobos && (
                  <LepasUangMukaForm recordId={data.record.id} advanceId={u.id}
                    requestKey={randomUUID()} nomor={u.no_uang_muka} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>


    </>
  );
}

function Kartu({ label, value, color, bg, icon }: {
  label: string; value: string; color: string; bg: string; icon: string;
}) {
  return (
    <div className="card" style={{ padding: 10, display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`ti ${icon}`} style={{ color, fontSize: 20 }} />
      </div>
      <div>
        <div style={{ fontSize: 9.5, color, fontWeight: 700, letterSpacing: ".03em" }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#141413", lineHeight: 1.2 }}>{value}</div>
      </div>
    </div>
  );
}
