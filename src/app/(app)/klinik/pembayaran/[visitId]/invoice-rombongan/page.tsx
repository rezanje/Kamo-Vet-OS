import { readCompleteList } from "@/lib/checked-list";
import { customerPackageLines, type PackagePrintSource } from "@/lib/clinic-package-print";
import { printBranchHeading } from "@/components/print-branch-heading";
import { KopCabang } from "@/components/KopCabang";
import { bacaIdentitasKop } from "@/lib/cabang-identitas-server";
import { bacaKartuPetugas, idPetugas, petugasCetak, type BarisTagihanPetugas, type KunjunganPetugas } from "@/lib/petugas-cetak";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../PrintButton";
import { bacaRombongan } from "@/lib/rombongan-server";
import { labelStatus, ringkasTagihanRombongan } from "@/lib/rombongan-tagihan";
import { idCabangKopRombongan, nomorTagihanRombongan, rincianTagihanUtuh, sisaTagihan, totalGabunganCocok } from "@/lib/rombongan-cetak";
import { labelPromo } from "@/lib/label-potongan";
import { bacaRincianPromoKlinik, pasangPromoKeBaris } from "@/lib/rincian-promo-klinik";
import { muatBagianUangMuka, ringkasMetodeInvoice, type PembayaranMetode } from "@/lib/metode-uang-muka";
import { uangPindahanBersih } from "@/lib/uang-pindahan-bersih";

// Invoice gabungan satu kedatangan (A4): pemilik yang membawa beberapa hewan menerima SATU dokumen.
// Rombongannya diturunkan dari bacaRombongan — definisi yang sama dengan struk gabungan — jadi struk dan
// invoice tidak bisa berbeda pendapat tentang siapa yang ikut. Tagihan tetap terpisah per kunjungan di
// belakang layar: nomor invoice tiap hewan dicetak supaya bisa ditelusuri ke rekam medis dan jurnalnya.
// Tagihan yang sudah dibatalkan (void) tidak ikut. Invoice per hewan (…/invoice) tidak berubah.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function InvoiceRombonganPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const rombongan = await bacaRombongan(supabase, visitId);
  if (!rombongan) notFound();
  const ringkasan = ringkasTagihanRombongan(rombongan.baris);
  // Tagihan/pembayaran yang gagal dibaca bukan "belum ditagih": dokumen ditahan.
  if (rombongan.bacaanTagihanGagal) throw new Error("Verifikasi rincian tagihan gagal. Invoice gabungan tidak dapat dicetak.");

  const { data: acuan, error: acuanError } = await supabase
    .from("visits").select("branch_id, branches(name, code)").eq("id", visitId).maybeSingle();
  if (acuanError) throw new Error("Kunjungan sumber belum dapat diverifikasi. Invoice gabungan tidak dapat dicetak.");
  const branch = one(acuan?.branches as Rel<{ name: string; code: string | null }>);

  // Rincian tiap tagihan. Hewan yang belum ditagih tetap tampil sebagai bagian kosong — pemilik berhak tahu.
  const invoiceIds = nomorTagihanRombongan(rombongan.baris);
  const { data: invs, error: invoiceError } = invoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, invoice_no, subtotal, discount, tax, total, metode_bayar, paid_status, dp_amount, paid_at, created_at, cashier_name, visits(branch_id, branches(name, code))")
        .in("invoice_no", invoiceIds).is("voided_at", null)
    : { data: [] as Record<string, unknown>[], error: null };

  // Bacaan gagal / terpotong bukan "belum ditagih": dokumen ditahan (aturan yang sama dengan struk gabungan).
  if (!rincianTagihanUtuh(invoiceIds, invs, invoiceError)) {
    throw new Error("Verifikasi rincian tagihan gagal. Invoice gabungan tidak dapat dicetak.");
  }

  type Inv = {
    visits: Rel<{ branch_id?: string | null; branches: Rel<{ name: string; code: string | null }> }>;
    id: string; invoice_no: string; subtotal: number; discount: number; tax: number; total: number;
    metode_bayar: string | null; paid_status: string; dp_amount: number; paid_at: string | null; created_at: string; cashier_name: string | null;
  };
  const invRows = (invs ?? []) as unknown as Inv[];

  // Dua pembacaan (daftar rombongan & rincian tagihan) harus menyebut jumlah yang sama.
  if (!totalGabunganCocok(ringkasan.totalTagihan, invRows.map((i) => Number(i.total)))) {
    throw new Error("Verifikasi total tagihan gagal. Invoice gabungan tidak dapat dicetak.");
  }

  // Kop = identitas CABANG PENERBIT; beda cabang = hanya daftar nama (aturan struk gabungan).
  const idCabangKop = idCabangKopRombongan(invoiceIds, invRows, (acuan as { branch_id?: string | null } | null)?.branch_id);
  const identitas = await bacaIdentitasKop(supabase, idCabangKop);
  const namaKop = invoiceIds.length
    ? [...new Set(invRows.map((inv) => printBranchHeading(one(one(inv.visits)?.branches ?? null))))].join(" · ")
    : printBranchHeading(branch);

  const allItems = invRows.length
    ? await readCompleteList<PackagePrintSource & BarisTagihanPetugas & { id: string; invoice_id: string }>((from, to) => supabase.from("invoice_items")
        .select("id, invoice_id, item_id, deskripsi, qty, harga, diskon_persen, jenis, package_item_id, package_qty, package:items!invoice_items_package_item_id_fkey(name), service_performers", { count: "exact" })
        .in("invoice_id", invRows.map((i) => i.id)).order("created_at").order("id").range(from, to), "Rincian invoice gabungan", { maxRows: null })
    : [];
  const itemsPerInv = new Map<string, (PackagePrintSource & BarisTagihanPetugas)[]>();
  for (const it of allItems) itemsPerInv.set(it.invoice_id, [...(itemsPerInv.get(it.invoice_id) ?? []), it]);
  const invPerNo = new Map(invRows.map((i) => [i.invoice_no, i]));

  // Pembayaran tiap tagihan: metode & sisa dibaca dari komponennya, bukan dari kolom bawaan (lihat metode-uang-muka).
  const semuaPembayaran = invRows.length
    ? await readCompleteList<PembayaranMetode & { invoice_id: string; reversal_of: string | null }>((from, to) => supabase.from("invoice_payments")
        .select("id, invoice_id, amount, metode, transferred_from, reversal_of", { count: "exact" })
        .in("invoice_id", invRows.map((i) => i.id)).order("created_at").order("id").range(from, to), "Pembayaran invoice gabungan", { maxRows: null })
    : [];
  const bayarPerInv = new Map<string, (PembayaranMetode & { reversal_of: string | null })[]>();
  for (const p of semuaPembayaran) bayarPerInv.set(p.invoice_id, [...(bayarPerInv.get(p.invoice_id) ?? []), p]);
  const bagianUangMuka = await muatBagianUangMuka(supabase, invRows.map((i) => ({ id: i.id, payments: bayarPerInv.get(i.id) ?? [] })));

  // Petugas per hewan (kunjungan masing-masing), dicetak per jabatan — lihat petugas-cetak.
  const { data: visitRows, error: visitError } = await supabase
    .from("visits").select("id, poli, doctor_id, dokter, pets(name, species, breed)").in("id", rombongan.baris.map((b) => b.visitId));
  if (visitError || !Array.isArray(visitRows)) throw new Error("Kunjungan sumber belum dapat diverifikasi. Invoice gabungan tidak dapat dicetak.");
  type VisitRow = KunjunganPetugas & { id: string; pets: Rel<{ name: string; species: string | null; breed: string | null }> };
  const kunjunganPer = new Map((visitRows as VisitRow[]).map((v) => [v.id, v]));
  const kartuPetugas = await bacaKartuPetugas(supabase, idPetugas([...kunjunganPer.values()], allItems));

  // Promo per barang dicetak di bawah barangnya, per tagihan; "Diskon transaksi" hanya sisanya.
  const promoPerInv = await bacaRincianPromoKlinik(supabase, invRows.map((i) => i.id));
  const cetakPerInv = new Map(invRows.map((inv) => {
    const lines = customerPackageLines(itemsPerInv.get(inv.id) ?? [], { subtotal: inv.subtotal });
    return [inv.id, { lines, ...pasangPromoKeBaris(lines, promoPerInv.get(inv.id) ?? [], Number(inv.discount)) }] as const;
  }));

  // Pemilik: nama dari rombongan; telepon/alamat pelengkap (gagal baca = nama saja).
  const { data: pemilik } = rombongan.customerId
    ? await supabase.from("customers").select("name, phone, address").eq("id", rombongan.customerId).maybeSingle()
    : { data: null };
  const cust = pemilik as { name?: string | null; phone?: string | null; address?: string | null } | null;

  const metodeGabungan = new Map<string, string>(); // judul metode tiap tagihan, untuk ringkasan di bawah
  for (const inv of invRows) {
    const ringkas = ringkasMetodeInvoice(inv, bayarPerInv.get(inv.id) ?? [], bagianUangMuka);
    metodeGabungan.set(inv.id, ringkas.judul);
  }
  const metodeSemua = [...new Set([...metodeGabungan.values()].filter((m) => m && m !== "-"))].join(", ") || "-";
  const tgl = new Date(`${rombongan.tanggal}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: 14mm; } [data-bagian-hewan] { break-inside: avoid; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/pembayaran/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Invoice Gabungan" />
      </div>

      {!ringkasan.semuaLunas && (
        <div className="no-print p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-alert-triangle" /> {ringkasan.adaBelumDitagih
            ? "Ada pasien yang tagihannya belum dibuat dan/atau belum lunas — invoice ini belum lengkap."
            : "Masih ada tagihan yang belum lunas — invoice ini belum bisa dipakai sebagai bukti pelunasan."}
        </div>
      )}

      <div style={{ maxWidth: 720, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 10, padding: "32px 36px", fontSize: 12.5, color: "#141413" }}>
        {/* Kop */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, borderBottom: "2px solid #16213e", paddingBottom: 14, marginBottom: 18 }}>
          <KopCabang nama={namaKop} alamat={identitas.alamat} telepon={identitas.telepon} logoUrl={identitas.logoUrl} ukuranNama={20} warnaNama="#141413" ukuranKontak={10} />
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: ".04em" }}>INVOICE GABUNGAN</div>
            <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 3 }}>{ringkasan.jumlahPasien} pasien · {invoiceIds.length} invoice</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{tgl}</div>
            <span data-status-semua style={{ display: "inline-block", marginTop: 6, padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600,
              background: ringkasan.semuaLunas ? "#e8f5ee" : "#fef2f2", color: ringkasan.semuaLunas ? "#15803d" : "#b91c1c" }}>{ringkasan.semuaLunas ? "Lunas" : "Belum lunas"}</span>
          </div>
        </div>

        {/* Tagih ke */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9.5, color: "var(--td)", letterSpacing: ".06em", marginBottom: 3 }}>TAGIHAN KEPADA</div>
          <div style={{ fontWeight: 600 }}>{cust?.name ?? rombongan.customerName}</div>
          {cust?.phone ? <div style={{ fontSize: 11, color: "var(--tm)" }}>{cust.phone}</div> : null}
          {cust?.address ? <div style={{ fontSize: 11, color: "var(--tm)" }}>{cust.address}</div> : null}
        </div>

        {/* Per hewan */}
        {rombongan.baris.map((b, no) => {
          const nomor = b.invoiceNos ?? (b.invoiceNo ? [b.invoiceNo] : []);
          const daftar = nomor.map((n) => invPerNo.get(n)).filter(Boolean) as Inv[];
          const kunj = kunjunganPer.get(b.visitId);
          const pet = one(kunj?.pets ?? null);
          const petugas = petugasCetak(kunj, daftar.flatMap((inv) => itemsPerInv.get(inv.id) ?? []), kartuPetugas);
          const subtotalHewan = daftar.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
          return (
            <section key={b.visitId} data-bagian-hewan={b.visitId} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, background: "#f4f4f2", padding: "7px 10px", borderRadius: 6, marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{no + 1}. {b.hewan}
                    <span style={{ fontWeight: 400, fontSize: 11, color: "var(--tm)" }}> ({pet?.species ?? "-"}{pet?.breed ? " / " + pet.breed : ""})</span>
                  </div>
                  {kunj?.poli ? <div style={{ fontSize: 11, color: "var(--tm)" }}>Poli: {kunj.poli}</div> : null}
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                  {petugas.map((p) => <div key={p.label}>{p.label}: {p.nama}</div>)}
                  {daftar[0] && <div>Kasir: {daftar[0].cashier_name ?? "Kasir belum tercatat"}</div>}
                </div>
              </div>

              {!daftar.length && <div style={{ fontSize: 11, color: "var(--tm)", padding: "4px 10px" }}>(tagihan belum dibuat)</div>}

              {daftar.map((inv) => {
                const cetak = cetakPerInv.get(inv.id);
                const lines = cetak?.lines ?? [];
                const perBaris = cetak?.perBaris ?? [];
                const totalPromo = cetak?.totalPromo ?? 0;
                const diskonTransaksi = Math.max(0, Number(inv.discount) - totalPromo);
                const bayar = bayarPerInv.get(inv.id) ?? [];
                const { sisa } = sisaTagihan(inv, bayar);
                const lunas = inv.paid_status === "Lunas";
                const credit = uangPindahanBersih(bayar);
                const metode = ringkasMetodeInvoice(inv, bayar, bagianUangMuka);
                return (
                  <div key={inv.id} data-invoice={inv.invoice_no} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, margin: "0 0 4px" }}>
                      <span>No. Invoice: <b>{inv.invoice_no}</b></span>
                      <span style={{ padding: "1px 9px", borderRadius: 20, fontSize: 10, fontWeight: 600,
                        background: lunas ? "#e8f5ee" : "#fef2f2", color: lunas ? "#15803d" : "#b91c1c" }}>{inv.paid_status}</span>
                    </div>
                    <table className="tbl" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}>No</th><th>Deskripsi</th>
                          <th style={{ textAlign: "center", width: 50 }}>Qty</th>
                          <th style={{ textAlign: "right", width: 110 }}>Harga</th>
                          <th style={{ textAlign: "center", width: 56 }}>Disk</th>
                          <th style={{ textAlign: "right", width: 120 }}>Jumlah</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.flatMap((it, i) => [
                          <tr key={i}>
                            <td style={{ color: "var(--td)" }}>{i + 1}</td>
                            <td style={{ fontWeight: 500 }}>{it.deskripsi}</td>
                            <td style={{ textAlign: "center" }}>{it.qty}</td>
                            <td style={{ textAlign: "right" }}>{rp(it.harga)}</td>
                            <td style={{ textAlign: "center" }}>{it.diskon_persen === null ? rp(it.diskon) : Number(it.diskon_persen) > 0 ? `${Number(it.diskon_persen)}%` : "—"}</td>
                            <td style={{ textAlign: "right" }}>{rp(it.jumlah)}</td>
                          </tr>,
                          ...(perBaris[i] ?? []).map((p, k) => (
                            <tr key={`${i}-promo-${k}`}>
                              <td />
                              <td colSpan={4} style={{ fontSize: 11, color: "var(--tm)", paddingLeft: 16 }}>{labelPromo(p.nama)}</td>
                              <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>- {rp(p.potongan)}</td>
                            </tr>
                          )),
                        ])}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 8, marginLeft: "auto", width: 260 }}>
                      <SumRow label="Subtotal" value={rp(Number(inv.subtotal) - totalPromo)} />
                      {diskonTransaksi > 0.005 && <SumRow label="Diskon transaksi" value={`- ${rp(diskonTransaksi)}`} />}
                      {Number(inv.tax) > 0 && <SumRow label="PPN 11%" value={rp(inv.tax)} />}
                      <SumRow label={`Total ${inv.invoice_no}`} value={rp(inv.total)} tebal />
                      {credit > 0 && <SumRow label="Pembayaran dialihkan" value={`- ${rp(credit)}`} />}
                      {inv.paid_status === "DP" && Number(inv.dp_amount) > 0 && <SumRow label="DP dibayar" value={`- ${rp(inv.dp_amount)}`} />}
                      {!lunas && <SumRow label="Sisa" value={rp(sisa)} merah />}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--tm)" }}>
                      Metode pembayaran: <b style={{ color: "#141413" }}>{metode.judul}</b>
                      {metode.baris.map((baris, index) => <div key={`${baris.label}-${index}`} style={{ marginTop: 2 }}>{baris.label}: {rp(baris.amount)}</div>)}
                      {inv.paid_at && lunas && ` · Lunas pada ${new Date(inv.paid_at).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}`}
                    </div>
                  </div>
                );
              })}

              {daftar.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, borderTop: ".5px solid var(--bd)", paddingTop: 5, marginTop: 4 }}>
                  <span>Subtotal {b.hewan}</span><span data-subtotal-hewan>{rp(subtotalHewan)}</span>
                </div>
              )}
            </section>
          );
        })}

        {/* Total semua */}
        <div data-bagian-hewan="total" style={{ marginTop: 6, marginLeft: "auto", width: 300, borderTop: "1.5px solid #141413", paddingTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span style={{ fontWeight: 700 }}>TOTAL SEMUA</span>
            <span data-total-semua style={{ fontWeight: 700, fontSize: 14 }}>{rp(ringkasan.totalTagihan)}</span>
          </div>
          <SumRow label="Dibayar" value={rp(ringkasan.totalDibayar)} />
          {ringkasan.sisa > 0 && <SumRow label="Sisa" value={rp(ringkasan.sisa)} merah />}
        </div>

        {/* Status per hewan */}
        <table className="tbl" style={{ width: "100%", marginTop: 18 }}>
          <thead>
            <tr><th>Pasien</th><th>No. Invoice</th><th style={{ textAlign: "right", width: 120 }}>Total</th><th style={{ width: 100 }}>Status</th></tr>
          </thead>
          <tbody>
            {rombongan.baris.map((b) => (
              <tr key={b.visitId}>
                <td>{b.hewan}</td>
                <td style={{ fontSize: 11 }}>{(b.invoiceNos ?? (b.invoiceNo ? [b.invoiceNo] : [])).join(", ") || "—"}</td>
                <td style={{ textAlign: "right" }}>{rp(b.total)}</td>
                <td>{labelStatus(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 18, fontSize: 11, color: "var(--tm)", borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
          Metode pembayaran: <b style={{ color: "#141413" }}>{metodeSemua}</b> · Status keseluruhan: <b data-status-keseluruhan style={{ color: "#141413" }}>{ringkasan.semuaLunas ? "Lunas" : "Belum lunas"}</b>
          <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--td)" }}>Invoice gabungan ini merangkum invoice tiap hewan di atas dan sah tanpa tanda tangan & cap. PPN 11% dihitung dari DPP (subtotal − diskon).</div>
        </div>
      </div>
    </>
  );
}

function SumRow({ label, value, tebal, merah }: { label: string; value: string; tebal?: boolean; merah?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5, fontWeight: tebal || merah ? 600 : 400, color: merah ? "#b91c1c" : undefined }}>
      <span style={{ color: merah ? "#b91c1c" : "var(--tm)" }}>{label}</span><span>{value}</span>
    </div>
  );
}
