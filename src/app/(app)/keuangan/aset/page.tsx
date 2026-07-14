import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { depreciationPerMonth } from "@/lib/aging";
import { tambahAset, jalankanPenyusutan } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function AsetPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string; n?: string }> }) {
  const { success, error, n } = await searchParams;
  const supabase = await createClient();

  const [{ data: assets }, { data: deps }, { data: branches }] = await Promise.all([
    supabase.from("fixed_assets").select("id, nama, kategori, tanggal_perolehan, harga_perolehan, nilai_sisa, umur_bulan, is_active").order("tanggal_perolehan"),
    supabase.from("asset_depreciations").select("asset_id, amount"),
    supabase.from("branches").select("id, name").order("name"),
  ]);

  const depSum = new Map<string, number>();
  for (const d of deps ?? []) depSum.set(d.asset_id, (depSum.get(d.asset_id) ?? 0) + Number(d.amount));

  const rows = (assets ?? []).map((a) => {
    const akum = depSum.get(a.id) ?? 0;
    return {
      ...a,
      perBulan: depreciationPerMonth(Number(a.harga_perolehan), Number(a.nilai_sisa), a.umur_bulan),
      akum,
      nilaiBuku: Number(a.harga_perolehan) - akum,
    };
  });

  const totalPerolehan = rows.reduce((a, r) => a + Number(r.harga_perolehan), 0);
  const totalAkum = rows.reduce((a, r) => a + r.akum, 0);
  const periodeNow = new Date().toISOString().slice(0, 7);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Aset Tetap</span>
      </div>

      {success === "aset" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Aset tersimpan{" "}— jurnal pembelian otomatis (kecuali saldo awal).
        </div>
      )}
      {success === "susut" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Penyusutan {n} aset dijurnal (Dr Beban Penyusutan / Cr Akumulasi Penyusutan).
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-triangle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR ASET TETAP" desc={`Total perolehan ${rp(totalPerolehan)} · akumulasi penyusutan ${rp(totalAkum)} · nilai buku ${rp(totalPerolehan - totalAkum)}.`}
          action={
            <form action={jalankanPenyusutan} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="fi" type="month" name="periode" defaultValue={periodeNow} style={{ width: 130 }} />
              <button type="submit" className="btn-def" style={{ padding: "6px 10px", fontSize: 10.5 }}>
                <i className="ti ti-calculator" /> Jalankan Penyusutan
              </button>
            </form>
          } />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr><th>Aset</th><th>Kategori</th><th>Perolehan</th><th style={{ textAlign: "right" }}>Harga</th><th style={{ textAlign: "right" }}>Susut/bln</th><th style={{ textAlign: "right" }}>Akumulasi</th><th style={{ textAlign: "right" }}>Nilai Buku</th><th>Umur</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 12 }}>{r.nama}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.kategori}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(r.tanggal_perolehan)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(r.harga_perolehan))}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.perBulan)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.akum)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(r.nilaiBuku)}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.umur_bulan} bln</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada aset tetap.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="TAMBAH ASET TETAP" desc="Aset baru dari kas/bank dijurnal otomatis; aset lama pilih 'Saldo awal'." />
        <form action={tambahAset}>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Nama aset</label>
              <input className="fi" name="nama" placeholder="mis. Mesin X-Ray" required />
            </div>
            <div>
              <label className="flab">Kategori</label>
              <select className="fi" name="kategori" defaultValue="Peralatan">
                <option>Peralatan</option><option>Inventaris Kantor</option><option>Kendaraan</option><option>Bangunan</option>
              </select>
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Tanggal perolehan</label>
              <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <label className="flab">Harga perolehan</label>
              <input className="fi" type="number" name="harga" min={1} step="any" required />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Nilai sisa</label>
              <input className="fi" type="number" name="nilai_sisa" min={0} step="any" defaultValue={0} />
            </div>
            <div>
              <label className="flab">Umur ekonomis (bulan)</label>
              <input className="fi" type="number" name="umur_bulan" min={1} placeholder="mis. 60 (5 tahun)" required />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 12 }}>
            <div>
              <label className="flab">Sumber dana</label>
              <select className="fi" name="sumber" defaultValue="saldo-awal">
                <option value="saldo-awal">Saldo awal (tanpa jurnal)</option>
                <option value="Tunai">Kas (jurnal otomatis)</option>
                <option value="Bank">Bank (jurnal otomatis)</option>
              </select>
            </div>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id" defaultValue="">
                <option value="">— Pusat / tanpa cabang —</option>
                {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="pay-btn"><i className="ti ti-plus" /> Simpan Aset</button>
        </form>
      </div>
    </>
  );
}
