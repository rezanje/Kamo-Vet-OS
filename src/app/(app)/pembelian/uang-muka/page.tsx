import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { DocumentBackLink, DocumentLink } from "@/components/RelatedDocuments";
import { AdvanceUsageList } from "@/components/AdvanceUsageList";
import { loadPurchaseAdvanceUsage, type AdvanceUsage } from "@/lib/advance-usage";
import { documentAnchor } from "@/lib/related-document-routes";
import { TransactionDraftComplete } from "@/components/LocalTransactionDraft";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import {readCompleteList,ListLoadError} from "@/lib/checked-list";
import {AdvanceForm,type AdvancePO} from "./AdvanceForm";
import { batalkanUangMuka } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type UM = {
  id: string; po_id: string | null; no_um: string; tanggal: string; jumlah: number; terpakai: number;
  metode: string; catatan: string | null; status: string;
  suppliers: Rel<{ nama: string }>;
  purchase_orders: Rel<{ no_po: string | null }>;
};

export default async function UangMukaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; from?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const boleh = await bolehTransaksiKas();

  let daftar:UM[]=[],pemasok:{id:string;nama:string}[]=[],po:AdvancePO[]=[],receipts:{id:string;po_id:string}[]=[];
  let loadError="";
  const rekening=await loadRekeningAktif(supabase);
  try {
    [daftar,pemasok,po,receipts] = await Promise.all([
      readCompleteList<UM>((from,to)=>supabase.from("purchase_advances")
        .select("id,po_id,no_um,tanggal,jumlah,terpakai,metode,catatan,status,suppliers(nama),purchase_orders(no_po)",{count:"exact"})
        .order("tanggal",{ascending:false}).order("id").range(from,to),"Daftar uang muka",{maxRows:null}),
      readCompleteList<{id:string;nama:string}>((from,to)=>supabase.from("suppliers").select("id,nama",{count:"exact"}).eq("is_active",true).order("nama").order("id").range(from,to),"Pemasok uang muka",{maxRows:null}),
      readCompleteList<AdvancePO>((from,to)=>supabase.from("purchase_orders").select("id,no_po,supplier_id,status,total",{count:"exact"}).order("tanggal",{ascending:false}).order("id").range(from,to),"PO uang muka",{maxRows:null}),
      readCompleteList<{id:string;po_id:string}>((from,to)=>supabase.from("goods_receipts").select("id,po_id",{count:"exact"}).order("id").range(from,to),"Penerimaan PO uang muka",{maxRows:null}),
    ]);
  }catch(error){if(!(error instanceof ListLoadError))throw error;loadError=error.message;}
  const { usage, usageError } = daftar.length
    ? await loadPurchaseAdvanceUsage(supabase, daftar.map(u => u.id))
      .then(usage => ({ usage, usageError: false }), () => ({ usage: new Map<string, AdvanceUsage[]>(), usageError: true }))
    : { usage: new Map<string, AdvanceUsage[]>(), usageError: false };
  const receivedPOs = new Set(receipts.map(row=>row.po_id));
  po = po.map(row=>({...row,hasReceipt:receivedPOs.has(row.id)}));

  const aktif = daftar.filter((u) => u.status === "aktif");
  const totalSisa = aktif.reduce((a, u) => a + (Number(u.jumlah) - Number(u.terpakai)), 0);

  return (
    <MasterPage
      back="/pembelian" icon="ti-cash-banknote" title="UANG MUKA PEMBELIAN"
      desc="DP ke pemasok — tercatat sebagai hak tagih, bukan beban"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mencatat uang muka."
    >
      <DocumentBackLink from={sp.from} />
      <div className="crm-sec">
        <SecHeader
          num="01" title="BAYAR UANG MUKA"
          desc="Uang keluar sekarang, dipotongkan otomatis saat melunasi hutang pemasok itu."
        />

        <TransactionDraftComplete userId={user?.id??""}/>
        {loadError ? <div role="alert">{loadError}</div> : boleh && <AdvanceForm key={user?.id??""} userId={user?.id??""} suppliers={pemasok} orders={po} advances={daftar} rekening={rekening}/>}

      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="02" title="DAFTAR UANG MUKA"
          desc={loadError?"Saldo belum dapat diverifikasi.":`Sisa yang belum terpakai: ${rp(totalSisa)}.`}
        />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. dokumen</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Pemasok</th>
                <th style={{ width: 120 }}>PO</th>
                <th style={{ width: 130, textAlign: "right" }}>Nominal</th>
                <th style={{ width: 130, textAlign: "right" }}>Sisa</th>
                <th style={{ width: 90 }}>Status</th>
                {boleh && <th style={{ width: 90 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {daftar.map((u) => {
                const sisa = Number(u.jumlah) - Number(u.terpakai);
                return (
                  <tr id={documentAnchor("advance",u.id)} style={{scrollMarginTop:90}} key={u.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {u.no_um}
                      <div><ActivityHistoryLink entity="purchase_advances" id={u.id} /></div>
                      {u.catatan && <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>{u.catatan}</div>}
                      <AdvanceUsageList usages={usage.get(u.id) ?? []} error={usageError} terpakai={Number(u.terpakai)} />
                    </td>
                    <td style={{ fontSize: 11 }}>{tgl(u.tanggal)}</td>
                    <td style={{ fontSize: 11.5 }}>{one(u.suppliers)?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{u.po_id && one(u.purchase_orders)?.no_po
                      ? <DocumentLink kind="purchase-order" id={u.po_id}>{one(u.purchase_orders)!.no_po}</DocumentLink>
                      : one(u.purchase_orders)?.no_po ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(u.jumlah))}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: sisa > 0 ? "#15803d" : "var(--td)" }}>
                      {u.status === "batal" ? "—" : rp(sisa)}
                    </td>
                    <td>
                      <span className={`bge ${u.status === "batal" ? "x" : sisa > 0 ? "g" : "b"}`}>
                        {u.status === "batal" ? "Batal" : sisa > 0 ? "Aktif" : "Terpakai"}
                      </span>
                    </td>
                    {boleh && (
                      <td>
                        {u.status === "aktif" && Number(u.terpakai) === 0 && (
                          <form action={batalkanUangMuka}>
                            <input type="hidden" name="id" value={u.id} />
                            <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                              Batalkan
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {daftar.length === 0 && (
                <tr><td colSpan={boleh ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  {loadError?"Daftar uang muka belum dapat dimuat.":"Belum ada uang muka ke pemasok."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
