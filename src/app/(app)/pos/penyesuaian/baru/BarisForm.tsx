"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export type BarangStok = { item_id: string; code: string; nama: string; unit: string; qty: number };

const fmt = (n: number) => n.toLocaleString("id-ID");

// Hanya barang yang jumlah barunya diisi yang ikut terkirim — sisanya tidak
// tersentuh sama sekali. Ini yang membedakan penyesuaian dari stok opname:
// dokumen ini menyasar beberapa barang tertentu, bukan seluruh rak.
export function BarisForm({ barang }: { barang: BarangStok[] }) {
  const [cari, setCari] = useState("");
  const [isi, setIsi] = useState<Record<string, string>>({});

  const tampil = useMemo(() => {
    const s = cari.trim().toLowerCase();
    if (!s) return barang;
    return barang.filter((b) => b.nama.toLowerCase().includes(s) || b.code.toLowerCase().includes(s));
  }, [barang, cari]);

  const terisi = useMemo(
    () =>
      barang
        .map((b) => ({ b, v: isi[b.item_id] }))
        .filter(({ v }) => v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0)
        .map(({ b, v }) => ({ item_id: b.item_id, qty_baru: Number(v), selisih: Number(v) - b.qty, nama: b.nama })),
    [barang, isi],
  );
  const berubah = terisi.filter((t) => t.selisih !== 0);

  return (
    <>
      <input type="hidden" name="baris" value={JSON.stringify(berubah.map(({ item_id, qty_baru }) => ({ item_id, qty_baru })))} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <input className="fi" placeholder="Cari nama / kode barang…" value={cari}
          onChange={(e) => setCari(e.target.value)} style={{ width: 260, fontSize: 11.5 }} />
        <span style={{ fontSize: 11, color: berubah.length ? "#b45309" : "var(--td)" }}>
          {berubah.length ? `${berubah.length} barang berubah` : "Belum ada yang diubah"}
        </span>
      </div>

      <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
        <table className="tbl" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Kode</th><th>Nama Barang</th>
              <th style={{ textAlign: "right", width: 90 }}>Stok sistem</th>
              <th style={{ width: 130 }}>Jumlah baru</th>
              <th style={{ textAlign: "right", width: 80 }}>Selisih</th>
              <th style={{ width: 60 }}>Satuan</th>
            </tr>
          </thead>
          <tbody>
            {tampil.map((b) => {
              const v = isi[b.item_id];
              const ada = v !== undefined && v !== "";
              const selisih = ada ? Number(v) - b.qty : 0;
              return (
                <tr key={b.item_id} style={ada && selisih !== 0 ? { background: "#fffbeb" } : undefined}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{b.code}</td>
                  <td style={{ fontSize: 11.5 }}>{b.nama}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{fmt(b.qty)}</td>
                  <td>
                    <input className="fi" type="number" min={0} step="any" placeholder="—"
                      value={v ?? ""} style={{ fontSize: 11.5, padding: "4px 8px", textAlign: "right" }}
                      onChange={(e) => setIsi((s) => ({ ...s, [b.item_id]: e.target.value }))} />
                  </td>
                  <td style={{
                    textAlign: "right", fontSize: 11.5, fontWeight: 600,
                    color: !ada || selisih === 0 ? "var(--td)" : selisih > 0 ? "#15803d" : "#b91c1c",
                  }}>
                    {ada && selisih !== 0 ? `${selisih > 0 ? "+" : ""}${fmt(selisih)}` : "—"}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{b.unit}</td>
                </tr>
              );
            })}
            {tampil.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                Tidak ada barang yang cocok.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" disabled={berubah.length === 0}>
          Simpan penyesuaian
        </SubmitButton>
      </div>
    </>
  );
}
