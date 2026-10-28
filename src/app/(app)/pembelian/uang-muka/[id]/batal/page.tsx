import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { DocumentLink } from "@/components/RelatedDocuments";
import { batalkanUangMukaBeserta } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type PlanRow = {
  payment_id: string; group_key: string; tanggal: string; amount: number; dari_uang_muka: number;
  uses_this_advance: boolean; no_um: string | null; invoice_id: string; no_faktur: string;
  invoice_voided: boolean; payment_order_id: string | null; no_pp: string | null;
};
type Preview = { advance_id: string; no_um: string; status: string; jumlah: number; terpakai: number; payments: PlanRow[]; fingerprint: string };

/** P08: preview of everything a one-step cancel of a used advance reverses, then OWNER confirmation. */
export default async function BatalUangMukaPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_purchase_advance_cascade", { p_advance_id: id });
  const preview = data as Preview | null;
  const back = <Link href="/pembelian/uang-muka" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke uang muka</Link>;
  if (error || !preview) return <>{back}<div role="alert" className="p2ban">{error?.message ?? "Pratinjau pembatalan belum dapat dimuat."}</div></>;

  const invoices = new Map<string, string>();
  for (const row of preview.payments) invoices.set(row.invoice_id, row.no_faktur);
  const groups = new Set(preview.payments.map(row => row.group_key)).size;
  const others = preview.payments.filter(row => !row.uses_this_advance);
  const active = preview.status === "aktif";

  return (
    <>
      {back}
      {sp.error && <div role="alert" className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>{sp.error}</div>}
      <section className="crm-sec">
        <SecHeader num="01" title={`BATALKAN ${preview.no_um}`} desc={`Nominal ${rp(preview.jumlah)} · sudah terpakai ${rp(preview.terpakai)}`} />
        {!active && <p>Uang muka ini sudah dibatalkan. Tidak ada yang perlu dilakukan.</p>}
        {active && <>
          <p style={{ fontSize: 12 }}>
            Sistem akan membatalkan <strong>{preview.payments.length} pembayaran</strong> ({groups} jurnal) pada{" "}
            <strong>{invoices.size} faktur</strong>, lalu membatalkan uang mukanya. Semua dalam satu langkah: kalau satu
            bagian gagal, tidak ada yang berubah. Pembayaran asli tetap tersimpan dengan status dibatalkan, hutang faktur
            terbuka lagi, dan uang muka kembali ke rekening asal lewat jurnal pembalik.
          </p>
          {others.length > 0 && (
            <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
              {others.length} pembayaran lain ikut dibatalkan karena tercatat dalam jurnal/perintah bayar yang sama.
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead><tr><th>Tanggal</th><th>Faktur</th><th style={{ textAlign: "right" }}>Pembayaran</th><th style={{ textAlign: "right" }}>Dari uang muka</th><th>Keterangan</th></tr></thead>
              <tbody>
                {preview.payments.map(row => (
                  <tr key={row.payment_id}>
                    <td style={{ fontSize: 11 }}>{row.tanggal}</td>
                    <td style={{ fontSize: 11.5 }}><DocumentLink kind="purchase-invoice" id={row.invoice_id}>{row.no_faktur}</DocumentLink>{row.invoice_voided && " (faktur dibatalkan)"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(row.amount)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(row.dari_uang_muka)}{!row.uses_this_advance && row.no_um ? ` (${row.no_um})` : ""}</td>
                    <td style={{ fontSize: 11 }}>{row.no_pp ? `Perintah bayar ${row.no_pp} — dibatalkan satu grup` : row.uses_this_advance ? "Memakai uang muka ini" : "Satu jurnal dengan pembayaran di atas"}</td>
                  </tr>
                ))}
                {preview.payments.length === 0 && <tr><td colSpan={5} style={{ fontSize: 11, color: "var(--td)" }}>Tidak ada pembayaran aktif yang memakai uang muka ini.</td></tr>}
              </tbody>
            </table>
          </div>
          <form action={batalkanUangMukaBeserta} style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
            <input type="hidden" name="advance_id" value={preview.advance_id} />
            <input type="hidden" name="fingerprint" value={preview.fingerprint} />
            <input type="hidden" name="request_key" value={crypto.randomUUID()} />
            <label className="flab" htmlFor="alasan">Alasan pembatalan *</label>
            <textarea className="fi" id="alasan" name="alasan" required minLength={3} maxLength={1000} rows={2} placeholder="Mis. uang muka salah pemasok" />
            <label style={{ fontSize: 11.5, display: "flex", gap: 6 }}>
              <input type="checkbox" name="setuju" value="1" required /> Saya sudah memeriksa daftar pembayaran di atas.
            </label>
            <SubmitButton className="btn-acc" style={{ background: "#b91c1c" }} pendingText="Membatalkan…">
              Batalkan uang muka + {preview.payments.length} pembayaran
            </SubmitButton>
          </form>
        </>}
      </section>
    </>
  );
}
