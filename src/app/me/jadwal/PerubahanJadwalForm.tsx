"use client";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { jamRingkas } from "@/lib/shift-master";
import {
  pilihanCabangJadwal,
  pilihanShiftJadwal,
  type JadwalSaya,
  type CabangJadwal,
  type ShiftJadwal,
} from "@/lib/schedule-request";
import { ajukanPerubahanJadwal } from "./actions";
export function PerubahanJadwalForm({
  row,
  branches,
  shifts,
}: {
  row: JadwalSaya;
  branches: CabangJadwal[];
  shifts: ShiftJadwal[];
}) {
  const allowed = pilihanCabangJadwal(row, branches);
  const [branch, setBranch] = useState(allowed[0]?.id ?? "");
  const [shift, setShift] = useState("");
  const options = pilihanShiftJadwal(row, shifts, branch);
  const selected = options.find((s) => s.id === shift);
  if (!allowed.length)
    return (
      <p>Penugasan cabang tidak tersedia untuk tanggal ini. Hubungi HR.</p>
    );
  return (
    <form action={ajukanPerubahanJadwal}>
      <input type="hidden" name="schedule_id" value={row.id} />
      <input type="hidden" name="updated_at" value={row.updated_at} />
      <label className="flab" htmlFor={`branch-${row.id}`}>
        Cabang penugasan
      </label>
      <select
        id={`branch-${row.id}`}
        className="fi"
        name="branch_id"
        required
        value={branch}
        onChange={(e) => {
          setBranch(e.currentTarget.value);
          setShift("");
        }}
      >
        {allowed.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <label className="flab" htmlFor={`shift-${row.id}`}>
        Shift yang diminta
      </label>
      <select
        id={`shift-${row.id}`}
        className="fi"
        name="shift_id"
        required
        value={shift}
        onChange={(e) => setShift(e.currentTarget.value)}
      >
        <option value="">Pilih shift lain</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nama} ·{" "}
            {s.is_libur ? "Libur" : jamRingkas(s.jam_masuk, s.jam_pulang)}
          </option>
        ))}
      </select>
      {!options.length && (
        <p>Belum ada shift pengganti yang diizinkan. Hubungi HR.</p>
      )}
      {selected && (
        <p>
          Usulan: {row.shift.nama} →{" "}
          <b>
            {selected.nama} ·{" "}
            {selected.is_libur
              ? "Libur"
              : jamRingkas(selected.jam_masuk, selected.jam_pulang)}
          </b>
          . Berlaku setelah disetujui HR.
        </p>
      )}
      <label className="flab" htmlFor={`reason-${row.id}`}>
        Alasan perubahan
      </label>
      <textarea
        id={`reason-${row.id}`}
        className="fi"
        name="reason"
        required
        minLength={3}
        maxLength={1000}
      />
      <SubmitButton
        className="btn-acc"
        pendingText="Mengajukan…"
        disabled={!selected}
      >
        Ajukan perubahan
      </SubmitButton>
    </form>
  );
}
