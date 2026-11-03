"use client";

import { useEffect, useRef } from "react";

/**
 * Menyelaraskan Preset dengan kolom tanggal di form filter Operation & Sales.
 * - Tanggal diubah manual → preset otomatis "Rentang custom" (dulu tetap
 *   "Bulan berjalan" sehingga tanggal pilihan user diabaikan server).
 * - Preset diganti ke "Hari ini"/"Bulan berjalan" → tanggal ikut terisi.
 * Input tetap elemen native agar konfigurasi tersimpan tetap membaca nilainya.
 */
export function PeriodPresetSync({ today }: { today: string }) {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const preset = form.querySelector<HTMLSelectElement>('select[name="preset"]');
    const from = form.querySelector<HTMLInputElement>('input[name="from"]');
    const to = form.querySelector<HTMLInputElement>('input[name="to"]');
    if (!preset || !from || !to) return;

    const onDate = () => {
      if (preset.value !== "custom") preset.value = "custom";
    };
    const onPreset = () => {
      if (preset.value === "today") {
        from.value = today;
        to.value = today;
      } else if (preset.value === "mtd") {
        from.value = `${today.slice(0, 7)}-01`;
        to.value = today;
      }
    };
    from.addEventListener("change", onDate);
    to.addEventListener("change", onDate);
    from.addEventListener("input", onDate);
    to.addEventListener("input", onDate);
    preset.addEventListener("change", onPreset);
    return () => {
      from.removeEventListener("change", onDate);
      to.removeEventListener("change", onDate);
      from.removeEventListener("input", onDate);
      to.removeEventListener("input", onDate);
      preset.removeEventListener("change", onPreset);
    };
  }, [today]);

  return <span ref={anchor} hidden aria-hidden="true" />;
}
