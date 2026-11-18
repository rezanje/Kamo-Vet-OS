"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rupiahBulat } from "@/lib/saldo-awal-faktur";
import { koreksiSaldoAwalFaktur } from "./actions";
import type { OpeningInvoiceCorrectionReceipt, OpeningInvoiceCorrectionRow } from "./types";

const rp = (n: number) => "Rp " + Math.round(Number(n)).toLocaleString("id-ID");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Why a row cannot be corrected, or null when it can. */
export function alasanTidakBisa(row: OpeningInvoiceCorrectionRow): string | null {
  if (row.batal) return "Faktur sudah dibatalkan.";
  if (row.periode_tutup) return "Periode tanggal saldo awal sudah ditutup.";
  return null;
}

export function KoreksiSaldoAwalFaktur({ rows, isOwner }: { rows: OpeningInvoiceCorrectionRow[]; isOwner: boolean }) {
  const router = useRouter();
  const [cari, setCari] = useState("");
  const [pilih, setPilih] = useState<string | null>(null);
  const [nilai, setNilai] = useState("");
  const [alasan, setAlasan] = useState("");
  const [yakin, setYakin] = useState(false);
  const [error, setError] = useState("");
  const [hasil, setHasil] = useState<OpeningInvoiceCorrectionReceipt | null>(null);
  const [requestKey, setRequestKey] = useState(newKey);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  const daftar = useMemo(() => {
    const q = norm(cari);
    const cocok = q ? rows.filter(r => norm(`${r.no_faktur} ${r.no_asal} ${r.pihak}`).includes(q)) : rows;
    return cocok.slice(0, 25);
  }, [cari, rows]);
  const row = rows.find(r => r.line_id === pilih) ?? null;
  const baru = rupiahBulat(nilai);
  const selisih = row && baru !== null ? baru - Number(row.total) : null;
  const kurangDariBayar = row && baru !== null && baru < Number(row.dibayar);
  const blokir = row ? alasanTidakBisa(row) : null;
  const siap = isOwner && !!row && !blokir && baru !== null && baru > 0 && selisih !== 0 && !kurangDariBayar
    && alasan.trim().length >= 10 && alasan.trim().length <= 1000 && yakin && !pending;

  const pilihBaris = (id: string) => { setPilih(id); setNilai(""); setYakin(false); setError(""); setHasil(null); setRequestKey(newKey()); };
  const ubah = (fn: () => void) => { fn(); setYakin(false); setError(""); setRequestKey(newKey()); };

  const simpan = () => {
    if (!row || !siap || busy.current) return;
    busy.current = true;
    startTransition(async () => {
      setError("");
      try {
        const result = await koreksiSaldoAwalFaktur({ lineId: row.line_id, expectedTotal: Number(row.total), newTotal: nilai, reason: alasan, confirmed: yakin, requestKey });
        if (!result.ok) { setError(result.error); return; }
        setHasil(result.receipt); setPilih(null); setNilai(""); setAlasan(""); setYakin(false); setRequestKey(newKey());
        router.refresh();
      } catch { setError("Respons belum diterima. Muat ulang halaman dan cek riwayat koreksi sebelum mencoba lagi."); }
      finally { busy.current = false; }
    });
  };

  return <div>
    {!isOwner && <div className="p2ban">Hanya OWNER yang dapat menyimpan koreksi. Anda tetap bisa melihat daftar dan riwayatnya.</div>}
    {hasil && <div className="card" role="status" style={{ background: "#e8f5ee", marginBottom: 10, fontSize: 12 }}>
      <strong>Koreksi tersimpan{hasil.replayed ? " (permintaan yang sama sudah pernah tersimpan)" : ""}.</strong>{" "}
      {hasil.no_faktur}: {rp(hasil.old_total)} → {rp(hasil.new_total)} · sisa tagihan sekarang {rp(hasil.sisa)} · jurnal koreksi {hasil.no_jurnal}.
    </div>}
    <label className="flab" style={{ maxWidth: 420 }}>Cari faktur saldo awal
      <input className="fi" name="cari" type="search" value={cari} onChange={e => setCari(e.target.value)} placeholder="No. faktur (FB/FJ), no. asal Accurate, atau nama pemasok/pelanggan" />
    </label>
    <div style={{ overflowX: "auto", marginTop: 8 }}>
      <table className="tbl" style={{ minWidth: 760 }}>
        <thead><tr><th>Jenis</th><th>No. faktur</th><th>No. asal</th><th>Pemasok / pelanggan</th>
          <th style={{ textAlign: "right" }}>Nilai</th><th style={{ textAlign: "right" }}>Sudah dibayar</th><th style={{ textAlign: "right" }}>Sisa</th><th /></tr></thead>
        <tbody>
          {daftar.map(r => {
            const kunci = alasanTidakBisa(r);
            return <tr key={r.line_id} style={r.line_id === pilih ? { background: "var(--sf1)" } : undefined}>
              <td style={{ fontSize: 11 }}>{r.jenis === "HUTANG" ? "Hutang" : "Piutang"}</td>
              <td style={{ fontSize: 11, fontFamily: "monospace" }}>{r.no_faktur}</td>
              <td style={{ fontSize: 11 }}>{r.no_asal}</td>
              <td style={{ fontSize: 11 }}>{r.pihak}{r.jumlah_koreksi > 0 ? <span style={{ color: "var(--tm)" }}> · {r.jumlah_koreksi}× dikoreksi</span> : null}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.total)}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.dibayar)}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Math.max(Number(r.total) - Number(r.dibayar), 0))}</td>
              <td style={{ textAlign: "right" }}>
                {kunci ? <span style={{ fontSize: 10, color: "var(--tm)" }}>{kunci}</span>
                  : <button type="button" className="btn-def" style={{ fontSize: 11 }} onClick={() => pilihBaris(r.line_id)}>Koreksi</button>}
              </td>
            </tr>;
          })}
          {!daftar.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: 16, fontSize: 11 }}>
            {rows.length ? "Tidak ada faktur yang cocok dengan pencarian." : "Belum ada faktur saldo awal."}</td></tr>}
        </tbody>
      </table>
    </div>
    {rows.length > daftar.length && !cari && <p style={{ fontSize: 11, color: "var(--tm)" }}>Menampilkan 25 dari {rows.length} faktur. Ketik di kolom cari untuk menemukan faktur lain.</p>}

    {row && <section aria-label="Formulir koreksi saldo awal" className="card" style={{ marginTop: 12, maxWidth: 560, display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Koreksi {row.no_faktur} · {row.pihak}</div>
      <div style={{ fontSize: 11, color: "var(--tm)" }}>
        No. asal {row.no_asal} · tanggal saldo awal {row.as_of} · nilai sekarang {rp(row.total)} · sudah {row.jenis === "HUTANG" ? "dibayar" : "diterima"} {rp(row.dibayar)}
      </div>
      <label className="flab">Nilai saldo awal yang benar (Rp)
        <input className="fi" name="nilai" inputMode="numeric" value={nilai} onChange={e => ubah(() => setNilai(e.target.value))} placeholder="misalnya 10.101.500" />
      </label>
      {nilai.trim() !== "" && baru === null && <div className="p2ban" role="alert">Isi rupiah bulat, misalnya 10.101.500.</div>}
      {kurangDariBayar && <div className="p2ban" role="alert">
        Nilai baru lebih kecil dari yang sudah {row.jenis === "HUTANG" ? "dibayar" : "diterima"} ({rp(row.dibayar)}). Batalkan dulu pembayarannya bila memang salah.
      </div>}
      {selisih === 0 && <div className="p2ban" role="alert">Nilai baru sama dengan nilai sekarang.</div>}
      {selisih !== null && selisih !== 0 && !kurangDariBayar && baru !== null && <div style={{ fontSize: 12, lineHeight: 1.6 }}>
        <div>Nilai berubah {rp(row.total)} → <strong>{rp(baru)}</strong> ({selisih > 0 ? "naik" : "turun"} {rp(Math.abs(selisih))}).</div>
        <div>Sisa tagihan menjadi <strong>{rp(baru - Number(row.dibayar))}</strong>{baru === Number(row.dibayar) ? " (lunas)" : ""}.</div>
        <div style={{ color: "var(--tm)", fontSize: 11 }}>
          Sistem membuat jurnal koreksi bertanggal {row.as_of}:{" "}
          {row.jenis === "HUTANG"
            ? (selisih > 0 ? "Modal Pemilik (410001) debit, Utang Supplier (311001) kredit" : "Utang Supplier (311001) debit, Modal Pemilik (410001) kredit")
            : (selisih > 0 ? "Piutang Usaha (150001) debit, Modal Pemilik (410001) kredit" : "Modal Pemilik (410001) debit, Piutang Usaha (150001) kredit")}
          {" "}sebesar {rp(Math.abs(selisih))}. Jurnal saldo awal aslinya tidak diubah.
        </div>
      </div>}
      <label className="flab">Alasan koreksi
        <textarea className="fi" name="alasan" value={alasan} minLength={10} maxLength={1000} onChange={e => ubah(() => setAlasan(e.target.value))}
          placeholder="misalnya: salah ketik di file impor, angka benar dari laporan Accurate" />
      </label>
      <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "flex-start" }}>
        <input type="checkbox" name="yakin" checked={yakin} onChange={e => setYakin(e.target.checked)} disabled={!isOwner} />
        Saya sudah cek angka di atas. Koreksi tercatat di riwayat beserta alasan dan nama saya.
      </label>
      {error && <div className="p2ban" role="alert">{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-acc" disabled={!siap} onClick={simpan}>{pending ? "Menyimpan koreksi…" : "Simpan koreksi"}</button>
        <button type="button" className="btn-def" disabled={pending} onClick={() => { setPilih(null); setError(""); }}>Batal</button>
      </div>
    </section>}
  </div>;
}
