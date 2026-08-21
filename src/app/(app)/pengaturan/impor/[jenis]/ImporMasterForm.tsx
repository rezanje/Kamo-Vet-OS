"use client";

// ponytail: file dibaca di browser jadi teks, lalu dikirim lewat satu textarea.
// Tanpa upload ke storage — isinya cuma perlu dibaca sekali, bukan disimpan.

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import type { KonfigImpor, JenisImpor } from "@/lib/impor-jenis";
import { imporMaster } from "../actions";

export function ImporMasterForm({ jenis, konfig }: { jenis: JenisImpor; konfig: KonfigImpor }) {
  const [csv, setCsv] = useState("");
  const [namaFile, setNamaFile] = useState("");
  const wajib = new Set<string>(konfig.wajib);

  const ambilFile = async (f: File | undefined) => {
    if (!f) return;
    setNamaFile(f.name);
    setCsv(await f.text());
  };

  // Hitungan kasar buat pemakai: berapa baris data yang bakal diproses.
  const jumlahBaris = csv.trim()
    ? csv.trim().split(/\r?\n/).filter((b) => b.trim() && b.replace(/[,;\t\s]/g, "")).length - 1
    : 0;

  const unduhContoh = () => {
    // BOM supaya Excel membuka file ini tanpa mengacak huruf beraksen.
    const blob = new Blob(["﻿" + konfig.contoh], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = konfig.namaFile;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <form action={imporMaster} className="crm-sec">
      <input type="hidden" name="jenis" value={jenis} />
      <input type="hidden" name="csv" value={csv} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-file-upload" /> Pilih file CSV
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={(e) => ambilFile(e.target.files?.[0])} />
        </label>
        <button type="button" className="btn-def" onClick={unduhContoh}>
          <i className="ti ti-download" /> Unduh contoh
        </button>
        {namaFile && (
          <span style={{ fontSize: 11, color: "var(--tm)" }}>
            <i className="ti ti-paperclip" /> {namaFile}
          </span>
        )}
        {jumlahBaris > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d" }}>
            {jumlahBaris} baris terbaca
          </span>
        )}
      </div>

      <label className="flab">Isi file (boleh ditempel langsung dari Excel)</label>
      <textarea
        className="fi"
        rows={10}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={konfig.contoh}
        style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.6, resize: "vertical" }}
      />

      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 6, lineHeight: 1.7 }}>
        Kolom yang dikenali: {konfig.kolom.map((k) => (
          <code key={k} style={{ marginRight: 6, fontWeight: wajib.has(k) ? 700 : 400, color: wajib.has(k) ? "#b91c1c" : "inherit" }}>
            {k}{wajib.has(k) ? " *" : ""}
          </code>
        ))}
        <br />
        Yang bertanda <b style={{ color: "#b91c1c" }}>*</b> wajib ada. Urutan kolom bebas, kolom lain diabaikan.
        <br />
        {konfig.catatan}
      </div>

      <div style={{ marginTop: 14 }}>
        <SubmitButton className="btn-acc" icon="ti-upload" pendingText="Mengimpor…" style={{ background: "#2563eb" }}>
          Impor {jenis}
        </SubmitButton>
      </div>
    </form>
  );
}
