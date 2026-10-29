"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { akhiriPenugasanCabang } from "./actions";

/**
 * T2: satu penugasan lintas cabang ditutup dengan tanggal berakhir (boleh
 * bertanggal depan) dan alasan wajib. Setelah tanggal itu lewat, orangnya
 * berhenti muncul sebagai pilihan petugas di cabang tersebut.
 */
export function AkhiriPenugasanForm({ employeeId, branchId, branchName, today, minDate }: {
  employeeId: string; branchId: string; branchName: string; today: string; minDate: string;
}) {
  const [state, akhiri] = useActionState(akhiriPenugasanCabang, null);
  const id = `${employeeId}-${branchId}`;
  return <details style={{ fontSize: 11 }}>
    <summary style={{ cursor: "pointer" }}>Akhiri penugasan</summary>
    <form action={akhiri} style={{ display: "grid", gap: 6, marginTop: 6, minWidth: 220 }}>
      <input type="hidden" name="employee_id" value={employeeId} />
      <input type="hidden" name="branch_id" value={branchId} />
      {state && <span role={state.ok ? "status" : "alert"} style={{ color: state.ok ? "#15803d" : "#b91c1c" }}>{state.pesan}</span>}
      <div>
        <label className="flab" htmlFor={`end-${id}`}>Berakhir pada *</label>
        {/* Boleh mundur sampai tanggal mulai (orangnya sudah berhenti minggu lalu) dan boleh maju. */}
        <input id={`end-${id}`} className="fi" name="end_date" type="date" defaultValue={today} min={minDate} required />
      </div>
      <div>
        <label className="flab" htmlFor={`reason-${id}`}>Alasan *</label>
        <input id={`reason-${id}`} className="fi" name="reason" minLength={3} maxLength={300} required
          placeholder={`Alasan mengakhiri penugasan di ${branchName}`} />
      </div>
      <SubmitButton className="btn-def" pendingText="Mengakhiri…">Akhiri penugasan</SubmitButton>
    </form>
  </details>;
}
