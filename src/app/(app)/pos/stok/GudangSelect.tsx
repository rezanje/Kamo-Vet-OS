"use client";

/** Dropdown gudang yang langsung menampilkan stok saat dipilih (form GET). */
export function GudangSelect({ value, options }: { value: string; options: { id: string; label: string }[] }) {
  return (
    <select className="fi" name="wh" aria-label="Pilih gudang" defaultValue={value}
      style={{ flex: "0 1 260px", minWidth: 0 }}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}
