"use client";

import { useState, type ComponentPropsWithRef } from "react";
import { NumberInput } from "./NumberInput";

type Props = Omit<ComponentPropsWithRef<"input">, "value" | "onChange" | "type"> & {
  value: number;
  /** Dipanggil hanya dengan angka yang sah (>= min). */
  onValue: (value: number) => void;
};

/** Isian jumlah yang menahan apa yang diketik. Kosong boleh selama mengetik
 * (tidak berubah jadi "0" lalu "02"); angka di bawah minimum tidak dikirim;
 * saat ditinggal kosong/tidak sah, kembali ke nilai terakhir yang sah. */
export function QtyInput({ value, onValue, min, onBlur, ...props }: Props) {
  const minimum = Number(min ?? 0);
  const [text, setText] = useState<string | null>(null);
  const sah = (n: number) => Number.isFinite(n) && (min === undefined ? n >= 0 : n >= minimum);
  // Selama mengetik pakai teks lokal; bila nilai dari luar berubah, ikuti nilai itu.
  const shown = text !== null && (text === "" || !sah(Number(text)) || Number(text) === value) ? text : String(value);
  return <NumberInput {...props} type="number" min={min} value={shown}
    onChange={(event) => {
      const raw = event.target.value;
      setText(raw);
      const n = Number(raw);
      if (raw !== "" && sah(n)) onValue(n);
    }}
    onBlur={(event) => { setText(null); onBlur?.(event); }} />;
}
