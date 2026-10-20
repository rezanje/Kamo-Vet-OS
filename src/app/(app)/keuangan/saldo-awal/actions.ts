"use server";

import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountBalances } from "@/lib/ledger";
import { assertRole } from "@/lib/master-guard";
import { completeReportQuery } from "@/lib/report-query";
import { hariIniWIB } from "@/lib/tanggal";
import {
  nilaiPersediaan, selisihSaldoAwal,
  type BarisSaldoAwal,
} from "@/lib/saldo-awal";

const BACK = "/keuangan/saldo-awal";

export type Usulan = {
  code: string; nama: string; sisi: "D" | "K";
  nyata: number; buku: number; selisih: number; sumber: string;
};

export type RingkasSaldoAwal = {
  usulan: Usulan[];
  sudahAda: { id: string; no_jurnal: string; tanggal: string } | null;
  barisAktif: BarisSaldoAwal[];
  akun: { code: string; name: string; type: string; normal: string }[];
};

/**
 * Hitung apa yang belum pernah masuk buku besar, dengan membandingkan kondisi NYATA
 * (stok fisik, daftar aset) terhadap saldo akunnya. Yang sudah benar akan berselisih 0
 * dan tidak muncul sebagai usulan.
 */
export async function bacaSaldoAwal(supabase: Awaited<ReturnType<typeof createClient>>): Promise<RingkasSaldoAwal> {
  const [balances, layerResult, assetResult, depResult, entryResult, coaResult] =
    await Promise.all([
      getAccountBalances(supabase as never),
      completeReportQuery(supabase.from("stock_layers").select("id, qty_left, unit_cost",{count:"exact"}).gt("qty_left", 0)),
      completeReportQuery(supabase.from("fixed_assets").select("id, harga_perolehan",{count:"exact"}).eq("is_active", true)),
      completeReportQuery(supabase.from("asset_depreciations").select("id, amount",{count:"exact"})),
      supabase.from("journal_entries").select("id, no_jurnal, tanggal").eq("source", "saldo-awal").is("opening_retired_at",null).maybeSingle(),
      completeReportQuery(supabase.from("coa_accounts").select("id, code, name, type, normal_balance",{count:"exact"}).eq("is_active", true).eq("is_header",false).order("code")),
    ]);

  for (const result of [layerResult,assetResult,depResult,entryResult,coaResult]) if (result.error) throw new Error("Data saldo awal belum lengkap. Muat ulang sebelum membuat perubahan.");
  const {data:layers}=layerResult, {data:assets}=assetResult, {data:deps}=depResult, {data:entry}=entryResult, {data:coa}=coaResult;
  let barisAktif: BarisSaldoAwal[]=[];
  if(entry){
    const {data,error}=await completeReportQuery(supabase.from("journal_lines").select("id,debit,credit,coa_accounts!inner(code)",{count:"exact"}).eq("entry_id",entry.id));
    if(error)throw new Error("Rincian saldo awal aktif belum dapat dibaca.");
    barisAktif=(data??[]).flatMap(line=>{const account=Array.isArray(line.coa_accounts)?line.coa_accounts[0]:line.coa_accounts;return account&&account.code!=="3101"?[{code:account.code,nilai:Number(line.debit)>0?Number(line.debit):Number(line.credit),sisi:Number(line.debit)>0?"D" as const:"K" as const}]:[];});
  }
  const saldo = (code: string) => balances.find((b) => b.code === code)?.saldo ?? 0;

  const persediaanNyata = nilaiPersediaan((layers ?? []) as { qty_left: number; unit_cost: number }[]);
  const asetNyata = (assets ?? []).reduce((a, r) => a + Number(r.harga_perolehan), 0);
  const akumNyata = (deps ?? []).reduce((a, r) => a + Number(r.amount), 0);

  const usulan: Usulan[] = ([
    {
      code: "1301", nama: "Persediaan Obat & Produk", sisi: "D",
      nyata: persediaanNyata, buku: saldo("1301"),
      selisih: selisihSaldoAwal(persediaanNyata, saldo("1301")),
      sumber: "Sisa lapisan stok × modalnya",
    },
    {
      code: "1501", nama: "Aset Tetap", sisi: "D",
      nyata: asetNyata, buku: saldo("1501"),
      selisih: selisihSaldoAwal(asetNyata, saldo("1501")),
      sumber: "Total harga perolehan aset aktif",
    },
    {
      // 1509 kontra-aset: saldo normalnya kredit, jadi 'nyata' dibandingkan apa adanya.
      code: "1509", nama: "Akumulasi Penyusutan", sisi: "K",
      nyata: akumNyata, buku: saldo("1509"),
      selisih: selisihSaldoAwal(akumNyata, saldo("1509")),
      sumber: "Total penyusutan yang sudah dijalankan",
    },
  ] as Usulan[]).filter((u) => u.selisih !== 0);

  return {
    usulan,
    sudahAda: entry ? { id:entry.id, no_jurnal: entry.no_jurnal as string, tanggal: entry.tanggal as string } : null,
    barisAktif,
    akun: (coa ?? []).map((a) => ({
      code: a.code as string, name: a.name as string, type: a.type as string, normal: a.normal_balance as string,
    })),
  };
}

async function simpan(formData:FormData,action:"save"|"void") {
  const supabase=await assertRole(BACK,"saldo awal",action==="void"?["OWNER"]:["OWNER","ADMIN","FINANCE"]);
  const gagal=(message:string):never=>redirect(`${BACK}?error=${encodeURIComponent(message)}`);
  const key=String(formData.get("draft_key")??"").trim();
  const expected=String(formData.get("expected_entry_id")??"").trim()||null;
  const reason=String(formData.get("reason")??"").trim()||null;
  const tanggal=action==="save"?String(formData.get("tanggal")??"").trim()||hariIniWIB():null;
  if(!key||key.length>120)gagal("Identitas simpan belum tersedia. Muat ulang formulir.");
  let rows:unknown=[];
  if(action==="save")try {rows=JSON.parse(String(formData.get("baris")??"[]"));}catch{gagal("Baris saldo awal tidak valid.");}
  if(!Array.isArray(rows)||(action==="save"&&rows.length===0))gagal("Isi minimal satu baris saldo awal.");
  const {data,error}=await supabase.rpc("mutate_opening_balance",{p_request_key:key,p_expected_entry_id:expected,p_action:action,p_tanggal:tanggal,p_rows:rows,p_reason:reason});
  if(error||!data?.entry_id)gagal(error?.message??"Hasil saldo awal belum terkonfirmasi. Isian tetap tersedia.");
  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(action==="void"?"Saldo awal dibatalkan; catatan lama dan pembaliknya tetap tersimpan.":"Saldo awal tersimpan; riwayat perubahan tetap tersedia.")}${transactionDraftAck(formData)}`);
}
export async function simpanSaldoAwal(formData:FormData){return simpan(formData,"save");}
export async function hapusSaldoAwal(formData:FormData){return simpan(formData,"void");}
export async function pulihkanSaldoAwal(formData:FormData){
 const supabase=await assertRole(BACK,"saldo awal",["OWNER","ADMIN","FINANCE"]);
 const key=String(formData.get("draft_key")??"").trim();
 const {data,error}=await supabase.rpc("get_opening_balance_result",{p_request_key:key});
 if(error||!data?.entry_id)redirect(`${BACK}?error=${encodeURIComponent(error?.message??"Permintaan belum tercatat. Draf tetap tersedia; periksa saldo aktif sebelum menyimpan ulang.")}`);
 redirect(`${BACK}?success=${encodeURIComponent("Hasil permintaan sebelumnya sudah dikonfirmasi.")}${transactionDraftAck(formData)}`);
}
