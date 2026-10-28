"use client";

import { useState } from "react";

export type CabangOpsi = { id: string; name: string };
export type GudangOpsi = { id: string; name: string; branch_id: string | null };

/**
 * Cabang menentukan gudang mana yang boleh dipotong. Daftar cabangnya sudah dibatasi
 * penempatan pengguna di server; pilihan gudang ikut cabang yang dipilih supaya tidak ada
 * faktur yang memotong stok cabang lain.
 */
export function CabangGudang({ cabang, gudang }: { cabang: CabangOpsi[]; gudang: GudangOpsi[] }) {
  const [branchId, setBranchId] = useState(cabang.length === 1 ? cabang[0].id : "");
  const pilihan = gudang.filter((g) => g.branch_id === branchId);
  return <>
    <div>
      <label className="flab" htmlFor="faktur-branch">Cabang *</label>
      <select className="fi" id="faktur-branch" name="branch_id" required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
        <option value="">— pilih cabang —</option>
        {cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
    <div>
      <label className="flab" htmlFor="faktur-warehouse">Gudang pengirim *</label>
      <select className="fi" id="faktur-warehouse" name="warehouse_id" required defaultValue="" key={branchId}>
        <option value="">{branchId ? "— pilih gudang —" : "pilih cabang dulu"}</option>
        {pilihan.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {branchId && pilihan.length === 0 && <p style={{ fontSize: 10.5, color: "#b45309" }}>Cabang ini belum punya gudang aktif.</p>}
    </div>
  </>;
}
