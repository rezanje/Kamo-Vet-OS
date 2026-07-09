"use client";

import { useState } from "react";
import Link from "next/link";

export type MedEntry = {
  visitId: string;
  date: string; // ISO
  poli: string;
  dokter: string | null;
  keluhan: string | null;
  diagnosis: string | null;
  tindakan: string | null;
  tindakanCount: number;
  resepCount: number;
  color: string;
};
export type RacikanEntry = { id: string; recipe_name: string; dosage_form: string; total_volume: string; status: string; date: string };
export type InapEntry = { id: string; visitId: string; doctor: string | null; condition: string; admitted: string; discharged: string | null };
export type InvoiceEntry = { visitId: string; total: number; paid_status: string; date: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

const TABS = ["Riwayat Medis", "Rawat Inap", "Resep / Racikan", "Invoice / Pembayaran"] as const;
type Tab = (typeof TABS)[number];

export function RiwayatTabs({ med, racikan, inap, invoices }: {
  med: MedEntry[]; racikan: RacikanEntry[]; inap: InapEntry[]; invoices: InvoiceEntry[];
}) {
  const [tab, setTab] = useState<Tab>("Riwayat Medis");

  return (
    <div className="crm-sec" style={{ marginBottom: 0 }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 20, borderBottom: ".5px solid var(--bd)", marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="back-btn" style={{
            padding: "2px 0 10px", fontSize: 12.5, fontWeight: tab === t ? 700 : 500,
            color: tab === t ? "#2563eb" : "var(--tm)",
            borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent", borderRadius: 0,
          }}>{t}</button>
        ))}
      </div>

      {tab === "Riwayat Medis" && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Riwayat Medis</div>
          </div>
          {med.length === 0 ? (
            <Empty text="Belum ada riwayat medis." />
          ) : (
            <div style={{ position: "relative" }}>
              {/* garis timeline */}
              <div style={{ position: "absolute", left: 5, top: 6, bottom: 6, width: 2, background: "var(--bd)" }} />
              {med.map((m) => (
                <div key={m.visitId} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr auto", gap: 14, alignItems: "start", padding: "12px 0 12px 22px", position: "relative", borderBottom: ".5px solid var(--bd)" }}>
                  <span style={{ position: "absolute", left: 0, top: 16, width: 12, height: 12, borderRadius: "50%", background: m.color, border: "2px solid #fff", boxShadow: "0 0 0 1px var(--bd)" }} />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtDate(m.date)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--tm)" }}><i className="ti ti-clock" style={{ fontSize: 11 }} /> {fmtTime(m.date)}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 8 }}>{m.poli}</div>
                    {m.dokter && <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{m.dokter}</div>}
                  </div>
                  <div>
                    <Label>Keluhan</Label>
                    <div style={{ fontSize: 11.5, marginBottom: 8 }}>{m.keluhan || "—"}</div>
                    <Label>Diagnosa</Label>
                    <div style={{ fontSize: 11.5 }}>{m.diagnosis || "—"}</div>
                  </div>
                  <div>
                    {m.tindakan && (
                      <>
                        <Label>Tindakan</Label>
                        <div style={{ fontSize: 11.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <i className="ti ti-paperclip" style={{ color: "var(--tm)" }} /> {m.tindakan}
                          {m.tindakanCount > 0 && <Pill>{m.tindakanCount} item</Pill>}
                        </div>
                      </>
                    )}
                    {m.resepCount > 0 && (
                      <>
                        <Label>Resep Obat</Label>
                        <div style={{ fontSize: 11.5 }}><Pill>{m.resepCount} item</Pill></div>
                      </>
                    )}
                  </div>
                  <Link href={`/klinik/rekam-medis/${m.visitId}`} className="btn-def" style={{ padding: "5px 11px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                    <i className="ti ti-eye" /> Lihat Detail
                  </Link>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "Rawat Inap" && (
        inap.length === 0 ? <Empty text="Belum pernah rawat inap." /> : (
          <table className="tbl">
            <thead><tr><th>Masuk</th><th>Keluar</th><th>Dokter PIC</th><th>Kondisi</th><th>Aksi</th></tr></thead>
            <tbody>
              {inap.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontSize: 11 }}>{fmtDate(i.admitted)} {fmtTime(i.admitted)}</td>
                  <td style={{ fontSize: 11 }}>{i.discharged ? `${fmtDate(i.discharged)} ${fmtTime(i.discharged)}` : "—"}</td>
                  <td style={{ fontSize: 11 }}>{i.doctor ?? "—"}</td>
                  <td><span className={`bge ${i.condition === "rip" ? "r" : i.condition === "kritis" ? "o" : i.condition === "sembuh" ? "g" : "b"}`}>{i.condition}</span></td>
                  <td><Link href={`/klinik/rawat-inap/${i.id}`} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>Detail</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === "Resep / Racikan" && (
        racikan.length === 0 ? <Empty text="Belum ada resep racikan." /> : (
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th>Nama Racikan</th><th>Bentuk</th><th>Volume</th><th>Status</th></tr></thead>
            <tbody>
              {racikan.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11 }}>{fmtDate(r.date)}</td>
                  <td style={{ fontSize: 11.5 }}>{r.recipe_name}</td>
                  <td style={{ fontSize: 11 }}>{r.dosage_form}</td>
                  <td style={{ fontSize: 11 }}>{r.total_volume}</td>
                  <td><span className={`bge ${r.status === "handed_over" ? "g" : r.status === "void" ? "r" : "b"}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === "Invoice / Pembayaran" && (
        invoices.length === 0 ? <Empty text="Belum ada invoice." /> : (
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th style={{ textAlign: "right" }}>Total</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {invoices.map((iv) => (
                <tr key={iv.visitId}>
                  <td style={{ fontSize: 11 }}>{fmtDate(iv.date)}</td>
                  <td style={{ fontSize: 11.5, textAlign: "right", fontWeight: 600 }}>{rp(iv.total)}</td>
                  <td><span className={`bge ${iv.paid_status === "Lunas" ? "g" : iv.paid_status === "DP" ? "o" : "r"}`}>{iv.paid_status}</span></td>
                  <td><Link href={`/klinik/pembayaran/${iv.visitId}`} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>Lihat</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx)" }}>{children}</div>;
}
function Pill({ children }: { children: React.ReactNode }) {
  return <span style={{ display: "inline-block", background: "#eff6ff", color: "#2563eb", fontSize: 9.5, fontWeight: 600, padding: "1px 7px", borderRadius: 20, marginLeft: 6 }}>{children}</span>;
}
function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 11.5, color: "var(--td)", textAlign: "center", padding: "24px 0" }}>{text}</div>;
}
