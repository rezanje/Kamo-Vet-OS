"use client";

import { useMemo, useState } from "react";
import { jurnalManual } from "./actions";

// ponytail: form jurnal umum manual — dynamic rows, live balance indicator.

type Account = { id: string; code: string; name: string };
type Branch = { id: string; code: string; name: string };
type Line = { account_id: string; debit: string; credit: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const emptyLine = (): Line => ({ account_id: "", debit: "", credit: "" });

export function JurnalForm({
  accounts,
  branches,
}: {
  accounts: Account[];
  branches: Branch[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [tanggal, setTanggal] = useState(today);
  const [deskripsi, setDeskripsi] = useState("");
  const [branchId, setBranchId] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (idx: number) =>
    setLines((ls) => ls.length > 2 ? ls.filter((_, i) => i !== idx) : ls);

  const totalDebit = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const totalKredit = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  const selisih = Math.abs(totalDebit - totalKredit);
  const isBalance = totalDebit > 0 && totalKredit > 0 && Math.round(totalDebit) === Math.round(totalKredit);

  const validLines = lines.filter(
    (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)
  );

  const canSubmit =
    isBalance &&
    validLines.length >= 2 &&
    tanggal.trim() !== "" &&
    deskripsi.trim() !== "";

  const serialized = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        }))
      ),
    [lines]
  );

  return (
    <form action={jurnalManual}>
      {/* Hidden fields */}
      <input type="hidden" name="tanggal" value={tanggal} />
      <input type="hidden" name="deskripsi" value={deskripsi} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="lines" value={serialized} />

      {/* Header fields */}
      <div className="grid2" style={{ marginBottom: 10 }}>
        <div>
          <label className="flab">Tanggal *</label>
          <input
            className="fi"
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="flab">Cabang</label>
          <select
            className="fi"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">— Semua cabang —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="flab">Deskripsi / Keterangan *</label>
        <input
          className="fi"
          type="text"
          placeholder="Misal: Koreksi stok opname Juni 2026"
          value={deskripsi}
          onChange={(e) => setDeskripsi(e.target.value)}
          required
        />
      </div>

      {/* Lines table */}
      <div style={{ overflowX: "auto", marginBottom: 8 }}>
        <table className="tbl" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: "center" }}>#</th>
              <th>Akun</th>
              <th style={{ width: 130, textAlign: "right" }}>Debit (Rp)</th>
              <th style={{ width: 130, textAlign: "right" }}>Kredit (Rp)</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td style={{ textAlign: "center", fontSize: 10, color: "var(--td)" }}>
                  {idx + 1}
                </td>
                <td>
                  <select
                    className="fi"
                    style={{ width: "100%", fontSize: 11 }}
                    value={l.account_id}
                    onChange={(e) => setLine(idx, { account_id: e.target.value })}
                  >
                    <option value="">— Pilih akun —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="fi"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={l.debit}
                    style={{ textAlign: "right", width: "100%" }}
                    onChange={(e) =>
                      setLine(idx, { debit: e.target.value, credit: e.target.value !== "" && Number(e.target.value) > 0 ? "0" : l.credit })
                    }
                  />
                </td>
                <td>
                  <input
                    className="fi"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={l.credit}
                    style={{ textAlign: "right", width: "100%" }}
                    onChange={(e) =>
                      setLine(idx, { credit: e.target.value, debit: e.target.value !== "" && Number(e.target.value) > 0 ? "0" : l.debit })
                    }
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    className="back-btn"
                    style={{ color: "#b91c1c", fontSize: 13 }}
                    onClick={() => removeLine(idx)}
                    disabled={lines.length <= 2}
                    title="Hapus baris"
                  >
                    <i className="ti ti-trash" />
                  </button>
                </td>
              </tr>
            ))}

            {/* Totals row */}
            <tr style={{ background: "var(--sb2, #f8fafc)" }}>
              <td />
              <td style={{ fontSize: 11, fontWeight: 600, color: "var(--tm)", paddingLeft: 8 }}>
                Total
              </td>
              <td style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: "#2563eb" }}>
                {rp(totalDebit)}
              </td>
              <td style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: "#16a34a" }}>
                {rp(totalKredit)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Add row + balance indicator */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button type="button" className="btn-def" onClick={addLine} style={{ fontSize: 11 }}>
          <i className="ti ti-plus" style={{ marginRight: 4 }} />
          Tambah baris
        </button>

        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "5px 12px",
            borderRadius: 6,
            border: ".5px solid",
            ...(totalDebit === 0 && totalKredit === 0
              ? { color: "var(--td)", borderColor: "var(--bd)", background: "transparent" }
              : isBalance
              ? { color: "#15803d", borderColor: "#86efac", background: "#f0fdf4" }
              : { color: "#b91c1c", borderColor: "#fca5a5", background: "#fef2f2" }),
          }}
        >
          {totalDebit === 0 && totalKredit === 0 ? (
            "Isi baris jurnal"
          ) : isBalance ? (
            <>
              <i className="ti ti-circle-check" style={{ marginRight: 4 }} />
              Balance ✓
            </>
          ) : (
            <>
              <i className="ti ti-alert-triangle" style={{ marginRight: 4 }} />
              Tidak balance (selisih {rp(selisih)})
            </>
          )}
        </div>
      </div>

      <button
        type="submit"
        className="btn-acc"
        disabled={!canSubmit}
        style={{ opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? "pointer" : "not-allowed" }}
      >
        <i className="ti ti-device-floppy" style={{ marginRight: 6 }} />
        Simpan Jurnal
      </button>
    </form>
  );
}
