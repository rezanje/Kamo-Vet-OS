"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { salinJadwalBulanLalu } from "./actions";

// C1: salin pola jadwal bulan lalu (hari yang sama, 4 minggu sebelumnya). Bawaan hanya mengisi sel
// yang masih kosong; menimpa jadwal yang sudah ada wajib dicentang dan dikonfirmasi.
export function SalinJadwalForm({
  cabang, bulan, bulanLalu, adaIsi,
}: {
  cabang: string; bulan: string; bulanLalu: string; adaIsi: boolean;
}) {
  const [timpa, setTimpa] = useState(false);
  return (
    <form
      action={salinJadwalBulanLalu}
      onSubmit={(e) => {
        if (timpa && !window.confirm(`Jadwal ${bulan} yang sudah terisi akan DIGANTI dengan pola ${bulanLalu}. Lanjutkan?`)) e.preventDefault();
      }}
      style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10,
        padding: "8px 10px", border: ".5px dashed var(--bd)", borderRadius: 8 }}
    >
      <input type="hidden" name="cabang" value={cabang} />
      <input type="hidden" name="bulan" value={bulan} />
      <span style={{ fontSize: 11, color: "var(--tm)" }}>
        Salin pola jadwal {bulanLalu} (hari yang sama, mis. Senin ← Senin) ke bulan ini.
      </span>
      {adaIsi && (
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
          <input type="checkbox" name="timpa" value="1" checked={timpa} onChange={(e) => setTimpa(e.target.checked)} />
          Timpa jadwal yang sudah terisi
        </label>
      )}
      <SubmitButton className="btn-def" icon="ti-copy" pendingText="Menyalin…" style={{ marginLeft: "auto", fontSize: 11 }}>
        Salin dari bulan lalu
      </SubmitButton>
    </form>
  );
}
