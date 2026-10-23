"use client";

import { useMemo, useState, useTransition } from "react";
import {buildTree,flatOptions,labelPath,type KategoriRow} from "@/lib/kategori";
import { filterBahanRacikan } from "@/lib/bahan-racikan";
import { setBahanBaku, setBahanBakuBanyak } from "./actions";

export type ItemRow = { id: string; code: string; name: string; kategori: string; category_id: string | null; sell_price: number; is_compound_material: boolean };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function BahanBakuClient({ items, categories }: { items: ItemRow[]; categories: KategoriRow[] }) {
  const [q, setQ] = useState("");
  const [kategori, setKategori] = useState("__selected__");
  const [child,setChild] = useState("");
  // Overlay only this server snapshot. Refreshed props discard obsolete labels,
  // associations and flags; late action responses cannot overwrite a new snapshot.
  const [local,setLocal] = useState({source:items,values:{} as Record<string,boolean>});
  const rows = useMemo(() => items.map(row => ({...row,is_compound_material:
    local.source === items ? local.values[row.id] ?? row.is_compound_material : row.is_compound_material})),[items,local]);
  const apply = (values:Record<string,boolean>,rollback=false) => setLocal(current =>
    rollback && current.source !== items ? current : {source:items,values:{...(current.source === items ? current.values : {}),...values}});
  const [notice,setNotice] = useState({source:items,text:""});
  const message = notice.source === items ? notice.text : "";
  const setMessage = (text:string) => setNotice({source:items,text});
  const [pending, start] = useTransition();

  const tree = useMemo(() => {
    const active = new Set(flatOptions(categories).map(row => row.id));
    return buildTree(categories.filter(row => active.has(row.id)));
  },[categories]);
  const group = tree.find(row => row.induk.id === kategori);
  const parent = kategori === "" || kategori === "__selected__" || group ? kategori : "__selected__";
  const selectedChild = group?.anak.find(row => row.id === child)?.id ?? "";
  const categoryIds = group ? selectedChild ? [selectedChild] : [group.induk.id,...group.anak.map(row => row.id)] : undefined;
  const shown = filterBahanRacikan(rows,{q,kategori:parent === "__selected__" ? parent : "",categoryIds});

  const toggle = (id: string, value: boolean) => {
    setMessage("");
    const before = rows.find(row => row.id === id)?.is_compound_material ?? !value;
    apply({[id]:value});
    start(async () => {
      const res = await setBahanBaku(id, value);
      if (!res.ok) {
        apply({[id]:before},true);
        setMessage(res.error);
      }
    });
  };

  const setSemuaTerlihat = (value: boolean) => {
    const ids = shown.map((row) => row.id);
    if (ids.length === 0) return;
    const before = new Map(rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row.is_compound_material]));
    setMessage("");
    apply(Object.fromEntries(ids.map(id => [id,value])));
    start(async () => {
      const res = await setBahanBakuBanyak(ids, value);
      if (!res.ok) {
        apply(Object.fromEntries(before),true);
        setMessage(res.error);
        return;
      }
      setMessage(`${res.updated} barang berhasil ${value ? "dipilih" : "dilepas"}.`);
    });
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{width:220,maxWidth:"100%"}}>
          <label className="flab" htmlFor="material-parent">Kategori induk</label>
          <select id="material-parent" aria-label="Kategori induk" className="fi" value={parent} onChange={e => {setKategori(e.target.value);setChild("");setQ("");}} style={{width:"100%"}}>
            <option value="__selected__">Bahan yang sudah dipilih</option>
            <option value="">Semua barang Persediaan aktif</option>
            {tree.map(({induk}) => <option key={induk.id} value={induk.id}>{induk.name}</option>)}
          </select>
        </div>
        <div style={{width:230,maxWidth:"100%"}}>
          <label className="flab" htmlFor="material-child">Subkategori</label>
          <select id="material-child" aria-label="Subkategori" className="fi" value={selectedChild} disabled={!group?.anak.length} onChange={e => {setChild(e.target.value);setQ("");}} style={{width:"100%"}}>
            <option value="">Semua subkategori</option>
            {(group?.anak ?? []).map(row => <option key={row.id} value={row.id}>{labelPath(row.id,categories).split(" › ").slice(1).join(" › ")}</option>)}
          </select>
        </div>
        <div style={{ position: "relative", width: 280, maxWidth: "100%" }}>
          <input className="fi" aria-label="Cari bahan baku" placeholder="Cari nama / kode barang..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingRight: 28 }} />
          <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
        </div>
        {group && (
          <button type="button" className="btn-acc" disabled={pending || shown.length === 0} onClick={() => setSemuaTerlihat(true)}>
            <i className="ti ti-checks" /> Pilih semua hasil ({shown.length})
          </button>
        )}
        {parent === "__selected__" && shown.length > 0 && (
          <button type="button" className="btn-def" disabled={pending} onClick={() => setSemuaTerlihat(false)}>
            Lepas semua hasil ({shown.length})
          </button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: message.includes("berhasil") ? "#15803d" : message ? "#dc2626" : "var(--tm)", marginBottom: 10 }}>
        {message || (parent === "__selected__" ? "Daftar awal hanya menampilkan bahan yang sudah dipilih; kategori historis tetap ditampilkan tanpa mengubah asosiasinya." : "Pilihan kategori mengikuti master aktif. Pilih semua hanya berlaku untuk kategori dan pencarian yang tampil; jenis barang tetap Persediaan aktif.")}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead><tr><th>Kode</th><th>Nama Barang</th><th>Kategori</th><th style={{ textAlign: "right" }}>Harga Jual</th><th style={{ textAlign: "center" }}>Bahan Baku Racikan</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{r.code}</td>
                <td style={{ fontSize: 11.5, fontWeight: 500 }}>{r.name}</td>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.kategori}</td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.sell_price)}</td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" aria-label={`Bahan baku ${r.code} · ${r.name}`} checked={r.is_compound_material} disabled={pending}
                    onChange={(e) => toggle(r.id, e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Barang tidak ditemukan.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
