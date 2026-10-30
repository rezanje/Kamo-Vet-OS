"use client";
import { useEffect, useRef } from "react";
import { STAY_TYPES, STAY_TYPE_LABEL } from "@/lib/inpatient-stay";

/** Explicit clinical decision; never inferred from services, consent or money. */
export function DpAdmissionFields({ selected, onChange }: { selected: boolean; onChange: (value: boolean) => void }) {
  const decision = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    // useClinicDraft restores named DOM fields, not new snapshot keys. Keep the
    // decision and validation in sync after its existing numeric-sync event.
    const node = decision.current;
    const restore = () => onChange(node?.value === "1");
    node?.addEventListener("vetos:numeric-sync", restore);
    return () => node?.removeEventListener("vetos:numeric-sync", restore);
  }, [onChange]);
  return <fieldset className="card" style={{ marginBottom: 10 }}>
    <legend style={{ fontSize: 12, fontWeight: 700 }}>Lanjutan pasien</legend>
    <label className="flab">Keputusan perawatan<select ref={decision} className="fi" name="admit_after_dp" aria-label="DP lalu Rawat Inap"
      value={selected ? "1" : "0"} onChange={e => onChange(e.target.value === "1")}>
      <option value="0">Rawat jalan — tidak masuk Rawat Inap</option>
      <option value="1">Pasien diputuskan Rawat Inap setelah DP</option>
    </select></label>
    <div hidden={!selected}>
      <p style={{ fontSize: 11 }}>Isi jumlah bayar sebagian lalu pilih Simpan. DP, tagihan dan masuk Rawat Inap disimpan bersama. Persetujuan khusus, dokter PIC dan rencana diperiksa; jika ditolak, tidak ada uang atau stok yang tersimpan sebagian.</p>
      <label className="flab">Tipe rawat inap *<select className="fi" name="stay_type" aria-label="Tipe rawat inap" required={selected} disabled={!selected} defaultValue="sakit">
        {STAY_TYPES.map(type => <option key={type} value={type}>{STAY_TYPE_LABEL[type]}</option>)}
      </select></label>
      <label className="flab">Rencana tindakan dari dokter PIC *<input className="fi" name="treatment_plan" aria-label="Rencana tindakan Rawat Inap" required={selected} disabled={!selected} maxLength={4000} /></label>
    </div>
  </fieldset>;
}
