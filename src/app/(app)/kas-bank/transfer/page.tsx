import { TransferForm } from "./TransferForm";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { getAccountBalances } from "@/lib/ledger";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Baris = {
  id: string; no_transfer: string; tanggal: string; jumlah: number; biaya_admin: number;
  keterangan: string | null; voided_at: string | null; revision: number; from_account_id: string; to_account_id: string;
  from: Rel<{ nama: string }>; to: Rel<{ nama: string }>; branches: Rel<{ name: string }>;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) =>
  new Date(d).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

export default async function TransferPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();
  const boleh = await bolehTransaksiKas();
  const {data: profile} = await supabase.from("profiles").select("role").eq("id",user?.id ?? "").maybeSingle();

  const [{ data: rekData }, { data: branches }, { data: rows }, saldoAkun] = await Promise.all([
    supabase.from("cash_accounts").select("id, nama, jenis, coa_code").eq("is_active", true).order("nama"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("cash_transfers")
      .select("id, no_transfer, tanggal, jumlah, biaya_admin, keterangan, voided_at, revision, from_account_id, to_account_id, from:from_account_id(nama), to:to_account_id(nama), branches(name)")
      .order("tanggal", { ascending: false }).order("created_at", { ascending: false }).limit(50),
    getAccountBalances(supabase),
  ]);

  const saldoPerKode = new Map(saldoAkun.map((a) => [a.code, a.saldo]));
  const rekening = (rekData ?? []) as { id: string; nama: string; jenis: string; coa_code: string }[];
  const daftar = (rows ?? []) as unknown as Baris[];
  const {data: history} = daftar.length ? await supabase.from("cash_transfer_revisions")
    .select("transfer_id,action,reason,created_at").in("transfer_id",daftar.map(t=>t.id)).order("created_at",{ascending:false}) : {data:[]};

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
            Setor tunai, tarik tunai, dan pindah antar rekening — semuanya lewat sini
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
          <i className="ti ti-circle-check" /> {success === "batal" ? "Transfer dibatalkan." : success === "koreksi" ? "Koreksi transfer tersimpan." : "Transfer tersimpan."}
        </div>
      )}
      {!boleh && <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN/FINANCE yang bisa membuat transfer.</div>}
      {rekening.length < 2 && (
        <div className="p2ban">
          <i className="ti ti-info-circle" /> Butuh minimal dua rekening aktif. Tambah di{" "}
          <Link href="/kas-bank/rekening" style={{ color: "#2563eb" }}>Daftar Rekening</Link>.
        </div>
      )}

      {boleh && rekening.length >= 2 && (
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
                          {profile?.role === "OWNER" && <details><summary>Koreksi</summary><TransferForm userId={user?.id ?? ""} mode="edit" header={t} rekening={opsi}/></details>}
                          <details><summary>Batalkan</summary><TransferForm userId={user?.id ?? ""} mode="void" header={t}/></details>
                        </div>
                      )}
                      {history?.some(h=>h.transfer_id===t.id) && <details style={{marginTop:6}}><summary>Riwayat</summary>{history.filter(h=>h.transfer_id===t.id).map((h,index)=><p key={index} style={{fontSize:11}}>{fmtTgl(h.created_at)} · {h.action === "edit" ? "Koreksi" : "Pembatalan"}: {h.reason}</p>)}</details>}
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

      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 10 }}>
        Transfer tidak bisa dihapus — dibatalkan dengan jurnal balik bertanggal sama, supaya laporan
        bulan mana pun tidak ikut bergeser.
      </div>
    </>
  );
}
