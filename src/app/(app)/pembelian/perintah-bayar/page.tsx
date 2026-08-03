import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehKelolaMaster, bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { sisaFakturBayar } from "@/lib/perintah-bayar";
import { batalkanPerintahBayar, bayarPerintahBayar, buatPerintahBayar, setujuiPerintahBayar } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Order = {
  id: string; no_pp: string; tanggal: string; rencana_bayar: string | null;
  total: number; status: string; catatan: string | null;
  suppliers: Rel<{ nama: string }>;
  payment_order_items: { id: string; jumlah: number; purchase_invoices: Rel<{ no_faktur: string }> }[] | null;
};

const BADGE: Record<string, string> = { draft: "o", disetujui: "b", dibayar: "g", batal: "x" };
const LABEL: Record<string, string> = { draft: "Menunggu setuju", disetujui: "Siap dibayar", dibayar: "Dibayar", batal: "Batal" };

export default async function PerintahBayarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; supplier?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [bolehAjukan, bolehSetuju] = await Promise.all([bolehTransaksiKas(), bolehKelolaMaster()]);

  const [{ data: orderData }, { data: supData }, { data: invData }, { data: payData }, { data: antreData }, rekening] =
    await Promise.all([
      supabase.from("payment_orders")
        .select("id, no_pp, tanggal, rencana_bayar, total, status, catatan, suppliers(nama), payment_order_items(id, jumlah, purchase_invoices(no_faktur))")
        .order("created_at", { ascending: false }),
      supabase.from("suppliers").select("id, nama").order("nama"),
      supabase.from("purchase_invoices").select("id, no_faktur, tanggal, jatuh_tempo, total, supplier_id, suppliers(nama)").order("jatuh_tempo"),
      supabase.from("purchase_invoice_payments").select("invoice_id, amount"),
      supabase.from("payment_order_items").select("invoice_id, jumlah, payment_orders!inner(status)").in("payment_orders.status", ["draft", "disetujui"]),
      loadRekeningAktif(supabase),
    ]);

  const orders = (orderData ?? []) as unknown as Order[];
  const pemasok = (supData ?? []) as { id: string; nama: string }[];
  const faktur = (invData ?? []) as unknown as {
    id: string; no_faktur: string; tanggal: string; jatuh_tempo: string; total: number;
    supplier_id: string | null; suppliers: Rel<{ nama: string }>;
  }[];

  const sisa = sisaFakturBayar(
    faktur.map((f) => ({ id: f.id, total: Number(f.total) })),
    (payData ?? []) as { invoice_id: string; amount: number }[],
    (antreData ?? []) as { invoice_id: string; jumlah: number }[],
  );

  const supplierDipilih = sp.supplier && pemasok.some((p) => p.id === sp.supplier) ? sp.supplier : "";
  const fakturBisa = faktur.filter((f) => (sisa.get(f.id) ?? 0) > 0 && (!supplierDipilih || f.supplier_id === supplierDipilih));

  return (
    <MasterPage
      back="/pembelian" icon="ti-file-check" title="PERINTAH PEMBAYARAN"
      desc="Ajukan dulu, disetujui, baru uangnya keluar"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={bolehAjukan}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mengajukan perintah pembayaran."
    >
      <div className="crm-sec">
        <SecHeader
          num="01" title="AJUKAN PEMBAYARAN"
          desc="Pilih pemasok, centang faktur yang mau dibayar. Faktur yang sudah masuk perintah bayar lain tidak muncul dua kali."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select className="fi" name="supplier" defaultValue={supplierDipilih} style={{ fontSize: 11, height: 30, width: 190 }}>
                <option value="">— semua pemasok —</option>
                {pemasok.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
              </select>
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        {bolehAjukan && supplierDipilih && fakturBisa.length > 0 ? (
          <form action={buatPerintahBayar}>
            <input type="hidden" name="supplier_id" value={supplierDipilih} />

            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>Pilih</th>
                    <th>Faktur</th>
                    <th style={{ width: 120 }}>Jatuh tempo</th>
                    <th style={{ width: 140, textAlign: "right" }}>Sisa hutang</th>
                    <th style={{ width: 150, textAlign: "right" }}>Dibayar</th>
                  </tr>
                </thead>
                <tbody>
                  {fakturBisa.map((f) => {
                    const s = sisa.get(f.id) ?? 0;
                    return (
                      <tr key={f.id}>
                        <td><input type="checkbox" name={`pilih_${f.id}`} /></td>
                        <td style={{ fontSize: 11.5, fontWeight: 600 }}>{f.no_faktur}</td>
                        <td style={{ fontSize: 11 }}>{tgl(f.jatuh_tempo)}</td>
                        <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(s)}</td>
                        <td style={{ textAlign: "right" }}>
                          <input className="fi" type="number" name={`jumlah_${f.id}`} min={0} max={s} step="any"
                            defaultValue={s} style={{ width: 130, textAlign: "right" }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="frow" style={{ marginTop: 12 }}>
              <div>
                <label className="flab">Rencana bayar</label>
                <input className="fi" type="date" name="rencana_bayar" />
              </div>
              <div>
                <label className="flab">Catatan</label>
                <input className="fi" name="catatan" placeholder="opsional" />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <SubmitButton className="btn-acc" icon="ti-file-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                  Ajukan perintah bayar
                </SubmitButton>
              </div>
            </div>
          </form>
        ) : (
          <div style={{ fontSize: 11, color: "var(--td)" }}>
            {!supplierDipilih
              ? "Pilih pemasok dulu untuk melihat faktur yang bisa diajukan."
              : "Tidak ada faktur berjalan untuk pemasok ini."}
          </div>
        )}
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="02" title="DAFTAR PERINTAH BAYAR" desc="Uang baru keluar setelah disetujui dan dibayar." />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. dokumen</th>
                <th>Pemasok</th>
                <th style={{ width: 120 }}>Rencana bayar</th>
                <th style={{ width: 140, textAlign: "right" }}>Total</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 300 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {o.no_pp}
                    <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>
                      {(o.payment_order_items ?? []).map((i) => one(i.purchase_invoices)?.no_faktur).filter(Boolean).join(", ") || "—"}
                    </div>
                  </td>
                  <td style={{ fontSize: 11.5 }}>{one(o.suppliers)?.nama ?? "—"}</td>
                  <td style={{ fontSize: 11 }}>{tgl(o.rencana_bayar)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(o.total))}</td>
                  <td><span className={`bge ${BADGE[o.status] ?? ""}`}>{LABEL[o.status] ?? o.status}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                      {bolehSetuju && o.status === "draft" && (
                        <form action={setujuiPerintahBayar}>
                          <input type="hidden" name="id" value={o.id} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            Setujui
                          </SubmitButton>
                        </form>
                      )}
                      {bolehSetuju && o.status === "disetujui" && (
                        <form action={bayarPerintahBayar} style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={o.id} />
                          <select className="fi" name="metode" defaultValue="Transfer" style={{ width: 100, height: 26, fontSize: 10.5 }}>
                            {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <PilihRekening rekening={rekening} label="" width={140} />
                          <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)}
                            style={{ width: 130, height: 26, fontSize: 10.5 }} />
                          <SubmitButton className="btn-acc" style={{ padding: "3px 9px", fontSize: 10.5, background: "#16a34a" }} pendingText="…">
                            Bayar
                          </SubmitButton>
                        </form>
                      )}
                      {bolehSetuju && o.status !== "dibayar" && o.status !== "batal" && (
                        <form action={batalkanPerintahBayar}>
                          <input type="hidden" name="id" value={o.id} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                            Batalkan
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada perintah pembayaran.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
