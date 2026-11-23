import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ListLoadFailure } from "@/components/ListPagination";
import { SecHeader } from "@/components/SecHeader";
import { INVOP_PATH } from "@/lib/inventaris-operasional";
import { loadInvopContext, loadInvopItems } from "@/lib/inventaris-operasional-server";
import { InvopHeader, TanpaCabang } from "../InvopHeader";
import { OpnameForm } from "./OpnameForm";

export default async function OpnameOperasionalPage({ searchParams }: {
  searchParams: Promise<{ cabang?: string; error?: string }>;
}) {
  const { cabang, error } = await searchParams;
  let ctx, items;
  try {
    ctx = await loadInvopContext(cabang);
    items = ctx.branch ? await loadInvopItems(ctx.supabase, ctx.branch.id) : [];
  } catch (loadError) {
    return <ListLoadFailure error={loadError} label="Opname inventaris operasional" />;
  }
  const { branches, branch } = ctx;

  return (
    <>
      <InvopHeader active="opname" branches={branches} branch={branch} error={error} />
      {!branch ? <TanpaCabang /> : (
        <div className="crm-sec">
          <SecHeader num="01" title={`OPNAME · ${branch.name.toUpperCase()}`}
            desc="Hitung semua barang lalu isi jumlah fisiknya. Bila berbeda dari catatan, isi alasannya. Saat disimpan, jumlah tercatat diganti hasil hitungan dan tiap perubahan masuk riwayat." />
          {items.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--td)", fontSize: 11, padding: "20px 0" }}>
              Belum ada perlengkapan untuk dihitung. <Link href={`${INVOP_PATH}?cabang=${branch.id}`}>Tambah barang dulu</Link>.
            </div>
          ) : (
            <OpnameForm branchId={branch.id} requestKey={randomUUID()} items={items} />
          )}
        </div>
      )}
    </>
  );
}
