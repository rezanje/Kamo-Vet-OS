import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { akunBeban } from "@/lib/anggaran-data";
import { hapusAnggaran, salinAnggaranBulanLalu, simpanAnggaran } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const periodeSekarang = () => new Date().toISOString().slice(0, 7);

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Anggaran = {
  id: string; coa_code: string; jumlah: number; catatan: string | null;
  branches: Rel<{ name: string }>;
};

export default async function AnggaranPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; periode?: string }>;
}) {
  const sp = await searchParams;
  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : periodeSekarang();

  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: budgetData }, { data: cabData }, akun] = await Promise.all([
    supabase.from("budgets").select("id, coa_code, jumlah, catatan, branches(name)").eq("periode", periode).order("coa_code"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    akunBeban(supabase),
  ]);

  const anggaran = (budgetData ?? []) as unknown as Anggaran[];
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  const namaAkun = new Map(akun.map((a) => [a.code, a.name]));
  const total = anggaran.reduce((a, b) => a + Number(b.jumlah), 0);

  return (
    <MasterPage
      back="/buku-besar" icon="ti-chart-arrows-vertical" title="ANGGARAN"
      desc="Batas belanja per pos biaya, ditetapkan sebelum uangnya keluar"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa menetapkan anggaran."
    >
      <div className="crm-sec">
        <SecHeader
          num="01" title={`TETAPKAN ANGGARAN ${periode}`}
          desc="Kosongkan cabang kalau anggarannya berlaku untuk seluruh perusahaan."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="fi" type="month" name="periode" defaultValue={periode} style={{ fontSize: 11, height: 30, width: 150 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        {boleh && (
          <>
            <form action={simpanAnggaran}>
              <input type="hidden" name="periode" value={periode} />
              <div className="frow">
                <div>
                  <label className="flab">Pos biaya *</label>
                  <select className="fi" name="coa_code" defaultValue="" required>
                    <option value="">— pilih akun beban —</option>
                    {akun.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="flab">Cabang</label>
                  <select className="fi" name="branch_id" defaultValue="">
                    <option value="">— seluruh perusahaan —</option>
                    {cabang.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="flab">Anggaran (Rp) *</label>
                  <input className="fi" name="jumlah" type="number" min={0} step="any" required />
                </div>
                <div>
                  <label className="flab">Catatan</label>
                  <input className="fi" name="catatan" placeholder="opsional" />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
                    Simpan
                  </SubmitButton>
                </div>
              </div>
            </form>

            <form action={salinAnggaranBulanLalu} style={{ marginTop: 10 }}>
              <input type="hidden" name="periode" value={periode} />
              <SubmitButton className="btn-def" icon="ti-copy" style={{ fontSize: 10.5 }} pendingText="Menyalin…">
                Salin anggaran bulan lalu
              </SubmitButton>
            </form>
          </>
        )}
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="02" title="DAFTAR ANGGARAN" desc={`Total anggaran periode ini ${rp(total)}.`} />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Kode</th>
                <th>Pos biaya</th>
                <th style={{ width: 180 }}>Cabang</th>
                <th style={{ width: 150, textAlign: "right" }}>Anggaran</th>
                <th style={{ width: 180 }}>Catatan</th>
                {boleh && <th style={{ width: 80 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {anggaran.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{b.coa_code}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{namaAkun.get(b.coa_code) ?? "—"}</td>
                  <td style={{ fontSize: 11 }}>{one(b.branches)?.name ?? "Seluruh perusahaan"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(b.jumlah))}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{b.catatan ?? "—"}</td>
                  {boleh && (
                    <td>
                      <form action={hapusAnggaran}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="periode" value={periode} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                          Hapus
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {anggaran.length === 0 && (
                <tr><td colSpan={boleh ? 6 : 5} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada anggaran untuk periode ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
