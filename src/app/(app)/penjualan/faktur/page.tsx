// Faktur Penjualan — SATU daftar untuk semua penjualan (permintaan Andri,
// mengikuti Faktur Penjualan di Accurate): struk kasir petshop, tagihan klinik,
// dan faktur grosir tampil bersama; satu klik membuka dokumen aslinya.
//
// Yang khusus grosir tetap di sini karena tidak punya rumah lain: tombol faktur
// baru, form Penerimaan, dan kolom Aksi Edit. Baris sumber lain cuma "Lihat" —
// koreksinya milik halaman dokumennya masing-masing.
import { NumberInput } from "@/components/NumberInput";
import { readCompleteList } from "@/lib/checked-list";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { hariIniWIB } from "@/lib/tanggal";
import {
  CATATAN_TOTAL, STATUS_LABEL, SUMBER_FAKTUR, SUMBER_LABEL, hrefFaktur, umurFaktur,
} from "@/lib/faktur-gabungan";
import {
  bacaFakturGabungan, bacaFilterFaktur, muatSisaGrosir, paramFilter, type ParamFaktur,
} from "@/lib/faktur-gabungan-server";
import { terimaPembayaranJual } from "./actions";
import Link from "next/link";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => !s ? "Tanpa tanggal" : new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const WARNA_SUMBER: Record<string, string> = { petshop: "b", klinik: "g", grosir: "o" };

export default async function FakturJualPage({
  searchParams,
}: {
  searchParams: Promise<ParamFaktur & { error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const boleh = await bolehTransaksiKas();
  const today = hariIniWIB();
  const filter = bacaFilterFaktur(sp, today);
  const param = paramFilter(filter);
  const unduh = (format: string) => `/penjualan/faktur/unduh?${new URLSearchParams({ ...param, format })}`;

  const daftar = await bacaFakturGabungan(supabase, user?.id ?? null, filter, sp.hal)
    .then(hasil => ({ hasil, error: null as unknown }))
    .catch(error => ({ hasil: null, error }));

  type Advance = { id: string; no_um: string; customer_id: string | null; jumlah: number; terpakai: number };
  type Credit = { id: string; tanggal: string; customer_credit: number; sales_invoices: Rel<{ id: string; no_faktur: string; customers: Rel<{ name: string }> }> };
  const idGrosir = (daftar.hasil?.rows ?? []).filter(row => row.sumber === "grosir").map(row => row.id);
  const [sisaGrosir, umData, rekening, credits] = await Promise.all([
    boleh ? muatSisaGrosir(supabase, idGrosir) : Promise.resolve(new Map<string, number>()),
    readCompleteList<Advance>((from, to) => supabase.from("sales_advances").select("id,no_um,customer_id,jumlah,terpakai", { count: "exact" })
      .eq("status", "aktif").order("id").range(from, to), "Uang muka pelanggan", { maxRows: null }),
    loadRekeningAktif(supabase),
    readCompleteList<Credit>((from, to) => supabase.from("wholesale_invoice_corrections")
      .select("id,tanggal,customer_credit,sales_invoices!invoice_id(id,no_faktur,customers(name))", { count: "exact" })
      .gt("customer_credit", 0).order("tanggal").order("id").range(from, to), "Kredit pelanggan", { maxRows: null }),
  ]);

  // Uang muka aktif per pelanggan, supaya DP yang sudah masuk tidak terlupa saat menagih.
  const umPerPelanggan = new Map<string, { id: string; no_um: string; sisa: number }[]>();
  for (const u of umData) {
    const sisa = Number(u.jumlah) - Number(u.terpakai);
    if (!u.customer_id || sisa <= 0) continue;
    const arr = umPerPelanggan.get(u.customer_id) ?? [];
    arr.push({ id: u.id, no_um: u.no_um, sisa });
    umPerPelanggan.set(u.customer_id, arr);
  }

  const hasil = daftar.hasil;
  const kolom = 9 + (boleh ? 1 : 0) + 1;

  return (
    <MasterPage
      back="/penjualan" icon="ti-receipt-2" title="FAKTUR PENJUALAN"
      desc="Semua penjualan dalam satu daftar: petshop, klinik, dan grosir. Klik barisnya untuk melihat isinya."
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mencatat penerimaan dan menerbitkan faktur grosir."
    >
      <form className="crm-sec" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div><label className="flab">Dari tanggal</label><input className="fi" type="date" name="dari" defaultValue={filter.dari} /></div>
        <div><label className="flab">Sampai tanggal</label><input className="fi" type="date" name="sampai" defaultValue={filter.sampai} /></div>
        <div style={{ minWidth: 170 }}>
          <label className="flab">Cabang</label>
          <select className="fi" name="cabang" defaultValue={filter.cabang}>
            <option value="">Semua cabang</option>
            {(hasil?.cabangOptions ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 130 }}>
          <label className="flab">Sumber</label>
          <select className="fi" name="sumber" defaultValue={filter.sumber}>
            <option value="">Semua sumber</option>
            {SUMBER_FAKTUR.map(s => <option key={s} value={s}>{SUMBER_LABEL[s]}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 130 }}>
          <label className="flab">Status</label>
          <select className="fi" name="status" defaultValue={filter.status}>
            <option value="">Semua status</option>
            <option value="lunas">{STATUS_LABEL.lunas}</option>
            <option value="belum">{STATUS_LABEL.belum}</option>
            <option value="batal">{STATUS_LABEL.batal}</option>
          </select>
        </div>
        <div><label className="flab">Pelanggan</label><input className="fi" name="pelanggan" defaultValue={filter.pelanggan} placeholder="Nama pelanggan" style={{ width: 160 }} /></div>
        <div><label className="flab">Cari nomor / pelanggan</label><input className="fi" name="cari" defaultValue={filter.cari} placeholder="Nomor atau nama" style={{ width: 190 }} /></div>
        <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5, paddingBottom: 7 }}>
          <input type="checkbox" name="batal" value="1" defaultChecked={filter.batal} /> Tampilkan batal
        </label>
        <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <a className="btn-def" href={unduh("xlsx")}>Excel</a>
          <a className="btn-def" href={unduh("csv")}>CSV</a>
          {boleh && <Link href="/penjualan/faktur/baru" className="btn-acc" style={{ textDecoration: "none" }}>+ Faktur Penjualan baru</Link>}
        </div>
      </form>

      {daftar.error ? <ListLoadFailure error={daftar.error} label="Daftar faktur penjualan" /> : hasil && <>
        <div className="crm-sec" style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 12 }}>
          <div><div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: .3 }}>Jumlah dokumen</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{hasil.ringkasan.jumlah.toLocaleString("id-ID")}</div></div>
          <div><div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: .3 }}>Total penjualan</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{rp(hasil.ringkasan.total)}</div></div>
          <div><div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: .3 }}>Belum lunas</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: hasil.ringkasan.jumlahBelum ? "#b45309" : "var(--sb)" }}>
              {hasil.ringkasan.jumlahBelum.toLocaleString("id-ID")} dokumen{" "}
              <span style={{ fontSize: 11, fontWeight: 500 }}>· nilai {rp(hasil.ringkasan.totalBelum)}</span></div>
            {/* Nilai dokumen, bukan sisa tagihan: faktur yang sudah dibayar sebagian
                tetap dihitung penuh di sini. Sisa sebenarnya ada di dokumennya. */}
            <div style={{ fontSize: 9, color: "var(--td)" }}>Nilai dokumen, bukan sisa tagihan.</div></div>
        </div>

        {hasil.pelangganTerpotong && <div className="p2ban" role="status">
          <i className="ti ti-info-circle" /> Nama pelanggan yang dicari terlalu banyak yang cocok; ketik nama lebih lengkap supaya hasilnya pasti.
        </div>}

        <div className="crm-sec" style={{ marginBottom: 12 }}>
          <SecHeader num="01" title="SEMUA PENJUALAN"
            desc={`${hasil.ringkasan.jumlah.toLocaleString("id-ID")} dokumen · ${rp(hasil.ringkasan.total)} · ${filter.dari} s/d ${filter.sampai}. ${CATATAN_TOTAL}`} />
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 1250 }}>
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Nomor</th>
                  <th style={{ width: 105 }}>Tanggal</th>
                  <th style={{ width: 130 }}>Cabang</th>
                  <th style={{ width: 85 }}>Sumber</th>
                  <th>Pelanggan</th>
                  <th>Keterangan</th>
                  <th style={{ width: 100 }}>Status</th>
                  <th style={{ width: 70, textAlign: "right" }}>Umur</th>
                  <th style={{ width: 130, textAlign: "right" }}>Total</th>
                  {boleh && <th style={{ width: 120 }}>Terima</th>}
                  <th style={{ width: 90 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {hasil.rows.map(row => {
                  const href = hrefFaktur(row);
                  const umur = row.status === "belum" ? umurFaktur(row.tanggal, today) : null;
                  const sisa = sisaGrosir.get(row.id) ?? 0;
                  const um = umPerPelanggan.get(row.customerId ?? "") ?? [];
                  return (
                    <tr key={`${row.sumber}-${row.id}`}>
                      <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                        <Link href={href}>{row.nomor || "(tanpa nomor)"}</Link>
                        {row.rincianHpp && <div style={{ marginTop: 3 }}>
                          <Link href={`/keuangan/buku-besar/hpp/${encodeURIComponent(row.nomor)}`} style={{ fontSize: 9.5, fontWeight: 500 }}>Lihat rincian HPP</Link>
                        </div>}
                      </td>
                      <td style={{ fontSize: 11 }}>{tgl(row.tanggal)}</td>
                      <td style={{ fontSize: 11 }}>{row.cabang}</td>
                      <td><span className={`bge ${WARNA_SUMBER[row.sumber]}`}>{SUMBER_LABEL[row.sumber]}</span></td>
                      <td style={{ fontSize: 11.5 }}>{row.pelanggan}</td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.keterangan}</td>
                      <td><span className={`bge ${row.status === "lunas" ? "g" : row.status === "belum" ? "o" : "x"}`}>{STATUS_LABEL[row.status]}</span></td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{umur === null ? "—" : `${umur} hr`}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(row.total)}</td>
                      {boleh && <td>
                        {row.sumber === "grosir" ? (
                          <details>
                            <summary className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
                              {sisa > 0 && row.status !== "batal" ? "Terima / periksa" : "Periksa penerimaan"}
                            </summary>
                            <TransactionForm userId={user?.id ?? ""} scope={`sales-payment:${row.id}`} action={terimaPembayaranJual} style={{ display: "flex", gap: 6, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
                              <input type="hidden" name="invoice_id" value={row.id} />
                              <div>
                                <label className="flab">Nominal (maks {rp(sisa)})</label>
                                <NumberInput className="fi" type="number" name="jumlah" min={1} max={sisa} step="any" defaultValue={sisa} style={{ width: 140 }} />
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
                              {sisa > 0 && row.status !== "batal" && <SubmitButton className="btn-acc" name="tindakan" value="simpan" icon="ti-cash" pendingText="Menyimpan…" style={{ padding: "7px 12px", fontSize: 11 }}>Simpan</SubmitButton>}
                              <button type="submit" className="btn-def" name="tindakan" value="periksa" formNoValidate>Periksa hasil terakhir</button>
                            </TransactionForm>
                          </details>
                        ) : <span style={{ fontSize: 10, color: "var(--td)" }}>di dokumennya</span>}
                      </td>}
                      <td>
                        <Link href={href} className="btn-def" style={{ textDecoration: "none", padding: "4px 10px", fontSize: 10.5 }}>
                          {row.sumber === "grosir" && row.status !== "batal" ? <><i className="ti ti-pencil" /> Edit</> : "Lihat"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {hasil.rows.length === 0 && (
                  <tr><td colSpan={kolom} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                    Tidak ada penjualan pada rentang dan saringan ini.
                  </td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} style={{ textAlign: "right", fontWeight: 700, fontSize: 11 }}>
                    Total {hasil.ringkasan.jumlah.toLocaleString("id-ID")} dokumen sesuai saringan
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 800, fontSize: 12 }}>{rp(hasil.ringkasan.total)}</td>
                  <td colSpan={kolom - 9} />
                </tr>
              </tfoot>
            </table>
          </div>
          <ListPagination path="/penjualan/faktur" query={param} total={hasil.ringkasan.jumlah} pageInfo={hasil.pageInfo} />
        </div>
      </>}

      {credits.length > 0 && <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="02" title="KREDIT PELANGGAN DARI KOREKSI GROSIR" desc="Kewajiban pelanggan pada akun 314001; perlu tinjauan keuangan untuk penyelesaian. Tidak ada refund/transfer otomatis." />
        <table className="tbl"><thead><tr><th>Tanggal</th><th>Pelanggan</th><th>Faktur asal</th><th>Kredit</th></tr></thead><tbody>
          {credits.map(c => { const f = one(c.sales_invoices); return <tr key={c.id}><td>{c.tanggal}</td><td>{one(f?.customers ?? null)?.name ?? "—"}</td><td><Link href={`/penjualan/faktur/${f?.id}`}>{f?.no_faktur}</Link></td><td>{rp(Number(c.customer_credit))}</td></tr>; })}
        </tbody></table>
      </div>}
    </MasterPage>
  );
}
