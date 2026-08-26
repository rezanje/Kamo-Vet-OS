"use client";

import { useState } from "react";
import { simpanJadwal } from "./actions";

export type ShiftOpsi = { id: string; nama: string; warna: string; is_libur: boolean; jam: string };
export type KaryawanBaris = { id: string; nama: string; jabatan: string | null };

const HAPUS = "__hapus__";
const kunci = (empId: string, tgl: string) => `${empId}|${tgl}`;

export function JadwalBoard({
  karyawan, shifts, hari, awal, cabang, bulan, bolehKelola,
}: {
  karyawan: KaryawanBaris[];
  shifts: ShiftOpsi[];
  hari: { tanggal: string; hari: number; namaHari: string; akhirPekan: boolean }[];
  awal: Record<string, string>;   // "empId|tanggal" → shiftId
  cabang: string;
  bulan: string;
  bolehKelola: boolean;
}) {
  const [kuas, setKuas] = useState<string>(shifts[0]?.id ?? HAPUS);
  const [isi, setIsi] = useState<Record<string, string>>(awal);
  const [ubah, setUbah] = useState<Record<string, string>>({});

  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  const olesSatu = (empId: string, tgl: string) => {
    if (!bolehKelola) return;
    const k = kunci(empId, tgl);
    const nilai = kuas === HAPUS ? "" : kuas;
    // Klik ulang dengan kuas yang sama = hapus, biar tidak perlu ganti kuas cuma untuk mengoreksi.
    const akhir = isi[k] === nilai ? "" : nilai;
    setIsi((s) => ({ ...s, [k]: akhir }));
    setUbah((s) => ({ ...s, [k]: akhir }));
  };

  const olesBaris = (empId: string) => {
    if (!bolehKelola) return;
    const nilai = kuas === HAPUS ? "" : kuas;
    const isiBaru = { ...isi };
    const ubahBaru = { ...ubah };
    for (const h of hari) {
      const k = kunci(empId, h.tanggal);
      isiBaru[k] = nilai;
      ubahBaru[k] = nilai;
    }
    setIsi(isiBaru);
    setUbah(ubahBaru);
  };

  const jumlahUbah = Object.keys(ubah).length;
  const rows = Object.entries(ubah).map(([k, v]) => {
    const [employee_id, tanggal] = k.split("|");
    return { employee_id, tanggal, shift_id: v || null };
  });

  return (
    <form action={simpanJadwal}>
      <input type="hidden" name="cabang" value={cabang} />
      <input type="hidden" name="bulan" value={bulan} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />

      {bolehKelola && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "var(--tm)" }}>Kuas:</span>
          {shifts.map((s) => (
            <button
              key={s.id} type="button" onClick={() => setKuas(s.id)}
              style={{
                border: kuas === s.id ? "2px solid #16213e" : ".5px solid var(--bd)",
                background: kuas === s.id ? s.warna : "#fff",
                color: kuas === s.id ? "#fff" : "var(--tx)",
                borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600,
              }}
              title={s.jam}
            >
              <span style={{
                display: "inline-block", width: 8, height: 8, borderRadius: 2,
                background: s.warna, marginRight: 6, verticalAlign: 0,
                border: kuas === s.id ? "1px solid #fff" : "none",
              }} />
              {s.nama}
            </button>
          ))}
          <button
            key={HAPUS} type="button" onClick={() => setKuas(HAPUS)}
            style={{
              border: kuas === HAPUS ? "2px solid #16213e" : ".5px solid var(--bd)",
              background: kuas === HAPUS ? "#64748b" : "#fff",
              color: kuas === HAPUS ? "#fff" : "var(--tx)",
              borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600,
            }}
          >
            Kosongkan
          </button>
          <span style={{ fontSize: 10, color: "var(--td)" }}>
            Klik sel untuk menempel · klik nama karyawan untuk sebulan penuh
          </span>
        </div>
      )}

      <div style={{ overflowX: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
        {/* width max-content: tanpa ini browser melebarkan kolom nama sampai kolom tanggal terdorong keluar layar */}
          <table className="tbl" style={{ width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, background: "#16213e", zIndex: 2, width: 170, minWidth: 170 }}>Karyawan</th>
              {hari.map((h) => (
                <th key={h.tanggal} style={{ width: 34, minWidth: 34, textAlign: "center", padding: "6px 2px" }}>
                  <div style={{ fontSize: 9, opacity: 0.75 }}>{h.namaHari}</div>
                  <div style={{ fontSize: 11 }}>{h.hari}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {karyawan.map((k) => (
              <tr key={k.id}>
                <td
                  onClick={() => olesBaris(k.id)}
                  title={bolehKelola ? "Klik: isi sebulan penuh dengan kuas terpilih" : undefined}
                  style={{
                    position: "sticky", left: 0, background: "#fff", zIndex: 1,
                    fontSize: 11.5, fontWeight: 600, cursor: bolehKelola ? "pointer" : "default",
                    borderRight: ".5px solid var(--bd)",
                  }}
                >
                  {k.nama}
                  {k.jabatan && <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>{k.jabatan}</div>}
                </td>
                {hari.map((h) => {
                  const sid = isi[kunci(k.id, h.tanggal)] ?? "";
                  const s = sid ? shiftById.get(sid) : null;
                  return (
                    <td
                      key={h.tanggal}
                      onClick={() => olesSatu(k.id, h.tanggal)}
                      title={s ? `${s.nama} ${s.jam}` : "kosong"}
                      style={{
                        textAlign: "center", padding: 2, cursor: bolehKelola ? "pointer" : "default",
                        background: s ? s.warna : h.akhirPekan ? "#f8fafc" : undefined,
                        color: s ? "#fff" : "var(--td)",
                        fontSize: 9.5, fontWeight: 700, userSelect: "none",
                      }}
                    >
                      {s ? (s.is_libur ? "L" : s.nama.slice(0, 2).toUpperCase()) : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
            {karyawan.length === 0 && (
              <tr><td colSpan={hari.length + 1} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                Tidak ada karyawan aktif di cabang ini.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {bolehKelola && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <span style={{ fontSize: 11, color: jumlahUbah > 0 ? "#b55a35" : "var(--td)" }}>
            {jumlahUbah > 0 ? `${jumlahUbah} sel belum disimpan` : "Belum ada perubahan"}
          </span>
          <button type="submit" className="btn-acc" style={{ background: "var(--posb)" }} disabled={jumlahUbah === 0}>
            <i className="ti ti-device-floppy" /> Simpan jadwal
          </button>
        </div>
      )}
    </form>
  );
}
