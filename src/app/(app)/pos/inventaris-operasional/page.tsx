import { randomUUID } from "node:crypto";
import { ListLoadFailure } from "@/components/ListPagination";
import { SecHeader } from "@/components/SecHeader";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtQty } from "@/lib/inventaris-operasional";
import { loadInvopContext, loadInvopItems } from "@/lib/inventaris-operasional-server";
import { tambahBarangOperasional } from "./actions";
import { InvopHeader, TanpaCabang } from "./InvopHeader";

const fmtWaktu = (v: string) => new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function InventarisOperasionalPage({ searchParams }: {
  searchParams: Promise<{ cabang?: string; success?: string; error?: string }>;
}) {
  const { cabang, success, error } = await searchParams;
  let ctx, items;
  try {
    ctx = await loadInvopContext(cabang);
    items = ctx.branch ? await loadInvopItems(ctx.supabase, ctx.branch.id) : [];
  } catch (loadError) {
    return <ListLoadFailure error={loadError} label="Inventaris operasional" />;
  }
  const { branches, branch } = ctx;

  return (
    <>
      <InvopHeader active="daftar" branches={branches} branch={branch} success={success} error={error} />
      {!branch ? <TanpaCabang /> : (
        <>
          <div className="crm-sec">
            <SecHeader num="01" title="PERLENGKAPAN CABANG"
              desc="Barang operasional cabang seperti sapu, ember, dan alat pel. Hanya jumlah: tidak masuk stok barang jual, jurnal, atau penyusutan. Jumlah berubah lewat Opname." />
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 560 }}>
                <thead><tr><th>Nama Barang</th><th>Satuan</th><th style={{ textAlign: "right" }}>Jumlah Tercatat</th><th>Terakhir Berubah</th></tr></thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.id}>
                      <td style={{ fontWeight: 500, fontSize: 11.5 }}>{i.nama}</td>
                      <td style={{ fontSize: 11.5 }}>{i.satuan}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{fmtQty(i.qty)}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtWaktu(i.updated_at)}</td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                      Belum ada perlengkapan di {branch.name}. Tambahkan di bawah.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="crm-sec">
            <SecHeader num="02" title="TAMBAH BARANG" desc="Jumlah awal dicatat di riwayat sebagai saldo awal, lengkap dengan nama petugas dan waktunya." />
            <form action={tambahBarangOperasional} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <input type="hidden" name="branch_id" value={branch.id} />
              <input type="hidden" name="request_key" value={randomUUID()} />
              <label style={{ fontSize: 11 }}>Nama barang
                <input className="fi" name="nama" required minLength={2} maxLength={120} placeholder="mis. Sapu ijuk" style={{ display: "block", width: 220 }} />
              </label>
              <label style={{ fontSize: 11 }}>Satuan
                <input className="fi" name="satuan" required maxLength={30} placeholder="pcs" style={{ display: "block", width: 100 }} />
              </label>
              <label style={{ fontSize: 11 }}>Jumlah awal
                <NumberInput className="fi" name="qty" type="number" min={0} step="0.01" required placeholder="0" style={{ display: "block", width: 110 }} />
              </label>
              <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…">Tambah</SubmitButton>
            </form>
          </div>
        </>
      )}
    </>
  );
}
