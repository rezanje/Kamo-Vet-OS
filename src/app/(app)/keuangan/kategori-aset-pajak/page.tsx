import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { simpanGolonganPajak, toggleGolonganPajak } from "./actions";

type Golongan = {
  id: string; nama: string; umur_bulan: number; metode: string;
  tarif_persen: number; is_active: boolean;
};

export default async function KategoriAsetPajakPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data: golData }, { data: asetData }] = await Promise.all([
    supabase.from("tax_asset_categories").select("id, nama, umur_bulan, metode, tarif_persen, is_active").order("umur_bulan"),
    supabase.from("fixed_assets").select("tax_category_id"),
  ]);

  const golongan = (golData ?? []) as Golongan[];
  const jumlahAset = new Map<string, number>();
  for (const a of (asetData ?? []) as { tax_category_id: string | null }[]) {
    if (!a.tax_category_id) continue;
    jumlahAset.set(a.tax_category_id, (jumlahAset.get(a.tax_category_id) ?? 0) + 1);
  }
  const tanpaGolongan = ((asetData ?? []) as { tax_category_id: string | null }[]).filter((a) => !a.tax_category_id).length;

  return (
    <MasterPage
      back="/aset-tetap" icon="ti-receipt-tax" title="GOLONGAN PAJAK ASET"
      desc="Masa manfaat & metode penyusutan versi fiskal — dasar penyusutan di SPT"
      error={sp.error} success={sp.success} successMsg="Golongan pajak tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah golongan pajak."
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="01" title="DAFTAR GOLONGAN"
          desc="Terpisah dari kategori aset biasa: umur ekonomis perusahaan boleh beda dari masa manfaat fiskal."
        />

        {tanpaGolongan > 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
            <i className="ti ti-alert-triangle" /> {tanpaGolongan} aset belum punya golongan pajak — penyusutan
            fiskalnya belum bisa dihitung. Tetapkan dari halaman detail aset.
          </div>
        )}

        {bolehKelola && (
          <form action={simpanGolonganPajak} style={{ marginBottom: 12 }}>
            <div className="frow">
              <div>
                <label className="flab">Nama golongan *</label>
                <input className="fi" name="nama" maxLength={60} placeholder="mis. Golongan II (8 tahun)" required />
              </div>
              <div>
                <label className="flab">Masa manfaat (bulan) *</label>
                <input className="fi" name="umur_bulan" type="number" min={1} required />
              </div>
              <div>
                <label className="flab">Metode *</label>
                <select className="fi" name="metode" defaultValue="saldo_menurun" required>
                  <option value="saldo_menurun">Saldo menurun</option>
                  <option value="garis_lurus">Garis lurus</option>
                </select>
              </div>
              <div>
                <label className="flab">Tarif per tahun (%)</label>
                <input className="fi" name="tarif_persen" type="number" min={0} max={100} step="any"
                  placeholder="wajib untuk saldo menurun" />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
                  Simpan
                </SubmitButton>
              </div>
            </div>
          </form>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Golongan</th>
                <th style={{ width: 130 }}>Masa manfaat</th>
                <th style={{ width: 140 }}>Metode</th>
                <th style={{ width: 110, textAlign: "right" }}>Tarif/tahun</th>
                <th style={{ width: 90, textAlign: "right" }}>Aset</th>
                <th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 120 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {golongan.map((g) => (
                <tr key={g.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{g.nama}</td>
                  <td style={{ fontSize: 11 }}>{g.umur_bulan} bln ({Math.round(g.umur_bulan / 12)} th)</td>
                  <td style={{ fontSize: 10.5 }}>
                    <span className="bge">{g.metode === "saldo_menurun" ? "Saldo menurun" : "Garis lurus"}</span>
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>
                    {g.metode === "saldo_menurun" ? `${Number(g.tarif_persen)}%` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{jumlahAset.get(g.id) ?? 0}</td>
                  <td><span className={`bge ${g.is_active ? "g" : "x"}`}>{g.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <form action={toggleGolonganPajak}>
                        <input type="hidden" name="id" value={g.id} />
                        <input type="hidden" name="aktif" value={g.is_active ? "1" : "0"} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          {g.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {golongan.length === 0 && (
                <tr><td colSpan={bolehKelola ? 7 : 6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada golongan pajak.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
