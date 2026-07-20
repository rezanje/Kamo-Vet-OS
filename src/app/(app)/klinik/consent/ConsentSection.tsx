"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { SignaturePad } from "@/components/SignaturePad";
import { STATUS_BADGE, STATUS_LABEL, type ConsentStatus } from "@/lib/consent";
import { buatConsent, tandaTanganConsent } from "./actions";

export type ConsentRow = {
  id: string; tindakan: string; isi_snapshot: string; status: ConsentStatus;
  signer_name: string | null; signature_data: string | null; signed_at: string | null;
};

const waktu = (iso: string) => new Date(iso).toLocaleString("id-ID", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

// Bagian form persetujuan di rekam medis: buat, baca, tanda tangan, lihat status.
export function ConsentSection({ visitId, consents, templates }: {
  visitId: string;
  consents: ConsentRow[];
  templates: { id: string; nama: string }[];
}) {
  const [buka, setBuka] = useState(false);
  const [signing, setSigning] = useState<string | null>(null);
  const [lihat, setLihat] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card-hd" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-file-check" style={{ color: "#2563eb" }} /> Form persetujuan
        </span>
        {templates.length > 0 && !buka && (
          <button type="button" onClick={() => setBuka(true)} className="btn-acc"
            style={{ padding: "4px 10px", fontSize: 10.5, background: "#2563eb" }}>
            <i className="ti ti-plus" /> Buat
          </button>
        )}
      </div>

      {templates.length === 0 && (
        <div style={{ fontSize: 10.5, color: "var(--td)", padding: "6px 0" }}>
          Belum ada template aktif untuk cabang ini. Buat dulu di menu Klinik → Form persetujuan.
        </div>
      )}

      {buka && (
        <form action={buatConsent} style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <input type="hidden" name="visitId" value={visitId} />
          <div className="fg">
            <label className="flab">Template *</label>
            <select className="fi" name="templateId" required defaultValue="">
              <option value="" disabled>Pilih template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.nama}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="flab">Tindakan yang disetujui *</label>
            <input className="fi" name="tindakan" required placeholder="mis. Operasi sterilisasi" />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => setBuka(false)} className="btn-def" style={{ fontSize: 11 }}>Batal</button>
            <SubmitButton className="btn-acc" icon="ti-file-plus" pendingText="Membuat…" style={{ background: "#2563eb", fontSize: 11 }}>
              Buat Form
            </SubmitButton>
          </div>
        </form>
      )}

      {consents.length === 0 && !buka && (
        <div style={{ fontSize: 10.5, color: "var(--td)", padding: "6px 0" }}>
          Belum ada form persetujuan untuk kunjungan ini.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {consents.map((c) => (
          <div key={c.id} style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.tindakan}</div>
                <div style={{ fontSize: 9.5, color: "var(--tm)" }}>
                  {c.status === "sudah_ttd" && c.signed_at
                    ? `Ditandatangani ${c.signer_name} · ${waktu(c.signed_at)}`
                    : "Menunggu tanda tangan pemilik"}
                </div>
              </div>
              <span className={`bge ${STATUS_BADGE[c.status]}`} style={{ flexShrink: 0 }}>{STATUS_LABEL[c.status]}</span>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setLihat(lihat === c.id ? null : c.id)} className="back-btn"
                style={{ fontSize: 10.5, color: "#2563eb" }}>
                <i className={`ti ti-chevron-${lihat === c.id ? "up" : "down"}`} /> {lihat === c.id ? "Sembunyikan" : "Lihat isi"}
              </button>
              {c.status === "belum_ttd" && signing !== c.id && (
                <button type="button" onClick={() => { setSigning(c.id); setLihat(c.id); }} className="btn-acc"
                  style={{ padding: "3px 10px", fontSize: 10.5, background: "#16a34a" }}>
                  <i className="ti ti-signature" /> Tanda tangan
                </button>
              )}
              {c.status === "sudah_ttd" && (
                <a href={`/klinik/consent/${c.id}`} target="_blank" rel="noreferrer" className="btn-def"
                  style={{ padding: "3px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-printer" /> Cetak
                </a>
              )}
            </div>

            {lihat === c.id && (
              <div style={{ marginTop: 8, background: "var(--sf1)", borderRadius: 6, padding: 10, fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-line", color: "var(--tx)" }}>
                {c.isi_snapshot}
              </div>
            )}

            {c.status === "sudah_ttd" && c.signature_data && lihat === c.id && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9.5, color: "var(--tm)", marginBottom: 3 }}>Tanda tangan {c.signer_name}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.signature_data} alt="Tanda tangan" style={{ maxWidth: 240, border: ".5px solid var(--bd)", borderRadius: 6, background: "#fff" }} />
              </div>
            )}

            {signing === c.id && c.status === "belum_ttd" && (
              <form action={tandaTanganConsent} style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 10 }}>
                <input type="hidden" name="consentId" value={c.id} />
                <input type="hidden" name="visitId" value={visitId} />
                <div className="fg">
                  <label className="flab">Nama penanda tangan (pemilik) *</label>
                  <input className="fi" name="signerName" required placeholder="Nama sesuai identitas" />
                </div>
                <SignaturePad name="signature" />
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button type="button" onClick={() => setSigning(null)} className="btn-def" style={{ fontSize: 11 }}>Batal</button>
                  <SubmitButton className="btn-acc" icon="ti-check" pendingText="Menyimpan…" style={{ background: "#16a34a", fontSize: 11 }}>
                    Simpan Tanda Tangan
                  </SubmitButton>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
