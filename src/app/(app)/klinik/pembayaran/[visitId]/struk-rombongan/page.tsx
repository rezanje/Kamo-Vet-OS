import { readCompleteList } from "@/lib/checked-list";
import { customerPackageLines, type PackagePrintSource } from "@/lib/clinic-package-print";
import { printBranchHeading } from "@/components/print-branch-heading";
import { bacaKartuPetugas, idPetugas, petugasCetak, type BarisTagihanPetugas, type KunjunganPetugas } from "@/lib/petugas-cetak";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../PrintButton";
import { bacaRombongan } from "@/lib/rombongan-server";
import { labelStatus, ringkasTagihanRombongan } from "@/lib/rombongan-tagihan";
import { labelPromo } from "@/lib/label-potongan";
import { bacaRincianPromoKlinik, labelDiskonBaris, pasangPromoKeBaris } from "@/lib/rincian-promo-klinik";

// Struk gabungan satu kedatangan: pemilik menerima SATU lembar untuk seluruh
// hewannya. Di belakang layar tagihannya tetap terpisah per kunjungan — nomor
// tagihan masing-masing tetap dicetak supaya tiap baris bisa ditelusuri ke
// rekam medis, insentif dokter, dan jurnalnya sendiri.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function StrukRombonganPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const rombongan = await bacaRombongan(supabase, visitId);
  if (!rombongan) notFound();

  const ringkasan = ringkasTagihanRombongan(rombongan.baris);

  const { data: acuan } = await supabase
    .from("visits").select("branches(name, code)").eq("id", visitId).maybeSingle();
  const branch = one(acuan?.branches as Rel<{ name: string; code: string | null }>);

  // Rincian tiap tagihan. Kunjungan yang belum ditagih sengaja tetap tampil sebagai
  // baris kosong — pemilik berhak tahu ada pemeriksaan yang tagihannya belum keluar.
  // Rawat inap bertahap: satu kunjungan bisa punya beberapa nomor tagihan aktif.
  const invoiceIds = [...new Set(rombongan.baris
    .flatMap((b) => b.invoiceNos ?? (b.invoiceNo ? [b.invoiceNo] : []))
    .filter(Boolean) as string[])];
  const { data: invs, error: invoiceError } = invoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, invoice_no, subtotal, discount, tax, total, metode_bayar, paid_status, dp_amount, cashier_name, visits(branches(name, code))")
        .in("invoice_no", invoiceIds)
    : { data: [] as Record<string, unknown>[], error: null };

  // A failed or truncated read is not an unbilled group: withhold the receipt.
  const requestedInvoiceNos = new Set(invoiceIds);
  if (invoiceIds.length && (invoiceError || !Array.isArray(invs)
    || invs.length !== invoiceIds.length
    || new Set(invs.map(inv => inv?.invoice_no)).size !== invoiceIds.length
    || invs.some(inv => typeof inv?.invoice_no !== "string" || !requestedInvoiceNos.has(inv.invoice_no)))) {
    throw new Error("Verifikasi rincian tagihan gagal. Struk gabungan tidak dapat dicetak.");
  }

  type Inv = {
    visits: Rel<{ branches: Rel<{ name: string; code: string | null }> }>;
    id: string; invoice_no: string; subtotal: number; discount: number; tax: number;
    total: number; metode_bayar: string | null; paid_status: string; dp_amount: number; cashier_name: string | null;
  };
  const invRows = (invs ?? []) as unknown as Inv[];

  const allItems = invRows.length
    ? await readCompleteList<PackagePrintSource & BarisTagihanPetugas & { id: string; invoice_id: string }>((from, to) => supabase.from("invoice_items")
        .select("id, invoice_id, item_id, deskripsi, qty, harga, diskon_persen, jenis, package_item_id, package_qty, package:items!invoice_items_package_item_id_fkey(name), service_performers", { count: "exact" })
        .in("invoice_id", invRows.map((i) => i.id)).order("created_at").order("id").range(from, to), "Rincian struk gabungan", { maxRows: null })
    : [];

  const itemsPerInv = new Map<string, (PackagePrintSource & BarisTagihanPetugas)[]>();
  for (const it of allItems ?? []) {
    itemsPerInv.set(it.invoice_id, [...(itemsPerInv.get(it.invoice_id) ?? []), it]);
  }
  const invPerNo = new Map(invRows.map((i) => [i.invoice_no, i]));

  // Tiap hewan punya kunjungannya sendiri, jadi petugasnya juga sendiri-sendiri.
  // Dicetak per jabatan (Dokter / Groomer / Staff), bukan per baris — lihat petugas-cetak.ts.
  const { data: visitRows } = await supabase
    .from("visits").select("id, poli, doctor_id, dokter").in("id", rombongan.baris.map((b) => b.visitId));
  const kunjunganPer = new Map(((visitRows ?? []) as (KunjunganPetugas & { id: string })[]).map((v) => [v.id, v]));
  const kartuPetugas = await bacaKartuPetugas(supabase, idPetugas([...kunjunganPer.values()], allItems ?? []));

  // Promo per barang (Reza 8 Nov) dicetak di bawah barangnya, per nota hewan; "Diskon
  // transaksi" di bawah hanya sisanya. Total tidak berubah.
  const promoPerInv = await bacaRincianPromoKlinik(supabase, invRows.map((i) => i.id));
  const cetakPerInv = new Map(invRows.map((inv) => {
    const lines = customerPackageLines(itemsPerInv.get(inv.id) ?? [], { subtotal: inv.subtotal });
    return [inv.id, { lines, ...pasangPromoKeBaris(lines, promoPerInv.get(inv.id) ?? [], Number(inv.discount)) }] as const;
  }));
  const totalDiskon = invRows.reduce((a, i) => a + Math.max(0, (Number(i.discount) || 0) - (cetakPerInv.get(i.id)?.totalPromo ?? 0)), 0);
  const totalPpn = invRows.reduce((a, i) => a + (Number(i.tax) || 0), 0);
  const metode = [...new Set(invRows.map((i) => i.metode_bayar).filter(Boolean))].join(", ") || "-";
  const tgl = new Date(`${rombongan.tanggal}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta",
    day: "2-digit", month: "short", year: "numeric",
  });

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/pembayaran/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Struk Gabungan" />
      </div>

      {!ringkasan.semuaLunas && (
        <div className="no-print p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-alert-triangle" /> Masih ada tagihan yang belum lunas — struk ini belum bisa dipakai sebagai bukti pelunasan.
        </div>
      )}

      <div style={{ width: "74mm", margin: "0 auto", background: "#fff", padding: "10px 8px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>{invoiceIds.length ? [...new Set(invRows.map(inv => printBranchHeading(one(one(inv.visits)?.branches ?? null))))].join(" · ") : printBranchHeading(branch)}</div>
        </div>
        <Hr />
        <Kv k="Tgl" v={tgl} />
        <Kv k="Pemilik" v={rombongan.customerName} />
        <Kv k="Pasien" v={`${ringkasan.jumlahPasien} ekor`} />
        <Hr />

        {rombongan.baris.map((b) => {
          const nomor = b.invoiceNos ?? (b.invoiceNo ? [b.invoiceNo] : []);
          const daftar = nomor.map((no) => invPerNo.get(no)).filter(Boolean) as Inv[];
          const petugas = petugasCetak(kunjunganPer.get(b.visitId), daftar.flatMap((inv) => itemsPerInv.get(inv.id) ?? []), kartuPetugas);
          return (
            <div key={b.visitId} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>
                {b.hewan}
                {daftar.length ? <span style={{ fontWeight: 400, fontSize: 9.5 }}> · {daftar.map((i) => i.invoice_no).join(", ")}</span> : null}
              </div>
              {daftar[0] && <Kv k="Kasir" v={daftar[0].cashier_name ?? "Kasir belum tercatat"} />}
              {petugas.map((p) => <Kv key={p.label} k={p.label} v={p.nama} />)}
              {!daftar.length && <div style={{ fontSize: 9.5 }}>(tagihan belum dibuat)</div>}
              {daftar.flatMap((inv) => {
                const cetak = cetakPerInv.get(inv.id);
                return (cetak?.lines ?? []).map((it, i) => ({ it, promos: cetak?.perBaris[i] ?? [], key: `${inv.id}-${i}` }));
              }).map(({ it, promos, key }) => (
                <div key={key}>
                  <div>{it.deskripsi}</div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{it.qty} x {rp(it.harga)}</span>
                    <span>{rp(it.jumlah + it.diskon)}</span>
                  </div>
                  <PotonganBaris label={labelDiskonBaris(it)} nilai={it.diskon} />
                  {promos.map((p, k) => <PotonganBaris key={k} label={labelPromo(p.nama)} nilai={p.potongan} />)}
                </div>
              ))}
              {daftar.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                  <span>Subtotal {b.hewan}</span>
                  <span>{rp(daftar.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0))}</span>
                </div>
              )}
            </div>
          );
        })}

        <Hr />
        {totalDiskon > 0.005 && <Row k="Diskon transaksi" v={`-${rp(totalDiskon)}`} />}
        {totalPpn > 0 && <Row k="PPN" v={rp(totalPpn)} />}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}>
          <span>TOTAL SEMUA</span><span>{rp(ringkasan.totalTagihan)}</span>
        </div>
        <Row k="Dibayar" v={rp(ringkasan.totalDibayar)} />
        {ringkasan.sisa > 0 && <Row k="Sisa" v={rp(ringkasan.sisa)} />}
        <Hr />
        <Row k="Metode" v={metode} />
        <Row k="Status" v={ringkasan.semuaLunas ? "Lunas" : "Belum lunas"} />
        <Hr />
        <div style={{ fontSize: 9 }}>
          {rombongan.baris.map((b) => (
            <div key={b.visitId} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{b.hewan}</span><span>{labelStatus(b)}</span>
            </div>
          ))}
        </div>
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
