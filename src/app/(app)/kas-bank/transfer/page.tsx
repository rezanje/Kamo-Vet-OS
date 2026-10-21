import { TransferRecovery } from "./TransferRecovery";
import { TransferForm } from "./TransferForm";
import Link from "next/link";
import { readListPage } from "@/lib/checked-list";
import { ListPagination } from "@/components/ListPagination";
import { createClient } from "@/lib/supabase/server";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { getAccountBalances } from "@/lib/ledger";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Baris = {
  id: string; no_transfer: string; tanggal: string; jumlah: number; biaya_admin: number;
  keterangan: string | null; voided_at: string | null; void_reason: string | null; replacement_of: string | null; branch_id: string | null; revision: number; from_account_id: string; to_account_id: string;
  from: Rel<{ nama: string }>; to: Rel<{ nama: string }>; branches: Rel<{ name: string }>;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) =>
  new Date(d).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

export default async function TransferPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; koreksi?: string; batal?: string; hal?: string }>;
}) {
  const { error, success, koreksi, batal, hal } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();
  const boleh = await bolehTransaksiKas();
  const {data: profile} = await supabase.from("profiles").select("role,is_active").eq("id",user?.id ?? "").maybeSingle();

  const columns = "id, no_transfer, tanggal, jumlah, biaya_admin, keterangan, voided_at, void_reason, replacement_of, branch_id, revision, from_account_id, to_account_id, from:from_account_id(nama), to:to_account_id(nama), branches(name)";
  const loadTransfers = readListPage<Baris>((from, to) => supabase.from("cash_transfers")
    .select(columns, {count:"exact"}).order("tanggal", {ascending:false}).order("created_at", {ascending:false}).order("id").range(from,to)
    .then(result => ({...result,data:result.data as unknown as Baris[] | null})), "Catatan transfer", hal)
    .then(page => ({page,error:null})).catch((error: unknown) => ({page:null,error}));
  const [{ data: rekData }, { data: branches }, { page: transferPage, error: transferError }, saldoAkun] = await Promise.all([
    supabase.from("cash_accounts").select("id, nama, jenis, coa_code").eq("is_active", true).order("nama"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    loadTransfers,
    getAccountBalances(supabase),
  ]);

  const saldoPerKode = new Map(saldoAkun.map((a) => [a.code, a.saldo]));
  const rekening = (rekData ?? []) as { id: string; nama: string; jenis: string; coa_code: string }[];
  const daftar = transferPage?.rows ?? [];
  const mayCorrect = profile?.role === "OWNER" && profile?.is_active;
  let selected = daftar.find(t => t.id === (koreksi ?? batal));
  let selectionError: unknown = null;
  if ((koreksi || batal) && !selected) {
    const result = await supabase.from("cash_transfers").select(columns).eq("id",koreksi ?? batal ?? "").maybeSingle();
    selected = (result.data as unknown as Baris | null) ?? undefined;
    selectionError = result.error;
  }
  const historyIds = [...new Set([...daftar.map(t=>t.id), ...(selected ? [selected.id] : [])])];
  const {data: history, error: historyError} = historyIds.length ? await supabase.from("cash_transfer_revisions")
    .select("id,transfer_id,replacement_transfer_id,created_by,original_journal_id,reversal_journal_id,replacement_journal_id,action,reason,created_at").in("transfer_id",historyIds).order("created_at",{ascending:false}) : {data:[],error:null};

  // Saldo ditempel di label dropdown — keputusan boss: saldo minus tidak dilarang,
  // tapi harus kelihatan sebelum transfer disimpan.
  const opsi = rekening.map((r) => ({
    id: r.id,
    label: `${r.nama} — ${rp(saldoPerKode.get(r.coa_code) ?? 0)}`,
  }));

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/kas-bank" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#e8f5ee", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-building-bank" style={{ fontSize: 22, color: "#16a34a" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>TRANSFER BANK</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
            Catatan perpindahan antar rekening internal. Halaman ini tidak mengirim uang melalui bank.
          </div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success === "batal" ? "Transfer dibatalkan." : success === "koreksi" ? "Catatan asli dibalik dan pengganti tersimpan. Saldo kedua rekening sudah dikoreksi." : "Transfer tersimpan."}
        </div>
      )}
      {!boleh && <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN/FINANCE yang bisa membuat transfer.</div>}
      {(koreksi || batal) && !mayCorrect && <div role="alert" className="p2ban">Hanya Super Admin/OWNER aktif yang berhak mengoreksi atau membatalkan catatan transfer.</div>}
      <TransferRecovery userId={user?.id ?? ""}/>
      {rekening.length < 2 && (
        <div className="p2ban">
          <i className="ti ti-info-circle" /> Butuh minimal dua rekening aktif. Tambah di{" "}
          <Link href="/kas-bank/rekening" style={{ color: "#2563eb" }}>Daftar Rekening</Link>.
        </div>
      )}

      {(transferError || selectionError) && <div role="alert" className="p2ban">Daftar catatan transfer gagal dimuat. Muat ulang atau hubungi administrator.</div>}
      {historyError && <div role="alert" className="p2ban">Riwayat koreksi gagal dimuat. Muat ulang sebelum melanjutkan.</div>}
      {mayCorrect && selected && !selected.voided_at && <section id="koreksi-transfer" className="crm-sec" style={{marginBottom:14}}>
        <h2>{koreksi ? "Koreksi" : "Batalkan"} catatan {selected.no_transfer}</h2>
        <TransferForm userId={user?.id ?? ""} mode={koreksi ? "edit" : "void"} header={selected} rekening={opsi}/>
        <Link href="/kas-bank/transfer" className="btn-def">Tutup koreksi</Link>
      </section>}
      {mayCorrect && (koreksi || batal) && (!selected || selected.voided_at) && <div role="alert" className="p2ban">Catatan tidak tersedia atau sudah berubah/dibatalkan. Periksa hasil sebelumnya atau pilih catatan aktif.</div>}
      {boleh && rekening.length >= 2 && !koreksi && !batal && (
        <div className="crm-sec" style={{marginBottom:14}}><TransferForm userId={user?.id ?? ""} rekening={opsi} branches={branches ?? []}/></div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>No.</th>
                <th style={{ width: 100 }}>Tanggal</th>
                <th>Dari → Ke</th>
                <th style={{ width: 120, textAlign: "right" }}>Jumlah</th>
                <th style={{ width: 100, textAlign: "right" }}>Biaya</th>
                <th style={{ width: 120 }}>Cabang</th>
                <th style={{ width: 90 }}>Status</th>
                {boleh && <th style={{ width: 110 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {daftar.map((t) => (
                <tr key={t.id} style={t.voided_at ? { opacity: 0.55 } : undefined}>
                  <td style={{ fontSize: 10.5, fontWeight: 600 }}>{t.no_transfer}</td>
                  <td style={{ fontSize: 10.5 }}>{fmtTgl(t.tanggal)}</td>
                  <td style={{ fontSize: 11 }}>
                    {one(t.from)?.nama ?? "—"} → {one(t.to)?.nama ?? "—"}
                    {t.replacement_of && <div style={{fontSize:10}}>Pengganti catatan {t.replacement_of}</div>}
                    {t.void_reason && <div style={{fontSize:10}}>Alasan pembatalan: {t.void_reason}</div>}
                    {t.keterangan && <div style={{ fontSize: 9.5, color: "var(--td)" }}>{t.keterangan}</div>}
                  </td>
                  <td style={{ fontSize: 11, textAlign: "right", fontWeight: 600 }}>{rp(Number(t.jumlah))}</td>
                  <td style={{ fontSize: 10.5, textAlign: "right", color: "var(--tm)" }}>
                    {Number(t.biaya_admin) > 0 ? rp(Number(t.biaya_admin)) : "—"}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{one(t.branches)?.name ?? "Pusat"}</td>
                  <td>
                    <span className={`bge ${t.voided_at ? "x" : "g"}`}>{t.voided_at ? "Dibatalkan" : "Aktif"}</span>
                  </td>
                  {boleh && (
                    <td>
                      {!t.voided_at && (
                        <div>
                          {mayCorrect && <Link href={`/kas-bank/transfer?koreksi=${t.id}&hal=${transferPage?.pageInfo.page ?? 1}#koreksi-transfer`}>Koreksi</Link>}
                          {mayCorrect && <div><Link href={`/kas-bank/transfer?batal=${t.id}&hal=${transferPage?.pageInfo.page ?? 1}#koreksi-transfer`}>Batalkan catatan</Link></div>}
                        </div>
                      )}
                      {history?.some(h=>h.transfer_id===t.id) && <details style={{marginTop:6}}><summary>Riwayat</summary>{history.filter(h=>h.transfer_id===t.id).map((h)=><p key={h.id} style={{fontSize:11}}>{fmtTgl(h.created_at)} · {h.action === "edit" ? "Koreksi" : "Pembatalan"}: {h.reason}<br/>Pelaku: {h.created_by}<br/>Jurnal asli: {h.original_journal_id}<br/>Pembalik: {h.reversal_journal_id}{h.replacement_journal_id && <><br/>Jurnal pengganti: {h.replacement_journal_id}</>}{h.replacement_transfer_id && <><br/>Catatan pengganti: {h.replacement_transfer_id}</>}</p>)}</details>}
                    </td>
                  )}
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr><td colSpan={boleh ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada transfer.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {transferPage && <ListPagination path="/kas-bank/transfer" query={{}} total={transferPage.count} pageInfo={transferPage.pageInfo}/>}
      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 10 }}>
        Hanya Super Admin/OWNER dapat mengoreksi atau membatalkan. Catatan asli tetap tersimpan; jurnal pembalik dan pengganti memakai tanggal serta cabang yang sama. Saldo rekening asal dan tujuan diperbaiki bersama tanpa menambah pendapatan.
      </div>
    </>
  );
}
