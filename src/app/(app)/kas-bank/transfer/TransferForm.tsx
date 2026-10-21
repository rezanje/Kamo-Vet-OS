"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { buatTransfer, koreksiTransfer, batalkanTransfer } from "./actions";

type Header = {
  id: string; revision: number; tanggal: string; from_account_id: string; to_account_id: string;
  jumlah: number; biaya_admin: number; branch_id?: string | null; keterangan: string | null;
};
const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID")}`;

export function TransferForm({ userId, mode = "create", header, rekening = [], branches = [] }: {
  userId: string; mode?: "create" | "edit" | "void"; header?: Header;
  rekening?: { id: string; label: string }[]; branches?: { id: string; name: string }[];
}) {
  const action = mode === "create" ? buatTransfer : mode === "edit" ? koreksiTransfer : batalkanTransfer;
  const scope = mode === "create" ? "bank-transfer-create" : `bank-transfer-${mode}-${header?.id}-${header?.revision}`;
  const field = (name: string) => `${scope}-${name}`;
  return <CorrectionTransactionForm key={`${userId}:${scope}`} userId={userId} scope={scope} action={action}>
    {({ ready }) => <>
      {header && <><input type="hidden" name="id" value={header.id}/><input type="hidden" name="revision" value={header.revision}/></>}
      {mode !== "create" && <div className="p2ban" role="note" style={{display:"block",lineHeight:1.6}}>
        Koreksi ini hanya memperbaiki catatan KAMO, bukan transfer uang melalui bank.
        Jurnal pembalik mengembalikan saldo rekening asal dan tujuan, termasuk biaya admin.
        {mode === "edit" ? " Pengganti dicatat dengan nomor baru; catatan asli tetap tersimpan." : " Catatan asli dan alasan pembatalan tetap tersimpan."}
        {header && <div>Saldo asal dikembalikan {rp(Number(header.jumlah) + Number(header.biaya_admin))}; saldo tujuan dikurangi {rp(header.jumlah)}. Biaya {rp(header.biaya_admin)} dibalik.</div>}
        {mode === "edit" && <div>Pengganti akan mengurangi saldo rekening asal sebesar jumlah baru + biaya, menambah saldo rekening tujuan sebesar jumlah baru, dan mencatat biaya sebagai beban.</div>}
        <div>Periode tertutup, jurnal yang tidak cocok, atau rekonsiliasi yang mencakup rekening ini akan menolak koreksi. Tinjau ketergantungan terkait dahulu.</div>
      </div>}
      {mode !== "void" && <>
        <div className="frow" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 220px), 1fr))"}}>
          {mode === "create" ? <div><label className="flab" htmlFor={field("tanggal")}>Tanggal *</label><input id={field("tanggal")} className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required/></div>
            : <><input type="hidden" name="tanggal" value={header?.tanggal ?? ""}/><input type="hidden" name="branch_id" value={header?.branch_id ?? ""}/><div>Tanggal dan cabang tetap mengikuti catatan asli: {header?.tanggal}.</div></>}
          {mode === "create" && <div><label className="flab" htmlFor={field("branch_id")}>Cabang</label><select id={field("branch_id")} className="fi" name="branch_id" defaultValue=""><option value="">— Pusat / tanpa cabang —</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
        </div>
        <div className="frow" style={{ marginTop: 10, gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
          <div><label className="flab" htmlFor={field("from_account_id")}>Dari rekening *</label><select id={field("from_account_id")} className="fi" name="from_account_id" defaultValue={header?.from_account_id ?? ""} required><option value="">— pilih —</option>{rekening.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          <div><label className="flab" htmlFor={field("to_account_id")}>Ke rekening *</label><select id={field("to_account_id")} className="fi" name="to_account_id" defaultValue={header?.to_account_id ?? ""} required><option value="">— pilih —</option>{rekening.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
        </div>
        <div className="frow" style={{ marginTop: 10, gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
          <div><label className="flab" htmlFor={field("jumlah")}>Jumlah *</label><input id={field("jumlah")} className="fi" type="number" name="jumlah" min="0.01" step="0.01" defaultValue={header?.jumlah} required/></div>
          <div><label className="flab" htmlFor={field("biaya_admin")}>Biaya admin bank</label><input id={field("biaya_admin")} className="fi" type="number" name="biaya_admin" min="0" step="0.01" defaultValue={header?.biaya_admin ?? 0}/><small>Dipotong dari rekening sumber; dicatat sebagai beban.</small></div>
        </div>
        <div className="fg" style={{ marginTop: 10 }}><label className="flab" htmlFor={field("keterangan")}>Keterangan</label><input id={field("keterangan")} className="fi" name="keterangan" maxLength={1000} defaultValue={header?.keterangan ?? ""}/></div>
      </>}
      {mode !== "create" && <div className="fg" style={{ marginTop: 10 }}><label className="flab" htmlFor={field("reason")}>Alasan {mode === "edit" ? "koreksi" : "pembatalan"} *</label><input id={field("reason")} className="fi" name="reason" minLength={3} maxLength={1000} required/></div>}
      <div style={{ marginTop: 12, display: "flex", flexWrap:"wrap", gap: 8 }}>
        <button type="submit" className="btn-def" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
        <SubmitButton className={mode === "void" ? "btn-def" : "btn-acc"} pendingText="Menyimpan…" disabled={!ready}>{mode === "create" ? "Simpan transfer" : mode === "edit" ? "Balikkan & simpan pengganti" : "Batalkan catatan transfer"}</SubmitButton>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
