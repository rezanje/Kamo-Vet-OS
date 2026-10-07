"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextSeqJurnal, prefixJurnal } from "@/lib/posting";
import {transactionDraftAck} from "@/lib/transaction-draft-ack";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";

// Rekonsiliasi bank (saldo-level) PER REKENING: bandingkan saldo buku rekening terpilih
// dengan saldo rekening korannya, catat biaya adm / bunga sbg jurnal penyesuaian.
export async function prosesRekonsiliasi(formData: FormData) {
  const supabase = await createClient();
  const back = "/keuangan/rekonsiliasi";
  const gagal = (msg: string) => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const accountId = String(formData.get("account_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const saldoBank = Number(formData.get("saldo_bank")??0);
  const biayaAdm = Number(formData.get("biaya_adm")??0);
  const bunga = Number(formData.get("bunga")??0);
  const catatan = String(formData.get("catatan") ?? "") || null;

  if (![saldoBank,biayaAdm,bunga].every(Number.isFinite)||biayaAdm<0||bunga<0) gagal("Nilai rekonsiliasi tidak valid");
  if (!accountId) gagal("Pilih rekening yang direkonsiliasi");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: rek, error:rekError } = await supabase
    .from("cash_accounts").select("id, nama, coa_code").eq("id", accountId).maybeSingle();
  if(rekError)throw new Error(rekError.message);
  if (!rek) gagal("Rekening tidak ditemukan");

  // Saldo buku rekening terpilih (bukan lagi akun 1102 mati).
  const { data: acc, error:accountError } = await supabase
    .from("coa_accounts").select("id").eq("code", rek!.coa_code).maybeSingle();
  if(accountError||!acc)throw new Error(accountError?.message??"Akun rekening tidak ditemukan");
  let saldoBuku = 0;
  if (acc) {
    // Dibatasi S/D tanggal rekonsiliasi. Tanpa batas ini, saldo buku selalu posisi
    // HARI INI sementara saldo rekening korannya posisi tanggal tertentu — rekonsiliasi
    // untuk tanggal lampau pasti melaporkan selisih palsu.
    const { data: lines, error:balanceError } = await supabase
      .from("journal_lines")
      .select("debit, credit, journal_entries!inner(tanggal)")
      .eq("account_id", acc.id)
      .lte("journal_entries.tanggal", tanggal);
    if(balanceError)throw new Error(balanceError.message);
    saldoBuku = (lines ?? []).reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
  }
  const adjusted = saldoBuku + bunga - biayaAdm;
  const selisih = saldoBank - adjusted;

  const {error:reconciliationError} = await supabase.from("bank_reconciliations").insert({
    tanggal, cash_account_id: accountId,
    saldo_buku: saldoBuku, saldo_bank: saldoBank, biaya_adm: biayaAdm, bunga, selisih, catatan,
  });

  if(reconciliationError) throw new Error(reconciliationError.message);

  // Jurnal penyesuaian → buku ikut bergerak ke arah bank.
  if (biayaAdm > 0) {
    await checkedReconciliationJournal(supabase, {
      tanggal, deskripsi: `Biaya administrasi bank — ${rek!.nama}`, source: "bank-rec", branchId: null,
      lines: [{ code: "5501", debit: biayaAdm, credit: 0 }, { code: rek!.coa_code, debit: 0, credit: biayaAdm }],
    });
  }
  if (bunga > 0) {
    await checkedReconciliationJournal(supabase, {
      tanggal, deskripsi: `Pendapatan bunga bank — ${rek!.nama}`, source: "bank-rec", branchId: null,
      lines: [{ code: rek!.coa_code, debit: bunga, credit: 0 }, { code: "4301", debit: 0, credit: bunga }],
    });
  }

  redirect(`${back}?success=1&rek=${accountId}${transactionDraftAck(formData)}`);
}

// Reconciliation is itself an accounting transaction: every write must be checked.
async function checkedReconciliationJournal(supabase: Awaited<ReturnType<typeof createClient>>,o:{tanggal:string;deskripsi:string;source:string;branchId:null;lines:{code:string;debit:number;credit:number}[]}) {
  const {data:accounts,error:accountError}=await supabase.from("coa_accounts").select("id,code,is_header,is_active").in("code",o.lines.map(l=>l.code));
  if(accountError||!accounts||o.lines.some(l=>!accounts.some(a=>a.code===l.code&&!a.is_header&&a.is_active)))throw new Error("Akun jurnal rekonsiliasi tidak tersedia. Periksa transaksi sebelum mengulang.");
  const seq=await nextSeqJurnal(supabase,o.tanggal);
  const {data:entry,error:entryError}=await supabase.from("journal_entries").insert({no_jurnal:`${prefixJurnal(o.tanggal)}-${String(seq).padStart(4,"0")}`,tanggal:o.tanggal,deskripsi:o.deskripsi,source:o.source,branch_id:null}).select("id").single();
  if(entryError||!entry)throw new Error(entryError?.message??"Jurnal belum terkonfirmasi");
  const {error:lineError}=await supabase.from("journal_lines").insert(o.lines.map(l=>({entry_id:entry.id,account_id:accounts.find(a=>a.code===l.code)!.id,debit:l.debit,credit:l.credit})));
  if(lineError){await supabase.from("journal_entries").delete().eq("id",entry.id);throw new Error(lineError.message);}
}
