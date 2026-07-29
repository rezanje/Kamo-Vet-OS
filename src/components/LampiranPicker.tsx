"use client";

// Pemilih lampiran untuk form yang dokumennya BELUM ada di database (mis. pengeluaran
// baru): file diunggah duluan ke bucket `dokumen`, path-nya dikirim sebagai JSON di
// hidden input, baris document_attachments dibuat server action setelah dokumen induk jadi.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { namaFileAman, type LampiranDraft } from "@/lib/dokumen";

const MAKS_MB = 10;

export function LampiranPicker({
  name = "lampiran",
  folder,
  wajib = false,
}: {
  name?: string;
  folder: string;
  wajib?: boolean;
}) {
  const [files, setFiles] = useState<LampiranDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setBusy(true);
    setErr("");
    try {
      const supabase = createClient();
      for (const file of picked) {
        if (file.size > MAKS_MB * 1024 * 1024) {
          throw new Error(`"${file.name}" lebih dari ${MAKS_MB} MB`);
        }
        const path = `${folder}/${Date.now()}-${namaFileAman(file.name)}`;
        const { error } = await supabase.storage.from("dokumen").upload(path, file, { upsert: true });
        if (error) throw error;
        setFiles((f) => [...f, { path, nama: file.name, mime: file.type || null, ukuran: file.size }]);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Gagal mengunggah lampiran");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  const hapus = (path: string) => setFiles((f) => f.filter((x) => x.path !== path));

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(files)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, cursor: busy ? "wait" : "pointer", padding: "5px 11px" }}>
          <i className="ti ti-paperclip" /> {busy ? "Mengunggah…" : "Pilih file"}
          <input type="file" multiple hidden disabled={busy} onChange={onPick}
            accept="image/*,application/pdf" />
        </label>
        <span style={{ fontSize: 9.5, color: files.length === 0 && wajib ? "#b91c1c" : "var(--td)" }}>
          {wajib ? "Wajib: foto/scan nota atau bukti transfer." : "Foto atau PDF, maks 10 MB."}
        </span>
      </div>

      {err && <div style={{ fontSize: 10, color: "#b91c1c", marginTop: 4 }}>{err}</div>}

      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
          {files.map((f) => (
            <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
              <i className="ti ti-file-check" style={{ color: "#15803d" }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.nama}</span>
              <button type="button" onClick={() => hapus(f.path)} className="btn-def"
                style={{ padding: "1px 7px", fontSize: 10, color: "#b91c1c" }} title="Hapus">
                <i className="ti ti-x" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
