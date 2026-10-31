import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ALL_BRANCHES, BRANCH_HEADER, MODE_HEADER, branchSelectionUrl } from "@/lib/operational-context";
import { branchDisplayName, type BranchForDisplay } from "@/lib/branch-display";

export async function ActiveBranch({ catalog = [] }: { catalog?: BranchForDisplay[] } = {}) {
  const requestHeaders = await headers();
  const branchId = requestHeaders.get(BRANCH_HEADER);
  const mode = requestHeaders.get(MODE_HEADER);
  if (!branchId || (mode !== "klinik" && mode !== "petshop")) return null;
  // Klinik-A: cabang aktif yang sudah ada di katalog cabang aktif pemanggil tidak dibaca ulang.
  const fromCatalog = catalog.find((row) => (row as { id?: string }).id === branchId);
  const { data: branch } = branchId === ALL_BRANCHES
    ? { data: { code: "ALL", name: "Semua cabang", type: null } }
    : fromCatalog ? { data: fromCatalog }
    : await (await createClient()).from("branches").select("name, code, type").eq("id", branchId).maybeSingle();
  const name = branch && mode === "klinik" && branchId !== ALL_BRANCHES ? branchDisplayName(branch, catalog) : branch?.name;
  return <div role="status" className="p2ban no-print" style={{ padding: "8px 16px", margin: 0 }}>
    <strong>Cabang aktif: {branch?.code} · {name ?? "Gagal dimuat"}</strong>
    <Link href={branchSelectionUrl(mode)} prefetch={false} className="back-btn">Ganti cabang</Link>
  </div>;
}
