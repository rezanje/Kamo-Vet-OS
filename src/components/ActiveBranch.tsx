import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { BRANCH_HEADER, MODE_HEADER, branchSelectionUrl } from "@/lib/operational-context";

export async function ActiveBranch() {
  const requestHeaders = await headers();
  const branchId = requestHeaders.get(BRANCH_HEADER);
  const mode = requestHeaders.get(MODE_HEADER);
  if (!branchId || (mode !== "klinik" && mode !== "petshop")) return null;
  const client = await createClient();
  const { data: branch } = await client.from("branches").select("name, code").eq("id", branchId).maybeSingle();
  return <div role="status" className="p2ban" style={{ padding: "8px 16px", margin: 0 }}>
    <strong>Cabang aktif: {branch?.code} · {branch?.name ?? "Gagal dimuat"}</strong>
    <Link href={branchSelectionUrl(mode)} prefetch={false} className="back-btn">Ganti cabang</Link>
  </div>;
}
