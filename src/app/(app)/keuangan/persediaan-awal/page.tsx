import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InventoryAccountingForm } from "./InventoryAccountingForm";
import type { InventoryAccountingAccount, InventoryAccountingBatch } from "./types";

export default async function InventoryAccountingPage({ searchParams }: { searchParams: Promise<{ run_id?: string }> }) {
  const { run_id: requestedRunId = "" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" || profile.is_active !== true) {
    return <div className="p2ban">Hanya OWNER aktif yang dapat meninjau dan memposting persediaan awal.</div>;
  }
  const [batchResult, accountResult] = await Promise.all([
    supabase.from("import_runs").select("id,source_name,status,as_of_date,branch_id,created_at").eq("kind", "initial_stock").order("created_at", { ascending: false }).limit(100),
    supabase.from("coa_accounts").select("id,code,name").eq("type", "EKUITAS").eq("is_active", true).eq("is_header", false).order("code"),
  ]);
  let batches = (batchResult.data ?? []) as InventoryAccountingBatch[];
  let exactError: string | null = null;
  // A deep link may refer to an older batch outside the latest 100; fetch only that exact ID.
  if (requestedRunId && /^[0-9a-f-]{36}$/i.test(requestedRunId) && !batches.some(batch => batch.id === requestedRunId)) {
    const exact = await supabase.from("import_runs").select("id,source_name,status,as_of_date,branch_id,created_at").eq("kind", "initial_stock").eq("id", requestedRunId).maybeSingle();
    exactError = exact.error?.message ?? (exact.data ? null : "Batch pada tautan tidak ditemukan atau tidak dapat diakses.");
    if (exact.data) batches = [exact.data as InventoryAccountingBatch, ...batches];
  }
  const error = batchResult.error?.message ?? accountResult.error?.message ?? exactError;

  return <>
    <Link href="/pos/sku/impor" className="back-btn">Kembali ke impor Accurate</Link>
    <section className="crm-sec" style={{ marginTop: 12 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Persediaan awal Accurate → Neraca cabang</h1>
      <p style={{ fontSize: 12, lineHeight: 1.6 }}>Tinjau batch, nilai asli, tanggal, cabang, dan akun ekuitas sebelum memposting stok serta jurnal dalam satu transaksi. Batch lama yang stoknya sudah masuk hanya menghasilkan laporan untuk keputusan keuangan.</p>
      <p style={{ fontSize: 11, color: "var(--tm)" }}>Daftar menampilkan 100 batch terbaru dan batch pada tautan langsung. Angka dari laporan bukan persetujuan penyesuaian historis.</p>
      {error ? <div className="p2ban" role="alert">Gagal memuat pilihan: {error}</div> : <InventoryAccountingForm batches={batches} accounts={(accountResult.data ?? []) as InventoryAccountingAccount[]} initialRunId={requestedRunId} />}
    </section>
  </>;
}
