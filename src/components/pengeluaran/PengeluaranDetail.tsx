import { NumberInput } from "@/components/NumberInput";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";
import { ExpenseForm, ExpenseSubmitButton } from "./ExpenseForm";
import { ubahExpense, batalkanExpense } from "@/app/(app)/pos/expense/actions";

// Detail satu pengeluaran + bukti/lampirannya. Dipakai dua rute supaya FINANCE
// (yang sidebarnya tidak memuat modul Persediaan) tetap punya jalan ke bukti:
//   /pos/expense/[id]        — dari modul Persediaan
//   /buku-besar/beban/[id]   — dari Pencatatan Beban
type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

type Expense = {
  id: string;
  tanggal: string;
  kategori: string;
  deskripsi: string | null;
  jumlah: number;
  metode_bayar: string;
  revision: number;
  shift_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  branches: Rel<{ name: string }>;
  pembuat: Rel<{ full_name: string | null }>;
};

export async function PengeluaranDetail({
  id, kembaliHref, kembaliLabel, success, error,
}: {
  id: string;
  kembaliHref: string;
  kembaliLabel: string;
  success?: string;
  error?: string;
}) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("expenses")
    .select("id, tanggal, kategori, deskripsi, jumlah, metode_bayar, revision, shift_id, voided_at, void_reason, branches(name), pembuat:created_by(full_name)")
    .eq("id", id)
    .maybeSingle();

  const exp = data as unknown as Expense | null;
  if (!exp) notFound();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle() : { data: null };
  const canManage = !!profile?.is_active && ["OWNER", "ADMIN", "FINANCE"].includes(profile.role);
  const [lock, shift, history] = canManage ? await Promise.all([
    supabase.from("accounting_locks").select("closed_until").eq("id", true).maybeSingle(),
    exp.shift_id ? supabase.from("cashier_shifts").select("status").eq("id", exp.shift_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("expense_revisions").select("id, action, reason, before_value, after_value, created_at").eq("expense_id", exp.id).order("created_at", { ascending: false }),
  ]) : [{ data: null, error: null }, { data: null, error: null }, { data: [], error: null }];
  const blocked = lock.error || shift.error ? "Status periode atau shift belum dapat diperiksa. Muat ulang sebelum mengoreksi."
    : exp.shift_id && shift.data?.status !== "open" ? "Shift sudah ditutup. Koreksi memerlukan rekonsiliasi kas terlebih dahulu."
      : lock.data?.closed_until && exp.tanggal <= lock.data.closed_until ? `Periode akuntansi s/d ${lock.data.closed_until} sudah ditutup.` : null;
  const revisions = (history.data ?? []) as { id: string; action: string; reason: string; before_value: { jumlah: number }; after_value: { jumlah: number }; created_at: string }[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href={kembaliHref} className="back-btn"><i className="ti ti-arrow-left" /> {kembaliLabel}</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Detail Pengeluaran</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success === "edit" ? "Pengeluaran diperbarui dan jurnal koreksi tersimpan." : success === "void" ? "Pengeluaran dibatalkan dan jurnal pembalik tersimpan." : "Dokumen tersimpan."}
        </div>
      )}
      {exp.voided_at && <div className="p2ban" role="status">Pengeluaran dibatalkan. {exp.void_reason}</div>}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{exp.kategori}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtTgl(exp.tanggal)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".03em" }}>Jumlah</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{rp(Number(exp.jumlah))}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Info label="Cabang" value={one(exp.branches)?.name ?? "—"} />
          <Info label="Metode bayar" value={exp.metode_bayar} />
          <Info label="Dibuat oleh" value={one(exp.pembuat)?.full_name ?? "—"} />
          <Info label="Deskripsi" value={exp.deskripsi ?? "—"} />
        </div>
      </div>

      {canManage && !exp.voided_at && (blocked ? <div className="p2ban" role="status">{blocked}</div> : user && <>
        <div className="crm-sec">
          <h2 style={{ fontSize: 13, marginTop: 0 }}>EDIT PENGELUARAN</h2>
          <p style={{ fontSize: 11, color: "var(--tm)" }}>Perubahan nominal, tanggal dan metode bayar dicatat dengan jurnal pembalik serta riwayat koreksi.</p>
          <ExpenseForm userId={user.id} scope={`expense-edit:${exp.id}:${exp.revision}`} action={ubahExpense}>
            <input type="hidden" name="id" value={exp.id} /><input type="hidden" name="revision" value={exp.revision} /><input type="hidden" name="kembali" value={kembaliHref} />
            <div className="grid2">
              <label className="flab">Tanggal<input className="fi" type="date" name="tanggal" defaultValue={exp.tanggal} required /></label>
              <label className="flab">Kategori<select className="fi" name="kategori" defaultValue={exp.kategori} required>{Array.from(new Set([exp.kategori, "Operasional", "Listrik & Air", "Perlengkapan", "Transportasi", "Perawatan", "Perawatan Aset", "Sewa Gedung", "Lain-lain"])).map(category => <option key={category}>{category}</option>)}</select></label>
              <label className="flab">Jumlah (Rp)<NumberInput className="fi" type="number" min="0.01" step="any" name="jumlah" defaultValue={Number(exp.jumlah)} required /></label>
              <label className="flab">Metode bayar<select className="fi" name="metode_bayar" defaultValue={exp.metode_bayar} required>{["Tunai", "Transfer", "QRIS", "Debit", "Kredit", "E-Wallet"].map(method => <option key={method}>{method}</option>)}</select></label>
              <label className="flab">Deskripsi<input className="fi" name="deskripsi" defaultValue={exp.deskripsi ?? ""} /></label>
              <label className="flab">Alasan koreksi *<input className="fi" name="alasan" minLength={3} maxLength={1000} required /></label>
            </div>
            <ExpenseSubmitButton className="btn-acc" style={{ marginTop: 12 }}>Simpan Perubahan</ExpenseSubmitButton>
          </ExpenseForm>
        </div>
        <div className="crm-sec">
          <h2 style={{ fontSize: 13, marginTop: 0 }}>BATALKAN PENGELUARAN</h2>
          <p style={{ fontSize: 11, color: "var(--tm)" }}>Untuk pengeluaran salah input atau tercatat ganda. Pembatalan menghapus nominal dari total dan membalik jurnal. Bukti serta riwayat tetap tersimpan.</p>
          <ExpenseForm userId={user.id} scope={`expense-void:${exp.id}:${exp.revision}`} action={batalkanExpense}>
            <input type="hidden" name="id" value={exp.id} /><input type="hidden" name="revision" value={exp.revision} /><input type="hidden" name="kembali" value={kembaliHref} />
            <label className="flab">Alasan pembatalan *<input className="fi" name="alasan" minLength={3} maxLength={1000} required /></label>
            <ExpenseSubmitButton className="btn-def" style={{ marginTop: 12, color: "#b91c1c" }}>Batalkan Pengeluaran</ExpenseSubmitButton>
          </ExpenseForm>
        </div>
      </>)}

      {canManage && revisions.length > 0 && <div className="crm-sec">
        <h2 style={{ fontSize: 13, marginTop: 0 }}>RIWAYAT KOREKSI</h2>
        {revisions.map(revision => <div key={revision.id} style={{ borderTop: ".5px solid var(--bd)", padding: "10px 0", fontSize: 11 }}>
          <strong>{revision.action === "void" ? "Dibatalkan" : "Diperbarui"}</strong> · {new Date(revision.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
          <div>{rp(Number(revision.before_value.jumlah))} → {rp(Number(revision.after_value.jumlah))} · {revision.reason}</div>
        </div>)}
      </div>}

      <DokumenPanel modul="pengeluaran" refId={exp.id} kembali={`${kembaliHref}/${exp.id}`} judul="BUKTI & DOKUMEN" />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
