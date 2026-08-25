import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { kumpulkanBarisKomisi } from "@/lib/komisi-data";
import { realisasiTarget, type TargetPenjualan } from "@/lib/komisi";
import { hapusTarget, simpanTarget } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const periodeSekarang = () => new Date().toISOString().slice(0, 7);

type TargetRow = {
  id: string; periode: string; employee_id: string | null; branch_id: string | null;
  category_id: string | null; basis: string; target: number;
};

export default async function TargetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; periode?: string }>;
}) {
  const sp = await searchParams;
  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : periodeSekarang();

  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data: targetData }, { data: empData }, { data: cabData }, { data: katData }, { baris }] =
    await Promise.all([
      supabase.from("sales_targets")
        .select("id, periode, employee_id, branch_id, category_id, basis, target")
        .eq("periode", periode),
      supabase.from("employees").select("id, nama").eq("status", "Aktif").order("nama"),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("item_categories").select("id, name, parent_id").order("name"),
      kumpulkanBarisKomisi(supabase, periode),
    ]);

  const targets = (targetData ?? []) as TargetRow[];
  const karyawan = (empData ?? []) as { id: string; nama: string }[];
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  const kategori = (katData ?? []) as { id: string; name: string; parent_id: string | null }[];

  const namaEmp = new Map(karyawan.map((k) => [k.id, k.nama]));
  const namaCab = new Map(cabang.map((c) => [c.id, c.name]));
  const namaKat = new Map(kategori.map((k) => [k.id, k.name]));

  const cakupan = (t: TargetRow): string => {
    const bagian = [
      t.employee_id ? namaEmp.get(t.employee_id) ?? "karyawan" : null,
      t.branch_id ? namaCab.get(t.branch_id) ?? "cabang" : null,
      t.category_id ? `kategori ${namaKat.get(t.category_id) ?? "?"}` : null,
    ].filter(Boolean);
    return bagian.length ? bagian.join(" · ") : "Seluruh perusahaan";
  };

  const rows = targets
    .map((t) => {
      const spek: TargetPenjualan = {
        id: t.id,
        employeeId: t.employee_id,
        branchId: t.branch_id,
        categoryId: t.category_id,
        basis: t.basis === "laba" ? "laba" : "omzet",
        target: Number(t.target),
      };
      return { t, ...realisasiTarget(baris, spek) };
    })
    .sort((a, b) => b.persen - a.persen);

  const warna = (persen: number) => (persen >= 100 ? "#15803d" : persen >= 75 ? "#b45309" : "#b91c1c");

  return (
    <MasterPage
      back="/penjualan" icon="ti-target" title="TARGET PENJUALAN"
      desc="Target per bulan untuk perusahaan, cabang, karyawan, atau kategori barang"
      error={sp.error} success={sp.success} successMsg="Target tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah target penjualan."
      aksi={bolehKelola ? (
        <Link href="/pengaturan/impor/target" className="btn-def" style={{ fontSize: 11, textDecoration: "none" }}>
          <i className="ti ti-file-spreadsheet" /> Impor dari Excel
        </Link>
      ) : null}
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="01" title={`TARGET & REALISASI ${periode}`}
          desc="Realisasi dihitung dari penjualan dikurangi retur bulan itu."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="fi" type="month" name="periode" defaultValue={periode} style={{ fontSize: 11, height: 30, width: 150 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        {bolehKelola && (
          <form action={simpanTarget} style={{ marginBottom: 12 }}>
            <input type="hidden" name="periode" value={periode} />
            <div className="frow">
              <div>
                <label className="flab">Karyawan</label>
                <select className="fi" name="employee_id" defaultValue="">
                  <option value="">— semua karyawan —</option>
                  {karyawan.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Cabang</label>
                <select className="fi" name="branch_id" defaultValue="">
                  <option value="">— semua cabang —</option>
                  {cabang.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Kategori barang</label>
                <select className="fi" name="category_id" defaultValue="">
                  <option value="">— semua kategori —</option>
                  {kategori.map((k) => (
                    <option key={k.id} value={k.id}>{k.parent_id ? `— ${k.name}` : k.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flab">Diukur dari *</label>
                <select className="fi" name="basis" defaultValue="omzet" required>
                  <option value="omzet">Omzet</option>
                  <option value="laba">Laba kotor</option>
                </select>
              </div>
              <div>
                <label className="flab">Nilai target (Rp) *</label>
                <input className="fi" name="target" type="number" min={1} step="any" required />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                  Simpan target
                </SubmitButton>
              </div>
            </div>
          </form>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Target untuk</th>
                <th style={{ width: 100 }}>Diukur</th>
                <th style={{ width: 150, textAlign: "right" }}>Target</th>
                <th style={{ width: 150, textAlign: "right" }}>Realisasi</th>
                <th style={{ width: 110, textAlign: "right" }}>Capai</th>
                {bolehKelola && <th style={{ width: 80 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, realisasi, persen }) => (
                <tr key={t.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{cakupan(t)}</td>
                  <td style={{ fontSize: 10.5 }}>
                    <span className="bge">{t.basis === "laba" ? "Laba" : "Omzet"}</span>
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(t.target))}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(realisasi)}</td>
                  <td style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: warna(persen) }}>{persen}%</td>
                  {bolehKelola && (
                    <td>
                      <form action={hapusTarget}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="periode" value={periode} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                          Hapus
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={bolehKelola ? 6 : 5} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada target untuk periode ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
