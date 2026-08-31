"use client";

import { useState, useTransition } from "react";
import {
  konfirmasiKomponenGrup,
  previewKomponenGrup,
  type GroupImportState,
} from "./actions";

export function GroupComponentImport() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<GroupImportState | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (action: typeof previewKomponenGrup | typeof konfirmasiKomponenGrup) => {
    if (!file) {
      setError("Pilih file Rincian Grup .xlsx terlebih dulu.");
      return;
    }
    setError("");
    startTransition(async () => {
      const data = new FormData();
      data.append("group_file", file);
      setState(await action(data));
    });
  };

  return (
    <section className="crm-sec" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Rincian Grup Accurate</div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3, lineHeight: 1.55 }}>
        Upload template dengan kolom Kode Grup, Kode Komponen, Kuantitas, Satuan, dan Urutan.
        Grup baru aktif hanya setelah seluruh komponennya valid.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-components" /> Pilih Rincian Grup .xlsx
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setState(null);
              setError("");
            }}
          />
        </label>
        <button type="button" className="btn-acc" disabled={pending || !file} onClick={() => run(previewKomponenGrup)}>
          <i className={`ti ${pending ? "ti-loader-2" : "ti-eye"}`} /> {pending ? "Memproses…" : "Cek rincian"}
        </button>
        {file && <span style={{ fontSize: 11, color: "var(--tm)" }}>{file.name}</span>}
      </div>

      {(error || (state && !state.ok)) && (
        <div className="p2ban" style={{ marginTop: 10, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error || state?.message}
        </div>
      )}

      {state && (
        <>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
            <span className="badge g">Grup lengkap {state.complete}</span>
            <span className="badge y">Belum lengkap {state.incomplete}</span>
            <span className="badge r">Ditolak {state.rejected}</span>
            <span className="badge x">Kode tak dikenal {state.unknown}</span>
          </div>
          {state.errors.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 180, overflow: "auto", fontSize: 10.5, color: "#b91c1c" }}>
              {state.errors.map((message) => <div key={message}>{message}</div>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            {state.phase === "preview" ? (
              <button type="button" className="btn-acc" disabled={pending || !state.ok} onClick={() => run(konfirmasiKomponenGrup)} style={{ background: "#15803d" }}>
                <i className="ti ti-check" /> {pending ? "Menyimpan…" : "Konfirmasi rincian Grup"}
              </button>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700, color: "#166534" }}>Rincian Grup tersimpan.</span>
            )}
            <span style={{ fontSize: 10.5, color: state.ok ? "#166534" : "#b91c1c" }}>{state.message}</span>
          </div>
        </>
      )}
    </section>
  );
}
