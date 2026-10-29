"use client";

import { useId } from "react";
import { VALUATION_POLICY_OPTIONS, type InitialStockValuationPolicy } from "@/lib/initial-stock-valuation-policy";

/** Pilihan pembulatan nilai uang selalu terlihat; default mengikuti keputusan pemilik 29 Okt. */
export function ValuationPolicyChoice({ value, onChange, disabled = false }: {
  value: InitialStockValuationPolicy;
  onChange: (policy: InitialStockValuationPolicy) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return <fieldset style={{ marginTop: 10, border: ".5px solid var(--bd)", borderRadius: 8, padding: "8px 10px", fontSize: 11 }}>
    <legend style={{ fontWeight: 700 }}>Pembulatan nilai uang</legend>
    {VALUATION_POLICY_OPTIONS.map(option => <label key={option.value} style={{ display: "block", marginTop: 4 }}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled}
        onChange={() => onChange(option.value)} /> {option.label}
      <span style={{ display: "block", marginLeft: 20, color: "var(--tm)", fontSize: 10 }}>{option.hint}</span>
    </label>)}
    <span style={{ display: "block", marginTop: 4, color: "var(--tm)", fontSize: 10 }}>Jumlah stok tidak pernah dibulatkan. File tidak perlu diedit.</span>
  </fieldset>;
}
