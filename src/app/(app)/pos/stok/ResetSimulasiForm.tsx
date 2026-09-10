"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { RESET_SIMULASI_TOTAL_PHRASE, bolehResetSimulasi } from "@/lib/simulasi-reset";
import { resetSimulasiBarangDanStok } from "./actions";

export function ResetSimulasiForm({ role }: { role: string | null | undefined }) {
  const [understoodImpact, setUnderstoodImpact] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const ready = bolehResetSimulasi({ role, understoodImpact, confirmation });

  if (role !== "OWNER") return null;

  return (
    <div className="crm-sec" style={{ borderColor: "#fecaca", background: "#fffafa" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#991b1b", marginBottom: 5 }}>
        Reset simulasi barang &amp; stok
      </div>
      <div style={{ fontSize: 11.5, color: "#7f1d1d", lineHeight: 1.6, marginBottom: 10 }}>
        Mengosongkan barang, stok, dan transaksi simulasi terkait. Akun, cabang, gudang, user, pelanggan, serta rekam medis tetap ada.
      </div>
      <form action={resetSimulasiBarangDanStok}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#7f1d1d", marginBottom: 9, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={understoodImpact}
            onChange={(event) => setUnderstoodImpact(event.target.checked)}
            name="understood_impact"
            value="1"
            style={{ marginTop: 2 }}
          />
          Saya paham reset ini menghapus data simulasi dan tidak bisa dibatalkan.
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="fi"
            name="confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={`Ketik ${RESET_SIMULASI_TOTAL_PHRASE}`}
            aria-label="Konfirmasi reset simulasi"
            style={{ width: 290, maxWidth: "100%", borderColor: "#fca5a5" }}
          />
          <SubmitButton
            className="btn-acc"
            icon="ti-trash"
            pendingText="Mereset simulasi…"
            disabled={!ready}
            style={{ background: "#b91c1c" }}
          >
            Reset simulasi total
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
