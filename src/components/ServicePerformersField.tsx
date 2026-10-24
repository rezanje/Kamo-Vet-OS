"use client";
import { useId } from "react";
import { emptyServicePerformers, serviceStaffSlots, type ServicePerformersInput, type ServiceStaff } from "@/lib/service-performers";

export function ServicePerformersField({ value, staff, onChange, label }: {
  value?: ServicePerformersInput | null; staff: ServiceStaff[]; onChange: (value: ServicePerformersInput) => void; label: string;
}) {
  const id = useId(), current = value ?? emptyServicePerformers(), slots = serviceStaffSlots(staff);
  return <fieldset style={{ border: 0, padding: 0, margin: "6px 0", minWidth: 0 }}>
    <legend style={{ fontSize: 11, fontWeight: 600 }}>{label}</legend>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {([{ key: "doctor_id", title: "Dokter", choices: slots.doctors }, { key: "staff_id", title: "Non-dokter", choices: slots.staff }] as const).map(slot => <div key={slot.key} style={{ flex: "1 1 150px", minWidth: 0 }}>
        <label className="flab" htmlFor={`${id}-${slot.key}`}>{slot.title}</label>
        <select id={`${id}-${slot.key}`} className="fi" style={{ width: "100%" }} value={current[slot.key] ?? ""} onChange={event => onChange({ ...current, [slot.key]: event.target.value || null })}>
          <option value="">Belum ditetapkan</option>
          {current[slot.key] && !slot.choices.some(person => person.id === current[slot.key]) && <option value={current[slot.key]!}>Petugas tersimpan tidak tersedia — pilih ulang</option>}
          {slot.choices.map(person => <option key={person.id} value={person.id}>{person.nama}</option>)}
        </select>
      </div>)}
    </div>
  </fieldset>;
}
