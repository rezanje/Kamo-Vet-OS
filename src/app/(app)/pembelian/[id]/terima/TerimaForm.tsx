"use client";

// ponytail: qty diterima default = sisa yang belum datang; user tinggal ubah baris
// yang tidak sesuai. Kolom rusak dipisah dari kolom terima karena akibatnya beda:
// yang baik masuk stok & jadi hutang, yang rusak cuma jadi bahan klaim ke pemasok.

import Link from "next/link";
import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { terimaBarang } from "../../actions";
import { hariIniWIB } from "@/lib/tanggal";
import { sisaBelumDijatah, type BatchInput } from "@/lib/kadaluarsa-batch";

export type BarisPO = {
  id: string;
  nama: string;
  qty: number;
  harga_beli: number;
  satuan: string;
  /** Barang dengan masa kadaluarsa (flag master) — hanya ini yang diminta tanggalnya. */
  trackExpiry?: boolean;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function TerimaForm({
  poId,
  noPo,
  supplier,
  gudang,
  totalPO,
  rows,
}: {
  poId: string;
  noPo: string;
  supplier: string;
  gudang: string;
  totalPO: number;
  rows: BarisPO[];
}) {
  const [terima, setTerima] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.id, r.qty])),
  );
  const [rusak, setRusak] = useState<Record<string, number>>({});
  const [catatan, setCatatan] = useState<Record<string, string>>({});
  const [exp, setExp] = useState<Record<string, string>>({});
  // Kadaluarsa bertingkat: satu barang boleh datang dengan beberapa tanggal
  // sekaligus (permintaan Pak Faisal, meeting 14 Agustus). Baris tambahan hanya
  // muncul kalau petugas menekan "Tanggal lain" — kiriman satu tanggal tetap
  // seringkas dulu.
  const [batch, setBatch] = useState<Record<string, BatchInput[]>>({});
  const adaExpiry = rows.some((r) => r.trackExpiry);

  const batchOf = (id: string) => batch[id] ?? [];
  const tambahBatch = (id: string) =>
    setBatch((b) => ({ ...b, [id]: [...(b[id] ?? []), { qty: 0, exp_date: "" }] }));
  const ubahBatch = (id: string, i: number, patch: Partial<BatchInput>) =>
    setBatch((b) => ({ ...b, [id]: (b[id] ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const hapusBatch = (id: string, i: number) =>
    setBatch((b) => ({ ...b, [id]: (b[id] ?? []).filter((_, j) => j !== i) }));

  const qtyOf = (r: BarisPO) => Math.min(Math.max(0, Number(terima[r.id]) || 0), r.qty);
  const rusakOf = (r: BarisPO) => Math.min(Math.max(0, Number(rusak[r.id]) || 0), Math.max(0, r.qty - qtyOf(r)));

  const totalTerima = rows.reduce((a, r) => a + qtyOf(r) * r.harga_beli, 0);
  const nilaiRusak = rows.reduce((a, r) => a + rusakOf(r) * r.harga_beli, 0);
  const selisih = totalTerima - totalPO;
  const today = hariIniWIB();

  // Tanggal utama tetap dikirim sebagai batch pertama supaya server tidak perlu
  // tahu bedanya "satu tanggal" dan "beberapa tanggal".
  const batchLengkap = (r: BarisPO): BatchInput[] => {
    if (!r.trackExpiry) return [];
    const utama = (exp[r.id] ?? "").trim();
    const lain = batchOf(r.id).filter((b) => String(b.exp_date ?? "").trim());
    const sisaUtama = utama
      ? [{ qty: qtyOf(r) - lain.reduce((a, b) => a + (Number(b.qty) || 0), 0), exp_date: utama }]
      : [];
    return [...sisaUtama.filter((b) => Number(b.qty) > 0), ...lain];
  };

  const payload = rows.map((r) => ({
    id: r.id,
    qty_terima: qtyOf(r),
    qty_rusak: rusakOf(r),
    catatan: catatan[r.id] ?? "",
    exp_date: r.trackExpiry ? (exp[r.id] ?? "") : "",
    batches: batchLengkap(r),
  }));

  return (
    <form action={terimaBarang}>
      <input type="hidden" name="id" value={poId} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="PENERIMAAN BARANG"
          desc={`${noPo} · ${supplier} · masuk gudang ${gudang}.`}
        />

        <div className="frow" style={{ marginBottom: 12 }}>
          <div>
            <label className="flab">Tanggal terima</label>
            <input className="fi" type="date" name="tanggal" defaultValue={today} />
          </div>
          <div>
            <label className="flab">No. surat jalan pemasok</label>
            <input className="fi" name="surat_jalan" maxLength={60} placeholder="opsional" />
          </div>
          <div>
            <label className="flab">Catatan penerimaan</label>
            <input className="fi" name="catatan" placeholder="mis. kiriman tahap 2" />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Barang</th>
                <th style={{ textAlign: "right", width: 80 }}>Sisa PO</th>
                <th style={{ textAlign: "right", width: 100 }}>Diterima baik</th>
                <th style={{ textAlign: "right", width: 100 }}>Rusak / ditolak</th>
                <th style={{ width: 70 }}>Satuan</th>
                <th style={{ textAlign: "right", width: 110 }}>Harga</th>
                <th style={{ textAlign: "right", width: 120 }}>Subtotal</th>
                {adaExpiry && <th style={{ width: 130 }}>Kadaluarsa</th>}
                <th style={{ width: 150 }}>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const q = qtyOf(r);
                const rk = rusakOf(r);
                const belumDatang = r.qty - q - rk;
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 500 }}>
                      {r.nama}
                      {belumDatang > 0 && (
                        <div style={{ fontSize: 9.5, color: "#b45309" }}>
                          {belumDatang} {r.satuan} belum datang
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11.5, color: "var(--tm)" }}>{r.qty}</td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="fi"
                        type="number"
                        min={0}
                        max={r.qty}
                        step="any"
                        value={terima[r.id] ?? 0}
                        onChange={(e) => setTerima((t) => ({ ...t, [r.id]: Number(e.target.value) }))}
                        style={{ width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="fi"
                        type="number"
                        min={0}
                        max={Math.max(0, r.qty - q)}
                        step="any"
                        value={rusak[r.id] ?? 0}
                        onChange={(e) => setRusak((t) => ({ ...t, [r.id]: Number(e.target.value) }))}
                        style={{ width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.satuan || "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(r.harga_beli)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(q * r.harga_beli)}</td>
                    {adaExpiry && (
                      <td>
                        {r.trackExpiry ? (
                          <>
                            <input
                              className="fi"
                              type="date"
                              value={exp[r.id] ?? ""}
                              onChange={(e) => setExp((x) => ({ ...x, [r.id]: e.target.value }))}
                              style={{ width: 125, height: 26, fontSize: 10.5 }}
                            />
                            {batchOf(r.id).map((b, i) => (
                              <div key={i} style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
                                <input className="fi" type="number" min={0} step="any"
                                  value={String(b.qty ?? "")} placeholder="jml"
                                  onChange={(e) => ubahBatch(r.id, i, { qty: Number(e.target.value) })}
                                  style={{ width: 48, height: 26, fontSize: 10.5, textAlign: "right" }} />
                                <input className="fi" type="date"
                                  value={String(b.exp_date ?? "")}
                                  onChange={(e) => ubahBatch(r.id, i, { exp_date: e.target.value })}
                                  style={{ width: 118, height: 26, fontSize: 10.5 }} />
                                <i className="ti ti-x" onClick={() => hapusBatch(r.id, i)}
                                  style={{ cursor: "pointer", color: "#dc2626", fontSize: 12 }} />
                              </div>
                            ))}
                            <button type="button" onClick={() => tambahBatch(r.id)} className="btn-def"
                              style={{ padding: "1px 7px", fontSize: 9.5, marginTop: 4 }}>
                              <i className="ti ti-plus" /> Tanggal lain
                            </button>
                            {batchOf(r.id).length > 0 && (
                              <div style={{ fontSize: 9, color: "var(--tm)", marginTop: 3 }}>
                                {sisaBelumDijatah(qtyOf(r), batchLengkap(r))} {r.satuan} pakai tanggal utama
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: 10, color: "var(--td)" }}>—</span>
                        )}
                      </td>
                    )}
                    <td>
                      <input
                        className="fi"
                        value={catatan[r.id] ?? ""}
                        onChange={(e) => setCatatan((c) => ({ ...c, [r.id]: e.target.value }))}
                        placeholder={rk > 0 ? "kondisi rusaknya" : "opsional"}
                        style={{ width: 140, height: 26, fontSize: 10.5 }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 6,
            border: ".5px solid var(--bd)", background: "var(--bg2, #f9fafb)",
            display: "flex", justifyContent: "space-between", fontSize: 12.5,
          }}
        >
          <span style={{ color: "var(--tm)" }}>
            Nilai PO {rp(totalPO)} → nilai diterima
          </span>
          <span style={{ fontWeight: 700 }}>
            {rp(totalTerima)}
            {selisih !== 0 && (
              <span style={{ fontWeight: 500, color: selisih < 0 ? "#b91c1c" : "#b45309", marginLeft: 8 }}>
                ({selisih > 0 ? "+" : "−"}{rp(Math.abs(selisih))})
              </span>
            )}
          </span>
        </div>

        {nilaiRusak > 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 10 }}>
            <i className="ti ti-alert-triangle" /> {rp(nilaiRusak)} barang rusak ditolak — tidak masuk stok dan tidak
            menambah hutang. Sisa pesanannya tetap ditagih ke pemasok.
          </div>
        )}

        {adaExpiry && (
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Tanggal kadaluarsa menempel ke kiriman ini saja — kiriman berikutnya diisi sendiri.
            Boleh dikosongkan, tapi barangnya tidak akan muncul di Monitor Expired. Kalau satu barang
            datang dengan beberapa masa simpan, tekan &quot;Tanggal lain&quot; lalu isi jumlah per tanggalnya;
            sisanya otomatis ikut tanggal utama.
          </div>
        )}

        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
          Stok &amp; jurnal penerimaan (Dr Persediaan / Cr Hutang Belum Difakturkan) memakai qty diterima baik,
          bukan qty PO. Tiap penerimaan menghasilkan dokumen bernomor sendiri.
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Link href="/pembelian" className="btn-def" style={{ textDecoration: "none" }}>
          Batal
        </Link>
        <button type="submit" className="btn-acc">
          <i className="ti ti-package-import" /> Simpan penerimaan
        </button>
      </div>
    </form>
  );
}
