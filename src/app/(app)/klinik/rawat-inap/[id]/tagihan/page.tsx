import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Popup } from "@/components/Popup";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { getPajakSettings } from "@/lib/pajak";
import { getDpMinimalPercent, bolehMenerobosDp } from "@/lib/dp-minimal";
import { muatTagihanBerjalan } from "@/lib/tagihan-berjalan-server";
import { nilaiBarisResep } from "@/lib/tagihan-berjalan";
import { TagihSekarangForm } from "./TagihSekarangForm";
import { TerimaPembayaranForm } from "./TerimaPembayaranForm";
import { BatalKwitansiForm } from "./BatalKwitansiForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const SUKSES: Record<string, string> = {
  tagih: "Tagihan tahap terbit. Obat dan jasa yang baru ditagih sudah tercatat sebagai omzet.",
  bayar: "Pembayaran tersimpan. Cetak kwitansinya untuk pemilik.",
  batal: "Kwitansi dibatalkan. Jurnal pembaliknya sudah tercatat.",
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
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
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
      {!error && success && SUKSES[success] && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {SUKSES[success]}
        </div>
      )}
      {!shift && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", justifyContent: "space-between" }}>
          <span><i className="ti ti-lock" /> Shift klinik belum dibuka — menagih dan menerima uang masih terkunci.</span>
          <Link href="/klinik/shift" className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>Buka shift</Link>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Kartu label="BELUM DITAGIH" value={rp(estimasi)} sub={`${data.belumDitagih.length} baris`} color="#d97706" bg="#fffbeb" icon="ti-clipboard-list" />
        <Kartu label="TOTAL PIUTANG" value={rp(data.piutang)} sub={`${data.tahap.length} tagihan tahap`} color="#b91c1c" bg="#fef2f2" icon="ti-clock-dollar" />
        <Kartu label="UANG MUKA PEMILIK" value={rp(data.saldoUangMuka)} sub="otomatis memotong tahap berikutnya" color="var(--posb)" bg="#eff6ff" icon="ti-wallet" />
        <Kartu label="UANG MUKA MINIMAL" value={`${minDpPercent}%`} sub="berlaku tiap tagihan tahap" color="#15803d" bg="#e8f5ee" icon="ti-percentage" />
      </div>

      <section className="crm-sec" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)", marginBottom: 9 }}>
          <i className="ti ti-clipboard-list" /> BELUM DITAGIH
        </div>
        {shift ? (
          <TagihSekarangForm
            key={`${data.record.id}:${data.belumDitagih.map((b) => b.id).join(",")}`}
            recordId={data.record.id} visitId={data.visit.id} requestKey={randomUUID()}
            baris={data.belumDitagih} ppnRate={ppnRate} minDpPercent={minDpPercent}
            saldoUangMuka={data.saldoUangMuka} bolehTerobos={bolehTerobos}
          />
        ) : (
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
            {data.belumDitagih.length} baris menunggu ditagih senilai {rp(estimasi)} (belum termasuk PPN). Buka shift klinik untuk menagih.
          </div>
        )}
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
                      {k.status === "aktif" && shift && (
                        <BatalKwitansiForm recordId={data.record.id} receiptId={k.id} requestKey={randomUUID()} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!data.kwitansi.length && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Belum ada pembayaran untuk kunjungan ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data.uangMuka.length > 0 && (
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 8 }}>
            Uang muka: {data.uangMuka.map((u) => `${u.no_uang_muka} ${rp(Number(u.amount))} (terpakai ${rp(Number(u.applied))}${u.status === "batal" ? ", dibatalkan" : ""})`).join(" · ")}
          </div>
        )}
      </section>

      <section className="crm-sec">
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)", marginBottom: 9 }}>
          <i className="ti ti-cash" /> TERIMA PEMBAYARAN
        </div>
        {shift ? (
          <TerimaPembayaranForm key={`bayar:${data.kwitansi.length}:${data.tahap.length}`}
            recordId={data.record.id} visitId={data.visit.id} requestKey={randomUUID()} tahap={data.tahap} />
        ) : (
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Buka shift klinik untuk menerima uang.</div>
        )}
      </section>
    </>
  );
}

function Kartu({ label, value, sub, color, bg, icon }: {
  label: string; value: string; sub: string; color: string; bg: string; icon: string;
}) {
  return (
    <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`ti ${icon}`} style={{ color, fontSize: 20 }} />
      </div>
      <div>
        <div style={{ fontSize: 9.5, color, fontWeight: 700, letterSpacing: ".03em" }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#141413", lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{sub}</div>
      </div>
    </div>
  );
}
