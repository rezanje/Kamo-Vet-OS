import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { depreciationPerMonth } from "@/lib/aging";
import { akumulasiFiskal, nilaiBuku, penyusutanFiskalTahunKe, tahunBerjalan, type GolonganPajak } from "@/lib/aset";
import { disposisiAset, pindahAset, setGolonganPajak, tambahNilaiAset, ubahUmurAset } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export default async function DetailAsetPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: aset }, { data: depData }, { data: golData }, { data: cabData }, { data: ubahData }, { data: pindahData }, { data: lepasData }, rekening] =
    await Promise.all([
      supabase.from("fixed_assets")
        .select("id, nama, kategori, tanggal_perolehan, harga_perolehan, nilai_sisa, umur_bulan, branch_id, status, tax_category_id, asset_categories(nama), branches(name), tax_asset_categories(nama, umur_bulan, metode, tarif_persen)")
        .eq("id", id).maybeSingle(),
      supabase.from("asset_depreciations").select("periode, amount").eq("asset_id", id).order("periode"),
      supabase.from("tax_asset_categories").select("id, nama").eq("is_active", true).order("umur_bulan"),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("asset_changes").select("id, tanggal, jenis, nilai_lama, nilai_baru, umur_lama, umur_baru, keterangan").eq("asset_id", id).order("tanggal", { ascending: false }),
      supabase.from("asset_transfers").select("id, tanggal, keterangan, dari:dari_branch_id(name), ke:ke_branch_id(name)").eq("asset_id", id).order("tanggal", { ascending: false }),
      supabase.from("asset_disposals").select("tanggal, jenis, harga_jual, harga_perolehan, akumulasi, nilai_buku, laba_rugi, keterangan").eq("asset_id", id).maybeSingle(),
      loadRekeningAktif(supabase),
    ]);

  if (!aset) notFound();

  const dep = (depData ?? []) as { periode: string; amount: number }[];
  const akumulasi = dep.reduce((a, d) => a + Number(d.amount), 0);
  const harga = Number(aset.harga_perolehan);
  const buku = nilaiBuku(harga, akumulasi);
  const perBulan = depreciationPerMonth(harga, Number(aset.nilai_sisa), aset.umur_bulan);
  const dilepas = aset.status === "dilepas";

  const golongan = (golData ?? []) as { id: string; nama: string }[];
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  const perubahan = (ubahData ?? []) as { id: string; tanggal: string; jenis: string; nilai_lama: number | null; nilai_baru: number | null; umur_lama: number | null; umur_baru: number | null; keterangan: string | null }[];
  const pindahan = (pindahData ?? []) as unknown as { id: string; tanggal: string; keterangan: string | null; dari: Rel<{ name: string }>; ke: Rel<{ name: string }> }[];

  const pajakRel = one(aset.tax_asset_categories as Rel<{ nama: string; umur_bulan: number; metode: string; tarif_persen: number }>);
  const fiskal: GolonganPajak | null = pajakRel
    ? { umurBulan: pajakRel.umur_bulan, metode: pajakRel.metode as GolonganPajak["metode"], tarifPersen: Number(pajakRel.tarif_persen) }
    : null;
  const tahunIni = tahunBerjalan(aset.tanggal_perolehan, new Date().toISOString().slice(0, 10));
  const tahunFiskal = fiskal ? Math.ceil(fiskal.umurBulan / 12) : 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan/aset" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{aset.nama}</span>
        {dilepas && <span className="bge x">Sudah dilepas</span>}
      </div>

      {sp.error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {sp.error}
        </div>
      )}
      {sp.success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {sp.success}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="RINGKASAN" desc="Nilai buku = harga perolehan dikurangi akumulasi penyusutan." />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 18px", fontSize: 11 }}>
          <KV k="Kategori" v={one(aset.asset_categories as Rel<{ nama: string }>)?.nama ?? aset.kategori} />
          <KV k="Cabang" v={one(aset.branches as Rel<{ name: string }>)?.name ?? "—"} />
          <KV k="Tanggal perolehan" v={tgl(aset.tanggal_perolehan)} />
          <KV k="Harga perolehan" v={rp(harga)} />
          <KV k="Umur ekonomis" v={`${aset.umur_bulan} bulan`} />
          <KV k="Penyusutan / bulan" v={rp(perBulan)} />
          <KV k="Akumulasi penyusutan" v={`${rp(akumulasi)} (${dep.length} bulan)`} />
          <KV k="Nilai buku" v={rp(buku)} />
          <KV k="Golongan pajak" v={pajakRel?.nama ?? "belum ditetapkan"} />
          <KV k="Nilai sisa" v={rp(Number(aset.nilai_sisa))} />
        </div>
      </div>

      {lepasData && (
        <div className="crm-sec">
          <SecHeader num="02" title="PELEPASAN ASET" desc="Aset ini sudah keluar dari daftar aktif." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 18px", fontSize: 11 }}>
            <KV k="Tanggal" v={tgl(lepasData.tanggal)} />
            <KV k="Jenis" v={lepasData.jenis === "jual" ? "Dijual" : "Dihapus"} />
            <KV k="Harga jual" v={rp(Number(lepasData.harga_jual))} />
            <KV k="Nilai buku saat lepas" v={rp(Number(lepasData.nilai_buku))} />
            <KV k={Number(lepasData.laba_rugi) >= 0 ? "Laba pelepasan" : "Rugi pelepasan"}
              v={rp(Math.abs(Number(lepasData.laba_rugi)))} />
            <KV k="Keterangan" v={lepasData.keterangan ?? "—"} />
          </div>
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num={lepasData ? "03" : "02"} title="PENYUSUTAN FISKAL"
          desc="Versi SPT — masa manfaat & metodenya boleh beda dari penyusutan komersial di atas."
        />

        {boleh && !dilepas && (
          <form action={setGolonganPajak} style={{ marginBottom: 12 }}>
            <input type="hidden" name="id" value={id} />
            <div className="frow">
              <div>
                <label className="flab">Golongan pajak</label>
                <select className="fi" name="tax_category_id" defaultValue={aset.tax_category_id ?? ""}>
                  <option value="">— belum ditetapkan —</option>
                  {golongan.map((g) => <option key={g.id} value={g.id}>{g.nama}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <SubmitButton className="btn-def" pendingText="Menyimpan…">Simpan golongan</SubmitButton>
              </div>
            </div>
          </form>
        )}

        {fiskal ? (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Tahun ke</th>
                  <th style={{ textAlign: "right" }}>Penyusutan fiskal</th>
                  <th style={{ textAlign: "right" }}>Akumulasi</th>
                  <th style={{ textAlign: "right" }}>Nilai buku fiskal</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: tahunFiskal }, (_, i) => i + 1).map((t) => {
                  const akum = akumulasiFiskal(harga, fiskal, t);
                  return (
                    <tr key={t} style={t === tahunIni ? { background: "#eff6ff" } : undefined}>
                      <td style={{ fontSize: 11.5, fontWeight: t === tahunIni ? 700 : 400 }}>
                        {t}{t === tahunIni ? " (berjalan)" : ""}
                      </td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{rp(penyusutanFiskalTahunKe(harga, fiskal, t))}</td>
                      <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(akum)}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{rp(harga - akum)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--td)" }}>
            Tetapkan golongan pajaknya dulu untuk melihat penyusutan versi fiskal.
          </div>
        )}
      </div>

      {boleh && !dilepas && (
        <div className="crm-sec">
          <SecHeader num={lepasData ? "04" : "03"} title="TINDAKAN" desc="Perubahan nilai & umur berlaku ke depan, tidak menghitung ulang penyusutan yang sudah jalan." />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <form action={tambahNilaiAset}>
              <input type="hidden" name="id" value={id} />
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Tambah nilai (perbaikan besar)</div>
              <div className="fg"><label className="flab">Nilai tambahan (Rp) *</label>
                <input className="fi" name="tambahan" type="number" min={1} step="any" required /></div>
              <div className="fg"><label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
              <div className="fg"><label className="flab">Dibayar dengan</label>
                <select className="fi" name="metode" defaultValue="Transfer">
                  {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
                </select></div>
              <PilihRekening rekening={rekening} label="Dari rekening" width={200} />
              <div className="fg"><label className="flab">Keterangan</label>
                <input className="fi" name="keterangan" placeholder="mis. ganti mesin" /></div>
              <SubmitButton className="btn-def" icon="ti-plus" pendingText="Menyimpan…">Tambah nilai</SubmitButton>
            </form>

            <form action={ubahUmurAset}>
              <input type="hidden" name="id" value={id} />
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Revisi umur ekonomis</div>
              <div className="fg"><label className="flab">Umur baru (bulan) *</label>
                <input className="fi" name="umur_bulan" type="number" min={1} defaultValue={aset.umur_bulan} required /></div>
              <div className="fg"><label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
              <div className="fg"><label className="flab">Alasan</label>
                <input className="fi" name="keterangan" placeholder="mis. dipakai lebih lama" /></div>
              <SubmitButton className="btn-def" icon="ti-edit" pendingText="Menyimpan…">Simpan umur</SubmitButton>
            </form>

            <form action={pindahAset}>
              <input type="hidden" name="id" value={id} />
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Pindah cabang</div>
              <div className="fg"><label className="flab">Cabang tujuan *</label>
                <select className="fi" name="ke_branch_id" defaultValue="" required>
                  <option value="">— pilih cabang —</option>
                  {cabang.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div className="fg"><label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
              <div className="fg"><label className="flab">Keterangan</label>
                <input className="fi" name="keterangan" placeholder="opsional" /></div>
              <SubmitButton className="btn-def" icon="ti-arrows-transfer-down" pendingText="Memindahkan…">Pindahkan</SubmitButton>
            </form>

            <form action={disposisiAset}>
              <input type="hidden" name="id" value={id} />
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8, color: "#b91c1c" }}>Lepas aset (jual / hapus)</div>
              <div className="fg"><label className="flab">Jenis *</label>
                <select className="fi" name="jenis" defaultValue="jual" required>
                  <option value="jual">Dijual</option>
                  <option value="hapus">Dihapus (tanpa hasil)</option>
                </select></div>
              <div className="fg"><label className="flab">Harga jual (Rp)</label>
                <input className="fi" name="harga_jual" type="number" min={0} step="any" placeholder={`nilai buku ${rp(buku)}`} /></div>
              <div className="fg"><label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
              <div className="fg"><label className="flab">Uang masuk ke</label>
                <select className="fi" name="metode" defaultValue="Transfer">
                  {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
                </select></div>
              <PilihRekening rekening={rekening} label="Rekening" width={200} />
              <div className="fg"><label className="flab">Keterangan</label>
                <input className="fi" name="keterangan" placeholder="opsional" /></div>
              <SubmitButton className="btn-def" icon="ti-trash" style={{ color: "#b91c1c" }} pendingText="Memproses…">
                Lepas aset
              </SubmitButton>
            </form>
          </div>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num={boleh && !dilepas ? (lepasData ? "05" : "04") : "04"} title="RIWAYAT" desc="Perubahan nilai, umur, dan perpindahan cabang." />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Tanggal</th>
                <th style={{ width: 130 }}>Jenis</th>
                <th>Perubahan</th>
                <th style={{ width: 200 }}>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {perubahan.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11 }}>{tgl(p.tanggal)}</td>
                  <td style={{ fontSize: 10.5 }}><span className="bge">{p.jenis === "nilai" ? "Nilai" : "Umur"}</span></td>
                  <td style={{ fontSize: 11 }}>
                    {p.jenis === "nilai"
                      ? `${rp(Number(p.nilai_lama))} → ${rp(Number(p.nilai_baru))}`
                      : `${p.umur_lama} → ${p.umur_baru} bulan`}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{p.keterangan ?? "—"}</td>
                </tr>
              ))}
              {pindahan.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11 }}>{tgl(p.tanggal)}</td>
                  <td style={{ fontSize: 10.5 }}><span className="bge b">Pindah</span></td>
                  <td style={{ fontSize: 11 }}>
                    {one(p.dari)?.name ?? "—"} → {one(p.ke)?.name ?? "—"}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{p.keterangan ?? "—"}</td>
                </tr>
              ))}
              {perubahan.length === 0 && pindahan.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada perubahan pada aset ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: "var(--tm)", minWidth: 150 }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}
