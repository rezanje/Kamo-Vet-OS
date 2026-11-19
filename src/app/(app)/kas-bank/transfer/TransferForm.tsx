"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { NumberInput } from "@/components/NumberInput";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { buatTransfer, koreksiTransfer, batalkanTransfer } from "./actions";

type Header = {
  id: string; revision: number; tanggal: string; from_account_id: string; to_account_id: string;
  jumlah: number; biaya_admin: number; branch_id?: string | null; to_branch_id?: string | null; keterangan: string | null;
};
export type RekeningOpsi = { id: string; label: string; branch_id?: string | null };
const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID")}`;
const grid = { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" };

/** Cabang tujuan catatan lama yang belum punya kolom cabang tujuan = cabang asal. */
export function cabangTujuanAwal(header?: Pick<Header, "branch_id" | "to_branch_id">) {
  if (!header) return "";
  return (header.to_branch_id === undefined ? header.branch_id : header.to_branch_id) ?? "";
}

/** Select terkendali yang ikut dipulihkan dari draf transaksi (TransactionDraft memicu vetos:draft-restore). */
function CabangSelect({ id, name, value, onChange, children }: { id: string; name: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const ref = useRef<HTMLSelectElement>(null);
  const latest = useRef(onChange);
  useEffect(() => { latest.current = onChange; });
  useEffect(() => {
    const el = ref.current;
    const restore = (event: Event) => latest.current(String((event as CustomEvent).detail ?? ""));
    el?.addEventListener("vetos:draft-restore", restore);
    return () => el?.removeEventListener("vetos:draft-restore", restore);
  }, []);
  return <select ref={ref} id={id} className="fi" name={name} value={value} data-draft-state="" onChange={e => onChange(e.target.value)}>{children}</select>;
}

// Form transfer seperti Accurate (permintaan Anisa, 19 Nov 2026): rekening + cabang asal, rekening + cabang tujuan.
// Memilih rekening yang terikat ke cabang langsung mengisi cabangnya (tetap bisa diganti).
export function TransferForm({ userId, mode = "create", header, rekening = [], branches = [] }: {
  userId: string; mode?: "create" | "edit" | "void"; header?: Header;
  rekening?: RekeningOpsi[]; branches?: { id: string; name: string }[];
}) {
  const action = mode === "create" ? buatTransfer : mode === "edit" ? koreksiTransfer : batalkanTransfer;
  const scope = mode === "create" ? "bank-transfer-create" : `bank-transfer-${mode}-${header?.id}-${header?.revision}`;
  const field = (name: string) => `${scope}-${name}`;
  const [cabangAsal, setCabangAsal] = useState(header?.branch_id ?? "");
  const [cabangTujuan, setTujuan] = useState(cabangTujuanAwal(header));
  // Selama cabang tujuan belum dipilih sendiri, ia mengikuti cabang asal (kebiasaan lama: satu cabang).
  const [tujuanDipilih, setTujuanDipilih] = useState(cabangTujuanAwal(header) !== (header?.branch_id ?? ""));
  const setCabangTujuan = (value: string) => { setTujuanDipilih(true); setTujuan(value); };
  const ubahAsal = (value: string) => { setCabangAsal(value); if (!tujuanDipilih) setTujuan(value); };
  const cabangRekening = (id: string) => rekening.find(r => r.id === id)?.branch_id ?? null;
  const pilihanCabang = (id: string, value: string, onChange: (value: string) => void, label: string) => (
    <div><label className="flab" htmlFor={field(id)}>{label}</label>
      <CabangSelect id={field(id)} name={id} value={value} onChange={onChange}>
        <option value="">— Pusat / tanpa cabang —</option>
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        {value && !branches.some(b => b.id === value) && <option value={value}>Cabang catatan asli</option>}
      </CabangSelect></div>);
  return <CorrectionTransactionForm key={`${userId}:${scope}`} userId={userId} scope={scope} action={action}>
    {({ ready }) => <>
      {header && <><input type="hidden" name="id" value={header.id}/><input type="hidden" name="revision" value={header.revision}/></>}
      {mode === "edit" && <div className="p2ban" role="note" style={{display:"block",lineHeight:1.6}}>
        Ubah langsung isian di bawah lalu simpan. Catatan lama otomatis dibatalkan dan diganti nomor baru; saldo rekening & cabang ikut menyesuaikan, riwayatnya tetap tersimpan.
      </div>}
      {mode === "void" && header && <div className="p2ban" role="note" style={{display:"block",lineHeight:1.6}}>
        Catatan ini dibatalkan: saldo rekening asal kembali {rp(Number(header.jumlah) + Number(header.biaya_admin))}, rekening tujuan berkurang {rp(header.jumlah)}. Riwayatnya tetap tersimpan.
      </div>}
      {mode !== "void" && <>
        <div className="frow" style={grid}>
          <div><label className="flab" htmlFor={field("tanggal")}>Tanggal *</label><input id={field("tanggal")} className="fi" type="date" name="tanggal" defaultValue={header?.tanggal ?? hariIniWIB()} max={hariIniWIB()} required/></div>
        </div>
        <div className="frow" style={{ marginTop: 10, ...grid }}>
          <div><label className="flab" htmlFor={field("from_account_id")}>Dari rekening *</label><select id={field("from_account_id")} className="fi" name="from_account_id" defaultValue={header?.from_account_id ?? ""} required
            onChange={e => { const b = cabangRekening(e.target.value); if (b) ubahAsal(b); }}><option value="">— pilih —</option>{rekening.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          {pilihanCabang("branch_id", cabangAsal, ubahAsal, "Cabang asal")}
        </div>
        <div className="frow" style={{ marginTop: 10, ...grid }}>
          <div><label className="flab" htmlFor={field("to_account_id")}>Ke rekening *</label><select id={field("to_account_id")} className="fi" name="to_account_id" defaultValue={header?.to_account_id ?? ""} required
            onChange={e => { const b = cabangRekening(e.target.value); if (b) setCabangTujuan(b); }}><option value="">— pilih —</option>{rekening.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          {pilihanCabang("to_branch_id", cabangTujuan, setCabangTujuan, "Cabang tujuan")}
        </div>
        {cabangAsal !== cabangTujuan && <small style={{display:"block",marginTop:6,color:"var(--tm)"}}>Antar cabang: uang keluar dicatat di cabang asal, uang masuk di cabang tujuan.</small>}
        <div className="frow" style={{ marginTop: 10, ...grid }}>
          <div><label className="flab" htmlFor={field("jumlah")}>Jumlah *</label><NumberInput id={field("jumlah")} className="fi" type="number" name="jumlah" min="0.01" step="0.01" defaultValue={header?.jumlah} required/></div>
          <div><label className="flab" htmlFor={field("biaya_admin")}>Biaya admin bank</label><NumberInput id={field("biaya_admin")} className="fi" type="number" name="biaya_admin" min="0" step="0.01" defaultValue={header?.biaya_admin ?? 0}/><small>Dipotong dari rekening sumber; dicatat sebagai beban.</small></div>
        </div>
        <div className="fg" style={{ marginTop: 10 }}><label className="flab" htmlFor={field("keterangan")}>Keterangan</label><input id={field("keterangan")} className="fi" name="keterangan" maxLength={1000} defaultValue={header?.keterangan ?? ""}/></div>
      </>}
      {mode !== "create" && <div className="fg" style={{ marginTop: 10 }}><label className="flab" htmlFor={field("reason")}>Alasan {mode === "edit" ? "perubahan" : "pembatalan"} *</label><input id={field("reason")} className="fi" name="reason" minLength={3} maxLength={1000} required/></div>}
      <div style={{ marginTop: 12, display: "flex", flexWrap:"wrap", gap: 8 }}>
        <button type="submit" className="btn-def" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
        <SubmitButton className={mode === "void" ? "btn-def" : "btn-acc"} pendingText="Menyimpan…" disabled={!ready}>{mode === "create" ? "Simpan transfer" : mode === "edit" ? "Simpan perubahan" : "Batalkan catatan transfer"}</SubmitButton>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
