import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanKategoriAset, toggleKategoriAset } from "./actions";

type Kat = {
  id: string; nama: string; umur_bulan: number;
  akun_beban: string; akun_akumulasi: string; is_active: boolean;
};

export default async function KategoriAsetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: asetRows }, { data: akunRows }] = await Promise.all([
    supabase.from("asset_categories").select("id, nama, umur_bulan, akun_beban, akun_akumulasi, is_active").order("nama"),
    supabase.from("fixed_assets").select("category_id").not("category_id", "is", null),
    supabase.from("coa_accounts").select("code, name").order("code"),
  ]);

  const kategori = (data ?? []) as Kat[];
  const akun = (akunRows ?? []) as { code: string; name: string }[];
  const editing = edit ? kategori.find((k) => k.id === edit) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of asetRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/aset-tetap" icon="ti-category" title="KATEGORI ASET"
      desc="Umur penyusutan & akun jurnal otomatis per kategori"
      error={error} success={success} successMsg="Kategori tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah kategori aset."
    >
      {bolehKelola && (
        <form action={simpanKategoriAset} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="frow">
            <div>
              <label className="flab">{editing ? "Ubah nama kategori" : "Kategori baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={60} placeholder="mis. Peralatan Medis" required />
            </div>
            <div>
              <label className="flab">Umur penyusutan (bulan) *</label>
              <input className="fi" name="umur_bulan" type="number" min={1} step={1}
                defaultValue={editing?.umur_bulan ?? 48} required />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>48 bulan = 4 tahun.</div>
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">Akun beban penyusutan *</label>
              <select className="fi" name="akun_beban" defaultValue={editing?.akun_beban ?? "5601"} required>
                {akun.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Akun akumulasi penyusutan *</label>
              <select className="fi" name="akun_akumulasi" defaultValue={editing?.akun_akumulasi ?? "1509"} required>
                {akun.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            {editing && <Link href="/keuangan/kategori-aset" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan
            </SubmitButton>
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 660 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Kategori</th>
                <th style={{ width: 90 }}>Umur</th>
                <th style={{ width: 90 }}>Beban</th>
                <th style={{ width: 100 }}>Akumulasi</th>
                <th style={{ width: 90 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {kategori.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ fontSize: 11 }}>{k.umur_bulan} bln</td>
                  <td style={{ fontSize: 11 }}>{k.akun_beban}</td>
                  <td style={{ fontSize: 11 }}>{k.akun_akumulasi}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(k.id) ?? 0} aset</td>
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/keuangan/kategori-aset?edit=${k.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleKategoriAset}>
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {kategori.length === 0 && (
                <tr><td colSpan={bolehKelola ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada kategori.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
