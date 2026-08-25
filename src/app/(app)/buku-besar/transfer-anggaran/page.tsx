import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { akunBeban, serapanPeriode } from "@/lib/anggaran-data";
import { batalGeserAnggaran, geserAnggaran } from "../anggaran/actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(s).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });
const periodeSekarang = () => new Date().toISOString().slice(0, 7);

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Transfer = {
  id: string; dari_coa: string; ke_coa: string; jumlah: number;
  alasan: string | null; created_at: string;
  branches: Rel<{ name: string }>;
};

export default async function TransferAnggaranPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; periode?: string }>;
}) {
  const sp = await searchParams;
  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : periodeSekarang();

  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: trfData }, { data: cabData }, akun, serapan] = await Promise.all([
    supabase.from("budget_transfers")
      .select("id, dari_coa, ke_coa, jumlah, alasan, created_at, branches(name)")
      .eq("periode", periode).order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    akunBeban(supabase),
    serapanPeriode(supabase, periode, null),
  ]);

  const transfer = (trfData ?? []) as unknown as Transfer[];
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  const namaAkun = new Map(akun.map((a) => [a.code, a.name]));

  // Pos yang masih punya sisa — cuma itu yang bisa menyumbang jatah.
  const bisaMenyumbang = serapan.ringkasan.filter((r) => r.anggaran - r.realisasi > 0);

  return (
    <MasterPage
      back="/buku-besar" icon="ti-arrows-transfer-down" title="TRANSFER ANGGARAN"
      desc="Geser jatah antar pos biaya tanpa mengubah total anggaran"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa menggeser anggaran."
    >
      <div className="crm-sec">
        <SecHeader
          num="01" title={`GESER ANGGARAN ${periode}`}
          desc="Yang bisa digeser hanya sisa yang belum terpakai di pos asalnya."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="fi" type="month" name="periode" defaultValue={periode} style={{ fontSize: 11, height: 30, width: 150 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        {boleh && (
          <form action={geserAnggaran}>
            <input type="hidden" name="periode" value={periode} />
            <div className="frow">
              <div>
                <label className="flab">Dari pos *</label>
                <select className="fi" name="dari_coa" defaultValue="" required>
                  <option value="">— pilih pos asal —</option>
                  {bisaMenyumbang.map((r) => (
                    <option key={r.coaCode} value={r.coaCode}>
                      {namaAkun.get(r.coaCode) ?? r.coaCode} · sisa {rp(r.anggaran - r.realisasi)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flab">Ke pos *</label>
                <select className="fi" name="ke_coa" defaultValue="" required>
                  <option value="">— pilih pos tujuan —</option>
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
                <label className="flab">Nominal (Rp) *</label>
                <input className="fi" name="jumlah" type="number" min={1} step="any" required />
              </div>
              <div>
                <label className="flab">Alasan</label>
                <input className="fi" name="alasan" placeholder="mis. listrik naik, transport turun" />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <SubmitButton className="btn-acc" icon="ti-arrows-transfer-down" pendingText="Menggeser…" style={{ background: "#2563eb" }}>
                  Geser
                </SubmitButton>
              </div>
            </div>

            {bisaMenyumbang.length === 0 && (
              <div style={{ fontSize: 10.5, color: "var(--td)", marginTop: 8 }}>
                Belum ada pos dengan sisa anggaran. Tetapkan anggarannya dulu di menu Anggaran.
              </div>
            )}
          </form>
        )}
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="02" title="RIWAYAT PERGESERAN" desc="Tidak menyentuh jurnal — ini rencana, bukan transaksi." />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Dari</th>
                <th>Ke</th>
                <th style={{ width: 160 }}>Cabang</th>
                <th style={{ width: 140, textAlign: "right" }}>Nominal</th>
                <th style={{ width: 180 }}>Alasan</th>
                {boleh && <th style={{ width: 80 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {transfer.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontSize: 11 }}>{tgl(t.created_at)}</td>
                  <td style={{ fontSize: 11.5 }}>{namaAkun.get(t.dari_coa) ?? t.dari_coa}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{namaAkun.get(t.ke_coa) ?? t.ke_coa}</td>
                  <td style={{ fontSize: 11 }}>{one(t.branches)?.name ?? "Seluruh perusahaan"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(t.jumlah))}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{t.alasan ?? "—"}</td>
                  {boleh && (
                    <td>
                      <form action={batalGeserAnggaran}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="periode" value={periode} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                          Batal
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {transfer.length === 0 && (
                <tr><td colSpan={boleh ? 7 : 6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada pergeseran anggaran di periode ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
