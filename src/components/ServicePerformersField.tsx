"use client";
import { useId } from "react";
import { emptyServicePerformers, serviceStaffSlots, type ServicePerformersInput, type ServiceStaff } from "@/lib/service-performers";
import { clinicalRoles } from "@/lib/clinical-staff";

/** `compact`: dipakai di baris keranjang klinik — pilihan pelaksana harus muat satu baris
 * kecil di bawah nama item, tidak boleh mengalahkan item utamanya. */
export function ServicePerformersField({ value, staff, onChange, label, grooming = false, doctorRequired = false, compact = false }: {
  value?: ServicePerformersInput | null; staff: ServiceStaff[]; onChange: (value: ServicePerformersInput) => void; label: string;
  grooming?: boolean; doctorRequired?: boolean; compact?: boolean;
}) {
  const id = useId(), current = value ?? emptyServicePerformers(), slots = serviceStaffSlots(staff);
  const choices = grooming ? slots.staff.filter(person => clinicalRoles(person.jabatan).includes("groomer")) : slots.staff;
  return <fieldset style={{ border: 0, padding: 0, margin: compact ? "2px 0" : "6px 0", minWidth: 0 }}>
    <legend style={{ fontSize: compact ? 9 : 11, fontWeight: 600, color: compact ? "var(--tm)" : undefined }}>{label}</legend>
    <div style={{ display: "flex", gap: compact ? 4 : 6, flexWrap: "wrap", alignItems: "center" }}>
      {([{ key: "doctor_id", title: "Dokter", choices: slots.doctors }, { key: "staff_id", title: grooming ? "Groomer" : "Non-dokter", choices }] as const).map(slot => <div key={slot.key} style={{ flex: compact ? "1 1 110px" : "1 1 150px", minWidth: 0, display: compact ? "flex" : undefined, alignItems: "center", gap: 3 }}>
        <label className="flab" htmlFor={`${id}-${slot.key}`} style={compact ? { fontSize: 9, margin: 0, whiteSpace: "nowrap", color: "var(--tm)" } : undefined}>{slot.title}{grooming && (slot.key === "staff_id" || doctorRequired) ? " *" : ""}</label>
        <select id={`${id}-${slot.key}`} className="fi" style={compact ? { width: "100%", height: 20, padding: "0 3px", fontSize: 9.5 } : { width: "100%" }} required={grooming && (slot.key === "staff_id" || doctorRequired)} value={current[slot.key] ?? ""} onChange={event => onChange({ ...current, [slot.key]: event.target.value || null })}>
          <option value="">Belum ditetapkan</option>
          {current[slot.key] && !slot.choices.some(person => person.id === current[slot.key]) && <option value={current[slot.key]!}>Petugas tersimpan tidak tersedia — pilih ulang</option>}
          {slot.choices.map(person => <option key={person.id} value={person.id}>{person.nama}</option>)}
        </select>
      </div>)}
    </div>
  </fieldset>;
}
