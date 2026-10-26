import { NumberInput } from "@/components/NumberInput";
import Link from "next/link";
import { ServiceAttributionTable } from "@/components/ServiceAttributionTable";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { komisiPeriode } from "@/lib/komisi-data";
import { hapusAturanKomisi, simpanAturanKomisi, simpanKelompokKomisi, toggleAturanKomisi } from "./actions";
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
};

type Aturan = {
  id: string; nama: string; tipe: string; basis: string; sumber: string; persen: number; nominal: number;
  employee_id: string | null; branch_id: string | null; category_id: string | null; item_id: string | null;
  commission_group: string | null; override_group_rule_id: string | null;
  min_omzet: number; berlaku_dari: string | null; berlaku_sampai: string | null; is_active: boolean;
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
      komisiPeriode(supabase, periode),
    ]); } catch (loadError) { return <ListLoadFailure error={loadError} label="Referensi komisi" />; }
  const [aturan, karyawan, cabang, kategori, barang, hitungan] = loaded;

  const namaEmp = new Map(karyawan.map((k) => [k.id, k.nama]));
  const groupEmp = new Map(karyawan.map((k) => [k.id, k.commission_group]));
  const namaCab = new Map(cabang.map((c) => [c.id, c.name]));
  const namaKat = new Map(kategori.map((k) => [k.id, k.name]));
  const namaItem = new Map(barang.map((i) => [i.id, i.name]));
  const aturanById = new Map(aturan.map((a) => [a.id, a]));

  const cakupan = (a: Aturan): string => {
    const bagian = [
      a.employee_id ? namaEmp.get(a.employee_id) ?? "karyawan" : null,
      a.commission_group ? `kelompok ${a.commission_group}` : null,
      a.override_group_rule_id ? `mengganti ${aturan.find(rule => rule.id === a.override_group_rule_id)?.nama ?? "aturan kelompok"}` : null,
      a.branch_id ? namaCab.get(a.branch_id) ?? "cabang" : null,
      a.category_id ? `kategori ${namaKat.get(a.category_id) ?? "?"}` : null,
      a.item_id ? namaItem.get(a.item_id) ?? "produk" : null,
    ].filter(Boolean);
    return bagian.length ? bagian.join(" · ") : "Semua penjualan";
  };

  const hasil = [...hitungan.hasil].sort((a, b) => b.komisi - a.komisi);
  const totalKomisi = hasil.reduce((a, h) => a + h.komisi, 0);
  const totalOmzet = hasil.reduce((a, h) => a + h.omzet, 0);
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
        <SecHeader num="00" title="KELOMPOK INSENTIF" desc="Tetapkan kode grade/kelompok karyawan sesuai keputusan bisnis. Kode kosong berarti tanpa kelompok." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {karyawan.map(k => <form key={k.id} action={simpanKelompokKomisi} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="hidden" name="employee_id" value={k.id} />
            <label className="flab" htmlFor={`group-${k.id}`}>{k.nama}</label>
            {bolehKelola ? <><input id={`group-${k.id}`} className="fi" name="commission_group" maxLength={40} pattern="[a-z0-9][a-z0-9_-]{0,39}" defaultValue={k.commission_group ?? ""} placeholder="kode kelompok" style={{ width: 145 }} />
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
              <div><label className="flab">Khusus grade/kelompok</label><select className="fi" name="commission_group" defaultValue="">
                <option value="">— semua kelompok —</option>
                {[...new Set(karyawan.map(k => k.commission_group).filter((code): code is string => !!code))].sort().map(code => <option key={code} value={code}>{code}</option>)}
              </select><div style={{ fontSize: 10, color: "var(--tm)" }}>Pilih kelompok atau karyawan khusus.</div></div>
              <div><label className="flab">Pengecualian individu: ganti aturan kelompok</label><select className="fi" name="override_group_rule_id" defaultValue="">
                <option value="">— tidak mengganti —</option>
                {aturan.filter(a => a.commission_group).map(a => <option key={a.id} value={a.id}>{a.nama} ({a.commission_group})</option>)}
              </select><div style={{ fontSize: 10, color: "var(--tm)" }}>Perlu pilih satu karyawan; aturan kelompok diganti hanya pada baris yang cocok.</div></div>
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
                      : `${rp(Number(a.nominal))} / unit`}
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
          Periode <b>{periode}</b> · omzet terhitung <b>{rp(totalOmzet)}</b> · total komisi{" "}
          <b style={{ color: "#15803d" }}>{rp(totalKomisi)}</b>
        </div>

        {hitungan.omzetTanpaPenjual !== 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
            <i className="ti ti-alert-triangle" /> {rp(hitungan.omzetTanpaPenjual)} penjualan tidak punya penerima komisi —
            kasirnya belum terhubung ke data karyawan, kunjungan kliniknya belum dipilih dokternya, atau pembuat faktur
            resellernya bukan karyawan terdaftar.
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
                <th style={{ width: 150, textAlign: "right" }}>Omzet</th>
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
    </MasterPage>
  );
}
