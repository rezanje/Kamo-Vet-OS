import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { getAccountBalances } from "@/lib/ledger";
import { tambahRekening, toggleRekening } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Rekening = {
  id: string; nama: string; jenis: string; coa_code: string;
  bank_nama: string | null; no_rekening: string | null; is_active: boolean;
  branches: Rel<{ name: string }>;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function RekeningPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: branches }, saldoAkun] = await Promise.all([
    supabase
      .from("cash_accounts")
      .select("id, nama, jenis, coa_code, bank_nama, no_rekening, is_active, branches(name)")
      .order("jenis").order("nama"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getAccountBalances(supabase),
  ]);

  const rekening = (data ?? []) as unknown as Rekening[];
  const saldoPerKode = new Map(saldoAkun.map((a) => [a.code, a.saldo]));
  const total = rekening.reduce((a, r) => a + (saldoPerKode.get(r.coa_code) ?? 0), 0);

  return (
    <MasterPage
      back="/kas-bank" icon="ti-wallet" title="DAFTAR REKENING"
      desc="Kas & rekening bank — tiap rekening punya akun sendiri di pembukuan"
      error={error} success={success} successMsg="Rekening tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah daftar rekening."
    >
      {bolehKelola && (
        <form action={tambahRekening} className="crm-sec" style={{ marginBottom: 14 }}>
          <div className="frow">
            <div>
              <label className="flab">Nama rekening *</label>
              <input className="fi" name="nama" maxLength={80} placeholder="mis. BCA Operasional" required />
            </div>
            <div>
              <label className="flab">Jenis *</label>
              <select className="fi" name="jenis" defaultValue="Bank" required>
                <option value="Bank">Bank</option>
                <option value="Kas">Kas</option>
              </select>
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">Nama bank</label>
              <input className="fi" name="bank_nama" maxLength={60} placeholder="mis. BCA — kosongkan untuk kas" />
            </div>
            <div>
              <label className="flab">No. rekening</label>
              <input className="fi" name="no_rekening" maxLength={40} placeholder="mis. 1234567890" />
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id" defaultValue="">
                <option value="">— Pusat / semua cabang —</option>
                {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Saldo awal</label>
              <input className="fi" name="saldo_awal" type="number" min={0} step="any" defaultValue={0} />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Kalau diisi, dijurnal hari ini dengan lawan <b>Modal Pemilik</b>. Kosongkan kalau saldo
                akan masuk dari transaksi biasa.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan rekening
            </SubmitButton>
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Rekening</th>
                <th style={{ width: 70 }}>Jenis</th>
                <th style={{ width: 150 }}>Bank / No. rek</th>
                <th style={{ width: 70 }}>Akun</th>
                <th style={{ width: 130 }}>Cabang</th>
                <th style={{ width: 130, textAlign: "right" }}>Saldo</th>
                <th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 120 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rekening.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ fontSize: 10.5 }}>{r.jenis}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    {r.bank_nama ?? "—"}{r.no_rekening ? ` · ${r.no_rekening}` : ""}
                  </td>
                  <td style={{ fontSize: 10.5 }}>{r.coa_code}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{one(r.branches)?.name ?? "Pusat"}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600, textAlign: "right" }}>
                    {rp(saldoPerKode.get(r.coa_code) ?? 0)}
                  </td>
                  <td><span className={`bge ${r.is_active ? "g" : "x"}`}>{r.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <form action={toggleRekening}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="aktif" value={r.is_active ? "1" : "0"} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {rekening.length === 0 && (
                <tr><td colSpan={bolehKelola ? 9 : 8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada rekening.
                </td></tr>
              )}
            </tbody>
            {rekening.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={6} style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>Total saldo</td>
                  <td style={{ textAlign: "right", fontSize: 12, fontWeight: 700 }}>{rp(total)}</td>
                  <td colSpan={bolehKelola ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 10 }}>
        Rekening tidak bisa dihapus karena akunnya sudah dipakai jurnal — nonaktifkan saja.
        Transaksi kasir, klinik, dan gaji masih masuk ke <b>Kas</b> / <b>Bank BCA</b>;
        memilih rekening di sana adalah pekerjaan berikutnya.
      </div>
    </MasterPage>
  );
}
