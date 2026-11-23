"use client";

import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtQty, fmtSelisih, parseQty, selisih, type InvopItem } from "@/lib/inventaris-operasional";
import { simpanOpnameOperasional } from "../actions";

/** Isi jumlah fisik per barang; selisih tampil langsung dan alasan jadi wajib bila ada selisih. */
export function OpnameForm({ branchId, requestKey, items }: { branchId: string; requestKey: string; items: InvopItem[] }) {
  const [fisik, setFisik] = useState<Record<string, string>>({});
  const diffs = items.map(i => {
    const n = parseQty(fisik[i.id]);
    return n === null ? null : selisih(i.qty, n);
  });
  const terisi = diffs.filter(d => d !== null).length;
  const beda = diffs.filter(d => d !== null && d !== 0).length;

  return (
    <form action={simpanOpnameOperasional}>
      <input type="hidden" name="branch_id" value={branchId} />
      <input type="hidden" name="request_key" value={requestKey} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 760 }}>
          <thead>
            <tr><th>Nama Barang</th><th>Satuan</th><th style={{ textAlign: "right" }}>Tercatat</th><th style={{ width: 120 }}>Jumlah Fisik</th>
              <th style={{ textAlign: "right" }}>Selisih</th><th>Alasan Selisih</th></tr>
          </thead>
          <tbody>
            {items.map((i, idx) => {
              const d = diffs[idx];
              return (
                <tr key={i.id}>
                  <td style={{ fontWeight: 500, fontSize: 11.5 }}>
                    {i.nama}
                    <input type="hidden" name="item_id" value={i.id} />
                    <input type="hidden" name="revision" value={i.revision} />
                  </td>
                  <td style={{ fontSize: 11.5 }}>{i.satuan}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{fmtQty(i.qty)}</td>
                  <td>
                    <NumberInput className="fi" name={`fisik_${i.id}`} type="number" min={0} step="0.01" required
                      aria-label={`Jumlah fisik ${i.nama}`} value={fisik[i.id] ?? ""} onChange={e => setFisik(s => ({ ...s, [i.id]: e.target.value }))}
                      style={{ width: 100 }} />
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: d === null ? "var(--td)" : d === 0 ? "#15803d" : "#b91c1c" }}>
                    {d === null ? "—" : d === 0 ? "Sesuai" : fmtSelisih(d)}
                  </td>
                  <td>
                    <input className="fi" name={`alasan_${i.id}`} maxLength={500} aria-label={`Alasan selisih ${i.nama}`}
                      required={d !== null && d !== 0} minLength={d !== null && d !== 0 ? 3 : undefined} disabled={d === 0}
                      placeholder={d !== null && d !== 0 ? "Wajib: mis. rusak, hilang, baru dibeli" : ""} style={{ width: "100%", minWidth: 200 }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
        <label style={{ fontSize: 11, flex: 1, minWidth: 240 }}>Catatan (opsional)
          <input className="fi" name="catatan" maxLength={500} style={{ display: "block", width: "100%" }} />
        </label>
        <span style={{ fontSize: 11, color: "var(--tm)" }}>{terisi}/{items.length} dihitung · {beda} selisih</span>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan opname…" disabled={terisi !== items.length}>
          Simpan Opname
        </SubmitButton>
      </div>
    </form>
  );
}
