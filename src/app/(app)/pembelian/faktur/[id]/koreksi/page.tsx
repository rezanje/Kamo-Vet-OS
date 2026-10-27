import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { NumberInput } from "@/components/NumberInput";
import { hariIniWIB } from "@/lib/tanggal";
import { ConfirmCorrectionForm } from "./ConfirmCorrectionForm";

const rp = (value: number) => `${value < 0 ? "-" : ""}Rp ${Math.abs(Number(value)).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const num = (value: number) => Number(value).toLocaleString("id-ID", { maximumFractionDigits: 4 });
type Preview = {
  satuan: string | null; faktor: number; cost_method: string; old_qty: number; new_qty: number; old_harga: number; new_harga: number;
  remaining_qty: number; sold_qty: number; removed_qty: number; old_total: number; new_total: number; paid: number;
  ap_delta: number; ppn_delta: number; inventory_delta: number; hpp_delta: number; old_unit_cost: number; new_unit_cost: number;
  lines: { code: string; name: string | null; debit: number; credit: number }[];
};

export default async function PurchaseInvoiceRepricePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ baris?: string; qty?: string; harga?: string; tanggal?: string; error?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: invoice }, { data: profile }, { data: line }] = await Promise.all([
    supabase.from("purchase_invoices").select("id,no_faktur,revision,voided_at,opening_batch_id,total,po_id").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
    supabase.from("purchase_invoice_items").select("id,invoice_id,nama,qty,satuan,harga").eq("id", sp.baris ?? "").eq("invoice_id", id).maybeSingle(),
  ]);
  if (!invoice || !line) notFound();
  const back = `/pembelian/faktur/${id}`;
  const owner = profile?.role === "OWNER" && profile.is_active;
  if (!owner || invoice.voided_at || invoice.opening_batch_id) {
    return <><Link className="back-btn" href={back}>Kembali ke faktur</Link>
      <div role="alert" className="p2ban">Koreksi harga faktur hanya oleh OWNER, untuk faktur aktif yang punya baris barang.</div></>;
  }
  const qty = sp.qty ?? String(line.qty);
  const tanggal = sp.tanggal ?? hariIniWIB();
  const asked = sp.harga !== undefined && sp.harga !== "";
  const preview = asked ? await supabase.rpc("preview_purchase_invoice_line_correction", {
    p_line_id: line.id, p_qty: Number(qty), p_harga: Number(sp.harga), p_tanggal: tanggal,
  }) : null;
  const impact = preview?.data as Preview | null | undefined;
  const satuan = line.satuan ?? "";
  return <>
    <Link className="back-btn" href={back}>Kembali ke faktur {invoice.no_faktur}</Link>
    {sp.error && <div role="alert" className="p2ban">{sp.error}</div>}
    <section className="crm-sec">
      <SecHeader num="01" title="KOREKSI HARGA FAKTUR" desc={`${invoice.no_faktur} · ${line.nama}`} />
      <p>Sekarang: {num(line.qty)} {satuan} × {rp(line.harga)}. Isi harga per {satuan || "satuan"} yang benar, lalu lihat dampaknya dulu sebelum disimpan.</p>
      <form method="get">
        <input type="hidden" name="baris" value={line.id} />
        <label className="flab" htmlFor="reprice-price">Harga baru per {satuan || "satuan"} (termasuk PPN bila PKP)</label>
        <NumberInput className="fi" id="reprice-price" name="harga" type="number" min={0} step="0.01" required defaultValue={sp.harga ?? String(line.harga)} />
        <label className="flab" htmlFor="reprice-qty">Qty {invoice.po_id ? "(faktur dari PO: qty dikoreksi lewat Retur Pembelian)" : "(hanya bisa dikurangi, maksimal sebanyak sisa stok faktur ini)"}</label>
        <NumberInput className="fi" id="reprice-qty" name="qty" type="number" min={0} step="any" max={line.qty} required defaultValue={qty} readOnly={!!invoice.po_id} />
        <label className="flab" htmlFor="reprice-date">Tanggal koreksi</label>
        <input className="fi" id="reprice-date" name="tanggal" type="date" required defaultValue={tanggal} max={hariIniWIB()} />
        <div style={{ marginTop: 8 }}><button className="btn-def" type="submit">Lihat dampak</button></div>
      </form>
    </section>
    {preview?.error && <div role="alert" className="p2ban">{preview.error.message}</div>}
    {impact && <section className="crm-sec">
      <SecHeader num="02" title="DAMPAK KOREKSI" desc="Belum tersimpan. Periksa lalu simpan dengan alasan." />
      <div style={{ overflowX: "auto" }}><table className="tbl"><tbody>
        <tr><th>Baris faktur</th><td>{num(impact.old_qty)} × {rp(impact.old_harga)} → {num(impact.new_qty)} × {rp(impact.new_harga)}</td></tr>
        <tr><th>Masih di stok (dari faktur ini)</th><td>{num(impact.remaining_qty)} {satuan}{impact.removed_qty > 0 ? ` · ${num(impact.removed_qty)} ${satuan} dikeluarkan dari stok` : ""}</td></tr>
        <tr><th>Sudah terjual / terpakai</th><td>{num(impact.sold_qty)} {satuan}</td></tr>
        <tr><th>Perubahan nilai stok</th><td>{rp(impact.inventory_delta)}</td></tr>
        <tr><th>Perubahan HPP (periode berjalan)</th><td>{rp(impact.hpp_delta)}</td></tr>
        {Number(impact.ppn_delta) !== 0 && <tr><th>Perubahan PPN masukan</th><td>{rp(impact.ppn_delta)}</td></tr>}
        <tr><th>Hutang faktur</th><td>{rp(impact.old_total)} → {rp(impact.new_total)} ({rp(impact.ap_delta)}) · sudah dibayar {rp(impact.paid)}</td></tr>
        <tr><th>Metode nilai stok</th><td>{impact.cost_method === "moving_average" ? "Rata-rata bergerak (rata-rata dihitung ulang)" : "FIFO (sisa stok pindah ke harga baru)"}</td></tr>
      </tbody></table></div>
      <h4>Jurnal yang akan diposting</h4>
      <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>Akun</th><th>Debit</th><th>Kredit</th></tr></thead><tbody>
        {impact.lines.map(l => <tr key={l.code}><td>{l.code} {l.name ?? ""}</td><td>{l.debit ? rp(l.debit) : ""}</td><td>{l.credit ? rp(l.credit) : ""}</td></tr>)}
      </tbody></table></div>
      <ConfirmCorrectionForm userId={user!.id} invoiceId={id} lineId={line.id} revision={invoice.revision} qty={qty} harga={String(sp.harga)} tanggal={tanggal}
        expected={JSON.stringify(Object.fromEntries((["remaining_qty", "sold_qty", "removed_qty", "ap_delta", "ppn_delta", "inventory_delta", "hpp_delta"] as const).map(k => [k, impact[k]])))} />
    </section>}
  </>;
}
