import { NumberInput } from "@/components/NumberInput";
import Link from "next/link";
import { ServiceAttributionTable } from "@/components/ServiceAttributionTable";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster, bolehKelolaPayroll } from "@/lib/master-guard";
import { komisiPeriode, muatKebijakanKomisiJasa } from "@/lib/komisi-data";
import { hapusAturanKomisi, simpanAturanKomisi, simpanKebijakanKomisiJasa, simpanKelompokKomisi, toggleAturanKomisi } from "./actions";
import { readCompleteList } from "@/lib/checked-list";
import { ListLoadFailure } from "@/components/ListPagination";
import { ItemReferenceField } from "@/components/ItemReferenceField";
import { rincianKomisiText } from "@/lib/komisi-detail";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const periodeSekarang = () => new Date().toISOString().slice(0, 7);

const LABEL_SUMBER: Record<string, string> = {
  semua: "Semua penjualan",
  kasir: "Kasir / petshop",
  klinik: "Klinik",
  reseller: "Reseller (B2B)",
  visit_ranap: "Visit rawat inap",
};

type Aturan = {
  id: string; nama: string; tipe: string; basis: string; sumber: string; persen: number; nominal: number;
  employee_id: string | null; branch_id: string | null; category_id: string | null; item_id: string | null;
  min_omzet: number; berlaku_dari: string | null; berlaku_sampai: string | null; is_active: boolean;
  commission_group: string | null; override_group_rule_id: string | null;
};

export default async function KomisiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; periode?: string }>;
}) {
  const sp = await searchParams;
  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : periodeSekarang();

  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();
  // Group membership and personal/group/exception rules are pay configuration: OWNER only.
  const bolehAturGaji = await bolehKelolaPayroll();

  let loaded;
  try { loaded = await Promise.all([
      readCompleteList<Aturan>((from, to) => supabase.from("commission_rules")
        .select("id, nama, tipe, basis, sumber, persen, nominal, employee_id, commission_group, override_group_rule_id, branch_id, category_id, item_id, min_omzet, berlaku_dari, berlaku_sampai, is_active", { count: "exact" })
        .order("nama").order("id").range(from, to), "Aturan komisi", { maxRows: null }),
      readCompleteList<{ id: string; nama: string; jabatan: string | null; commission_group: string | null }>((from, to) => supabase.from("employees")
        .select("id, nama, jabatan, commission_group", { count: "exact" }).eq("status", "Aktif").order("nama").order("id").range(from, to), "Karyawan komisi", { maxRows: null }),
      readCompleteList<{ id: string; name: string }>((from, to) => supabase.from("branches")
        .select("id, name", { count: "exact" }).eq("is_active", true).order("name").order("id").range(from, to), "Cabang komisi", { maxRows: null }),
      readCompleteList<{ id: string; name: string; parent_id: string | null }>((from, to) => supabase.from("item_categories")
        .select("id, name, parent_id", { count: "exact" }).order("name").order("id").range(from, to), "Kategori komisi", { maxRows: null }),
      readCompleteList<{ id: string; code: string | null; name: string }>((from, to) => supabase.from("items")
        .select("id, code, name", { count: "exact" }).eq("is_active", true).order("name").order("id").range(from, to), "Produk komisi", { maxRows: null }),
      muatKebijakanKomisiJasa(supabase),
      komisiPeriode(supabase, periode),
    ]); } catch (loadError) { return <ListLoadFailure error={loadError} label="Referensi komisi" />; }
  const [aturan, karyawan, cabang, kategori, barang, kebijakanTersimpan, hitungan] = loaded;
  const kebijakanJasa = kebijakanTersimpan.policies;

  const namaEmp = new Map(karyawan.map((k) => [k.id, k.nama]));
  const namaCab = new Map(cabang.map((c) => [c.id, c.name]));
  const namaKat = new Map(kategori.map((k) => [k.id, k.name]));
  const namaItem = new Map(barang.map((i) => [i.id, i.name]));
  const aturanById = new Map(aturan.map((a) => [a.id, a]));
  const groupEmp = new Map(karyawan.map((k) => [k.id, k.commission_group]));
  const kodeKelompok = [...new Set(karyawan.map(k => k.commission_group).filter((code): code is string => !!code))].sort();
  const barisVisit = (hitungan.baris ?? []).filter(row => row.sumber === "visit_ranap");
  const barisPaket = (hitungan.baris ?? []).filter(row => (row.paketKomponen ?? 0) > 0);

  const cakupan = (a: Aturan): string => {
    const bagian = [
      a.employee_id ? namaEmp.get(a.employee_id) ?? "karyawan" : null,
      a.commission_group ? `kelompok ${a.commission_group}` : null,
      a.override_group_rule_id ? `mengganti ${aturanById.get(a.override_group_rule_id)?.nama ?? "aturan kelompok"}` : null,
      a.branch_id ? namaCab.get(a.branch_id) ?? "cabang" : null,
      a.category_id ? `kategori ${namaKat.get(a.category_id) ?? "?"}` : null,
      a.item_id ? namaItem.get(a.item_id) ?? "produk" : null,
    ].filter(Boolean);
    return bagian.length ? bagian.join(" · ") : "Semua penjualan";
  };

  const hasil = [...hitungan.hasil].sort((a, b) => b.komisi - a.komisi);
  const totalKomisi = hasil.reduce((a, h) => a + h.komisi, 0);
  // Each source line is counted once even when an explicit policy gives two actors a full commission basis.
  const totalOmzet = hitungan.baris.reduce((a, row) => a + row.omzet, 0);
  const visitDobel = hitungan.visitDobel ?? [];
  const tanpaHpp = hasil.reduce((a, h) => a + h.barisTanpaHpp, 0);
  const adaAturanLaba = aturan.some((a) => a.is_active && a.basis === "laba");

  return (
    <MasterPage
      back="/penjualan" icon="ti-percentage" title="KOMISI PENJUAL"
      desc="Aturan insentif karyawan & hitungannya per bulan"
      error={sp.error} success={sp.success} successMsg="Aturan komisi tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah aturan komisi."
      aksi={bolehKelola ? (
        <Link href="/pengaturan/impor/komisi" className="btn-def" style={{ fontSize: 11, textDecoration: "none" }}>
          <i className="ti ti-file-spreadsheet" /> Impor dari Excel
        </Link>
      ) : null}
    >
      <div className="crm-sec">
        <SecHeader num="00" title="KEBIJAKAN JASA DUA PELAKSANA"
          desc="Pilih cara memakai tarif komisi existing saat satu baris jasa dikerjakan dokter dan non-dokter. Tanpa pilihan yang cocok, komisi dan penggajian baris itu tetap tertahan." />
        <p style={{fontSize:11}}>Pilihan bertanggal tersimpan sebagai riwayat. Cabang khusus mengalahkan pilihan semua cabang; pilihan terbaru pada tanggal yang sama berlaku. Retur mengikuti pilihan pada tanggal struk asal. Pool DEMO tetap memakai snapshot yang sudah ada.</p>
        {!kebijakanTersimpan.installed && <p style={{fontSize:11}}>Penyimpanan kebijakan belum terpasang di database. Baris dua pelaksana tetap tertahan; komisi lain tetap dihitung.</p>}
        {bolehKelola && kebijakanTersimpan.installed && <form action={simpanKebijakanKomisiJasa}>
          <div className="frow">
            <div><label className="flab" htmlFor="service-policy-mode">Cara menghitung *</label>
              <select className="fi" id="service-policy-mode" name="mode" defaultValue="" required>
                <option value="" disabled>Pilih kebijakan</option>
                <option value="pending">Tahan komisi dua pelaksana sampai diputuskan</option>
                <option value="personal_rules">Aturan khusus masing-masing karyawan, dasar penuh untuk keduanya</option>
                <option value="both_full">Semua aturan yang berlaku, dasar penuh untuk keduanya</option>
                <option value="split">Bagi dasar menurut persentase yang diisi</option>
              </select></div>
            <div><label className="flab" htmlFor="service-policy-branch">Cabang</label>
              <select className="fi" id="service-policy-branch" name="branch_id" defaultValue=""><option value="">Semua cabang</option>
                {cabang.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></div>
            <div><label className="flab" htmlFor="service-policy-date">Berlaku mulai *</label>
              <input className="fi" id="service-policy-date" type="date" name="effective_from" required /></div>
            <div><label className="flab" htmlFor="service-policy-doctor">Bagian dasar dokter (%)</label>
              <NumberInput className="fi" id="service-policy-doctor" name="doctor_share_pct" type="number" min={0} max={100} step="0.01" placeholder="isi hanya untuk Bagi dasar" /></div>
            <div><label className="flab" htmlFor="service-policy-staff">Bagian dasar non-dokter (%)</label>
              <NumberInput className="fi" id="service-policy-staff" name="staff_share_pct" type="number" min={0} max={100} step="0.01" placeholder="total bersama dokter 100" /></div>
            <div style={{display:"flex",alignItems:"flex-end"}}><SubmitButton className="btn-acc" pendingText="Menyimpan…">Simpan kebijakan</SubmitButton></div>
          </div>
        </form>}
        {!kebijakanTersimpan.installed?null:kebijakanJasa.length===0?<p style={{fontSize:11}}>Belum ada kebijakan tersimpan. Baris dua pelaksana tetap perlu keputusan sebelum masuk penggajian.</p>
          :<div style={{overflowX:"auto"}}><table className="tbl"><thead><tr><th>Mulai</th><th>Cabang</th><th>Cara hitung</th></tr></thead><tbody>
            {kebijakanJasa.slice(0,20).map(row=><tr key={row.id}><td>{row.effectiveFrom}</td><td>{row.branchId?namaCab.get(row.branchId)??"Cabang tidak aktif":"Semua cabang"}</td>
              <td>{row.mode==="pending"?"Ditahan — perlu keputusan":row.mode==="personal_rules"?"Aturan khusus karyawan · dasar penuh keduanya":row.mode==="both_full"?"Semua aturan · dasar penuh keduanya":row.mode==="split"?`Dokter ${row.doctorSharePct}% · non-dokter ${row.staffSharePct}%`:"Tidak dikenal — tertahan"}</td></tr>)}</tbody></table>
            {kebijakanJasa.length>20&&<p style={{fontSize:11}}>Menampilkan 20 pilihan terbaru dari {kebijakanJasa.length} riwayat.</p>}
          </div>}
      </div>
      <div className="crm-sec">
        <SecHeader num="K" title="KELOMPOK INSENTIF" desc="Tetapkan kode grade/kelompok karyawan sesuai keputusan bisnis. Kode kosong berarti tanpa kelompok; tarifnya diatur di aturan bawah." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {karyawan.map(k => <form key={k.id} action={simpanKelompokKomisi} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="hidden" name="employee_id" value={k.id} />
            <label className="flab" htmlFor={`group-${k.id}`}>{k.nama}</label>
            {bolehAturGaji ? <><input id={`group-${k.id}`} className="fi" name="commission_group" maxLength={40} pattern="[a-z0-9][a-z0-9_\-]{0,39}" defaultValue={k.commission_group ?? ""} placeholder="kode kelompok" style={{ width: 145 }} />
              <SubmitButton className="btn-def" pendingText="Menyimpan…">Simpan</SubmitButton></> : <span>{k.commission_group ?? "—"}</span>}
          </form>)}
        </div>
      </div>
      <div className="crm-sec">
        <SecHeader
          num="01" title="DAFTAR ATURAN"
          desc="Beberapa aturan boleh berlaku bersamaan pada satu struk."
        />

        {bolehKelola && (
          <form action={simpanAturanKomisi} style={{ marginBottom: 12 }}>
            <div className="frow">
              <div>
                <label className="flab">Nama aturan *</label>
                <input className="fi" name="nama" maxLength={60} placeholder="mis. Komisi umum kasir" required />
              </div>
              <div>
                <label className="flab">Jenis *</label>
                <select className="fi" name="tipe" defaultValue="persen" required>
                  <option value="persen">Persen dari penjualan</option>
                  <option value="nominal">Nominal tetap per unit terjual</option>
                </select>
              </div>
              <div>
                <label className="flab">Dihitung dari *</label>
                <select className="fi" name="basis" defaultValue="omzet" required>
                  <option value="omzet">Omzet (harga jual)</option>
                  <option value="laba">Laba kotor (harga jual − modal)</option>
                </select>
              </div>
              <div>
                <label className="flab">Sumber transaksi *</label>
                <select className="fi" name="sumber" defaultValue="semua" required>
                  <option value="semua">Semua penjualan</option>
                  <option value="kasir">Kasir / petshop saja</option>
                  <option value="klinik">Klinik saja (insentif dokter)</option>
                  <option value="reseller">Reseller / B2B saja (faktur penjualan)</option>
                  <option value="visit_ranap">Visit dokter rawat inap (nominal per visit)</option>
                </select>
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Persen (%)</label>
                <NumberInput className="fi" name="persen" type="number" min={0} max={100} step="any" placeholder="isi kalau jenisnya persen" />
              </div>
              <div>
                <label className="flab">Nominal per unit (Rp)</label>
                <NumberInput className="fi" name="nominal" type="number" min={0} step="any" placeholder="isi kalau jenisnya nominal" />
              </div>
              <div>
                <label className="flab">Cair kalau tembus (Rp)</label>
                <NumberInput className="fi" name="min_omzet" type="number" min={0} step="any" defaultValue={0} />
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Khusus karyawan</label>
                <select className="fi" name="employee_id" defaultValue="">
                  <option value="">— semua karyawan —</option>
                  {karyawan.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Khusus grade/kelompok</label>
                <select className="fi" name="commission_group" defaultValue="">
                  <option value="">— semua kelompok —</option>
                  {kodeKelompok.map(code => <option key={code} value={code}>{code}</option>)}
                </select>
                <div style={{ fontSize: 10, color: "var(--tm)" }}>Pilih kelompok atau karyawan khusus (hanya OWNER).</div>
              </div>
              <div>
                <label className="flab">Pengecualian individu: ganti aturan kelompok</label>
                <select className="fi" name="override_group_rule_id" defaultValue="">
                  <option value="">— tidak mengganti —</option>
                  {aturan.filter(a => a.commission_group).map(a => <option key={a.id} value={a.id}>{a.nama} ({a.commission_group})</option>)}
                </select>
                <div style={{ fontSize: 10, color: "var(--tm)" }}>Perlu pilih satu karyawan; aturan kelompok diganti hanya pada baris yang cocok.</div>
              </div>
              <div>
                <label className="flab">Khusus cabang</label>
                <select className="fi" name="branch_id" defaultValue="">
                  <option value="">— semua cabang —</option>
                  {cabang.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Khusus kategori barang</label>
                <select className="fi" name="category_id" defaultValue="">
                  <option value="">— semua kategori —</option>
                  {kategori.map((k) => (
                    <option key={k.id} value={k.id}>{k.parent_id ? `— ${k.name}` : k.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flab">Khusus produk</label>
                <ItemReferenceField name="item_id" ariaLabel="Produk aturan komisi" items={barang.map(item => ({ ...item, code: item.code ?? "" }))} />
                <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 4 }}>Kosongkan untuk semua produk.</div>
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Berlaku mulai</label>
                <input className="fi" name="berlaku_dari" type="date" />
              </div>
              <div>
                <label className="flab">Berlaku sampai</label>
                <input className="fi" name="berlaku_sampai" type="date" />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
                <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
                  Simpan aturan
                </SubmitButton>
              </div>
            </div>
          </form>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Aturan</th>
                <th style={{ width: 150 }}>Hitungan</th>
                <th style={{ width: 120 }}>Sumber</th>
                <th style={{ width: 230 }}>Berlaku untuk</th>
                <th style={{ width: 130, textAlign: "right" }}>Ambang cair</th>
                <th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {aturan.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {a.nama}
                    {(a.berlaku_dari || a.berlaku_sampai) && (
                      <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>
                        {a.berlaku_dari ?? "…"} s/d {a.berlaku_sampai ?? "…"}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {a.tipe === "persen"
                      ? `${Number(a.persen)}% dari ${a.basis === "laba" ? "laba" : "omzet"}`
                      : `${rp(Number(a.nominal))} / ${a.sumber === "visit_ranap" ? "visit" : "unit"}`}
                  </td>
                  <td style={{ fontSize: 10.5 }}>
                    <span className={`bge ${a.sumber === "klinik" ? "b" : ""}`}>{LABEL_SUMBER[a.sumber] ?? a.sumber}</span>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{cakupan(a)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>
                    {Number(a.min_omzet) > 0 ? rp(Number(a.min_omzet)) : "—"}
                  </td>
                  <td><span className={`bge ${a.is_active ? "g" : "x"}`}>{a.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td style={{ display: "flex", gap: 6 }}>
                      <form action={toggleAturanKomisi}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="aktif" value={a.is_active ? "1" : "0"} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          {a.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </SubmitButton>
                      </form>
                      <form action={hapusAturanKomisi}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                          Hapus
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {aturan.length === 0 && (
                <tr><td colSpan={bolehKelola ? 7 : 6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada aturan komisi tambahan. Insentif dari checkout DEMO tetap dihitung.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="02" title="HITUNGAN PER KARYAWAN"
          desc="Angka hidup dari struk kasir, retur, tagihan klinik yang lunas, dan faktur penjualan reseller bulan itu. Masuk slip gaji saat penggajian dihitung."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="fi" type="month" name="periode" defaultValue={periode} style={{ fontSize: 11, height: 30, width: 150 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 10 }}>
          Periode <b>{periode}</b> · omzet sumber (sekali per baris) <b>{rp(totalOmzet)}</b> · total komisi{" "}
          <b style={{ color: "#15803d" }}>{rp(totalKomisi)}</b>
        </div>

        {(hitungan.peringatanAturan ?? []).length > 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
            <i className="ti ti-alert-triangle" /> Aturan yang saat ini tidak membayar apa pun:
            <ul style={{ margin: "4px 0 0 18px" }}>{hitungan.peringatanAturan.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        {hitungan.omzetTanpaPenjual !== 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
            <i className="ti ti-alert-triangle" /> {rp(hitungan.omzetTanpaPenjual)} penjualan tidak punya penerima komisi —
            kasirnya belum terhubung ke data karyawan, pelaksana jasa belum memiliki kebijakan yang cocok,
            kunjungan kliniknya belum dipilih dokternya, atau pembuat faktur resellernya bukan karyawan terdaftar.
          </div>
        )}
        {adaAturanLaba && tanpaHpp > 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
            <i className="ti ti-alert-triangle" /> {tanpaHpp} baris penjualan tanpa data modal — dilewati oleh aturan
            yang dihitung dari laba (biasanya jasa atau transaksi lama).
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Karyawan</th>
                <th style={{ width: 150, textAlign: "right" }}>Dasar omzet atribusi</th>
                <th style={{ width: 150, textAlign: "right" }}>Laba kotor</th>
                <th style={{ width: 150, textAlign: "right" }}>Komisi</th>
              </tr>
            </thead>
            <tbody>
              {hasil.map((h) => (
                <tr key={h.employeeId}>
                  <td style={{ fontSize: 11.5 }}>
                    <b>{namaEmp.get(h.employeeId) ?? "—"}</b>
                    {groupEmp.get(h.employeeId) && <span style={{ marginLeft: 6, color: "var(--tm)" }}>({groupEmp.get(h.employeeId)})</span>}
                    {h.rincian.length > 0 && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ fontSize: 10, color: "var(--tm)", cursor: "pointer" }}>
                          rincian {h.rincian.length} aturan
                        </summary>
                        <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 4, lineHeight: 1.7 }}>
                          {h.rincian.map((r) => {
                            const detail = rincianKomisiText(r, aturanById.get(r.aturanId));
                            return <div key={r.aturanId}>
                              {r.nama}: {detail.basis}{detail.tarif ? ` × ${detail.tarif}` : ""} → <b>{rp(r.komisi)}</b>
                              {!r.cair && <span style={{ color: "#b45309" }}> (ambang belum tembus)</span>}
                            </div>;
                          })}
                        </div>
                      </details>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.omzet)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.laba)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: "#15803d" }}>{rp(h.komisi)}</td>
                </tr>
              ))}
              {hasil.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada penjualan yang bisa dinisbahkan ke karyawan di periode ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <ServiceAttributionTable rows={hitungan.baris ?? []} />
      <div className="crm-sec">
        <SecHeader num="03" title="DASAR VISIT RAWAT INAP"
          desc="Visit dokter yang tercatat di catatan rawat inap. Maksimal satu visit terhitung per dokter, per rawat inap, per tanggal (WIB). Dasarnya visit dikerjakan, bukan ditagih." />
        {barisVisit.length === 0 && visitDobel.length === 0 ? <p style={{ fontSize: 11 }}>Tidak ada visit dokter rawat inap tercatat di periode ini.</p> :
          <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 560 }}>
            <thead><tr><th>Tanggal</th><th>Dokter</th><th>Rawat inap</th><th>Status</th></tr></thead>
            <tbody>
              {barisVisit.map(row => <tr key={row.sourceLineId}>
                <td>{row.visitTanggal}</td><td>{row.employeeId ? namaEmp.get(row.employeeId) ?? "Dokter nonaktif" : "—"}</td>
                <td>{row.sourceDocumentHref ? <Link href={row.sourceDocumentHref}>Buka catatan</Link> : "—"}</td><td>Dihitung</td></tr>)}
              {visitDobel.map(row => <tr key={row.id}>
                <td>{row.tanggal}</td><td>{row.doctorId ? namaEmp.get(row.doctorId) ?? "Dokter nonaktif" : "—"}</td>
                <td><Link href={`/klinik/rawat-inap/${row.inpatientRecordId}`}>Buka catatan</Link></td><td>Tidak dihitung — visit kedua di tanggal yang sama</td></tr>)}
            </tbody></table></div>}
      </div>
      <div className="crm-sec">
        <SecHeader num="04" title="PENJUALAN PAKET"
          desc="Baris komponen yang berasal dari paket dihitung sebagai paket: qty = jumlah paket, omzet = jumlah baris komponennya. Komponen paket tidak ikut komisi SKU biasa." />
        {barisPaket.length === 0 ? <p style={{ fontSize: 11 }}>Tidak ada penjualan paket klinik di periode ini.</p> :
          <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 560 }}>
            <thead><tr><th>Tanggal</th><th>Dokumen</th><th>Paket</th><th style={{ textAlign: "right" }}>Qty paket</th><th style={{ textAlign: "right" }}>Omzet</th><th>Penjual</th></tr></thead>
            <tbody>{barisPaket.map((row, index) => <tr key={`${row.sourceDocumentId}-${row.itemId}-${index}`}>
              <td>{row.tanggal}</td><td>{row.sourceDocumentHref ? <Link href={row.sourceDocumentHref}>{row.sourceDocumentNumber ?? "Buka"}</Link> : row.sourceDocumentNumber ?? "—"}</td>
              <td>{row.itemId ? namaItem.get(row.itemId) ?? "Paket" : "Paket"} · {row.paketKomponen} komponen</td>
              <td style={{ textAlign: "right" }}>{row.qty}</td><td style={{ textAlign: "right" }}>{rp(row.omzet)}</td>
              <td>{row.employeeId ? namaEmp.get(row.employeeId) ?? "—" : "Belum ada penerima"}</td></tr>)}</tbody></table></div>}
      </div>
    </MasterPage>
  );
}
