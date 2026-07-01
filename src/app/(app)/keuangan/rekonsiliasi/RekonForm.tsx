"use client";

import { useState } from "react";
import { prosesRekonsiliasi } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function RekonForm({ saldoBuku }: { saldoBuku: number }) {
  const [saldoBank, setSaldoBank] = useState(0);
  const [biayaAdm, setBiayaAdm] = useState(0);
  const [bunga, setBunga] = useState(0);

  const adjusted = saldoBuku + bunga - biayaAdm;
  const selisih = saldoBank - adjusted;
  const cocok = Math.round(selisih) === 0;

  return (
    <form action={prosesRekonsiliasi}>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Tanggal rekonsiliasi</label>
              <input className="fi" name="tanggal" type="date" defaultValue="2026-07-01" />
            </div>
            <div>
              <label className="flab">Saldo rekening koran (bank)</label>
              <input className="fi" name="saldo_bank" type="number" min={0} step={1000} value={saldoBank || ""} onChange={(e) => setSaldoBank(Number(e.target.value))} placeholder="dari e-statement" />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Biaya admin bank</label>
              <input className="fi" name="biaya_adm" type="number" min={0} step={1000} value={biayaAdm || ""} onChange={(e) => setBiayaAdm(Number(e.target.value))} />
            </div>
            <div>
              <label className="flab">Bunga bank</label>
              <input className="fi" name="bunga" type="number" min={0} step={1000} value={bunga || ""} onChange={(e) => setBunga(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="flab">Catatan</label>
            <input className="fi" name="catatan" placeholder="mis. setoran dalam perjalanan" />
          </div>
        </div>

        <div className="card" style={{ background: "var(--sf1)" }}>
          <div className="card-hd"><i className="ti ti-calculator" style={{ color: "var(--acc)" }} /> Perhitungan</div>
          <Row k="Saldo buku (Bank 1102)" v={rp(saldoBuku)} />
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
          <button type="submit" className="pay-btn" style={{ marginTop: 12 }}>
            <i className="ti ti-checkbox" /> Proses Rekonsiliasi
          </button>
        </div>
      </div>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: "var(--tm)" }}><span>{k}</span><span>{v}</span></div>;
}
