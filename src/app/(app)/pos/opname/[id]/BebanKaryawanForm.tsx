"use client";
// F2: form bagi beban selisih kurang opname ke karyawan. Server dan database memeriksa ulang semuanya.
import { useMemo, useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { bacaRupiah, bagiRata, rupiah, ALASAN_BEBAN_MAKS, MAKS_KARYAWAN } from "@/lib/beban-selisih-karyawan";
import { catatBebanKaryawan } from "./beban-karyawan-actions";

type Karyawan = { id: string; nama: string; jabatan: string | null };
type Baris = { employee_id: string; amount: string };

// Nilai mentah (titik desimal) untuk NumberInput; tampilan ribuan diurus NumberInput.
const tampil = (n: number) => String(Math.round(n * 100) / 100);

export function BebanKaryawanForm({ orderId, resultId, total, requestKey, karyawan }: {
  orderId: string; resultId: string; total: number; requestKey: string; karyawan: Karyawan[];
}) {
  const [baris, setBaris] = useState<Baris[]>([{ employee_id: "", amount: tampil(total) }]);
  const jumlah = useMemo(() => baris.reduce((a, b) => a + Math.round((bacaRupiah(b.amount) ?? 0) * 100), 0) / 100, [baris]);
  const pas = Math.round(jumlah * 100) === Math.round(total * 100) && baris.every((b) => b.employee_id && (bacaRupiah(b.amount) ?? 0) > 0);
  const ubah = (i: number, patch: Partial<Baris>) => setBaris((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const rata = (rows: Baris[]) => { const nilai = bagiRata(total, rows.length); return rows.map((r, i) => ({ ...r, amount: tampil(nilai[i] ?? 0) })); };
  const json = JSON.stringify(baris.map((b) => ({ employee_id: b.employee_id, amount: bacaRupiah(b.amount) })));

  return (
    <form action={catatBebanKaryawan} style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 10 }}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="result_id" value={resultId} />
      <input type="hidden" name="request_key" value={requestKey} />
      <input type="hidden" name="total" value={String(total)} />
      <input type="hidden" name="baris" value={json} />
      <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Bebankan ke karyawan · {rupiah(total)}</div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>
        Dicatat sebagai kasbon karyawan dan tampil di HRIS. Tidak dipotong gaji otomatis. Bila dibagi beberapa orang, totalnya harus pas.
      </div>
      {baris.map((b, i) => (
        <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          <select className="fi" aria-label={`Karyawan ${i + 1}`} value={b.employee_id} onChange={(e) => ubah(i, { employee_id: e.target.value })} style={{ minWidth: 220 }}>
            <option value="">Pilih karyawan…</option>
            {karyawan.map((k) => (
              <option key={k.id} value={k.id} disabled={baris.some((x, j) => j !== i && x.employee_id === k.id)}>
                {k.nama}{k.jabatan ? ` · ${k.jabatan}` : ""}
              </option>
            ))}
          </select>
          <NumberInput className="fi" aria-label={`Jumlah ${i + 1}`} type="number" min="0" step="0.01" value={b.amount} onChange={(e) => ubah(i, { amount: e.target.value })} style={{ width: 140, textAlign: "right" }} />
          {baris.length > 1 && <button type="button" className="btn" onClick={() => setBaris((rows) => rata(rows.filter((_, j) => j !== i)))}>Hapus</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        {baris.length < MAKS_KARYAWAN && <button type="button" className="btn" onClick={() => setBaris((rows) => rata([...rows, { employee_id: "", amount: "0" }]))}>+ Tambah karyawan</button>}
        <button type="button" className="btn" onClick={() => setBaris((rows) => rata(rows))}>Bagi rata</button>
        <span style={{ fontSize: 11, color: pas ? "#15803d" : "#b91c1c" }}>Jumlah {rupiah(jumlah)} dari {rupiah(total)}</span>
      </div>
      <textarea className="fi" name="alasan" required minLength={3} maxLength={ALASAN_BEBAN_MAKS} placeholder="Alasan (wajib), mis. barang hilang di rak depan" style={{ width: "100%", minHeight: 48 }} />
      <button className="btn bp" type="submit" disabled={!pas} style={{ marginTop: 8 }}>Catat sebagai kasbon karyawan</button>
    </form>
  );
}
