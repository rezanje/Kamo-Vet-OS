import Link from "next/link";
import { EmployeePicker } from "@/components/EmployeePicker";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { formatPosMoney } from "@/lib/pos-money";
import { hariIniWIB } from "@/lib/tanggal";
import {
  atribusiPenjual, barisPerOrang, rekapTenagaPenjual, saringAtribusi,
  JENIS_PENJUAL, KANAL_PENJUAL, LABEL_KANAL_PENJUAL, LABEL_PERAN, PERAN_SEMUA,
  type KanalPenjual, type PeranPenjual, type RekapPenjual,
} from "@/lib/laporan-tenaga-penjual";
import type { JenisBarisPenjualan } from "@/lib/laporan-penjualan-barang";
import { ambilTenagaPenjual } from "./data";

// Penjualan per Tenaga Penjual.
//
// Pertanyaan Andri (Okt 2026): "siapa yang menjual apa, di semua kanal". Versi lama
// hanya benar-benar membaca faktur reseller; sekarang laporannya membaca BARIS
// penjualan dari kasir petshop, tagihan klinik (termasuk baris rawat inap yang
// memang masuk ke tagihan kunjungan), dan faktur grosir sekaligus.
//
// Satu baris bisa punya dua pemilik: Dokter dan Non-dokter. Masing-masing dihitung
// penuh di kolom perannya; "Total perusahaan" menghitung baris itu sekali saja.

const rp = formatPosMoney;
const num = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const awalBulan = () => hariIniWIB().slice(0, 8) + "01";
const tanggalIndo = (t: string) =>
  new Date(`${t}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Jakarta" });

const satuDari = <T extends string>(nilai: string | undefined, pilihan: readonly T[]): T | "" =>
  (pilihan as readonly string[]).includes(nilai ?? "") ? (nilai as T) : "";

export default async function PenjualPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang_id?: string; kanal?: string; peran?: string; karyawan?: string; jenis?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const kanal = satuDari<KanalPenjual>(sp.kanal, KANAL_PENJUAL);
  const peran = satuDari<PeranPenjual>(sp.peran, PERAN_SEMUA);
  const jenis = satuDari<JenisBarisPenjualan>(sp.jenis, JENIS_PENJUAL);

  const data = await ambilTenagaPenjual({ dari, sampai });
  const cabangId = data.cabangOptions.some((c) => c.id === sp.cabang_id) ? sp.cabang_id! : "";
  const karyawanId = data.karyawan.some((k) => k.id === sp.karyawan) ? sp.karyawan! : "";

  const semua = atribusiPenjual(data.rows);
  const terpilih = saringAtribusi(semua, { cabangId, kanal, peran, karyawanId, jenis });
  const { orang, tanpaPenjual, total } = rekapTenagaPenjual(terpilih);

  const jumlahNama = new Map<string, number>();
  for (const nama of data.namaKaryawan.values()) jumlahNama.set(nama, (jumlahNama.get(nama) ?? 0) + 1);
  const labelOrang = (employeeId: string | null): string => {
    if (!employeeId) return "Tanpa tenaga penjual";
    const nama = data.namaKaryawan.get(employeeId);
    if (!nama) return `Karyawan terhapus (ID ${employeeId.slice(-8)})`;
    return (jumlahNama.get(nama) ?? 0) > 1 ? `${nama} (ID ${employeeId.slice(-8)})` : nama;
  };

  const barisRekap: RekapPenjual[] = [...orang, ...(tanpaPenjual ? [tanpaPenjual] : [])];
  const fakturTerpilih = data.faktur.filter((f) => !karyawanId || f.penjualId === karyawanId);
  const sisaFaktur = fakturTerpilih.reduce((jumlah, f) => jumlah + f.sisa, 0);
  // Rekap "faktur belum lunas per penjual" — permintaan Kamo Group 24 Agu 2026.
  const fakturPerPenjual = [...fakturTerpilih.reduce((peta, f) => {
    const kunci = f.penjualId ?? "";
    const baris = peta.get(kunci) ?? { penjualId: f.penjualId, faktur: 0, lunas: 0, belum: 0, nilai: 0, sisa: 0 };
    baris.faktur += 1;
    baris.nilai += f.nilai;
    baris.sisa += f.sisa;
    if (f.sisa > 0) baris.belum += 1; else baris.lunas += 1;
    return peta.set(kunci, baris);
  }, new Map<string, { penjualId: string | null; faktur: number; lunas: number; belum: number; nilai: number; sisa: number }>()).values()]
    .sort((a, b) => b.sisa - a.sisa || b.nilai - a.nilai);

  const KOLOM = 7 + KANAL_PENJUAL.length + JENIS_PENJUAL.length;

  return (
    <LaporanPage
      icon="ti-user-dollar" title="PENJUALAN PER TENAGA PENJUAL"
      desc="Omzet per orang dari seluruh kanal — kasir petshop, tagihan klinik, dan faktur grosir — dipisah menurut peran Dokter dan Non-dokter pada tiap baris."
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
          <div style={{ minWidth: 170 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang_id" defaultValue={cabangId}>
              <option value="">Semua cabang</option>
              {data.cabangOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="flab">Kanal</label>
            <select className="fi" name="kanal" defaultValue={kanal}>
              <option value="">Semua kanal</option>
              {KANAL_PENJUAL.map((k) => <option key={k} value={k}>{LABEL_KANAL_PENJUAL[k]}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="flab">Peran</label>
            <select className="fi" name="peran" defaultValue={peran}>
              <option value="">Semua peran</option>
              {PERAN_SEMUA.map((p) => <option key={p} value={p}>{LABEL_PERAN[p]}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 210 }}>
            <label className="flab" htmlFor="filter-karyawan">Karyawan</label>
            <EmployeePicker employees={data.karyawan} name="karyawan" inputId="filter-karyawan"
              defaultValue={karyawanId} placeholder="Semua karyawan — ketik nama…" ariaLabel="Karyawan" />
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="flab">Jenis</label>
            <select className="fi" name="jenis" defaultValue={jenis}>
              <option value="">Semua jenis</option>
              {JENIS_PENJUAL.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Tenaga penjual", nilai: `${orang.length} orang` },
          { label: "Total perusahaan (netto)", nilai: rp(total.netto), warna: "#15803d" },
          { label: "Omzet bruto", nilai: rp(total.bruto) },
          { label: "Diskon", nilai: total.diskon ? `− ${rp(total.diskon)}` : "—", warna: total.diskon ? "#b45309" : undefined },
          { label: "Transaksi", nilai: `${total.transaksi}x` },
          { label: "Baris penjualan", nilai: `${total.baris}` },
          { label: "Tanpa tenaga penjual", nilai: rp(tanpaPenjual?.netto ?? 0), warna: tanpaPenjual?.netto ? "#b45309" : undefined },
          ...KANAL_PENJUAL.map((k) => ({ label: LABEL_KANAL_PENJUAL[k], nilai: rp(total.perKanal[k]) })),
        ]} />
      }
    >
      {data.pesanError && (
        <div className="crm-sec" role="alert" style={{ marginBottom: 12, color: "#b91c1c", fontSize: 12 }}>{data.pesanError}</div>
      )}

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · REKAP PER TENAGA PENJUAL</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1320 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 170 }}>Tenaga penjual</th>
                <th style={{ width: 140 }}>Peran</th>
                <th style={{ width: 70, textAlign: "center" }}>Transaksi</th>
                <th style={{ width: 60, textAlign: "center" }}>Baris</th>
                <th style={{ width: 70, textAlign: "center" }}>Qty</th>
                {KANAL_PENJUAL.map((k) => <th key={k} style={{ width: 115, textAlign: "right" }}>{LABEL_KANAL_PENJUAL[k]}</th>)}
                {JENIS_PENJUAL.map((j) => <th key={j} style={{ width: 105, textAlign: "right" }}>{j}</th>)}
                <th style={{ width: 120, textAlign: "right" }}>Bruto</th>
                <th style={{ width: 110, textAlign: "right" }}>Diskon</th>
                <th style={{ width: 130, textAlign: "right" }}>Netto</th>
              </tr>
            </thead>
            <tbody>
              {barisRekap.map((r) => (
                <tr key={r.employeeId ?? "tanpa-penjual"}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{labelOrang(r.employeeId)}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    {r.peran.length ? r.peran.map((p) => LABEL_PERAN[p]).join(" · ") : "—"}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.transaksi}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.baris}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{num(r.qty)}</td>
                  {KANAL_PENJUAL.map((k) => (
                    <td key={k} style={{ textAlign: "right", fontSize: 11, color: r.perKanal[k] ? "var(--tm)" : "var(--td)" }}>
                      {r.perKanal[k] ? rp(r.perKanal[k]) : "—"}
                    </td>
                  ))}
                  {JENIS_PENJUAL.map((j) => (
                    <td key={j} style={{ textAlign: "right", fontSize: 11, color: r.perJenis[j] ? "var(--tm)" : "var(--td)" }}>
                      {r.perJenis[j] ? rp(r.perJenis[j]) : "—"}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.bruto)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.diskon ? "#b45309" : "var(--td)" }}>
                    {r.diskon ? `− ${rp(r.diskon)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.netto)}</td>
                </tr>
              ))}
              {barisRekap.length === 0 && (
                <TabelKosong kolom={KOLOM} pesan="Belum ada baris penjualan pada saringan ini." />
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontSize: 11.5, fontWeight: 800 }}>Total perusahaan</td>
                <td style={{ fontSize: 10, color: "var(--tm)" }}>tiap baris 1x</td>
                <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700 }}>{total.transaksi}</td>
                <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700 }}>{total.baris}</td>
                <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700 }}>{num(total.qty)}</td>
                {KANAL_PENJUAL.map((k) => (
                  <td key={k} style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(total.perKanal[k])}</td>
                ))}
                {JENIS_PENJUAL.map((j) => (
                  <td key={j} style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(total.perJenis[j])}</td>
                ))}
                <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(total.bruto)}</td>
                <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{total.diskon ? `− ${rp(total.diskon)}` : "—"}</td>
                <td style={{ textAlign: "right", fontSize: 12, fontWeight: 800, color: "#15803d" }}>{rp(total.netto)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          <b>Satu baris bisa punya dua pemilik.</b> Sejak atribusi per baris, tiap baris
          mencatat Dokter dan Non-dokter yang mengerjakannya. Baris berdua dihitung PENUH
          untuk masing-masing orang di kolom perannya, jadi jumlah seluruh baris orang di
          tabel ini boleh lebih besar dari &quot;Total perusahaan&quot;. Baris Total
          perusahaan menghitung setiap baris penjualan tepat satu kali — itulah angka yang
          dibandingkan dengan laporan omzet.<br />
          Dokumen lama yang belum punya atribusi per baris memakai isian penjual lama
          (&quot;Penjual SKU&quot;, kasir struk, pembuat faktur grosir) dengan peran
          &quot;{LABEL_PERAN.Penjual}&quot;. Tagihan klinik lama tanpa isian itu jatuh ke
          dokter penanggung jawab kunjungannya, dihitung sebagai peran Dokter.<br />
          Baris yang tidak punya pemilik sama sekali masuk baris &quot;Tanpa tenaga penjual&quot;.
          {data.returTanpaSumber > 0 && <> Ada retur senilai {rp(data.returTanpaSumber)} yang
          baris asalnya tidak bisa dipastikan; pemiliknya tidak ditebak dan ikut ke baris itu.</>}
          {data.selisihDokumen > 0 && <> Sebesar {rp(data.selisihDokumen)} dari total dokumen
          tidak melekat pada baris mana pun (pajak atau biaya kepala dokumen), jadi tidak
          dinisbahkan ke siapa pun.</>}
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · RINCIAN BARIS PER ORANG</div>
        {barisRekap.length === 0 && <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada baris penjualan pada saringan ini.</div>}
        {barisRekap.map((r) => {
          const rincian = barisPerOrang(terpilih, r.employeeId);
          return (
            <details key={r.employeeId ?? "tanpa-penjual"} style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{labelOrang(r.employeeId)}</span>
                <span style={{ fontWeight: 600, color: "var(--tm)" }}>{rincian.length} baris · {rp(r.netto)}</span>
              </summary>
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="tbl" style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Tanggal</th>
                      <th style={{ width: 150 }}>Dokumen</th>
                      <th style={{ width: 80 }}>Kanal</th>
                      <th style={{ width: 110 }}>Peran</th>
                      <th>Pelanggan</th>
                      <th style={{ width: 110 }}>Pasien</th>
                      <th>Item</th>
                      <th style={{ width: 80 }}>Jenis</th>
                      <th style={{ width: 60, textAlign: "center" }}>Qty</th>
                      <th style={{ width: 120, textAlign: "right" }}>Nilai netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rincian.map(({ baris, peran }) => (
                      <tr key={baris.id}>
                        <td style={{ fontSize: 10.5 }}>{tanggalIndo(baris.tanggal)}</td>
                        <td style={{ fontSize: 10.5, fontFamily: "monospace", fontWeight: 600 }}>
                          <Link href={baris.href} style={{ color: "#2563eb", textDecoration: "none" }}>{baris.dokumen}</Link>
                        </td>
                        <td style={{ fontSize: 10.5 }}>{baris.kanal}</td>
                        <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{peran ? LABEL_PERAN[peran] : "—"}</td>
                        <td style={{ fontSize: 10.5 }}>{baris.pelanggan}</td>
                        <td style={{ fontSize: 10.5 }}>{baris.pasien}</td>
                        <td style={{ fontSize: 10.5 }}>{baris.item}</td>
                        <td style={{ fontSize: 10.5 }}>{baris.jenis}</td>
                        <td style={{ textAlign: "center", fontSize: 10.5 }}>{num(baris.qty)}</td>
                        <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: baris.retur ? "#b91c1c" : undefined }}>
                          {rp(baris.netto)}
                        </td>
                      </tr>
                    ))}
                    {rincian.length === 0 && <TabelKosong kolom={10} pesan="Tidak ada baris." />}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · FAKTUR GROSIR BELUM LUNAS PER PENJUAL</div>
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table className="tbl" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Penjual</th>
                <th style={{ width: 70, textAlign: "center" }}>Faktur</th>
                <th style={{ width: 70, textAlign: "center" }}>Lunas</th>
                <th style={{ width: 90, textAlign: "center" }}>Belum lunas</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai faktur</th>
                <th style={{ width: 140, textAlign: "right" }}>Belum tertagih</th>
              </tr>
            </thead>
            <tbody>
              {fakturPerPenjual.map((r) => (
                <tr key={r.penjualId ?? "tanpa-penjual"}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{labelOrang(r.penjualId)}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.faktur}</td>
                  <td style={{ textAlign: "center", fontSize: 11, color: "#15803d" }}>{r.lunas}</td>
                  <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: r.belum ? "#b91c1c" : "var(--td)" }}>{r.belum}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.nilai)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: r.sisa ? "#b91c1c" : "var(--td)" }}>
                    {r.sisa ? rp(r.sisa) : "lunas semua"}
                  </td>
                </tr>
              ))}
              {fakturPerPenjual.length === 0 && <TabelKosong kolom={6} pesan="Belum ada faktur grosir pada rentang ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. faktur</th>
                <th style={{ width: 95 }}>Tanggal</th>
                <th>Penjual</th>
                <th style={{ width: 130, textAlign: "right" }}>Nilai</th>
                <th style={{ width: 130, textAlign: "right" }}>Dibayar</th>
                <th style={{ width: 130, textAlign: "right" }}>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {fakturTerpilih.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontSize: 10.5, fontFamily: "monospace", fontWeight: 600 }}>
                    <Link href={`/penjualan/faktur/${f.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>{f.no_faktur}</Link>
                  </td>
                  <td style={{ fontSize: 10.5 }}>{tanggalIndo(f.tanggal)}</td>
                  <td style={{ fontSize: 11 }}>{labelOrang(f.penjualId)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(f.nilai)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: f.dibayar ? "#15803d" : "var(--td)" }}>{f.dibayar ? rp(f.dibayar) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: f.sisa ? "#b91c1c" : "var(--td)" }}>
                    {f.sisa ? rp(f.sisa) : "lunas"}
                  </td>
                </tr>
              ))}
              {fakturTerpilih.length === 0 && <TabelKosong kolom={6} pesan="Belum ada faktur grosir pada rentang ini." />}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ fontSize: 11, fontWeight: 700 }}>Belum tertagih</td>
                <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 800, color: sisaFaktur ? "#b91c1c" : "#15803d" }}>{rp(sisaFaktur)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Dokumen yang dihitung sama persis dengan laporan omzet: struk batal dan rencana
          bayar yang belum diselesaikan, tagihan klinik yang dibatalkan, serta faktur grosir
          batal / pengganti / saldo awal / selisih stok opname tidak ikut. Retur penjualan
          dikurangkan dari struk asalnya berapa pun tanggal returnya, sama seperti Rincian
          Penjualan per Transaksi.<br />
          Tagihan klinik dihitung sejak tanggal terbitnya (akrual), bukan tanggal pelunasan —
          laporan Komisi memakai tanggal pelunasan, jadi bulan yang sama bisa menunjuk angka
          berbeda. Nilai faktur grosir di tabel omzet per orang memakai DPP (sebelum PPN),
          karena PPN bukan omzet penjual. Potongan kepala dokumen dibagi proporsional ke
          tiap baris dengan rumus yang sama persis dengan laporan Komisi.
        </div>
      </div>
    </LaporanPage>
  );
}
