import { readCompleteList } from "@/lib/checked-list";
import { customerPackageLines, type PackagePrintSource } from "@/lib/clinic-package-print";
import { printBranchHeading } from "@/components/print-branch-heading";
import { bacaKartuPetugas, idPetugas, petugasCetak, type BarisTagihanPetugas } from "@/lib/petugas-cetak";
import { ClinicDemoFees } from "@/components/ClinicDemoFees";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../PrintButton";
import { labelPromo } from "@/lib/label-potongan";
import { bacaRincianPromoKlinik, labelDiskonBaris, pasangPromoKeBaris } from "@/lib/rincian-promo-klinik";
import { muatBagianUangMuka, ringkasMetodeInvoice } from "@/lib/metode-uang-muka";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function StrukPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, poli, dokter, doctor_id, pets(name, species), customers(name), branches(name, code)")
    .eq("id", visitId).maybeSingle();
  if (!visit) notFound();

  // Rawat inap bertahap: satu kunjungan bisa punya beberapa tagihan aktif, jadi
  // `maybeSingle()` dulu menggagalkan cetak. Tanpa pilihan eksplisit dicetak yang TERBARU.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, invoice_no, subtotal, discount, tax, total, dp_amount, paid_status, metode_bayar, paid_at, created_at, cashier_name, visits(branches(name, code))")
    .eq("visit_id", visitId).is("voided_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(1).maybeSingle();
  if (!invoice) notFound();

  const items = await readCompleteList<PackagePrintSource & BarisTagihanPetugas & { id: string }>((from, to) => supabase
    .from("invoice_items").select("id, invoice_id, item_id, deskripsi, qty, harga, diskon_persen, jenis, package_item_id, package_qty, package:items!invoice_items_package_item_id_fkey(name), service_performers", { count: "exact" })
    .eq("invoice_id", invoice.id).order("created_at").order("id").range(from, to), "Rincian struk", { maxRows: null });
  // Petugas dicetak per jabatan (Dokter / Groomer / Staff), bukan per baris — lihat petugas-cetak.ts.
  const petugas = petugasCetak(visit, items, await bacaKartuPetugas(supabase, idPetugas([visit], items)));
  const { data: payments } = await supabase.from("invoice_payments")
    .select("id, amount, metode, transferred_from").eq("invoice_id", invoice.id).order("created_at");
  // Invoice yang dipotong uang muka: metode dibaca dari kwitansi asal, bukan kolom bawaan "Tunai".
  const metodeBayar = ringkasMetodeInvoice(invoice, payments ?? [],
    await muatBagianUangMuka(supabase, [{ id: invoice.id, payments: payments ?? [] }]));
  const {data: demoSnapshot, error: demoError} = await supabase.from("clinic_demo_invoice_snapshots")
    .select("fee_bearer,fee_amount,payments").eq("invoice_id",invoice.id).maybeSingle();
  if (demoError) throw new Error("Rincian biaya admin tidak terbaca. Muat ulang sebelum mencetak.");
  // Promo per barang (Reza 8 Nov): dicetak di bawah barangnya; "Diskon transaksi" di
  // bawah hanya sisanya (voucher, golongan, poin, diskon kasir). Total tidak berubah.
  const lines = customerPackageLines(items, { subtotal: invoice.subtotal });
  const promoInvoice = (await bacaRincianPromoKlinik(supabase, [invoice.id])).get(invoice.id) ?? [];
  const { perBaris, totalPromo } = pasangPromoKeBaris(lines, promoInvoice, Number(invoice.discount));
  const diskonTransaksi = Math.max(0, Number(invoice.discount) - totalPromo);
  const credit = (payments ?? []).filter((p) => p.transferred_from)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const received = Number(invoice.dp_amount) + (payments ?? [])
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const branch = one(one(invoice.visits)?.branches ?? null);
  const tgl = new Date(invoice.paid_at ?? invoice.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/pembayaran/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Struk" />
      </div>

      {/* Struk thermal 80mm */}
      <div style={{ width: "74mm", margin: "0 auto", background: "#fff", padding: "10px 8px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>{printBranchHeading(branch)}</div>
        </div>
        <Hr />
        <Kv k="No" v={invoice.invoice_no ?? "-"} />
        <Kv k="Tgl" v={tgl} />
        <Kv k="Kasir" v={invoice.cashier_name ?? "Kasir belum tercatat"} />
        {petugas.map((p) => <Kv key={p.label} k={p.label} v={p.nama} />)}
        <Kv k="Pasien" v={`${pet?.name ?? "-"} (${pet?.species ?? "-"})`} />
        <Kv k="Pemilik" v={cust?.name ?? "-"} />
        <Hr />
        {lines.map((it, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <div>{it.deskripsi}</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{it.qty} x {rp(it.harga)}</span>
              <span>{rp(it.jumlah + it.diskon)}</span>
            </div>
            <PotonganBaris label={labelDiskonBaris(it)} nilai={it.diskon} />
            {perBaris[i].map((p, k) => <PotonganBaris key={k} label={labelPromo(p.nama)} nilai={p.potongan} />)}
          </div>
        ))}
        <Hr />
        <Row k="Subtotal" v={rp(Number(invoice.subtotal) - totalPromo)} />
        {diskonTransaksi > 0.005 && <Row k="Diskon transaksi" v={`-${rp(diskonTransaksi)}`} />}
        <Row k="PPN 11%" v={rp(invoice.tax)} />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}>
          <span>TOTAL</span><span>{rp(invoice.total)}</span>
        </div>
        <Hr />
        <Row k="Metode" v={metodeBayar.judul} />
        {metodeBayar.baris.map((baris, index) => <Row key={`${baris.label}-${index}`} k={baris.label} v={rp(baris.amount)} />)}
        <ClinicDemoFees snapshot={demoSnapshot}/>
        <Row k="Status" v={invoice.paid_status} />
        {credit > 0 && <Row k="Dialihkan" v={rp(credit)} />}
        {invoice.paid_status === "DP" && <Row k="Sisa" v={rp(Math.max(0, Number(invoice.total) - received))} />}
        <Hr />
        <div style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>
          Terima kasih 🐾<br />Semoga anabul sehat selalu
        </div>
      </div>
    </>
  );
}

/** Potongan satu barang, menjorok di bawah barisnya (promo atau diskon kasir). */
function PotonganBaris({ label, nilai }: { label: string | null; nilai: number }) {
  if (!label || !(nilai > 0.005)) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
      <span>&nbsp;&nbsp;{label}</span><span>-{rp(nilai)}</span>
    </div>
  );
}
function Hr() {
  return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />;
}
function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ minWidth: 48 }}>{k}</span><span>: {v}</span>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span>{v}</span></div>;
}
