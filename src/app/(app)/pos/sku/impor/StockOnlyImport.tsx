"use client";

import Link from "next/link";
import {InitialStockDecimalPreview} from "./InitialStockDecimalPreview";
import { useEffect, useRef, useState } from "react";
import { previewSaldoAwalAccurate, type InitialStockState } from "./actions";

export function StockOnlyImport() {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [normalize, setNormalize] = useState(false);
  const [state, setState] = useState<InitialStockState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), request = useRef<number | null>(null);
  useEffect(() => () => { generation.current += 1; }, []);
  const invalidate = () => { generation.current += 1; request.current = null; setState(null); setError(""); setBusy(false); };
  const prepare = async (selection?: {branchId:string;warehouseId:string}) => {
    if (!file || !date || request.current !== null) return;
    const token = generation.current; request.current = token; setBusy(true); setError("");
    const data = new FormData();
    data.set("initial_stock_file", file); data.set("initial_stock_as_of", date);
    if (selection) { data.set("scope_branch_id", selection.branchId); data.set("scope_warehouse_id", selection.warehouseId); }
    data.set("import_mode", "stock_only"); data.set("valuation_policy", normalize ? "HALF_UP_BATCH_V1" : "STRICT");
    try {
      const result = await previewSaldoAwalAccurate(data);
      if (token !== generation.current) return;
      setState(result);
      if (result.ok && result.run_id) window.history.replaceState(window.history.state, "", `/pos/sku/impor?run_id=${encodeURIComponent(result.run_id)}`);
    } catch {
      if (token === generation.current) setError("Hasil persiapan belum dapat dipastikan. Periksa batch tersimpan dengan muat ulang halaman; pilih ulang file yang sama bila belum ditemukan. Jangan menganggap stok/jurnal sudah masuk.");
    } finally {
      if (token === generation.current) { request.current = null; setBusy(false); }
    }
  };
  return <section className="crm-sec">
    <h2 style={{fontSize:16}}>Saldo awal untuk SKU existing</h2>
    <p>Master: memakai jenis, satuan, konversi, dan aturan expiry yang sudah terdaftar. Kode baru, tidak aktif, atau ambigu ditahan; master tidak diperbarui.</p>
    <label>File saldo .xlsx <input type="file" accept=".xlsx" onChange={e=>{invalidate();setFile(e.target.files?.[0]??null);}} /></label>
    <label style={{display:"block",marginTop:10}}>Tanggal posisi saldo awal <input type="date" required value={date} onChange={e=>{invalidate();setDate(e.target.value);}} /></label>
    <label style={{display:"block",marginTop:10}}><input type="checkbox" checked={normalize} onChange={e=>{invalidate();setNormalize(e.target.checked);}} /> Saya memilih normalisasi HALF_UP total batch ke dua desimal, dengan alokasi residu deterministik ke HPP yang dapat menyimpannya tepat.</label>
    <p>Nilai dan kuantitas asli tetap disimpan. Target dihitung dari file, bukan nilai kontrol Accurate yang diasumsikan. Jika residu tidak dapat direpresentasikan tepat, batch ditahan. OWNER tetap harus memeriksa nilai, akun ekuitas, dan konfirmasi sebelum posting.</p>
    <button type="button" className="btn-acc" disabled={!file||!date||busy||Boolean(state?.ok)} onClick={()=>void prepare()}>Siapkan batch saldo</button>
    {busy&&<p role="status">Persiapan: menyiapkan batch. Stok dan jurnal belum diposting.</p>}
    {(error||(state&&!state.ok))&&<p role="alert">{error||state?.message}</p>}
    <InitialStockDecimalPreview preview={state?.decimal_preview}/>
    {state?.scope_clarification&&<div role="group" aria-label="Pilih tujuan saldo">
      <p>Konfirmasi alias sumber: {state.scope_clarification.sourceBranch} / {state.scope_clarification.sourceWarehouse}. Pilih hanya jika tujuan berikut adalah gudang yang sama.</p>
      {state.scope_clarification.candidates.map(candidate=><button type="button" className="btn-def" key={candidate.warehouse.id} disabled={busy} onClick={()=>void prepare({branchId:candidate.branch.id,warehouseId:candidate.warehouse.id})}>Gunakan {candidate.branch.name} / {candidate.warehouse.name}</button>)}
    </div>}
    {state?.ok&&state.run_id&&<div role="status">
      <p>Persiapan: batch tersimpan. Review: {state.phase==='done'?'sudah diposting; periksa bukti':'menunggu OWNER'}. {state.phase!=='done'&&'Stok dan jurnal belum diposting.'}</p>
      <StockValuation state={state}/>
      <Link className="btn-acc" href={`/keuangan/persediaan-awal?run_id=${encodeURIComponent(state.run_id)}`}>Tinjau stok + jurnal / bukti posting</Link>
    </div>}
    <p>File browser tidak bertahan setelah reload. Batch yang sudah tersimpan dapat dipulihkan dari daftar di atas; file yang belum tersimpan harus dipilih ulang. Bila file/tanggal diubah saat permintaan berjalan, hasil lama tidak dipakai; batch lama yang sempat tersimpan tetap dapat diperiksa setelah reload.</p>
  </section>;
}

export function StockValuation({state}:{state:InitialStockState}) {
  const v=state.valuation;
  if(!v)return null;
  return <dl style={{overflowWrap:"anywhere"}}>
    <dt>Kebijakan valuasi</dt><dd>{v.policy}</dd>
    <dt>Nilai sumber presisi penuh (Rp)</dt><dd>{v.source_value}</dd>
    <dt>Nilai stok dan jurnal yang ditinjau (Rp)</dt><dd>{v.posted_value}</dd>
    <dt>Residu terhadap sumber (Rp)</dt><dd>{v.residual}</dd>
    {v.allocated_source_row!=null&&<><dt>Baris alokasi residu</dt><dd>{v.allocated_source_row}</dd></>}
  </dl>;
}
