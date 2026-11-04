"use client";
import { useEffect, useId, useMemo, useState } from "react";
import type { PaketItemInfo, PaketItemRef } from "@/lib/promo-paket";
import s from "./PaketEditor.module.css";

const SHOWN = 8;

/**
 * Pemilih barang ringkas untuk satu baris Syarat / Hasil: cari → klik (atau Enter) untuk menambah, satuan per barang,
 * beberapa barang/varian dicampur dalam satu kumpulan. "Tambah semua hasil" memasukkan semua hasil pencarian sekaligus
 * (mis. ketik "bolt" → semua varian Bolt), dibatasi maksimum kumpulan.
 * Papan ketik: ↓/↑ menyorot hasil (aria-activedescendant, berputar), Enter menambah yang disorot (tanpa sorotan: yang pertama), Esc menutup.
 */
export function PaketItemPicker({ label, items, value, onChange, max, disabled = false }: {
  label: string; items: readonly PaketItemInfo[]; value: PaketItemRef[]; onChange: (next: PaketItemRef[]) => void; max: number; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [active, setActive] = useState(-1);
  const listId = useId();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const taken = useMemo(() => new Set(value.map((v) => `${v.item_id}|${v.unit}`)), [value]);
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => i.active && `${i.code} ${i.name}`.toLowerCase().includes(q) && !taken.has(`${i.id}|${i.units[0]}`));
  }, [items, query, taken]);

  const shown = Math.min(hits.length, SHOWN);
  const optId = (idx: number) => `${listId}-opt-${idx}`;
  useEffect(() => { if (active >= 0) document.getElementById(optId(active))?.scrollIntoView?.({ block: "nearest" }); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (list: PaketItemInfo[]) => {
    const room = max - value.length;
    const next = [...value, ...list.slice(0, Math.max(0, room)).map((i) => ({ item_id: i.id, unit: i.units[0] }))];
    setNote(list.length > room ? `Dibatasi maksimal ${max} barang; ${list.length - Math.max(0, room)} barang tidak ikut ditambahkan.` : "");
    onChange(next);
    setQuery(""); setActive(-1);
  };

  return (
    <div className={s.picker}>
      <div className={s.search}>
        <input className="fi" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={hits.length > 0} aria-controls={listId} aria-activedescendant={hits.length > 0 && active >= 0 && active < shown ? optId(active) : undefined} aria-label={`Cari barang ${label}`} placeholder="Cari kode / nama barang, Enter = tambah yang pertama" value={query} disabled={disabled}
          onChange={(e) => { setQuery(e.target.value); setNote(""); setActive(-1); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && shown > 0) { e.preventDefault(); setActive((a) => (a + 1) % shown); }
            else if (e.key === "ArrowUp" && shown > 0) { e.preventDefault(); setActive((a) => (a <= 0 ? shown - 1 : a - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); const pick = hits[active >= 0 && active < shown ? active : 0]; if (pick) add([pick]); }
            else if (e.key === "Escape") { setQuery(""); setActive(-1); }
          }} />
        {hits.length > 1 && <button type="button" className="btn-def" disabled={disabled} onClick={() => add(hits)}>Tambah semua hasil ({hits.length})</button>}
      </div>
      {hits.length > 0 && (
        <div id={listId} className={s.hits} role="listbox" aria-label={`Hasil pencarian ${label}`}>
          {hits.slice(0, SHOWN).map((i, idx) => (
            <button key={i.id} id={optId(idx)} type="button" role="option" tabIndex={-1} aria-selected={idx === active} className={s.hit} onMouseDown={(e) => e.preventDefault()} onClick={() => add([i])}>
              <span>{i.name}</span><small>{i.code} · {i.units[0]}</small>
            </button>
          ))}
          {hits.length > SHOWN && <div className={s.hint} style={{ padding: "3px 8px" }}>+{hits.length - SHOWN} lagi — persempit pencarian atau pakai “Tambah semua hasil”.</div>}
        </div>
      )}
      {note && <div role="status" className={s.hint} style={{ color: "#92400e" }}>{note}</div>}
      <div className={s.hint} aria-live="polite" style={{ marginTop: 3 }}>{value.length} barang dipilih (maks. {max}){value.length > 1 ? " — dihitung bersama (campur varian)" : ""}</div>
      {value.length > 0 && (
        <div className={s.pickedWrap}>
          <table className={s.picked} aria-label={`Barang terpilih ${label}`}>
            <thead><tr><th>Kode</th><th>Nama barang</th><th>Satuan</th><th /></tr></thead>
            <tbody>
              {value.map((v, idx) => {
                const info = byId.get(v.item_id);
                return (
                  <tr key={`${v.item_id}|${v.unit}|${idx}`}>
                    <td>{info?.code ?? "—"}</td>
                    <td>{info?.name ?? "Barang tidak tersedia"}</td>
                    <td>
                      <select className="fi" aria-label={`Satuan ${info?.name ?? "barang"}`} value={v.unit} disabled={disabled} onChange={(e) => onChange(value.map((x, j) => (j === idx ? { ...x, unit: e.target.value } : x)))}>
                        {[...new Set([...(info?.units ?? []), v.unit])].map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td><button type="button" className="btn-def" aria-label={`Buang ${info?.name ?? "barang"}`} disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== idx))} style={{ padding: "0 7px" }}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
