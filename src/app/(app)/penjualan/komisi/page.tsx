import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { komisiPeriode } from "@/lib/komisi-data";
import { hapusAturanKomisi, simpanAturanKomisi, toggleAturanKomisi } from "./actions";

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

  const [{ data: aturanData }, { data: empData }, { data: cabData }, { data: katData }, { data: itemData }, hitungan] =
    await Promise.all([
      supabase.from("commission_rules")
        .select("id, nama, tipe, basis, sumber, persen, nominal, employee_id, branch_id, category_id, item_id, min_omzet, berlaku_dari, berlaku_sampai, is_active")
        .order("nama"),
      supabase.from("employees").select("id, nama, jabatan").eq("status", "Aktif").order("nama"),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("item_categories").select("id, name, parent_id").order("name"),
      supabase.from("items").select("id, name").eq("is_active", true).order("name"),
      komisiPeriode(supabase, periode),
    ]);

  const aturan = (aturanData ?? []) as Aturan[];
  const karyawan = (empData ?? []) as { id: string; nama: string; jabatan: string | null }[];
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  const kategori = (katData ?? []) as { id: string; name: string; parent_id: string | null }[];
  const barang = (itemData ?? []) as { id: string; name: string }[];

  const namaEmp = new Map(karyawan.map((k) => [k.id, k.nama]));
  const namaCab = new Map(cabang.map((c) => [c.id, c.name]));
  const namaKat = new Map(kategori.map((k) => [k.id, k.name]));
  const namaItem = new Map(barang.map((i) => [i.id, i.name]));

  const cakupan = (a: Aturan): string => {
    const bagian = [
      a.employee_id ? namaEmp.get(a.employee_id) ?? "karyawan" : null,
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
                <input className="fi" name="persen" type="number" min={0} max={100} step="any" placeholder="isi kalau jenisnya persen" />
              </div>
              <div>
                <label className="flab">Nominal per unit (Rp)</label>
                <input className="fi" name="nominal" type="number" min={0} step="any" placeholder="isi kalau jenisnya nominal" />
              </div>
              <div>
                <label className="flab">Cair kalau tembus (Rp)</label>
                <input className="fi" name="min_omzet" type="number" min={0} step="any" defaultValue={0} />
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
                <select className="fi" name="item_id" defaultValue="">
                  <option value="">— semua produk —</option>
                  {barang.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
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
                  Belum ada aturan komisi — komisi semua karyawan masih nol.
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
                    {h.rincian.length > 0 && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ fontSize: 10, color: "var(--tm)", cursor: "pointer" }}>
                          rincian {h.rincian.length} aturan
                        </summary>
                        <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 4, lineHeight: 1.7 }}>
                          {h.rincian.map((r) => (
                            <div key={r.aturanId}>
                              {r.nama}: dasar {rp(r.dasar)} → <b>{rp(r.komisi)}</b>
                              {!r.cair && <span style={{ color: "#b45309" }}> (ambang belum tembus)</span>}
                            </div>
                          ))}
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
    </MasterPage>
  );
}
