"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { NumberInput } from "@/components/NumberInput";
import { pratinjauBarisPO, simpanBarisPO, type LinePreview } from "./line-actions";

const rp = (n: number) => `${n < 0 ? "-" : ""}Rp ${Math.abs(Number(n)).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const num = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 });

type Row = { id: string; nama: string; satuan: string | null; qty: number; qty_terima: number | null; qty_rusak?: number | null; harga_beli: number };

/** Edit satu baris PO dalam pop-up. Belum diterima: Qty PO & harga. Sudah diterima: qty/harga diterima, PO ikut. */
export function POLineEdit({ poId, revision, row, today, hargaDiterima }: { poId: string; revision: number; row: Row; today: string; hargaDiterima?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const received = Number(row.qty_terima ?? 0) > 0 || Number(row.qty_rusak ?? 0) > 0;
  const [qty, setQty] = useState(String(row.qty));
  const [qtyTerima, setQtyTerima] = useState(String(row.qty_terima ?? 0));
  // Sudah ditagih: harga awal = harga di faktur, bukan harga PO (yang bisa beda).
  const hargaAwal = String(received ? hargaDiterima ?? row.harga_beli : row.harga_beli);
  const [harga, setHarga] = useState(hargaAwal);
  const [tanggal, setTanggal] = useState(today);
  const [preview, setPreview] = useState<LinePreview | null>(null);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [pending, start] = useTransition();
  const changed = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { set(e.target.value); setPreview(null); setError(""); };

  const open = () => {
    setQty(String(row.qty)); setQtyTerima(String(row.qty_terima ?? 0)); setHarga(hargaAwal); setTanggal(today);
    setPreview(null); setError(""); setRequestKey(crypto.randomUUID());
    dialog.current?.showModal();
  };
  const check = () => start(async () => {
    setError("");
    const res = await pratinjauBarisPO({
      poItemId: row.id, qty: received ? null : Number(qty), qtyTerima: received ? Number(qtyTerima) : null, harga: Number(harga), tanggal,
    });
    if (res.ok) setPreview(res.preview); else { setPreview(null); setError(res.error); }
  });

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      const res = await simpanBarisPO(form);
      if (!res.ok) { setError(res.error); return; }
      // Muat ulang penuh: tabel, total, status, dan revisi PO pasti segar; pop-up ikut tertutup.
      window.location.replace(`/pembelian/${poId}?success=1#daftar-item`);
    });
  };

  return <>
    <button type="button" className="btn-def" onClick={open} style={{ padding: "3px 9px", fontSize: 10.5 }}>
      <i className="ti ti-pencil" /> Edit
    </button>
    <dialog ref={dialog} aria-labelledby={`edit-${row.id}`} style={{ border: ".5px solid var(--bd)", borderRadius: 12, padding: 20, maxWidth: 460, width: "calc(100% - 32px)" }}>
      <form onSubmit={save}>
        <div id={`edit-${row.id}`} style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Edit {row.nama}</div>
        <p style={{ fontSize: 11, color: "var(--tm)", marginTop: 0 }}>
          {received
            ? "Barang sudah diterima. Betulkan jumlah & harga yang benar-benar diterima; Qty PO, faktur, stok, dan hutang ikut otomatis."
            : "Barang belum diterima. Qty PO dan harga bisa diubah langsung."}
        </p>
        <input type="hidden" name="po_id" value={poId} />
        <input type="hidden" name="po_item_id" value={row.id} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="request_key" value={requestKey} />
        <input type="hidden" name="expected" value={preview ? JSON.stringify(preview) : ""} />
        <div className="frow" style={{ marginBottom: 10 }}>
          <div>
            <label className="flab">Qty PO ({row.satuan ?? "unit"})</label>
            {received
              ? <input className="fi" value={preview ? num(preview.new_qty) : `${num(row.qty)} (ikut otomatis)`} readOnly />
              : <NumberInput className="fi" type="number" name="qty" min={0} step="any" required value={qty} onChange={changed(setQty)} />}
          </div>
          {received && <div>
            <label className="flab">Qty diterima *</label>
            <NumberInput className="fi" type="number" name="qty_terima" min={0} max={Number(row.qty_terima ?? 0)} step="any" required value={qtyTerima} onChange={changed(setQtyTerima)} />
          </div>}
        </div>
        <div className="frow" style={{ marginBottom: 10 }}>
          <div>
            <label className="flab">{received ? "Harga diterima *" : "Harga *"} per {row.satuan ?? "unit"}</label>
            <NumberInput className="fi" type="number" name="harga" min={0} step="any" required value={harga} onChange={changed(setHarga)} />
          </div>
          <div>
            <label className="flab">Tanggal koreksi *</label>
            <input className="fi" type="date" name="tanggal" max={today} required value={tanggal} onChange={changed(setTanggal)} />
          </div>
        </div>
        <label className="flab">Alasan *</label>
        <input className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: vendor cuma kirim 30" />

        {error && <div role="alert" className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginTop: 10 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>}
        {preview && <div role="status" style={{ marginTop: 10, fontSize: 11.5, background: "var(--bg2, #f6f5f1)", borderRadius: 8, padding: "8px 10px", lineHeight: 1.6 }}>
          <div><b>Dampak perubahan</b></div>
          <div>Qty PO: {num(preview.old_qty)} → {num(preview.new_qty)} {preview.satuan ?? ""}</div>
          {preview.path === "invoice" && <div>Qty diterima: {num(preview.old_qty_terima)} → {num(preview.new_qty_terima)} {preview.satuan ?? ""}</div>}
          {preview.path === "invoice" && preview.old_harga_faktur != null && preview.old_harga_faktur !== preview.old_harga
            && <div>Harga faktur {preview.no_faktur}: {rp(preview.old_harga_faktur)} → {rp(preview.new_harga)}</div>}
          <div>Harga PO: {rp(preview.old_harga)} → {rp(preview.new_harga)}</div>
          <div>Total PO: {rp(preview.old_total)} → {rp(preview.total)}</div>
          {preview.path === "invoice" && <>
            {preview.removed_qty > 0 && <div>Stok dikurangi {num(preview.removed_qty)} {preview.satuan ?? ""}</div>}
            {preview.ap_delta !== 0 && <div>Hutang faktur {preview.no_faktur}: {preview.ap_delta > 0 ? "+" : ""}{rp(preview.ap_delta)}</div>}
            {preview.inventory_delta !== 0 && <div>Nilai stok: {preview.inventory_delta > 0 ? "+" : ""}{rp(preview.inventory_delta)}</div>}
            {preview.hpp_delta !== 0 && <div>HPP (barang sudah terjual): {preview.hpp_delta > 0 ? "+" : ""}{rp(preview.hpp_delta)}</div>}
            {preview.ppn_delta !== 0 && <div>PPN masukan: {preview.ppn_delta > 0 ? "+" : ""}{rp(preview.ppn_delta)}</div>}
          </>}
        </div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn-def" onClick={() => dialog.current?.close()}>Tutup</button>
          {preview
            ? <button type="submit" className="btn-acc" disabled={pending}><i className="ti ti-device-floppy" /> {pending ? "Menyimpan…" : "Simpan"}</button>
            : <button type="button" className="btn-acc" onClick={check} disabled={pending}>{pending ? "Memeriksa…" : "Lihat dampak"}</button>}
        </div>
      </form>
    </dialog>
  </>;
}
