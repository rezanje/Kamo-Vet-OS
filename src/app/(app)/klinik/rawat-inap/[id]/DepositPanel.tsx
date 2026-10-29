import Link from "next/link";
import { NumberInput } from "@/components/NumberInput";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { bolehBatalDeposit, bolehKelolaDeposit, saldoDeposit, sisaDeposit } from "@/lib/deposit-ranap";
import type { DepositRanap } from "@/lib/deposit-ranap-server";
import { batalkanDeposit, catatDeposit, kembalikanDeposit } from "../deposit-actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

/**
 * Deposit rawat inap: titipan uang pemilik selama pasien dirawat.
 *
 * Titipan bukan pembayaran tagihan — tagihan baru terbit saat pasien pulang.
 * Yang tampil di sini adalah uang yang sudah masuk, yang sudah terpakai menutup
 * tagihan, dan sisanya yang masih menjadi hak pemilik.
 */
export function DepositPanel({
  recordId, deposits, aktif, userId, role, keys, perkiraanTagihan,
}: {
  recordId: string;
  deposits: DepositRanap[] | null;
  aktif: boolean;
  userId: string;
  role: string | null;
  /** Kunci idempotensi dari server: satu per form supaya klik ganda tidak menggandakan uang. */
  keys: { catat: string; kelola: string };
  perkiraanTagihan: number | null;
}) {
  if (deposits === null) {
    return (
      <div className="crm-sec" data-deposit-ranap>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em", marginBottom: 8 }}>
          <i className="ti ti-pig-money" /> DEPOSIT RAWAT INAP
        </div>
        <p role="alert" style={{ fontSize: 12 }}>
          Daftar deposit belum dapat dibaca. Muat ulang halaman sebelum menerima atau mengembalikan uang titipan.
        </p>
      </div>
    );
  }

  const aktifRows = deposits.filter((d) => d.status === "aktif");
  const totalMasuk = aktifRows.reduce((a, d) => a + d.jumlah, 0);
  const totalTerpakai = aktifRows.reduce((a, d) => a + d.terpakai, 0);
  const totalKembali = aktifRows.reduce((a, d) => a + d.dikembalikan, 0);
  const saldo = saldoDeposit(deposits);
  const kelola = bolehKelolaDeposit(role);

  return (
    <div className="crm-sec" data-deposit-ranap>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em" }}>
          <i className="ti ti-pig-money" /> DEPOSIT RAWAT INAP
        </div>
        <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
          Titipan masuk <b style={{ color: "var(--tx)" }}>{rp(totalMasuk)}</b>
          {" · "}terpakai <b style={{ color: "var(--tx)" }}>{rp(totalTerpakai)}</b>
          {totalKembali > 0 && <> · dikembalikan <b style={{ color: "var(--tx)" }}>{rp(totalKembali)}</b></>}
          {" · "}sisa <b style={{ color: "#15803d" }}>{rp(saldo)}</b>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 0 }}>
        Uang titipan belum menjadi pendapatan klinik. Saat pasien pulang dan tagihan dibuat, sisa
        titipan otomatis memotong tagihan itu; kelebihannya tetap menjadi hak pemilik dan bisa dikembalikan.
      </p>

      {perkiraanTagihan !== null && (
        <div className="p2ban" style={{ background: saldo >= perkiraanTagihan ? "#e8f5ee" : "#fffbeb", border: `.5px solid ${saldo >= perkiraanTagihan ? "#86efac" : "#fcd34d"}`, color: saldo >= perkiraanTagihan ? "#15803d" : "#92400e" }}>
          <i className="ti ti-calculator" /> Perkiraan tagihan sampai hari ini <b>{rp(perkiraanTagihan)}</b> · deposit <b>{rp(saldo)}</b>
          {" — "}
          {saldo >= perkiraanTagihan
            ? `cukup, perkiraan kelebihan ${rp(saldo - perkiraanTagihan)}`
            : `perkiraan kurang ${rp(perkiraanTagihan - saldo)}`}
          . Angka ini perkiraan; tagihan tetap dihitung ulang saat pasien pulang.
        </div>
      )}

      {aktif && (
        <TransactionForm userId={userId} scope={`inpatient-deposit:${recordId}`} action={catatDeposit}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <input type="hidden" name="recordId" value={recordId} />
          <input type="hidden" name="request_key" value={keys.catat} />
          <div>
            <label className="flab" htmlFor="deposit-jumlah">Nominal titipan</label>
            <NumberInput className="fi" id="deposit-jumlah" name="jumlah" type="number" min={1} step={1}
              required style={{ width: 150, textAlign: "right" }} placeholder="0" />
          </div>
          <div>
            <label className="flab" htmlFor="deposit-metode">Metode</label>
            <select className="fi" id="deposit-metode" name="metode" defaultValue="Tunai" style={{ width: 130 }}>
              {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="flab" htmlFor="deposit-catatan">Catatan (opsional)</label>
            <input className="fi" id="deposit-catatan" name="catatan" maxLength={300} placeholder="mis. titipan dari kakak pemilik" />
          </div>
          <SubmitButton className="btn-acc" icon="ti-cash" pendingText="Menyimpan…">Simpan Deposit</SubmitButton>
        </TransactionForm>
      )}
      {!aktif && <p style={{ fontSize: 11.5, color: "var(--tm)" }}>Pasien sudah pulang — titipan baru tidak lagi diterima di sini. Uang masuk setelah ini dicatat sebagai pembayaran tagihan.</p>}

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 760 }}>
          <thead><tr>
            <th>No. Deposit</th><th>Tanggal</th><th>Metode</th>
            <th style={{ textAlign: "right" }}>Jumlah</th>
            <th style={{ textAlign: "right" }}>Terpakai</th>
            <th style={{ textAlign: "right" }}>Sisa</th>
            <th>Status</th><th style={{ textAlign: "center" }}>Bukti</th>
          </tr></thead>
          <tbody>
            {deposits.map((d) => {
              const sisa = sisaDeposit(d);
              const label = d.status === "batal" ? "Dibatalkan"
                : d.dikembalikan > 0 && sisa === 0 ? "Dikembalikan"
                : d.terpakai > 0 && sisa === 0 ? "Terpakai penuh"
                : d.terpakai > 0 ? "Terpakai sebagian" : "Aktif";
              const warna = d.status === "batal" ? "r" : sisa > 0 ? "g" : "b";
              return (
                <tr key={d.id}>
                  <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{d.no_deposit}</td>
                  <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{tgl(d.tanggal)}</td>
                  <td style={{ fontSize: 11 }}>{d.metode}{d.catatan && <div style={{ fontSize: 10, color: "var(--tm)" }}>{d.catatan}</div>}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(d.jumlah)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(d.terpakai)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(sisa)}</td>
                  <td>
                    <span className={`bge ${warna}`}>{label}</span>
                    {d.void_reason && <div style={{ fontSize: 10, color: "var(--tm)" }}>Alasan: {d.void_reason}</div>}
                    {d.refund_reason && <div style={{ fontSize: 10, color: "var(--tm)" }}>Kembali: {d.refund_reason}</div>}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <Link href={`/klinik/rawat-inap/${recordId}/deposit/${d.id}`} title="Bukti terima"
                      style={{ display: "inline-flex", width: 26, height: 26, borderRadius: 6, border: "1px solid #bfdbfe", color: "var(--posb)", background: "#fff", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
                      <i className="ti ti-receipt" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {deposits.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada deposit untuk pasien ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {kelola && deposits.some((d) => bolehBatalDeposit(d) || sisaDeposit(d) > 0) && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 11.5, cursor: "pointer" }}>Batalkan deposit atau kembalikan sisanya</summary>
          <p style={{ fontSize: 11, color: "var(--tm)" }}>
            Pembatalan hanya untuk deposit yang belum menempel di tagihan mana pun. Deposit yang sudah
            terpakai dibalik lewat void tagihannya. Barisnya tidak pernah dihapus.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {deposits.filter((d) => bolehBatalDeposit(d) || sisaDeposit(d) > 0).map((d) => (
              <div key={d.id} style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>{d.no_deposit} · sisa {rp(sisaDeposit(d))}</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {bolehBatalDeposit(d) && (
                    <TransactionForm userId={userId} scope={`inpatient-deposit-void:${d.id}`} action={batalkanDeposit}
                      style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <input type="hidden" name="recordId" value={recordId} />
                      <input type="hidden" name="deposit_id" value={d.id} />
                      <input type="hidden" name="request_key" value={`${keys.kelola}:batal:${d.id}`} />
                      <div>
                        <label className="flab">Alasan pembatalan</label>
                        <input className="fi" name="alasan" required maxLength={500} style={{ width: 230 }} placeholder="mis. salah input metode" />
                      </div>
                      <SubmitButton className="btn-def" icon="ti-x" pendingText="Membatalkan…">Batalkan</SubmitButton>
                    </TransactionForm>
                  )}
                  {sisaDeposit(d) > 0 && (
                    <TransactionForm userId={userId} scope={`inpatient-deposit-refund:${d.id}`} action={kembalikanDeposit}
                      style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <input type="hidden" name="recordId" value={recordId} />
                      <input type="hidden" name="deposit_id" value={d.id} />
                      <input type="hidden" name="request_key" value={`${keys.kelola}:kembali:${d.id}`} />
                      <div>
                        <label className="flab">Alasan pengembalian</label>
                        <input className="fi" name="alasan" required maxLength={500} style={{ width: 230 }} placeholder="mis. sisa titipan dikembalikan tunai" />
                      </div>
                      <SubmitButton className="btn-def" icon="ti-arrow-back-up" pendingText="Mengembalikan…">Kembalikan sisa {rp(sisaDeposit(d))}</SubmitButton>
                    </TransactionForm>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
