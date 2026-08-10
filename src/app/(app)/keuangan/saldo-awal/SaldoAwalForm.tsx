"use client";

import { useMemo, useState } from "react";
import { simpanSaldoAwal } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

type Akun = { code: string; name: string; type: string; normal: string };
type Usulan = { code: string; nama: string; sisi: "D" | "K"; nyata: number; buku: number; selisih: number; sumber: string };
type Baris = { code: string; nilai: string; sisi: "D" | "K" };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Akun yang boleh diisi manual: harta & utang. Pendapatan/beban TIDAK — saldo awal
// adalah posisi harta, bukan riwayat laba rugi (itu sudah lebur jadi modal).
const TIPE_BOLEH = ["ASET", "LIABILITAS", "EKUITAS"];

export function SaldoAwalForm({ akun, usulan }: { akun: Akun[]; usulan: Usulan[] }) {
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [baris, setBaris] = useState<Baris[]>(
    usulan.length > 0
      ? usulan.map((u) => ({ code: u.code, nilai: String(u.selisih), sisi: u.sisi }))
      : [{ code: "", nilai: "", sisi: "D" }],
  );

  const pilihan = akun.filter((a) => TIPE_BOLEH.includes(a.type));
  const set = (i: number, patch: Partial<Baris>) =>
    setBaris((bs) => bs.map((b, x) => (x === i ? { ...b, ...patch } : b)));
  const tambah = () => setBaris((bs) => [...bs, { code: "", nilai: "", sisi: "D" }]);
  const hapus = (i: number) => setBaris((bs) => (bs.length > 1 ? bs.filter((_, x) => x !== i) : bs));

  const nilaiDari = (b: Baris) => Math.round(Number(b.nilai) || 0);
  const totalD = baris.filter((b) => b.sisi === "D").reduce((a, b) => a + nilaiDari(b), 0);
  const totalK = baris.filter((b) => b.sisi === "K").reduce((a, b) => a + nilaiDari(b), 0);
  const modal = totalD - totalK;

  const isi = baris.filter((b) => b.code && nilaiDari(b) !== 0);
  const bolehSimpan = isi.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(tanggal);

  const serial = useMemo(
    () => JSON.stringify(baris.map((b) => ({ code: b.code, nilai: nilaiDari(b), sisi: b.sisi }))),
    [baris],
  );

  return (
    <form action={simpanSaldoAwal}>
      <input type="hidden" name="baris" value={serial} />
      <input type="hidden" name="tanggal" value={tanggal} />

      <div style={{ marginBottom: 12, maxWidth: 220 }}>
        <label className="flab">Posisi per tanggal *</label>
        <input className="fi" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th>Akun</th>
              <th style={{ width: 110 }}>Sisi</th>
              <th style={{ textAlign: "right", width: 170 }}>Nilai</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {baris.map((b, i) => (
              <tr key={i}>
                <td>
                  <select className="fi" value={b.code} onChange={(e) => set(i, { code: e.target.value })}>
                    <option value="">— pilih akun —</option>
                    {pilihan.map((a) => (
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="fi" value={b.sisi} onChange={(e) => set(i, { sisi: e.target.value as "D" | "K" })}>
                    <option value="D">Harta (Debit)</option>
                    <option value="K">Utang (Kredit)</option>
                  </select>
                </td>
                <td>
                  <input
                    className="fi" type="number" step="any" style={{ textAlign: "right" }}
                    value={b.nilai} onChange={(e) => set(i, { nilai: e.target.value })} placeholder="0"
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <button type="button" className="back-btn" style={{ fontSize: 11 }} onClick={() => hapus(i)} title="Hapus baris">
                    <i className="ti ti-trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" className="btn-def" style={{ marginTop: 8, padding: "5px 12px", fontSize: 11 }} onClick={tambah}>
        <i className="ti ti-plus" /> Tambah baris
      </button>

      <div style={{ marginTop: 14, borderTop: "2px solid #16213e", paddingTop: 10 }}>
        <Row label="Total harta (debit)" value={totalD} />
        <Row label="Total utang (kredit)" value={totalK} />
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontSize: 13, fontWeight: 800 }}>
          <span>{modal >= 0 ? "Modal Pemilik (3101)" : "Defisit modal (3101)"}</span>
          <span style={{ color: "var(--acc)" }}>{rp(Math.abs(modal))}</span>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 4 }}>
          Selisih harta dikurangi utang otomatis jadi modal — jadi jurnalnya tidak mungkin timpang.
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button type="submit" className="pay-btn" disabled={!bolehSimpan} style={{ opacity: bolehSimpan ? 1 : 0.5 }}>
          <i className="ti ti-device-floppy" /> Simpan Saldo Awal
        </button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
      <span>{label}</span><span>{rp(value)}</span>
    </div>
  );
}
