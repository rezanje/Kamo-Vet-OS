"use client";

import { useRef, useState, type FormEvent } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { KonfirmasiJumlah, PetunjukSatuan, SatuanBesar, type ButirKonfirmasi } from "@/components/SatuanHitung";
import { jumlahTakWajar } from "@/lib/opname-jumlah-tak-wajar";
import { fmtQty, fmtSelisih, parseQty, selisih, type InvopItem } from "@/lib/inventaris-operasional";
import { simpanOpnameOperasional } from "../actions";

/** Isi jumlah fisik per barang; selisih tampil langsung dan alasan jadi wajib bila ada selisih. */
export function OpnameForm({ branchId, requestKey, items }: { branchId: string; requestKey: string; items: InvopItem[] }) {
  const [fisik, setFisik] = useState<Record<string, string>>({});
  // Jumlah janggal (mis. 1000 padahal maksudnya 1) wajib dikonfirmasi sebelum opname disimpan.
  const [janggal, setJanggal] = useState<{ butir: ButirKonfirmasi[]; form: HTMLFormElement } | null>(null);
  const lolos = useRef(false);
  const diffs = items.map(i => {
    const n = parseQty(fisik[i.id]);
    return n === null ? null : selisih(i.qty, n);
  });
  const terisi = diffs.filter(d => d !== null).length;
  const beda = diffs.filter(d => d !== null && d !== 0).length;

  const sebelumSimpan = (e: FormEvent<HTMLFormElement>) => {
    if (lolos.current) { lolos.current = false; return; }
    const butir = items.flatMap((i): ButirKonfirmasi[] => {
      const n = parseQty(fisik[i.id]);
      return n !== null && jumlahTakWajar(n, i.qty) ? [{ id: i.id, nama: i.nama, jumlah: n, satuan: i.satuan, sistem: i.qty }] : [];
    });
    if (butir.length === 0) return;
    e.preventDefault();
    setJanggal({ butir, form: e.currentTarget });
  };

  return (
    <form action={simpanOpnameOperasional} onSubmit={sebelumSimpan}>
      <input type="hidden" name="branch_id" value={branchId} />
      <input type="hidden" name="request_key" value={requestKey} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 760 }}>
          <thead>
            <tr><th>Nama Barang</th><th style={{ textAlign: "right" }}>Tercatat</th><th style={{ width: 200 }}>Jumlah Fisik &amp; satuan</th>
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
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{fmtQty(i.qty)} {i.satuan}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                      <PetunjukSatuan unit={i.satuan} htmlFor={`fisik-${i.id}`} />
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <NumberInput className="fi" name={`fisik_${i.id}`} id={`fisik-${i.id}`} type="number" min={0} step="0.01" required
                          aria-label={`Jumlah fisik ${i.nama}${i.satuan ? ` (${i.satuan})` : ""}`} value={fisik[i.id] ?? ""} onChange={e => setFisik(s => ({ ...s, [i.id]: e.target.value }))}
                          style={{ width: 110, fontSize: 15, fontWeight: 700 }} />
                        <SatuanBesar unit={i.satuan} />
                      </div>
                    </div>
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
      {janggal && (
        <KonfirmasiJumlah
          butir={janggal.butir}
          onBatal={() => { const id = janggal.butir[0].id; setJanggal(null); setTimeout(() => document.getElementById(`fisik-${id}`)?.focus(), 0); }}
          onYa={() => { const form = janggal.form; setJanggal(null); lolos.current = true; form.requestSubmit(); }}
        />
      )}
    </form>
  );
}
