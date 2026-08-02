import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR, kodeBawaan } from "@/lib/kas-akun";
import { hapusPeta, simpanPetaCabang, simpanPetaPusat } from "./actions";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Aturan = {
  id: string; metode: string; branch_id: string | null;
  cash_account_id: string;
  cash_accounts: Rel<{ nama: string; coa_code: string }>;
  branches: Rel<{ name: string }>;
};

export default async function PetaRekeningPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehTransaksiKas();

  const [{ data: rekData }, { data: branchData }, { data: petaData }] = await Promise.all([
    supabase.from("cash_accounts").select("id, nama, jenis, coa_code").eq("is_active", true).order("jenis").order("nama"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("payment_account_map")
      .select("id, metode, branch_id, cash_account_id, cash_accounts(nama, coa_code), branches(name)")
      .order("metode"),
  ]);

  const rekening = (rekData ?? []) as { id: string; nama: string; jenis: string; coa_code: string }[];
  const branches = (branchData ?? []) as { id: string; name: string }[];
  const peta = (petaData ?? []) as unknown as Aturan[];
  const pusat = new Map(peta.filter((p) => !p.branch_id).map((p) => [p.metode, p]));
  const perCabang = peta.filter((p) => p.branch_id);

  const namaRekBawaan = (metode: string) => {
    const kode = kodeBawaan(metode);
    return rekening.find((r) => r.coa_code === kode)?.nama ?? `akun ${kode}`;
  };

  return (
    <MasterPage
      back="/kas-bank" icon="ti-arrows-split" title="PETA REKENING PEMBAYARAN"
      desc="Uang dari tiap metode bayar masuk ke rekening mana"
      error={error} success={success} successMsg="Peta rekening tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mengubah peta rekening."
    >
      <div className="crm-sec">
        <SecHeader
          num="01" title="ATURAN PUSAT"
          desc="Berlaku untuk semua cabang yang tidak punya aturan sendiri. Dikosongkan = ikut bawaan."
        />
        <form action={simpanPetaPusat}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Metode bayar</th>
                  <th>Masuk ke rekening</th>
                  <th style={{ width: 220 }}>Kalau dikosongkan</th>
                </tr>
              </thead>
              <tbody>
                {METODE_BAYAR.map((m) => (
                  <tr key={m}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{m}</td>
                    <td>
                      <select
                        className="fi" name={`rek_${m}`}
                        defaultValue={pusat.get(m)?.cash_account_id ?? ""}
                        disabled={!bolehKelola}
                      >
                        <option value="">— ikut bawaan —</option>
                        {rekening.map((r) => (
                          <option key={r.id} value={r.id}>{r.nama} · {r.coa_code}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--td)" }}>{namaRekBawaan(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bolehKelola && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                Simpan aturan pusat
              </SubmitButton>
            </div>
          )}
        </form>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="02" title="ATURAN KHUSUS CABANG"
          desc="Dipakai kalau satu cabang punya mesin EDC / QRIS yang setor ke rekening berbeda."
        />

        {bolehKelola && (
          <form action={simpanPetaCabang} style={{ marginBottom: 12 }}>
            <div className="frow">
              <div>
                <label className="flab">Cabang *</label>
                <select className="fi" name="branch_id" defaultValue="" required>
                  <option value="">— pilih cabang —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Metode bayar *</label>
                <select className="fi" name="metode" defaultValue="QRIS" required>
                  {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Rekening *</label>
                <select className="fi" name="cash_account_id" defaultValue="" required>
                  <option value="">— pilih rekening —</option>
                  {rekening.map((r) => <option key={r.id} value={r.id}>{r.nama} · {r.coa_code}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                Simpan aturan cabang
              </SubmitButton>
            </div>
          </form>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Cabang</th><th style={{ width: 130 }}>Metode</th><th>Rekening</th>
                {bolehKelola && <th style={{ width: 90 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {perCabang.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11.5 }}>{one(p.branches)?.name ?? "—"}</td>
                  <td style={{ fontSize: 11 }}>{p.metode}</td>
                  <td style={{ fontSize: 11 }}>
                    {one(p.cash_accounts)?.nama ?? "—"} · {one(p.cash_accounts)?.coa_code ?? ""}
                  </td>
                  {bolehKelola && (
                    <td>
                      <form action={hapusPeta}>
                        <input type="hidden" name="id" value={p.id} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          Hapus
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {perCabang.length === 0 && (
                <tr><td colSpan={bolehKelola ? 4 : 3} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada aturan khusus cabang — semua ikut aturan pusat.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 10 }}>
        Peta ini dipakai otomatis oleh kasir petshop, pembayaran klinik, penjualan online, dan
        pengeluaran shift — kasir tidak perlu memilih rekening. Layar keuangan tetap boleh
        memilih rekening lain saat mencatat.
      </div>
    </MasterPage>
  );
}
