"use client";

import { LampiranPicker } from "@/components/LampiranPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { tambahDokumen } from "./actions";

export function DokumenTambah({
  modul, refId, kembali, folder,
}: { modul: string; refId: string; kembali: string; folder: string }) {
  return (
    <form action={tambahDokumen} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
      <input type="hidden" name="modul" value={modul} />
      <input type="hidden" name="ref_id" value={refId} />
      <input type="hidden" name="kembali" value={kembali} />
      <div style={{ flex: 1, minWidth: 240 }}>
        <LampiranPicker folder={folder} />
      </div>
      <SubmitButton className="btn-def" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ width: "auto" }}>
        Simpan dokumen
      </SubmitButton>
    </form>
  );
}
