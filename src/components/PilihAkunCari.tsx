"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";

// Pilihan akun (bagan akun) yang bisa diketik/dicari — pengganti <select> panjang.
// Permintaan klinik 12 Nov 2026: "akun bebannya minta akses untuk ketik / cari, kalau scroll makan waktu".
// Nilai yang dikirim tetap kode akun lewat input tersembunyi `name`, jadi server action tidak berubah.
// Ikut draf transaksi: input tersembunyi bertanda data-draft-state dipulihkan lewat event vetos:draft-restore.
export function PilihAkunCari({
  name, akun, required = false, defaultValue = "", ariaLabel = "Akun", placeholder = "Ketik kode / nama akun",
}: {
  name: string; akun: { code: string; name: string }[]; required?: boolean; defaultValue?: string;
  ariaLabel?: string; placeholder?: string;
}) {
  const items = useMemo(() => akun.map((a) => ({ id: a.code, code: a.code, name: a.name })), [akun]);
  const [value, setValue] = useState(defaultValue);
  const hidden = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = hidden.current;
    const form = input?.closest("form");
    if (!input) return;
    const restore = (event: Event) => {
      const code = String((event as CustomEvent<string>).detail ?? "");
      setValue(items.some((i) => i.id === code) ? code : "");
    };
    const reset = (event: Event) => { queueMicrotask(() => { if (!event.defaultPrevented) setValue(defaultValue); }); };
    input.addEventListener("vetos:draft-restore", restore);
    form?.addEventListener("reset", reset);
    return () => { input.removeEventListener("vetos:draft-restore", restore); form?.removeEventListener("reset", reset); };
  }, [items, defaultValue]);

  return (
    <>
      <input ref={hidden} type="hidden" name={name} value={value} data-draft-state="" />
      <SearchableItemPicker
        items={items} value={value} onChange={setValue}
        ariaLabel={ariaLabel} placeholder={placeholder} selectedLabelFormat="code-name"
        required={required} detailLabel="Kode" requiredMessage="Pilih akun dari daftar hasil cari."
      />
    </>
  );
}
