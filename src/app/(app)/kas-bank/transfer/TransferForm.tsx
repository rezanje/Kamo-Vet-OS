"use client";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { buatTransfer, koreksiTransfer, batalkanTransfer } from "./actions";

type Header = { id: string; revision: number; tanggal: string; from_account_id: string; to_account_id: string; jumlah: number; biaya_admin: number; keterangan: string | null };
export function TransferForm({ userId, mode = "create", header, rekening = [], branches = [] }: {
 userId: string; mode?: "create" | "edit" | "void"; header?: Header;
 rekening?: { id: string; label: string }[]; branches?: { id: string; name: string }[];
}) {
 const action = mode === "create" ? buatTransfer : mode === "edit" ? koreksiTransfer : batalkanTransfer;
 const scope = mode === "create" ? "bank-transfer-create" : `bank-transfer-${mode}-${header?.id}-${header?.revision}`;
 return <CorrectionTransactionForm key={`${userId}:${scope}`} userId={userId} scope={scope} action={action}>
  {({ready}) => <>
   {header && <><input type="hidden" name="id" value={header.id}/><input type="hidden" name="revision" value={header.revision}/></>}
   {mode !== "void" && <>
    <div className="frow">
     <div><label className="flab">Tanggal *</label><input className="fi" type="date" name="tanggal" defaultValue={header?.tanggal ?? hariIniWIB()} required/></div>
     {mode === "create" && <div><label className="flab">Cabang</label><select className="fi" name="branch_id" defaultValue=""><option value="">— Pusat / tanpa cabang —</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
    </div>
    <div className="frow" style={{marginTop:10}}>
     <div><label className="flab">Dari rekening *</label><select className="fi" name="from_account_id" defaultValue={header?.from_account_id ?? ""} required><option value="">— pilih —</option>{rekening.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
     <div><label className="flab">Ke rekening *</label><select className="fi" name="to_account_id" defaultValue={header?.to_account_id ?? ""} required><option value="">— pilih —</option>{rekening.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
    </div>
    <div className="frow" style={{marginTop:10}}>
     <div><label className="flab">Jumlah *</label><input className="fi" type="number" name="jumlah" min="0.01" step="0.01" defaultValue={header?.jumlah} required/></div>
     <div><label className="flab">Biaya admin bank</label><input className="fi" type="number" name="biaya_admin" min="0" step="0.01" defaultValue={header?.biaya_admin ?? 0}/><small>Dipotong dari rekening sumber.</small></div>
    </div>
    <div className="fg" style={{marginTop:10}}><label className="flab">Keterangan</label><input className="fi" name="keterangan" maxLength={1000} defaultValue={header?.keterangan ?? ""}/></div>
   </>}
   {mode !== "create" && <div className="fg" style={{marginTop:10}}><label className="flab">Alasan {mode === "edit" ? "koreksi" : "pembatalan"} *</label><input className="fi" name="reason" minLength={3} maxLength={1000} required/></div>}
   <div style={{marginTop:12}}><SubmitButton className={mode === "void" ? "btn-def" : "btn-acc"} pendingText="Menyimpan…" disabled={!ready}>{mode === "create" ? "Simpan transfer" : mode === "edit" ? "Simpan koreksi" : "Batalkan transfer"}</SubmitButton></div>
  </>}
 </CorrectionTransactionForm>;
}
