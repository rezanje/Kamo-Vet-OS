import Link from "next/link";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { ImporForm } from "./ImporForm";
import { InventoryImportWorkspace, type RecoverableMasterBatch, type RecoverableStockBatch } from "./InventoryImportWorkspace";
import { recoverInitialStock } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { GroupComponentImport } from "./GroupComponentImport";
import { bacaProgresDariRingkasan } from "@/lib/impor-accurate-batch";

export default async function ImporBarangPage({
  searchParams,
}: {
  searchParams: Promise<{
    run_id?: string;
    error?: string;
    import_success?: string;
    stock_count?: string;
    problem_count?: string;
  }>;
}) {
  const { error, run_id, import_success, stock_count, problem_count } = await searchParams;
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
        progress: run.summary && typeof run.summary === "object" && !Array.isArray(run.summary) && "progress" in run.summary
          ? bacaProgresDariRingkasan(run.summary) : null,
      }));
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
          <InventoryImportWorkspace batches={batches} masterBatches={masterBatches} masterError={masterError} recovered={recovered} initialReceipt={initialReceipt} />
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
