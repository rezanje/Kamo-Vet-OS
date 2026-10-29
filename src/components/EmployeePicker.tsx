"use client";
import { useMemo, useState } from "react";
import { SearchableItemPicker } from "./SearchableItemPicker";

export type PilihanKaryawan = { id: string; nama: string; jabatan?: string | null; branchName?: string | null };

/**
 * Pemilih karyawan yang bisa diketik. Nilai yang dikirim form tetap id karyawan,
 * jadi server action lama tidak perlu berubah. Pencocokan memakai nama, jabatan,
 * dan cabang sekaligus — lihat SearchableItemPicker.
 */
export function EmployeePicker({
  employees, name, inputId, value, defaultValue = "", onChange, required = false,
  placeholder = "Ketik nama, jabatan, atau cabang…", ariaLabel = "Karyawan",
}: {
  employees: PilihanKaryawan[]; name: string; inputId?: string; value?: string; defaultValue?: string;
  onChange?: (id: string) => void; required?: boolean; placeholder?: string; ariaLabel?: string;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const items = useMemo(() => employees.map((row) => ({
    id: row.id,
    name: row.nama,
    code: [row.jabatan, row.branchName].map((text) => (text ?? "").trim()).filter(Boolean).join(" · "),
  })), [employees]);
  return <>
    <input type="hidden" name={name} value={current} />
    <SearchableItemPicker
      items={items} value={current} inputId={inputId} required={required}
      onChange={(id) => { setInternal(id); onChange?.(id); }}
      placeholder={placeholder} ariaLabel={ariaLabel}
      detailLabel={null} requiredMessage="Pilih karyawan dari daftar." />
  </>;
}
