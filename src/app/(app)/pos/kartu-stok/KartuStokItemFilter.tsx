"use client";

import { useId, useState } from "react";
import { SearchableItemPicker, type SearchableItem } from "@/components/SearchableItemPicker";

export function KartuStokItemFilter({ items, initialItemId }: { items: SearchableItem[]; initialItemId: string }) {
  const [itemId, setItemId] = useState(initialItemId);
  const selected = items.find((item) => item.id === itemId);
  const id = useId();

  return (
    <>
      <input type="hidden" name="item" value={itemId} />
      <div style={{ width: 150 }}>
        <label className="flab" htmlFor={`${id}-code`}>Kode Barang</label>
        <input id={`${id}-code`} className="fi" aria-label="Kode Barang" value={selected?.code ?? ""} readOnly placeholder="Otomatis" />
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <label className="flab" htmlFor={`${id}-name`}>Nama Item *</label>
        <SearchableItemPicker items={items} value={itemId} onChange={setItemId} inputId={`${id}-name`}
          ariaLabel="Nama Item" placeholder="Ketik nama item / kode barang" selectedLabelFormat="name" />
      </div>
    </>
  );
}
