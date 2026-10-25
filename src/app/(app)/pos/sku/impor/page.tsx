import Link from "next/link";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { ImporForm } from "./ImporForm";
import { InventoryImportWorkspace, type RecoverableMasterBatch, type RecoverableStockBatch, type RejectedMasterRows } from "./InventoryImportWorkspace";
import { recoverInitialStock } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { GroupComponentImport } from "./GroupComponentImport";
import { bacaProgresDariRingkasan } from "@/lib/impor-accurate-batch";

export default async function ImporBarangPage({
  searchParams,
}: {
  searchParams: Promise<{
    run_id?: string;
    master_run_id?: string;
    master_page?: string;
    error?: string;
    import_success?: string;
    stock_count?: string;
    problem_count?: string;
  }>;
}) {
  const { error, run_id, master_run_id, master_page, import_success, stock_count, problem_count } = await searchParams;
  const boleh = await bolehKelolaMaster();
  const initialReceipt = import_success === "1"
    ? {
        stockCount: Math.max(0, Number.parseInt(stock_count ?? "0", 10) || 0),
        problemCount: Math.max(0, Number.parseInt(problem_count ?? "0", 10) || 0),
      }
    : null;

  let batches: RecoverableStockBatch[] = [];
  let masterBatches: RecoverableMasterBatch[] = [];
  let recoveryError: string | null = null;
  let masterError: string | null = null;
  let masterReview: RejectedMasterRows | null = null;
  if (boleh) {
    const db = await createClient(); const {data:{user}} = await db.auth.getUser();
    if (user) {
      const [stockResult, masterResult] = await Promise.all([
        db.from("import_runs").select("id,source_name,status,as_of_date")
          .eq("kind","initial_stock").eq("created_by",user.id).order("created_at",{ascending:false}).limit(20),
        db.from("import_runs").select("id,source_name,status,summary")
          .eq("kind","master_accurate").eq("created_by",user.id).order("created_at",{ascending:false}).limit(20),
      ]);
      batches = stockResult.data ?? [];
      recoveryError = stockResult.error?.message ?? null;
      masterError = masterResult.error?.message ?? null;
      masterBatches = (masterResult.data ?? []).map((run) => ({
        id: run.id,
        source_name: run.source_name,
        status: run.status,
        rejectedCount: run.summary && typeof run.summary === "object" && !Array.isArray(run.summary)
          && "Ditolak" in run.summary && Number.isSafeInteger(run.summary.Ditolak) && run.summary.Ditolak >= 0
          ? run.summary.Ditolak : null,
        progress: run.summary && typeof run.summary === "object" && !Array.isArray(run.summary) && "progress" in run.summary
          ? bacaProgresDariRingkasan(run.summary) : null,
      }));
      if (master_run_id) {
        const selected = masterBatches.find(batch => batch.id === master_run_id);
        const rawPage = Number(master_page ?? 1);
        const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage < 100000 ? rawPage : 1;
        masterReview = {runId: master_run_id, sourceName: selected?.source_name ?? "Batch master", page, rows: [], hasNext: false, error: null};
        if (!selected) masterReview.error = "Batch master tidak dapat diakses dari daftar akun ini.";
        else if (!selected.rejectedCount || page > Math.ceil(selected.rejectedCount / 50)) masterReview.error = "Halaman baris ditolak tidak tersedia untuk batch ini.";
        else {
          const start = (page - 1) * 50;
          const result = await db.from("import_run_rows").select("id,source_row,source_code,reason,payload")
            .eq("run_id", master_run_id).eq("status", "rejected")
            .order("source_row", {ascending:true}).order("id", {ascending:true}).range(start, start + 50);
          if (result.error) masterReview.error = "Rincian baris ditolak belum dapat dimuat. Coba lagi setelah memeriksa status batch.";
          else if ((result.data ?? []).length !== Math.min(50, selected.rejectedCount - start) + (start + 50 < selected.rejectedCount ? 1 : 0))
            masterReview.error = "Jumlah rincian baris ditolak tidak cocok dengan status batch. Periksa batch sebelum melanjutkan.";
          else {
            masterReview.rows = (result.data ?? []).slice(0, 50).map(row => ({
              source_row:row.source_row,source_code:row.source_code,reason:row.reason,
              source:row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) && typeof row.payload.source === "string"
                ? row.payload.source : null,
            }));
            masterReview.hasNext = start + 50 < selected.rejectedCount;
          }
        }
      }
    }
  }
  const recovered = boleh && run_id ? await recoverInitialStock(run_id) : null;
  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/pos/sku" className="back-btn"><i className="ti ti-arrow-left" /> Barang &amp; Jasa</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-file-spreadsheet" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>IMPOR BARANG</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Migrasi master dari Accurate XLSX atau file CSV</div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {!boleh ? (
        <div className="p2ban">
          <i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang boleh mengimpor barang.
        </div>
      ) : (
        <>
          {recoveryError && <p role="alert">Daftar batch belum dapat dimuat: {recoveryError}</p>}
          <InventoryImportWorkspace batches={batches} masterBatches={masterBatches} masterError={masterError} masterReview={masterReview} recovered={recovered} initialReceipt={initialReceipt} />
          <GroupComponentImport />

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 10px" }}>
            <div style={{ height: 1, background: "var(--bd)", flex: 1 }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--tm)" }}>IMPOR CSV GENERIK</span>
            <div style={{ height: 1, background: "var(--bd)", flex: 1 }} />
          </div>
          <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af" }}>
            <i className="ti ti-bulb" /> Dari Excel: <b>File → Save As → CSV</b>, lalu pilih filenya di bawah.
            Baris yang bermasalah dilewati dan dilaporkan — sisanya tetap masuk.
          </div>
          <ImporForm />
        </>
      )}
    </>
  );
}
