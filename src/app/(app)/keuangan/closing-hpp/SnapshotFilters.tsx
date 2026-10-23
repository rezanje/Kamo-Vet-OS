"use client";
import { useState } from "react";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";

export function SnapshotFilters({ branches, selected, snapshots, snapshot }: {
 branches: {id:string;name:string}[]; selected:string[];
 snapshots:{id:string;period:string}[]; snapshot:string;
}) {
 const [value,setValue] = useState(selected);
 return <form method="get" style={{display:"grid",gap:10,marginBottom:14,maxWidth:640}}>
  <label>Periode snapshot tersimpan
   <select name="snapshot" className="fi" defaultValue={snapshot} style={{display:"block",width:"100%"}}>
    {!snapshots.length && <option value="">Belum ada snapshot</option>}
    {snapshots.map(row => <option key={row.id} value={row.id}>{row.period.slice(0,7)}</option>)}
   </select>
  </label>
  <SearchableMultiSelect name="cabang" label="cabang snapshot" options={branches.map(branch=>({id:branch.id,code:branch.id.slice(0,8),name:branch.name}))} value={value} onChange={setValue}/>
  <p style={{fontSize:12,margin:0}}>Tanpa pilihan cabang = semua cabang yang dapat Anda akses. Filter ini hanya mengubah laporan; aktivasi dan closing tetap berlaku global.</p>
  <button className="btn-pri" type="submit" style={{justifySelf:"start"}}>Tampilkan snapshot</button>
 </form>;
}
