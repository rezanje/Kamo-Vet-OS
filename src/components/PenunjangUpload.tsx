"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Upload foto hasil penunjang (lab/rontgen/USG) ke bucket privat `medical-docs`.
// URL disimpan di state lalu dikirim sebagai JSON — baris medical_records baru dibuat
// saat form disubmit, jadi belum ada id-nya waktu upload (pola sama dgn foto hewan).
export function PenunjangUpload({ name }: { name: string }) {
  const [paths, setPaths] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setErr("");
    try {
      const supabase = createClient();
      for (const file of files) {
        const path = `penunjang/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`;
        const { error } = await supabase.storage.from("medical-docs").upload(path, file, { upsert: true });
        if (error) throw error;
        setPaths((p) => [...p, path]);
        setPreviews((p) => ({ ...p, [path]: URL.createObjectURL(file) }));
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Gagal upload foto");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  const hapus = (path: string) => {
    setPaths((p) => p.filter((x) => x !== path));
    setPreviews((p) => {
      const { [path]: _drop, ...rest } = p;
      return rest;
    });
  };

  return (
    <div style={{ marginTop: 6 }}>
      <input type="hidden" name={name} value={JSON.stringify(paths)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, cursor: busy ? "wait" : "pointer", padding: "4px 10px" }}>
          <i className="ti ti-camera-plus" /> {busy ? "Mengunggah…" : "Upload foto hasil"}
          <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={onPick} />
        </label>
        <span style={{ fontSize: 9.5, color: "var(--td)" }}>Lab, rontgen, USG. Bisa lebih dari satu.</span>
      </div>

      {err && <div style={{ fontSize: 10, color: "#b91c1c", marginTop: 4 }}>{err}</div>}

      {paths.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 8 }}>
          {paths.map((p) => (
            <div key={p} style={{ position: "relative", width: 74, height: 74, borderRadius: 8, overflow: "hidden", border: ".5px solid var(--bd)", background: "var(--sf1)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[p]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button type="button" onClick={() => hapus(p)} title="Hapus"
                style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(0,0,0,.6)", color: "#fff", cursor: "pointer", fontSize: 10, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-x" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
