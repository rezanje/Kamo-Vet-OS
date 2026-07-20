"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Upload foto hewan langsung dari rekam medis — pet sudah ada (petId pasti),
// jadi update photo_url langsung ke tabel pets, gak lewat form submit.
export function PetPhotoUpload({ petId, initialUrl }: { petId: string; initialUrl: string | null }) {
  const [preview, setPreview] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    setErr("");
    try {
      const supabase = createClient();
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`;
      const { error: upErr } = await supabase.storage.from("pet-photos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("pet-photos").getPublicUrl(path);
      const { error: dbErr } = await supabase.from("pets").update({ photo_url: data.publicUrl }).eq("id", petId);
      if (dbErr) throw dbErr;
      setPreview(data.publicUrl);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Gagal upload foto");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ position: "relative", width: 72, height: 72, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)", overflow: "hidden" }}>
        {preview
          ? <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-paw" style={{ fontSize: 30, color: "var(--td)" }} /></div>}
        <label title="Ubah foto" style={{
          position: "absolute", bottom: 2, right: 2, width: 22, height: 22, borderRadius: "50%",
          background: "rgba(0,0,0,.65)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: busy ? "wait" : "pointer",
        }}>
          <i className="ti ti-camera" style={{ fontSize: 12 }} />
          <input type="file" accept="image/*" hidden disabled={busy} onChange={onPick} />
        </label>
      </div>
      {err && <div style={{ fontSize: 9, color: "#dc2626", marginTop: 3, maxWidth: 72 }}>{err}</div>}
    </div>
  );
}
