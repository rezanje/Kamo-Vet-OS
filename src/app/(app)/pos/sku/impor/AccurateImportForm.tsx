"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ACCURATE_MATRIX_COLUMNS,
  type AccurateMatrixColumn,
  type AccuratePreviewStatus,
} from "@/lib/impor-accurate";
import {
  konfirmasiImporAccurate,
  postSaldoAwalAccurate,
  previewImporAccurate,
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

const DEFAULT_MATRIX_COLUMNS: AccurateMatrixColumn[] = [
  "item_type", "category_name", "unit", "sell_price", "buy_price",
];

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

export function AccurateImportForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [categoryFile, setCategoryFile] = useState<File | null>(null);
  const [state, setState] = useState<AccurateImportState | null>(null);
  const [localError, setLocalError] = useState("");
  const [showSame, setShowSame] = useState(false);
  const [visibleMatrixColumns, setVisibleMatrixColumns] = useState<AccurateMatrixColumn[]>(DEFAULT_MATRIX_COLUMNS);
  const [progress, setProgress] = useState<AccurateImportProgress | null>(null);
  const [oneClickStatus, setOneClickStatus] = useState("");
  const [oneClickStockState, setOneClickStockState] = useState<InitialStockState | null>(null);
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

  const toggleMatrixColumn = (column: AccurateMatrixColumn) => {
    setVisibleMatrixColumns((current) => (
      current.includes(column)
        ? current.filter((value) => value !== column)
        : [...current, column]
    ));
  };

  const run = (action: (data: FormData) => Promise<AccurateImportState>) => {
    if (!files.length) {
      setLocalError("Pilih minimal satu file Accurate .xlsx terlebih dulu.");
      return;
    }
    setLocalError("");
    startTransition(async () => {
      const data = new FormData();
      files.forEach((file) => data.append("files", file));
      if (categoryFile) data.append("category_file", categoryFile);
      const isConfirmation = action === konfirmasiImporAccurate;
      if (isConfirmation && state?.run_id) data.append("run_id", state.run_id);
      if (isConfirmation && state?.run_id) {
        setProgress({ phase: "menyiapkan", completed: 0, total: state.rows.length, percentage: 0 });
        startProgressPolling(state.run_id);
      }
      try {
        setState(await action(data));
      } finally {
        if (isConfirmation) {
          stopProgressPolling();
          setProgress(null);
        }
      }
    });
  };

  const importSekali = () => {
    if (files.length !== 1) {
      setLocalError("Import Sekali memakai satu file Excel yang memuat master dan saldo stok awal.");
      return;
    }
    const file = files[0];
    setLocalError("");
    setOneClickStockState(null);
    startTransition(async () => {
      const masterData = new FormData();
      masterData.append("files", file);
      if (categoryFile) masterData.append("category_file", categoryFile);
      setOneClickStatus("Mengecek master Barang & Jasa…");
      const masterPreview = await previewImporAccurate(masterData);
      setState(masterPreview);
      if (!masterPreview.ok || !masterPreview.run_id) {
        setOneClickStatus("");
        return;
      }

      let masterDone = masterPreview;
      if (masterPreview.phase === "preview") {
        setOneClickStatus("Menyimpan master Barang & Jasa…");
        const confirmData = new FormData();
        confirmData.append("files", file);
        confirmData.append("run_id", masterPreview.run_id);
        if (categoryFile) confirmData.append("category_file", categoryFile);
        masterDone = await konfirmasiImporAccurate(confirmData);
        setState(masterDone);
      }
      if (!masterDone.ok || !masterDone.run_id) {
        setOneClickStatus("");
        return;
      }

      setOneClickStatus("Mengecek saldo stok awal…");
      const stockPreviewData = new FormData();
      stockPreviewData.append("initial_stock_file", file);
      stockPreviewData.append("master_run_id", masterDone.run_id);
      const stockPreview = await previewSaldoAwalAccurate(stockPreviewData);
      setOneClickStockState(stockPreview);
      if (!stockPreview.ok || !stockPreview.run_id || !stockPreview.branch_id || !stockPreview.warehouse_id || !stockPreview.as_of) {
        setOneClickStatus("");
        return;
      }

      setOneClickStatus("Menyimpan saldo stok awal…");
      const stockPostData = new FormData();
      stockPostData.append("initial_stock_file", file);
      stockPostData.append("master_run_id", masterDone.run_id);
      stockPostData.append("run_id", stockPreview.run_id);
      stockPostData.append("branch_id", stockPreview.branch_id);
      stockPostData.append("warehouse_id", stockPreview.warehouse_id);
      stockPostData.append("as_of", stockPreview.as_of);
      stockPostData.append("confirm_scope", "on");
      setOneClickStockState(await postSaldoAwalAccurate(stockPostData));
      setOneClickStatus("");
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

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-file-spreadsheet" /> Barang &amp; Jasa .xlsx (bisa banyak)
          <input
            type="file"
            multiple
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
              setState(null);
              setLocalError("");
              setShowSame(false);
              setProgress(null);
              stopProgressPolling();
            }}
          />
        </label>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-hierarchy-2" /> Kategori Barang .xlsx
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={(event) => {
              setCategoryFile(event.target.files?.[0] ?? null);
              setState(null);
              setLocalError("");
            }}
          />
        </label>
        <button type="button" className="btn-acc" disabled={pending || !files.length}
          onClick={() => run(previewImporAccurate)} style={{ background: "var(--posb)" }}>
          <i className={`ti ${pending ? "ti-loader-2" : "ti-eye"}`} /> {pending ? "Memproses…" : "Cek perubahan"}
        </button>
        <button type="button" className="btn-acc" disabled={pending || files.length !== 1}
          onClick={importSekali} style={{ background: "#15803d" }}>
          <i className={`ti ${pending ? "ti-loader-2" : "ti-database-import"}`} /> {pending ? "Mengimpor…" : "Import Sekali"}
        </button>
        {files.length > 0 && <span style={{ fontSize: 11, color: "var(--tm)" }}><i className="ti ti-paperclip" /> {files.length} file master dipilih</span>}
        {categoryFile && <span style={{ fontSize: 11, color: "var(--tm)" }}><i className="ti ti-paperclip" /> {categoryFile.name}</span>}
      </div>

      {(localError || (state && !state.ok)) && (
        <div className="p2ban" style={{ marginTop: 12, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {localError || state?.message}
        </div>
      )}

      {pending && !progress && (
        <div role="status" aria-live="polite" style={{ marginTop: 12, padding: 11, border: ".5px solid #93c5fd", borderRadius: 8, background: "#eff6ff", color: "#1e3a8a" }}>
          <div style={{ fontSize: 11, fontWeight: 800 }}>{oneClickStatus || "Membaca file dan mengecek perubahan…"}</div>
          <progress style={{ width: "100%", height: 7, marginTop: 8 }} />
        </div>
      )}

      {pending && progress && (
        <div role="status" aria-live="polite" style={{ marginTop: 12, padding: 11, border: ".5px solid #93c5fd", borderRadius: 8, background: "#eff6ff", color: "#1e3a8a" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, fontWeight: 800 }}>
            <span>{progress.phase === "menyiapkan" ? "Mengunggah dan membaca file…" : "Menyimpan Barang & Jasa…"}</span>
            <span>{progress.percentage}%</span>
          </div>
          <div style={{ height: 7, overflow: "hidden", borderRadius: 999, background: "#bfdbfe", marginTop: 8 }}>
            <div style={{ width: `${progress.percentage}%`, height: "100%", borderRadius: "inherit", background: "#2563eb", transition: "width .25s ease" }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 10.5 }}>
            {progress.total > 0
              ? `${progress.completed.toLocaleString("id-ID")} dari ${progress.total.toLocaleString("id-ID")} barang/jasa selesai diproses`
              : "Menyiapkan proses impor"}
          </div>
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
            {state.phase === "preview" ? (
              <button type="button" className="btn-acc" disabled={pending || !state.ok || !state.run_id}
                onClick={() => run(konfirmasiImporAccurate)} style={{ background: "#15803d" }}>
                <i className="ti ti-database-import" /> {pending ? "Mengimpor…" : "Konfirmasi impor master"}
              </button>
            ) : (
              <span style={{ fontSize: 10.5, color: "#166534", fontWeight: 800 }}>
                <i className="ti ti-circle-check" /> Master siap. Lanjut cek saldo stok di bawah.
              </span>
            )}
            <span style={{ fontSize: 10.5, color: state.ok ? "#166534" : "#b91c1c" }}>{state.message}</span>
            {state.phase === "preview" && state.source_fingerprint && (
              <span style={{ fontSize: 10, color: "var(--tm)" }}>Batch: {state.source_fingerprint}</span>
            )}
          </div>
        </>
      )}

      <InitialStockImport
        key={state?.run_id ?? "belum-ada-master"}
        sourceFile={files.length === 1 ? files[0] : null}
        masterRunId={state?.phase === "done" ? state.run_id : null}
        presetState={oneClickStockState}
        onPresetStateChange={setOneClickStockState}
      />
    </div>
  );
}
