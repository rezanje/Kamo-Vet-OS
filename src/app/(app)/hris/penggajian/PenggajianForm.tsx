"use client";

import { useMemo, useState } from "react";
import { prosesPenggajian } from "./actions";

// ponytail: form penggajian — tabel karyawan dengan input tunjangan & potongan, live totals, hidden JSON.

type Employee = { id: string; nama: string; jabatan: string; gaji_pokok: number };

type Row = {
  employee_id: string;
  nama: string;
  jabatan: string;
  gaji_pokok: number;
  tunjangan: number;
  potongan: number;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function PenggajianForm({ employees }: { employees: Employee[] }) {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [periode, setPeriode] = useState(currentMonth);
  const [rows, setRows] = useState<Row[]>(
    employees.map((e) => ({
      employee_id: e.id,
      nama: e.nama,
      jabatan: e.jabatan,
      gaji_pokok: e.gaji_pokok,
      tunjangan: 0,
      potongan: 0,
    }))
  );

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  // Live computed totals per row and grand totals.
  const computed = rows.map((r) => ({
    ...r,
    total: r.gaji_pokok + r.tunjangan - r.potongan,
  }));

  const grandGajiPokok  = computed.reduce((a, r) => a + r.gaji_pokok,  0);
  const grandTunjangan  = computed.reduce((a, r) => a + r.tunjangan,   0);
  const grandPotongan   = computed.reduce((a, r) => a + r.potongan,    0);
  const grandDibayar    = computed.reduce((a, r) => a + r.total,       0);

  const serialized = useMemo(
    () =>
      JSON.stringify(
        computed.map((r) => ({
          employee_id: r.employee_id,
          gaji_pokok:  r.gaji_pokok,
          tunjangan:   r.tunjangan,
          potongan:    r.potongan,
        }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]
  );

  const canSubmit = periode.trim() !== "" && rows.length > 0;

  return (
    <form action={prosesPenggajian}>
      <input type="hidden" name="periode" value={periode} />
      <input type="hidden" name="rows"    value={serialized} />

      {/* Periode picker */}
      <div style={{ marginBottom: 14, maxWidth: 220 }}>
        <label className="flab">Periode Penggajian *</label>
        <input
          className="fi"
          type="month"
          value={periode}
          onChange={(e) => setPeriode(e.target.value)}
          required
        />
      </div>

      {employees.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--td)", fontSize: 12 }}>
          <i className="ti ti-user-off" style={{ fontSize: 24, display: "block", marginBottom: 8, opacity: 0.35 }} />
          Tidak ada karyawan aktif ditemukan.
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto", marginBottom: 10 }}>
            <table className="tbl" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={{ width: 30, textAlign: "center" }}>#</th>
                  <th>Nama</th>
                  <th>Jabatan</th>
                  <th style={{ width: 140, textAlign: "right" }}>Gaji Pokok</th>
                  <th style={{ width: 140, textAlign: "right" }}>Tunjangan (Rp)</th>
                  <th style={{ width: 140, textAlign: "right" }}>Potongan (Rp)</th>
                  <th style={{ width: 140, textAlign: "right" }}>Total Dibayar</th>
                </tr>
              </thead>
              <tbody>
                {computed.map((r, idx) => (
                  <tr key={r.employee_id}>
                    <td style={{ textAlign: "center", fontSize: 10, color: "var(--td)" }}>{idx + 1}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{r.nama}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.jabatan}</td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 11, color: "var(--tm)" }}>
                      {rp(r.gaji_pokok)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="fi"
                        type="number"
                        min={0}
                        step={1000}
                        placeholder="0"
                        value={rows[idx].tunjangan || ""}
                        style={{ textAlign: "right", width: "100%", minWidth: 110 }}
                        onChange={(e) =>
                          setRow(idx, { tunjangan: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="fi"
                        type="number"
                        min={0}
                        step={1000}
                        placeholder="0"
                        value={rows[idx].potongan || ""}
                        style={{ textAlign: "right", width: "100%", minWidth: 110 }}
                        onChange={(e) =>
                          setRow(idx, { potongan: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontSize: 11,
                        fontWeight: 700,
                        color: r.total >= 0 ? "#16a34a" : "#b91c1c",
                      }}
                    >
                      {rp(r.total)}
                    </td>
                  </tr>
                ))}

                {/* Grand totals row */}
                <tr style={{ background: "var(--sb2, #f8fafc)", borderTop: "1.5px solid var(--bd)" }}>
                  <td />
                  <td
                    colSpan={2}
                    style={{ fontSize: 11, fontWeight: 700, color: "var(--tx)", paddingLeft: 8 }}
                  >
                    Grand Total ({computed.length} karyawan)
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>
                    {rp(grandGajiPokok)}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#2563eb" }}>
                    {rp(grandTunjangan)}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>
                    {rp(grandPotongan)}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 12, fontWeight: 800, color: "#16a34a" }}>
                    {rp(grandDibayar)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Summary strip */}
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--sb2, #f8fafc)",
              border: ".5px solid var(--bd)",
              fontSize: 11,
            }}
          >
            {[
              { label: "Total Gaji Pokok", val: grandGajiPokok, color: "var(--tx)" },
              { label: "Total Tunjangan",  val: grandTunjangan,  color: "#2563eb" },
              { label: "Total Potongan",   val: grandPotongan,   color: "#b91c1c" },
              { label: "Total Dibayar",    val: grandDibayar,    color: "#16a34a" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: "var(--td)", fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
                  {label}
                </span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color }}>
                  {rp(val)}
                </span>
              </div>
            ))}
          </div>

          <button
            type="submit"
            className="btn-acc"
            disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            <i className="ti ti-calculator" style={{ marginRight: 6 }} />
            Proses Penggajian
          </button>
        </>
      )}
    </form>
  );
}
