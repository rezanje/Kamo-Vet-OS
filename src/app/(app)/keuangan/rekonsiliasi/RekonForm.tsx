"use client";

import { NumberInput } from "@/components/NumberInput";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { draftNumber } from "@/components/TransactionDraft";

import { useState } from "react";
import { prosesRekonsiliasi, koreksiRekonsiliasi, batalkanRekonsiliasi } from "./actions";

const rp = (n: number) => "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export type RekeningRekon = { id: string; nama: string; coa_code: string; saldo: number };

export type RekonHeader = { id: string; revision: number; cash_account_id: string | null; tanggal: string; saldo_bank: number; biaya_adm: number; bunga: number; catatan: string | null };
export function RekonForm({ userId, rekening, hariIni, header }: { userId: string; rekening: RekeningRekon[]; hariIni: string; header?: RekonHeader }) {
  const [accountId, setAccountId] = useState(header?.cash_account_id ?? rekening[0]?.id ?? "");
  const [saldoBank, setSaldoBank] = useState(Number(header?.saldo_bank ?? 0));
  const [biayaAdm, setBiayaAdm] = useState(Number(header?.biaya_adm ?? 0));
  const [bunga, setBunga] = useState(Number(header?.bunga ?? 0));

  const dipilih = rekening.find((r) => r.id === accountId);
  const saldoBuku = dipilih?.saldo ?? 0;
  const adjusted = saldoBuku + bunga - biayaAdm;
  const selisih = saldoBank - adjusted;
  const cocok = Math.abs(selisih) < 0.005;
  const scope = header ? `bank-reconciliation-edit-${header.id}-${header.revision}` : "bank-reconciliation-create";

  if (rekening.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--td)" }}>
        Belum ada rekening bank. Tambahkan dulu di <b>Kas &amp; Bank → Daftar Rekening</b>.
      </div>
    );
  }

  return (
    <CorrectionTransactionForm userId={userId} scope={scope} action={header ? koreksiRekonsiliasi : prosesRekonsiliasi} state={{snapshot:{accountId,saldoBank,biayaAdm,bunga},restore(value){if(typeof value.accountId!=="string"||!draftNumber(value.saldoBank)||!draftNumber(value.biayaAdm)||!draftNumber(value.bunga))return false;setAccountId(value.accountId);setSaldoBank(value.saldoBank);setBiayaAdm(value.biayaAdm);setBunga(value.bunga);return true;},reset(){setAccountId(rekening[0]?.id??"");setSaldoBank(0);setBiayaAdm(0);setBunga(0);}}}>
      {({ ready }) => <>
      {header && <><input type="hidden" name="id" value={header.id}/><input type="hidden" name="revision" value={header.revision}/></>}
      <div className="grid2" style={{ alignItems: "start" }}>
        <div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Rekening *</label>
              <select className="fi" name="account_id" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                {rekening.map((r) => <option key={r.id} value={r.id}>{r.nama} · {r.coa_code}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Tanggal rekonsiliasi</label>
              <input className="fi" name="tanggal" type="date" defaultValue={header?.tanggal ?? hariIni} max={hariIni} />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Saldo rekening koran (bank)</label>
              <NumberInput className="fi" name="saldo_bank" type="number" step="0.01" value={saldoBank || ""} onChange={(e) => setSaldoBank(Number(e.target.value))} placeholder="dari e-statement" />
            </div>
            <div>
              <label className="flab">Biaya admin bank</label>
              <NumberInput className="fi" name="biaya_adm" type="number" min={0} step="0.01" value={biayaAdm || ""} onChange={(e) => setBiayaAdm(Number(e.target.value))} />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Bunga bank</label>
              <NumberInput className="fi" name="bunga" type="number" min={0} step="0.01" value={bunga || ""} onChange={(e) => setBunga(Number(e.target.value))} />
            </div>
            <div>
              <label className="flab">Catatan</label>
              <input className="fi" name="catatan" defaultValue={header?.catatan ?? ""} maxLength={1000} placeholder="mis. setoran dalam perjalanan" />
            </div>
          </div>
        </div>

        <div className="card" style={{ background: "var(--sf1)" }}>
          <div className="card-hd"><i className="ti ti-calculator" style={{ color: "var(--acc)" }} /> Perkiraan perhitungan</div>
          <p style={{ fontSize: 11 }}>Saldo sesuai tanggal rekonsiliasi dihitung ulang saat disimpan. Saat koreksi, penyesuaian lama dibalik terlebih dahulu.</p>
          <Row k={`Saldo buku (${dipilih?.nama ?? "-"})`} v={rp(saldoBuku)} />
          <Row k="+ Bunga bank" v={rp(bunga)} />
          <Row k="− Biaya admin" v={`- ${rp(biayaAdm)}`} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1px solid var(--bd)", fontWeight: 600 }}>
            <span>Saldo buku disesuaikan</span><span>{rp(adjusted)}</span>
          </div>
          <Row k="Saldo bank (rek. koran)" v={rp(saldoBank)} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", marginTop: 4, borderTop: "2px solid #16213e" }}>
            <span style={{ fontWeight: 700 }}>Selisih</span>
            <span style={{ fontWeight: 700, color: cocok ? "#15803d" : "#b91c1c" }}>{selisih < 0 ? "-" : ""}{rp(Math.abs(selisih))}</span>
          </div>
          <div style={{ fontSize: 10, color: cocok ? "#15803d" : "#b55a35", marginTop: 4 }}>
            {cocok ? "✓ Cocok — buku & bank selaras setelah penyesuaian." : "Belum cocok — sisa selisih (setoran/cek dalam perjalanan) perlu ditelusuri."}
          </div>
          <SubmitButton className="pay-btn" pendingText="Menyimpan…" disabled={!ready} style={{ marginTop: 12 }}>{header ? "Simpan koreksi" : "Proses rekonsiliasi"}</SubmitButton>
        </div>
      </div>
      {header && <label className="flab" style={{ marginTop: 10 }}>Alasan koreksi *<input className="fi" name="reason" minLength={3} maxLength={1000} required/></label>}
      </>}
    </CorrectionTransactionForm>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: "var(--tm)" }}><span>{k}</span><span>{v}</span></div>;
}

export function RekonVoidForm({ userId, header }: { userId: string; header: RekonHeader }) {
  const scope = `bank-reconciliation-void-${header.id}-${header.revision}`;
  return <CorrectionTransactionForm userId={userId} scope={scope} action={batalkanRekonsiliasi}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={header.id}/><input type="hidden" name="revision" value={header.revision}/>
      <label className="flab">Alasan pembatalan *<input className="fi" name="reason" minLength={3} maxLength={1000} required/></label>
      <SubmitButton className="btn-def" pendingText="Membatalkan…" disabled={!ready}>Batalkan rekonsiliasi</SubmitButton>
    </>}
  </CorrectionTransactionForm>;
}
