import Link from "next/link";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { createClient } from "@/lib/supabase/server";
import { ImporForm } from "./ImporForm";
import { AccurateImportForm } from "./AccurateImportForm";
import { GroupComponentImport } from "./GroupComponentImport";
import { InitialStockImport } from "./InitialStockImport";

export default async function ImporBarangPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const boleh = await bolehKelolaMaster();
  const supabase = boleh ? await createClient() : null;
  const [{ data: branches }, { data: warehouses }] = supabase
    ? await Promise.all([
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("warehouses").select("id, name, branch_id").eq("is_active", true).order("name"),
    ])
    : [{ data: [] }, { data: [] }];

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
          <AccurateImportForm />
          <GroupComponentImport />
          <InitialStockImport branches={branches ?? []} warehouses={warehouses ?? []} />

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
