"use client";
import { useState } from "react";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";

export function HistoricalFilters({ asOf, branches, selected }: {
  asOf: string; branches: { id: string; name: string }[]; selected: string[];
}) {
  const [branchIds, setBranchIds] = useState(selected);
  return <form method="get" className="crm-sec" style={{ display: "grid", gap: 10, marginBottom: 14, maxWidth: 680 }}>
    <label>Tanggal posisi akhir hari (WIB)<input className="fi" type="date" name="tanggal" defaultValue={asOf} required style={{ display: "block" }} /></label>
    <SearchableMultiSelect name="cabang" label="cabang valuasi historis" options={branches.map(branch => ({ id: branch.id, code: branch.id.slice(0, 8), name: branch.name }))} value={branchIds} onChange={setBranchIds} />
    <p style={{ fontSize: 12, margin: 0 }}>Tanpa pilihan cabang = semua cabang yang dapat Anda akses. Atribusi cabang mengikuti gudang saat laporan dibaca.</p>
    <button className="btn-pri" type="submit" style={{ justifySelf: "start" }}>Tampilkan nilai historis</button>
  </form>;
}
