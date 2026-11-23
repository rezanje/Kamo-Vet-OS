import { randomUUID } from "node:crypto";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { readListPage } from "@/lib/checked-list";
import { INVOP_PATH, fmtQty } from "@/lib/inventaris-operasional";
import { loadInvopContext, loadInvopItems } from "@/lib/inventaris-operasional-server";
import { InvopHeader, TanpaCabang } from "../InvopHeader";
import { batalkanPembelian } from "./actions";
import { PembelianForm, type PilihanKas } from "./PembelianForm";

type Row = {
  id: string; no_bukti: string; tanggal: string; qty: number; nominal: number; beban_code: string; actor_nama: string; catatan: string | null;
  voided_at: string | null; void_reason: string | null;
  operational_inventory_items: { nama: string; satuan: string } | null;
  cash_accounts: { nama: string } | null;
};

const rupiah = (n: number) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const fmtTgl = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

export default async function PembelianOperasionalPage({ searchParams }: {
  searchParams: Promise<{ cabang?: string; success?: string; error?: string; hal?: string }>;
}) {
  const { cabang, success, error, hal } = await searchParams;
  let ctx, items, page, bolehBeli = false, kas: PilihanKas[] = [], bebanCode = "";
  try {
    ctx = await loadInvopContext(cabang);
    const { supabase, branch } = ctx;
    if (branch) {
      const [allowed, kasRes, setelan] = await Promise.all([
        supabase.rpc("inventaris_operasional_beli_allowed"),
        supabase.from("cash_accounts").select("id,nama,branch_id").eq("is_active", true).or(`branch_id.is.null,branch_id.eq.${branch.id}`).order("nama"),
        supabase.from("operational_inventory_settings").select("beban_code").maybeSingle(),
      ]);
      bolehBeli = allowed.data === true;
      kas = ((kasRes.data ?? []) as { id: string; nama: string; branch_id: string | null }[]).map(k => ({ id: k.id, nama: k.nama, umum: k.branch_id === null }));
      bebanCode = String(setelan.data?.beban_code ?? "");
      items = await loadInvopItems(supabase, branch.id);
      page = await readListPage<Row>(async (from, to) => {
        const response = await supabase.from("operational_inventory_purchases")
          .select("id,no_bukti,tanggal,qty,nominal,beban_code,actor_nama,catatan,voided_at,void_reason,operational_inventory_items(nama,satuan),cash_accounts(nama)", { count: "exact" })
          .eq("branch_id", branch.id).order("created_at", { ascending: false }).order("id").range(from, to);
        return { ...response, data: response.data as unknown as Row[] | null };
      }, "Pembelian inventaris operasional", hal);
    }
  } catch (loadError) {
    return <ListLoadFailure error={loadError} label="Pembelian inventaris operasional" />;
  }
  const { branches, branch } = ctx;

  return (
    <>
      <InvopHeader active="pembelian" branches={branches} branch={branch} success={success} error={error} />
      {!branch || !page ? <TanpaCabang /> : (
        <>
          <div className="crm-sec">
            <SecHeader num="01" title={`CATAT PEMBELIAN · ${branch.name.toUpperCase()}`}
              desc={`Khusus Finance. Satu simpan mencatat Kas Keluar beserta nota dan jurnal beban (akun ${bebanCode || "—"}), lalu menambah jumlah barang. Barang lama/saldo awal tidak dijurnal ulang.`} />
            {bolehBeli ? (
              <PembelianForm branchId={branch.id} requestKey={randomUUID()} kas={kas}
                barang={(items ?? []).map(i => ({ id: i.id, nama: i.nama, satuan: i.satuan, qty: i.qty }))} />
            ) : (
              <div style={{ fontSize: 11, color: "var(--td)", padding: "8px 0" }}>Hanya akun Finance yang dapat mencatat pembelian inventaris.</div>
            )}
          </div>

          <div className="crm-sec">
            <SecHeader num="02" title="DAFTAR PEMBELIAN" desc="Pembatalan hanya dari sini (Finance): Kas Keluar dibatalkan dengan jurnal pembalik dan jumlah barang dikurangi sekaligus. Koreksi = batalkan lalu catat ulang." />
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 980 }}>
                <thead>
                  <tr><th>Tanggal</th><th>No. Bukti</th><th>Barang</th><th style={{ textAlign: "right" }}>Jumlah</th><th style={{ textAlign: "right" }}>Nominal</th>
                    <th>Kas</th><th>Petugas</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {page.rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtTgl(r.tanggal)}</td>
                      <td style={{ fontSize: 11.5, fontWeight: 500 }}>{r.no_bukti}</td>
                      <td style={{ fontSize: 11.5 }}>{r.operational_inventory_items?.nama ?? "—"}{r.catatan ? <div style={{ fontSize: 10.5, color: "var(--td)" }}>{r.catatan}</div> : null}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{fmtQty(Number(r.qty))} {r.operational_inventory_items?.satuan}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{rupiah(Number(r.nominal))}</td>
                      <td style={{ fontSize: 11 }}>{r.cash_accounts?.nama ?? "—"}</td>
                      <td style={{ fontSize: 11 }}>{r.actor_nama}</td>
                      <td style={{ fontSize: 11 }}>
                        {r.voided_at ? (
                          <span className="bge r" title={r.void_reason ?? ""}>Dibatalkan</span>
                        ) : bolehBeli ? (
                          <form action={batalkanPembelian} style={{ display: "flex", gap: 4 }}>
                            <input type="hidden" name="branch_id" value={branch.id} />
                            <input type="hidden" name="purchase_id" value={r.id} />
                            <input type="hidden" name="request_key" value={randomUUID()} />
                            <input className="fi" name="alasan" required minLength={3} maxLength={1000} placeholder="Alasan batal" style={{ width: 140 }} />
                            <SubmitButton className="btn-def" icon="ti-x" pendingText="Membatalkan…">Batal</SubmitButton>
                          </form>
                        ) : <span className="bge g">Aktif</span>}
                      </td>
                    </tr>
                  ))}
                  {page.rows.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>Belum ada pembelian di cabang ini.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <ListPagination path={`${INVOP_PATH}/pembelian`} query={{ cabang: branch.id }} total={page.count} pageInfo={page.pageInfo} />
          </div>
        </>
      )}
    </>
  );
}
