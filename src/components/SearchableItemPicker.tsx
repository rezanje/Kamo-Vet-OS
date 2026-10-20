"use client";

import { useId, useMemo, useState } from "react";

export type SearchableItem = { id: string; code: string; name: string };

export function SearchableItemPicker({ items, value, onChange, placeholder = "Cari kode / nama barang", ariaLabel = "Barang" }: {
  items: SearchableItem[]; value: string; onChange: (id: string) => void; placeholder?: string; ariaLabel?: string;
}) {
  const selected = items.find((item) => item.id === value);
  const selectedLabel = selected ? `${selected.code} · ${selected.name}` : "";
  const [queryOverride, setQueryOverride] = useState<{ value: string; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listId = useId();
  const query = queryOverride?.value === value ? queryOverride.text : selectedLabel;
  const hits = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (search ? items.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(search)) : items).slice(0, 50);
  }, [items, query]);
  const choose = (item: SearchableItem) => { onChange(item.id); setQueryOverride({ value: item.id, text: `${item.code} · ${item.name}` }); setOpen(false); };

  return (
    <div style={{ position: "relative" }}>
      <input className="fi" value={query} placeholder={placeholder} aria-label={ariaLabel} role="combobox"
        aria-autocomplete="list" aria-expanded={open && hits.length > 0} aria-controls={listId}
        aria-activedescendant={open && hits[highlighted] ? `${listId}-option-${highlighted}` : undefined}
        onFocus={() => { setOpen(true); }}
        onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) { setOpen(false); setQueryOverride(null); } }}
        onChange={(event) => { setQueryOverride({ value, text: event.target.value }); setHighlighted(-1); setOpen(true); if (!event.target.value.trim()) onChange(""); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); setQueryOverride(null); setHighlighted(-1); }
          else if (event.key === "ArrowDown" && hits.length) { event.preventDefault(); setOpen(true); setHighlighted((i) => i < 0 ? 0 : Math.min(i + 1, hits.length - 1)); }
          else if (event.key === "ArrowUp" && hits.length) { event.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)); }
          else if (event.key === "Enter" && open) { event.preventDefault(); if (hits[highlighted]) choose(hits[highlighted]); }
        }}
      />
      {open && hits.length > 0 && (
        <div id={listId} role="listbox" style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, maxHeight: 220, overflowY: "auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 5, boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}>
          {hits.map((item, index) => (
            <button id={`${listId}-option-${index}`} type="button" role="option" aria-selected={item.id === value} tabIndex={-1} key={item.id}
              onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}
              style={{ display: "block", width: "100%", border: 0, borderBottom: ".5px solid var(--bd)", background: index === highlighted ? "var(--sf1, #f3f4f6)" : "#fff", padding: "6px 9px", textAlign: "left", cursor: "pointer", fontSize: 11 }}>
              {item.code} · {item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
