"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { masterReturn, type MasterEntity, type MasterView } from "@/lib/master-lifecycle";
export function MasterLifecycleFilter({ entity, view }: { entity: MasterEntity; view: MasterView }) {
  const current = useSearchParams();
  return <nav aria-label="Status master" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
    {([['all','Semua (tanpa Sampah)'],['active','Aktif'],['inactive','Nonaktif'],['trash','Sampah']] as const).map(([value,label]) => {
      const params = new URLSearchParams(current.toString()); params.set("view",value); params.delete("hal"); params.delete("edit");
      return <Link key={value} href={masterReturn(entity,params.toString())} className="btn-def" aria-current={view === value ? "page" : undefined} style={{ fontWeight: view === value ? 700 : 400 }}>{label}</Link>;
    })}
    <span style={{ fontSize: 11, alignSelf: "center" }}>Sampah dapat dipulihkan. Riwayat dipertahankan lewat Nonaktifkan.</span>
  </nav>;
}
