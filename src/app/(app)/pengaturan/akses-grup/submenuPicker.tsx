"use client";
import { useEffect, useRef, useState } from "react";
import { selectableSubmenus, submenuLabel, submenuTileLabels } from "@/lib/submenu-access";

/**
 * Daftar sub-menu satu modul (bisa dibuka-tutup). Kotak centang tetap input biasa (tidak dikendalikan React)
 * supaya mekanisme draf formulir yang sudah ada tetap memulihkannya; hitungan dibaca ulang dari DOM.
 * `subs_<modul>` menandai bahwa bagian ini tampil, sehingga "semua dikosongkan" tidak tertukar dengan "tidak ada".
 */
export function SubmenuPicker({ moduleId, moduleLabel, allowed, moduleChecked }: { moduleId: string; moduleLabel: string; allowed: string[] | undefined; moduleChecked: boolean }) {
  const entries = selectableSubmenus(moduleId);
  const ref = useRef<HTMLDetailsElement>(null);
  const initial = allowed === undefined ? entries.length : entries.filter(e => allowed.includes(e.id)).length;
  const [view, setView] = useState({ checked: initial, moduleOn: moduleChecked });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scope = el.closest("fieldset") ?? el.ownerDocument;
    const recalc = () => setView({
      checked: el.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name^="sub_"]:checked').length,
      moduleOn: !!scope.querySelector<HTMLInputElement>(`input[name="mod_${moduleId}"]`)?.checked,
    });
    scope.addEventListener("change", recalc);
    scope.addEventListener("input", recalc);
    // pemulihan draf bisa mengatur centang setelah render pertama
    const timers = [window.setTimeout(recalc, 0), window.setTimeout(recalc, 400)];
    return () => { scope.removeEventListener("change", recalc); scope.removeEventListener("input", recalc); timers.forEach(window.clearTimeout); };
  }, [moduleId]);

  const setAll = (value: boolean) => {
    const boxes = ref.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name^="sub_"]') ?? [];
    boxes.forEach(box => {
      if (box.checked === value) return;
      box.checked = value;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const total = entries.length;
  return (
    <details ref={ref} data-submenu-module={moduleId} style={{ margin: "2px 0 6px 22px" }}>
      <summary>{moduleLabel}: {view.checked} dari {total} sub-menu{view.checked === total ? " (semua)" : ""}</summary>
      <input type="hidden" name={`subs_${moduleId}`} value="1" />
      <div style={{ margin: "4px 0" }}>
        <button type="button" className="btn-def" onClick={() => setAll(true)}>Pilih semua</button>{" "}
        <button type="button" className="btn-def" onClick={() => setAll(false)}>Kosongkan</button>
      </div>
      {!view.moduleOn && <p role="note">Modul ini belum dicentang di atas, jadi semua sub-menunya belum bisa dibuka.</p>}
      {view.moduleOn && view.checked === 0 && <p role="alert" style={{ color: "#b91c1c" }}>Modul dicentang tetapi semua sub-menunya kosong: modul ini dianggap tidak bisa dibuka dan hilang dari menu.</p>}
      {entries.map(e => {
        const also = submenuTileLabels(e.id).filter(l => l !== submenuLabel(e.id));
        return <label key={e.id} style={{ display: "block" }}>
          <input type="checkbox" name={`sub_${e.id}`} defaultChecked={allowed === undefined || allowed.includes(e.id)} /> {submenuLabel(e.id)}
          {also.length > 0 && <small style={{ color: "#6b7280" }}> — juga membuka: {also.join(", ")}</small>}
        </label>;
      })}
    </details>
  );
}
