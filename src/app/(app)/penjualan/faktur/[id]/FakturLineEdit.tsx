"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { NumberInput } from "@/components/NumberInput";
import { muatanBarisFaktur, ringkasanFaktur, validasiBarisFaktur, type BarisFakturEdit } from "@/lib/faktur-jual-edit";
import { pratinjauFakturJual, simpanFakturJual, type FakturPreview } from "./line-actions";

const rp = (n: number) => `${n < 0 ? "-" : ""}Rp ${Math.abs(Number(n)).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const num = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 });

/**
 * Edit satu baris faktur penjualan dalam pop-up (pola yang sama dengan edit baris PO).
 * Seluruh baris faktur tetap ikut dikirim supaya database bisa memposting ulang nilainya utuh.
 */
export function FakturLineEdit({ invoiceId, revision, today, jatuhTempo, catatan, taxRate, rows, row }: {
  invoiceId: string; revision: number; today: string; jatuhTempo: string; catatan: string;
  taxRate: number; rows: BarisFakturEdit[]; row: BarisFakturEdit;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [qty, setQty] = useState(String(row.qty));
  const [harga, setHarga] = useState(String(row.harga));
  const [diskon, setDiskon] = useState(String(row.diskon));
  const [tanggal, setTanggal] = useState(today);
  const [tempo, setTempo] = useState(jatuhTempo < today ? today : jatuhTempo);
  const [note, setNote] = useState(catatan);
  const [preview, setPreview] = useState<FakturPreview | null>(null);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [pending, start] = useTransition();
  const ubah = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { set(e.target.value); setPreview(null); setError(""); };

  const baris: BarisFakturEdit = { ...row, qty: Number(qty), harga: Number(harga), diskon: Number(diskon) };
  const pesanBaris = validasiBarisFaktur(baris);
  const items = muatanBarisFaktur(rows, baris);
  const hitung = ringkasanFaktur(items, taxRate);
  const kosong = items.every((b) => b.qty <= 0);

  const buka = () => {
    setQty(String(row.qty)); setHarga(String(row.harga)); setDiskon(String(row.diskon));
    setTanggal(today); setTempo(jatuhTempo < today ? today : jatuhTempo); setNote(catatan);
    setPreview(null); setError(""); setRequestKey(crypto.randomUUID());
    dialog.current?.showModal();
  };

  const periksa = () => start(async () => {
    setError("");
    const res = await pratinjauFakturJual({ invoiceId, tanggal, jatuhTempo: tempo, catatan: note, items });
    if (res.ok) setPreview(res.preview); else { setPreview(null); setError(res.error); }
  });

  const simpan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      const res = await simpanFakturJual(form);
      if (!res.ok) { setError(res.error); return; }
      // Faktur pengganti punya nomor baru: buka dokumen barunya, bukan faktur lama yang sudah batal.
      window.location.replace(`/penjualan/faktur/${res.replacementId}?success=${encodeURIComponent("Faktur pengganti tersimpan.")}`);
    });
  };

  return <>
    <button type="button" className="btn-def" onClick={buka} style={{ padding: "3px 9px", fontSize: 10.5 }}>
      <i className="ti ti-pencil" /> Edit
    </button>
    <dialog ref={dialog} aria-labelledby={`edit-faktur-${row.id}`} style={{ margin: "auto", border: ".5px solid var(--bd)", borderRadius: 12, padding: 20, maxWidth: 480, width: "calc(100% - 32px)" }}>
      <form onSubmit={simpan}>
        <div id={`edit-faktur-${row.id}`} style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Edit {row.nama}</div>
        <p style={{ fontSize: 11, color: "var(--tm)", marginTop: 0 }}>
          Qty, harga dan diskon baris ini dibetulkan. Faktur lama dibalik dan terbit faktur pengganti bernomor baru;
          piutang, pendapatan, diskon dan PPN ikut otomatis. Barang yang sudah dikirim tetap keluar gudang — stok tidak berubah.
        </p>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="request_key" value={requestKey} />
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <input type="hidden" name="expected" value={preview ? JSON.stringify(preview) : ""} />
        <div className="frow" style={{ marginBottom: 10 }}>
          <div>
            <label className="flab">Qty ({row.satuan ?? "unit"}) · maks {num(row.maksQty)}</label>
            <NumberInput className="fi" type="number" name="qty" min={0} max={row.maksQty} step="any" required value={qty} onChange={ubah(setQty)} />
          </div>
          <div>
            <label className="flab">Harga per {row.satuan ?? "unit"} *</label>
            <NumberInput className="fi" type="number" name="harga" min={0} step="any" required value={harga} onChange={ubah(setHarga)} />
          </div>
          <div>
            <label className="flab">Diskon baris (Rp)</label>
            <NumberInput className="fi" type="number" name="diskon" min={0} step="any" required value={diskon} onChange={ubah(setDiskon)} />
          </div>
        </div>
        <div className="frow" style={{ marginBottom: 10 }}>
          <div>
            <label className="flab">Tanggal koreksi *</label>
            <input className="fi" type="date" name="tanggal" max={today} required value={tanggal} onChange={ubah(setTanggal)} />
          </div>
          <div>
            <label className="flab">Jatuh tempo pengganti *</label>
            <input className="fi" type="date" name="jatuh_tempo" required value={tempo} onChange={ubah(setTempo)} />
          </div>
        </div>
        <label className="flab">Catatan faktur pengganti</label>
        <input className="fi" name="catatan" maxLength={1000} value={note} onChange={ubah(setNote)} />
        <label className="flab">Alasan *</label>
        <input className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: salah ketik qty, pelanggan minta diskon" />

        <div className="p2ban" aria-live="polite" style={{ marginTop: 10, fontSize: 11.5 }}>
          Perkiraan faktur: {rp(hitung.gross)} − diskon {rp(hitung.diskon)} = DPP {rp(hitung.dpp)}
          {taxRate > 0 ? ` + PPN ${rp(hitung.ppn)}` : ""} → total {rp(hitung.total)}. Angka pasti dihitung ulang server.
        </div>
        {pesanBaris && <div role="alert" className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginTop: 10 }}>{pesanBaris}</div>}
        {kosong && <div role="alert" className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginTop: 10 }}>
          Faktur harus menyisakan minimal satu baris. Untuk menghapus seluruh tagihan gunakan pembatalan faktur.
        </div>}
        {error && <div role="alert" className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginTop: 10 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>}
        {preview && <div role="status" style={{ marginTop: 10, fontSize: 11.5, background: "var(--bg2, #f6f5f1)", borderRadius: 8, padding: "8px 10px", lineHeight: 1.6 }}>
          <div><b>Dampak perubahan</b></div>
          <div>Qty: {num(preview.lines.find((l) => l.nama === row.nama)?.old_qty ?? row.qty)} → {num(preview.lines.find((l) => l.nama === row.nama)?.new_qty ?? baris.qty)} {row.satuan ?? ""}</div>
          <div>Total faktur: {rp(preview.old_total)} → {rp(preview.new_total)}</div>
          <div>Piutang: {preview.ar_delta > 0 ? "+" : ""}{rp(preview.ar_delta)}</div>
          <div>Pendapatan: {preview.revenue_delta > 0 ? "+" : ""}{rp(preview.revenue_delta)}</div>
          {preview.diskon_delta !== 0 && <div>Diskon penjualan: {preview.diskon_delta > 0 ? "+" : ""}{rp(preview.diskon_delta)}</div>}
          {preview.ppn_delta !== 0 && <div>PPN keluaran: {preview.ppn_delta > 0 ? "+" : ""}{rp(preview.ppn_delta)}</div>}
          <div>Alokasi HPP faktur: {rp(preview.old_hpp)} → {rp(preview.new_hpp)} <span style={{ color: "var(--td)" }}>(jurnal HPP tetap di pengiriman; stok tidak berubah)</span></div>
        </div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn-def" onClick={() => dialog.current?.close()}>Tutup</button>
          {preview
            ? <button type="submit" className="btn-acc" disabled={pending}><i className="ti ti-device-floppy" /> {pending ? "Menyimpan…" : "Simpan"}</button>
            : <button type="button" className="btn-acc" onClick={periksa} disabled={pending || !!pesanBaris || kosong}>{pending ? "Memeriksa…" : "Lihat dampak"}</button>}
        </div>
      </form>
    </dialog>
  </>;
}
