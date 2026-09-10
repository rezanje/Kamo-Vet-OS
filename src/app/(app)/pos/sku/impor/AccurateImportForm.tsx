"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ACCURATE_MATRIX_COLUMNS,
  type AccurateMatrixColumn,
} from "@/lib/accurate-matrix";
import {
  type AccuratePreviewStatus,
} from "@/lib/impor-accurate";
import {
  konfirmasiImporAccurate,
  postSaldoAwalAccurate,
  previewImporAccurate,
  preflightSaldoAwalSekali,
  previewSaldoAwalAccurate,
  type AccurateImportProgress,
  type AccurateImportState,
  type InitialStockState,
} from "./actions";
import { InitialStockImport } from "./InitialStockImport";

const STATUS_STYLE: Record<AccuratePreviewStatus, { bg: string; color: string }> = {
  Baru: { bg: "#dcfce7", color: "#166534" },
  Update: { bg: "#dbeafe", color: "#1d4ed8" },
  Sama: { bg: "#f1f5f9", color: "#475569" },
  Dilewati: { bg: "#fef3c7", color: "#92400e" },
  Ditolak: { bg: "#fee2e2", color: "#b91c1c" },
};

const DEFAULT_MATRIX_COLUMNS: AccurateMatrixColumn[] = ACCURATE_MATRIX_COLUMNS.map((column) => column.key);

function MasterList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  const shown = values.slice(0, 8);
  return (
    <div style={{ fontSize: 10.5, lineHeight: 1.55 }}>
      <b>{label} baru ({values.length}):</b> {shown.join(", ")}
      {values.length > shown.length ? `, +${values.length - shown.length} lainnya` : ""}
    </div>
  );
}

export function AccurateImportForm({
  initialReceipt = null,
}: {
  initialReceipt?: { stockCount: number; problemCount: number } | null;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [categoryFile, setCategoryFile] = useState<File | null>(null);
  const [state, setState] = useState<AccurateImportState | null>(null);
  const [localError, setLocalError] = useState("");
  const [showSame, setShowSame] = useState(false);
  const [visibleMatrixColumns, setVisibleMatrixColumns] = useState<AccurateMatrixColumn[]>(DEFAULT_MATRIX_COLUMNS);
  const [progress, setProgress] = useState<AccurateImportProgress | null>(null);
  const [oneClickStatus, setOneClickStatus] = useState("");
  const [oneClickPercentage, setOneClickPercentage] = useState(0);
  const [flowMode, setFlowMode] = useState<"idle" | "checking" | "importing">("idle");
  const [receiptDismissed, setReceiptDismissed] = useState(false);
  const [oneClickStockState, setOneClickStockState] = useState<InitialStockState | null>(null);
  const [initialStockAsOf, setInitialStockAsOf] = useState("");
  const [scopeSelection, setScopeSelection] = useState<{ branchId: string; warehouseId: string } | null>(null);
  const [skipInitialStock, setSkipInitialStock] = useState(false);
  const [pending, startTransition] = useTransition();
  const progressTimer = useRef<number | null>(null);

  const stopProgressPolling = () => {
    if (progressTimer.current != null) window.clearInterval(progressTimer.current);
    progressTimer.current = null;
  };

  const startProgressPolling = (runId: string) => {
    const refresh = async () => {
      try {
        const response = await fetch(`/api/impor/accurate/progres?run_id=${encodeURIComponent(runId)}`, { cache: "no-store" });
        if (response.ok) setProgress(await response.json() as AccurateImportProgress);
      } catch { /* hasil akhir tetap dari aksi impor */ }
    };
    void refresh();
    progressTimer.current = window.setInterval(() => { void refresh(); }, 800);
  };

  useEffect(() => () => {
    if (progressTimer.current != null) window.clearInterval(progressTimer.current);
  }, []);

  const visibleRows = useMemo(
    () => (state?.rows ?? []).filter((row) => showSame || row.status !== "Sama"),
    [showSame, state],
  );
  const previewReady = Boolean(
    files.length === 1
    && initialStockAsOf
    && state?.ok
    && state.run_id
    && (skipInitialStock || (oneClickStockState?.ok && oneClickStockState.phase === "preview")),
  );
  const importComplete = Boolean(oneClickStockState?.ok && oneClickStockState.phase === "done");
  const successStockCount = importComplete
    ? oneClickStockState?.rows.filter((row) => row.status === "valid").length ?? 0
    : initialReceipt?.stockCount ?? 0;
  const successProblemCount = importComplete
    ? oneClickStockState?.rows.filter((row) => row.status === "rejected").length ?? 0
    : initialReceipt?.problemCount ?? 0;
  const successMasterCount = importComplete
    ? (state?.summary.Baru ?? 0) + (state?.summary.Update ?? 0)
    : null;
  const successMasterProblemCount = importComplete
    ? state?.summary.Ditolak ?? 0
    : 0;
  const showSuccessReceipt = importComplete || Boolean(initialReceipt && !receiptDismissed);
  const stockFailure = Boolean(oneClickStockState && !oneClickStockState.ok && !pending && !skipInitialStock);
  const canCheck = files.length === 1 && !pending && !previewReady && !importComplete;
  const canImportOnce = previewReady && !pending;
  const readyStockCount = oneClickStockState?.rows.filter((row) => row.status === "valid").length ?? 0;
  const shownPercentage = progress
    ? Math.min(70, 35 + Math.round(progress.percentage * 0.35))
    : oneClickPercentage;

  const toggleMatrixColumn = (column: AccurateMatrixColumn) => {
    setVisibleMatrixColumns((current) => (
      current.includes(column)
        ? current.filter((value) => value !== column)
        : [...current, column]
    ));
  };

  const isiPilihanTujuan = (data: FormData, selection = scopeSelection) => {
    if (!selection) return;
    data.append("scope_branch_id", selection.branchId);
    data.append("scope_warehouse_id", selection.warehouseId);
  };

  const cekPerubahanSekali = (selection = scopeSelection) => {
    if (files.length !== 1) {
      setLocalError("Cek perubahan dan saldo memakai satu file Excel yang sama.");
      return;
    }
    const file = files[0];
    setLocalError("");
    setScopeSelection(selection);
    setSkipInitialStock(false);
    setOneClickStockState(null);
    setFlowMode("checking");
    setOneClickPercentage(10);
    startTransition(async () => {
      const masterData = new FormData();
      masterData.append("files", file);
      if (categoryFile) masterData.append("category_file", categoryFile);
      setOneClickStatus("Mengecek master Barang & Jasa…");
      const masterPreview = await previewImporAccurate(masterData);
      setState(masterPreview);
      if (!masterPreview.ok) {
        setOneClickPercentage(100);
        setOneClickStatus(masterPreview.message);
        return;
      }
      setOneClickPercentage(60);
      setOneClickStatus("Mengecek saldo stok awal…");
      const stockData = new FormData();
      stockData.append("initial_stock_file", file);
      stockData.append("initial_stock_as_of", initialStockAsOf);
      isiPilihanTujuan(stockData, selection);
      const stockPreview = await preflightSaldoAwalSekali(stockData);
      setOneClickStockState(stockPreview);
      setOneClickPercentage(100);
      setOneClickStatus(stockPreview.ok ? "Pemeriksaan selesai. Import Sekali sudah bisa dijalankan." : stockPreview.message);
    });
  };

  const importSekali = () => {
    if (!previewReady || !state?.run_id || (!skipInitialStock && !oneClickStockState?.ok) || files.length !== 1) {
      setLocalError("Jalankan Cek perubahan sampai selesai sebelum Import Sekali.");
      return;
    }
    const file = files[0];
    const masterPreview = state;
    const masterRunId = state.run_id;
    setLocalError("");
    setFlowMode("importing");
    setOneClickPercentage(5);
    startTransition(async () => {
      let masterDone = masterPreview;
      if (masterPreview.phase === "preview") {
        setOneClickStatus("Menyimpan master Barang & Jasa…");
        setOneClickPercentage(35);
        setProgress({ phase: "menyiapkan", completed: 0, total: masterPreview.rows.length, percentage: 0 });
        startProgressPolling(masterRunId);
        const confirmData = new FormData();
        confirmData.append("files", file);
        confirmData.append("run_id", masterRunId);
        if (categoryFile) confirmData.append("category_file", categoryFile);
        try {
          masterDone = await konfirmasiImporAccurate(confirmData);
          setState(masterDone);
        } finally {
          stopProgressPolling();
          setProgress(null);
        }
      }
      if (!masterDone.ok || !masterDone.run_id) {
        setOneClickStatus(masterDone.message);
        return;
      }

      if (skipInitialStock) {
        setOneClickStockState({
          ok: true, phase: "done", message: "Master Barang & Jasa berhasil disimpan. Saldo dari file ini tidak diimpor.",
          branch_id: null, warehouse_id: null, as_of: null, run_id: null, master_run_id: masterDone.run_id,
          source_hash: null, rows: [], source_qty: 0, source_value: 0, checks: [], scope_clarification: null,
        });
        setOneClickPercentage(100);
        setOneClickStatus("Master Barang & Jasa berhasil disimpan. Saldo ditahan.");
        window.history.replaceState(window.history.state, "", "/pos/sku/impor?import_success=1&stock_count=0&problem_count=0");
        return;
      }

      setOneClickStatus("Menyiapkan saldo stok awal…");
      setOneClickPercentage(75);
      const stockPreviewData = new FormData();
      stockPreviewData.append("initial_stock_file", file);
      stockPreviewData.append("master_run_id", masterDone.run_id);
      stockPreviewData.append("initial_stock_as_of", initialStockAsOf);
      isiPilihanTujuan(stockPreviewData);
      const stockPreview = await previewSaldoAwalAccurate(stockPreviewData);
      setOneClickStockState(stockPreview);
      if (!stockPreview.ok || !stockPreview.run_id || !stockPreview.branch_id || !stockPreview.warehouse_id || !stockPreview.as_of) {
        setOneClickStatus(stockPreview.message);
        return;
      }

      setOneClickStatus("Menyimpan saldo stok awal…");
      setOneClickPercentage(90);
      const stockPostData = new FormData();
      stockPostData.append("initial_stock_file", file);
      stockPostData.append("master_run_id", masterDone.run_id);
      stockPostData.append("run_id", stockPreview.run_id);
      stockPostData.append("branch_id", stockPreview.branch_id);
      stockPostData.append("warehouse_id", stockPreview.warehouse_id);
      stockPostData.append("as_of", stockPreview.as_of);
      stockPostData.append("initial_stock_as_of", initialStockAsOf);
      stockPostData.append("confirm_scope", "on");
      isiPilihanTujuan(stockPostData);
      const postedStock = await postSaldoAwalAccurate(stockPostData);
      const postedRows = stockPreview.rows.filter((row) => row.status === "valid").length;
      const problemRows = stockPreview.rows.filter((row) => row.status === "rejected").length;
      setOneClickStockState(postedStock.ok && postedStock.phase === "done"
        ? { ...postedStock, rows: stockPreview.rows }
        : postedStock);
      setOneClickPercentage(100);
      setOneClickStatus(postedStock.message);
      if (postedStock.ok && postedStock.phase === "done") {
        const params = new URLSearchParams({
          import_success: "1",
          stock_count: String(postedRows),
          problem_count: String(problemRows),
        });
        window.history.replaceState(window.history.state, "", `/pos/sku/impor?${params.toString()}`);
      }
    });
  };

  return (
    <div className="crm-sec" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Impor Barang, Jasa &amp; Saldo Stok Awal</div>
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3, maxWidth: 700, lineHeight: 1.55 }}>
            Pakai export <b>Persediaan → Barang &amp; Jasa → Ekspor ke Excel</b> atau format Excel klien dengan kolom yang sama.
            Satu alur untuk master dan saldo stok dari file yang sama. Master tetap dicek dulu, lalu saldo dapat ditinjau sebelum diposting.
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#166534", background: "#dcfce7", borderRadius: 999, padding: "5px 9px" }}>
          SALDO DALAM ALUR INI
        </span>
      </div>

      <div className="p2ban" style={{ marginTop: 12, background: "#fffbeb", border: ".5px solid #fcd34d", color: "#854d0e" }}>
          <i className="ti ti-alert-triangle" /> Grup Accurate masuk sebagai nonaktif sampai rincian komponennya tersedia.
        Tambahkan export Kategori Barang supaya relasi induk/subkategori ikut diimpor.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 7, marginTop: 12 }}>
        {[
          { number: 1, label: "Pilih file", active: files.length === 0, done: files.length === 1 },
          { number: 2, label: "Cek perubahan", active: files.length === 1 && !previewReady && !importComplete, done: previewReady || importComplete },
          { number: 3, label: "Import Sekali", active: previewReady || (pending && flowMode === "importing"), done: importComplete },
        ].map((step) => (
          <div key={step.number} style={{
            display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 8,
            border: `.5px solid ${step.done ? "#86efac" : step.active ? "#93c5fd" : "#cbd5e1"}`,
            background: step.done ? "#f0fdf4" : step.active ? "#eff6ff" : "#f8fafc",
            color: step.done ? "#166534" : step.active ? "#1d4ed8" : "#64748b",
            fontSize: 10.5, fontWeight: 800,
          }}>
            <span style={{
              display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 999,
              background: step.done ? "#16a34a" : step.active ? "#2563eb" : "#94a3b8", color: "white", fontSize: 10,
            }}>
              {step.done ? <i className="ti ti-check" /> : step.number}
            </span>
            {step.label}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, alignItems: "center", marginTop: 12 }}>
        <Link href="/pos/sku/impor/template" className="btn-def" style={{ justifyContent: "center", textDecoration: "none" }}>
          <i className="ti ti-download" /> Download format Excel
        </Link>
        <label className="btn-def" style={{ cursor: "pointer", justifyContent: "center" }}>
          <i className="ti ti-file-spreadsheet" /> Pilih Barang &amp; Jasa .xlsx
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFiles(selected ? [selected] : []);
              setState(null);
              setOneClickStockState(null);
              setScopeSelection(null);
              setSkipInitialStock(false);
              setOneClickStatus("");
              setOneClickPercentage(0);
              setFlowMode("idle");
              setReceiptDismissed(true);
              window.history.replaceState(window.history.state, "", "/pos/sku/impor");
              setLocalError("");
              setShowSame(false);
              setVisibleMatrixColumns(DEFAULT_MATRIX_COLUMNS);
              setProgress(null);
              stopProgressPolling();
            }}
          />
        </label>
        <label className="btn-def" style={{ cursor: "pointer", justifyContent: "center" }}>
          <i className="ti ti-hierarchy-2" /> Kategori Barang .xlsx (opsional)
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={(event) => {
              setCategoryFile(event.target.files?.[0] ?? null);
              setState(null);
              setOneClickStockState(null);
              setScopeSelection(null);
              setSkipInitialStock(false);
              setOneClickStatus("");
              setOneClickPercentage(0);
              setFlowMode("idle");
              setLocalError("");
            }}
          />
        </label>
        <button type="button" className="btn-acc" disabled={!canCheck}
          onClick={() => cekPerubahanSekali()} style={{ background: canCheck ? "var(--posb)" : "#94a3b8", cursor: canCheck ? "pointer" : "not-allowed" }}>
          <i className={`ti ${pending && flowMode === "checking" ? "ti-loader-2" : "ti-eye"}`} /> {pending && flowMode === "checking" ? "Memproses…" : "Cek perubahan"}
        </button>
        <button type="button" className="btn-acc" disabled={!canImportOnce}
          onClick={importSekali} style={{ background: canImportOnce ? "#15803d" : "#94a3b8", cursor: canImportOnce ? "pointer" : "not-allowed" }}>
          <i className={`ti ${pending && flowMode === "importing" ? "ti-loader-2" : "ti-database-import"}`} /> {pending && flowMode === "importing" ? "Mengimpor…" : "Import Sekali"}
        </button>
        {files.length > 0 && <span style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--tm)" }}><i className="ti ti-paperclip" /> {files[0].name}</span>}
        {categoryFile && <span style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--tm)" }}><i className="ti ti-paperclip" /> {categoryFile.name}</span>}
      </div>

      <label style={{ display: "block", marginTop: 10, maxWidth: 300 }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 800, color: "var(--sb)", marginBottom: 4 }}>
          Tanggal posisi saldo awal <span style={{ color: "#b91c1c" }}>*</span>
        </span>
        <input
          type="date"
          required
          value={initialStockAsOf}
          onChange={(event) => {
            setInitialStockAsOf(event.target.value);
            setOneClickStockState(null);
            setScopeSelection(null);
            setSkipInitialStock(false);
            setOneClickStatus("");
            setLocalError("");
          }}
          style={{ width: "100%", padding: "8px 9px", borderRadius: 7, border: ".5px solid var(--bd)", background: "white" }}
        />
        <span style={{ display: "block", marginTop: 4, fontSize: 10, color: "var(--tm)", lineHeight: 1.45 }}>
          Wajib dipilih. Dipakai hanya bila Per Tanggal di file kosong; bila file berisi tanggal berbeda, impor akan diblokir.
        </span>
      </label>

      {(localError || (state && !state.ok)) && (
        <div className="p2ban" style={{ marginTop: 12, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {localError || state?.message}
        </div>
      )}

      {pending && (
        <div role="status" aria-live="polite" style={{ marginTop: 12, padding: 11, border: ".5px solid #93c5fd", borderRadius: 8, background: "#eff6ff", color: "#1e3a8a" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, fontWeight: 800 }}>
            <span>{oneClickStatus || (flowMode === "checking" ? "Mengecek file…" : "Memulai impor…")}</span>
            <span>{shownPercentage}%</span>
          </div>
          <div style={{ height: 7, overflow: "hidden", borderRadius: 999, background: "#bfdbfe", marginTop: 8 }}>
            <div style={{ width: `${shownPercentage}%`, height: "100%", borderRadius: "inherit", background: "#2563eb", transition: "width .25s ease" }} />
          </div>
          {progress && <div style={{ marginTop: 6, fontSize: 10.5 }}>
            {progress.total > 0
              ? `${progress.completed.toLocaleString("id-ID")} dari ${progress.total.toLocaleString("id-ID")} barang/jasa selesai diproses`
              : "Menyiapkan proses impor"}
          </div>}
        </div>
      )}

      {previewReady && !pending && (
        <div role="status" style={{ marginTop: 12, padding: 11, border: ".5px solid #86efac", borderRadius: 8, background: "#f0fdf4", color: "#166534", fontSize: 11, fontWeight: 800 }}>
          <i className="ti ti-circle-check" /> {skipInitialStock ? "Saldo ditahan sesuai pilihan. Import Sekali hanya menyimpan master Barang & Jasa." : "Pemeriksaan selesai. Tombol Import Sekali sudah aktif."}
        </div>
      )}

      {stockFailure && (
        <div role="alert" style={{ marginTop: 12, padding: 13, border: ".5px solid #fca5a5", borderRadius: 9, background: "#fef2f2", color: "#b91c1c" }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}><i className="ti ti-alert-circle" /> Saldo stok awal belum siap</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>{oneClickStockState?.message}</div>
          {oneClickStockState?.scope_clarification ? (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "white", border: ".5px solid #fecaca", color: "#7f1d1d" }}>
              <div style={{ fontSize: 11, fontWeight: 900 }}>Pilih tujuan saldo — sistem tidak akan menebak.</div>
              <div style={{ fontSize: 10.5, marginTop: 4 }}>
                Dari file: <b>{oneClickStockState.scope_clarification.sourceBranch}</b> · <b>{oneClickStockState.scope_clarification.sourceWarehouse}</b>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 8 }}>
                {oneClickStockState.scope_clarification.candidates.map((candidate) => (
                  <button key={candidate.warehouse.id} type="button" className="btn-def" disabled={pending}
                    onClick={() => cekPerubahanSekali({ branchId: candidate.branch.id, warehouseId: candidate.warehouse.id })}>
                    <i className="ti ti-link" /> Ini sama: {candidate.branch.name} · {candidate.warehouse.name}
                  </button>
                ))}
                <button type="button" className="btn-def" disabled={pending} onClick={() => {
                  setScopeSelection(null);
                  setSkipInitialStock(true);
                  setOneClickStatus("Saldo ditahan. Hanya master Barang & Jasa yang akan diimpor.");
                }}>
                  <i className="ti ti-player-stop" /> Beda, impor master saja
                </button>
              </div>
              <div style={{ fontSize: 10, marginTop: 7, color: "#9f1239" }}>Pilih kandidat hanya bila lo yakin itu gudang sama. Kalau beda, saldo tidak masuk dan tombol Import Sekali hanya menyimpan master barang.</div>
            </div>
          ) : (
            <div style={{ fontSize: 10.5, marginTop: 7, color: "#9f1239" }}>
              Barang dan jasa sudah terbaca. Pilih Tanggal posisi saldo awal atau perbaiki data saldo yang disebutkan, lalu pilih <b>Cek perubahan</b> lagi agar tombol Import Sekali aktif.
            </div>
          )}
        </div>
      )}

      {showSuccessReceipt && !pending && (
        <div role="status" style={{ marginTop: 12, padding: 13, border: ".5px solid #86efac", borderRadius: 9, background: "#f0fdf4", color: "#166534" }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}><i className="ti ti-circle-check" /> Import selesai</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>
            {successMasterCount != null
              ? `${successMasterCount.toLocaleString("id-ID")} barang dan jasa sudah disimpan.`
              : "Barang dan jasa sudah diperbarui."} {successStockCount.toLocaleString("id-ID")} saldo stok masuk.
            {successMasterProblemCount > 0 ? ` ${successMasterProblemCount} barang ditahan untuk diperbaiki.` : ""}
            {successProblemCount > 0 ? ` ${successProblemCount} saldo bermasalah dilewati untuk diperbaiki.` : ""}
          </div>
          <Link href="/pos/stok" className="btn-acc" style={{ display: "inline-flex", marginTop: 9, background: "#15803d", textDecoration: "none" }}>
            <i className="ti ti-box" /> Buka halaman Stok
          </Link>
        </div>
      )}

      {state && state.rows.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14, alignItems: "center" }}>
            {(Object.keys(STATUS_STYLE) as AccuratePreviewStatus[]).map((status) => (
              <span key={status} style={{
                fontSize: 10.5,
                fontWeight: 800,
                background: STATUS_STYLE[status].bg,
                color: STATUS_STYLE[status].color,
                borderRadius: 999,
                padding: "5px 9px",
              }}>
                {status} {state.summary[status]}
              </span>
            ))}
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#6d28d9", background: "#ede9fe", borderRadius: 999, padding: "5px 9px" }}>
              Subkategori {state.hierarchy_count}
            </span>
            <label style={{ fontSize: 10.5, color: "var(--tm)", display: "flex", gap: 5, alignItems: "center", marginLeft: 4 }}>
              <input type="checkbox" checked={showSame} onChange={(event) => setShowSame(event.target.checked)} />
              Tampilkan yang sama
            </label>
          </div>

          {state.phase === "preview" && (
            <div style={{ marginTop: 10, padding: 10, background: "#f8fafc", border: ".5px solid #cbd5e1", borderRadius: 8, color: "#334155" }}>
              <MasterList label="Kategori" values={state.new_masters.categories} />
              <MasterList label="Merek" values={state.new_masters.brands} />
              <MasterList label="Satuan" values={state.new_masters.units} />
              <MasterList label="Pemasok" values={state.new_masters.suppliers} />
              {!Object.values(state.new_masters).some((values) => values.length) && (
                <div style={{ fontSize: 10.5 }}>Tidak ada master pendukung baru.</div>
              )}
            </div>
          )}

          <details style={{ marginTop: 10, padding: "9px 10px", background: "#f8fafc", border: ".5px solid #cbd5e1", borderRadius: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 800, color: "#334155" }}>
              Atur kolom matriks ({visibleMatrixColumns.length}/{ACCURATE_MATRIX_COLUMNS.length})
            </summary>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 12px", marginTop: 9 }}>
              {ACCURATE_MATRIX_COLUMNS.map((column) => (
                <label key={column.key} style={{ fontSize: 10.5, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={visibleMatrixColumns.includes(column.key)}
                    onChange={() => toggleMatrixColumn(column.key)}
                  />
                  {column.label}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: "#64748b" }}>
              Kolom di sini hanya mengatur tampilan. Semua data master tetap diperiksa dan diimpor saat dikonfirmasi.
            </div>
          </details>

          <div style={{ marginTop: 10, maxHeight: 430, overflow: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
            <table className="dt" style={{ width: "100%", minWidth: 720 + (visibleMatrixColumns.length * 130) }}>
              <thead>
                <tr>
                  <th>Baris</th><th>Kode</th><th>Nama</th>
                  {ACCURATE_MATRIX_COLUMNS.filter((column) => visibleMatrixColumns.includes(column.key)).map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                  <th>Status</th><th>Perubahan / alasan</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={`${row.row_no}-${row.code}`}>
                    <td>{row.source || row.row_no}</td>
                    <td><code>{row.code}</code></td>
                    <td>{row.name}</td>
                    {ACCURATE_MATRIX_COLUMNS.filter((column) => visibleMatrixColumns.includes(column.key)).map((column) => (
                      <td key={column.key} style={{ fontSize: 10.5, color: "var(--tm)", whiteSpace: "nowrap" }}>
                        {row.matrix?.[column.key] || "—"}
                      </td>
                    ))}
                    <td>
                      <span style={{
                        fontSize: 9.5,
                        fontWeight: 800,
                        color: STATUS_STYLE[row.status].color,
                        background: STATUS_STYLE[row.status].bg,
                        padding: "3px 6px",
                        borderRadius: 999,
                      }}>{row.status}</span>
                    </td>
                    <td style={{ fontSize: 10.5, color: row.reason ? "#b91c1c" : "var(--tm)" }}>
                      {row.reason || row.changed_fields.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, color: state.ok ? "#166534" : "#b91c1c" }}>{state.message}</span>
            {state.phase === "preview" && state.source_fingerprint && (
              <span style={{ fontSize: 10, color: "var(--tm)" }}>Batch: {state.source_fingerprint}</span>
            )}
          </div>
        </>
      )}

      {oneClickStockState && (
        <InitialStockImport
          key={state?.run_id ?? "belum-ada-master"}
          sourceFile={files.length === 1 ? files[0] : null}
          masterRunId={state?.phase === "done" ? state.run_id : null}
          presetState={oneClickStockState}
          onPresetStateChange={setOneClickStockState}
        />
      )}

      {previewReady && !pending && !importComplete && (
        <div role="status" style={{ marginTop: 12, padding: 13, border: ".5px solid #86efac", borderRadius: 9, background: "#f0fdf4", color: "#166534" }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}><i className="ti ti-circle-check" /> Siap dilanjutkan</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>
            Master sudah dicek dan {readyStockCount.toLocaleString("id-ID")} saldo aman siap masuk. Tekan tombol ini untuk menyimpan semuanya.
          </div>
          <button type="button" className="btn-acc" onClick={importSekali} style={{ marginTop: 9, background: "#15803d" }}>
            <i className="ti ti-database-import" /> Lanjutkan Import Sekali
          </button>
        </div>
      )}
    </div>
  );
}
