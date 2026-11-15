import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bacaRingkasanBeban, rupiah, STATUS_KASBON_BATAL } from "@/lib/beban-selisih-karyawan";
import { BebanKaryawanForm } from "./BebanKaryawanForm";
import { batalBebanKaryawan } from "./beban-karyawan-actions";

// F2 (meeting 12 Nov 2026): ringkasan selisih kurang (HPP & harga jual) + beban ke karyawan (kasbon, tidak potong gaji).
// Hanya untuk Owner/Finance atau pemegang izin; database menolak peran lain (42501) dan panel ini tidak tampil.
// Sebelum migrasi F2 terpasang (fungsi belum ada) panel juga tidak tampil.

const kanan = { textAlign: "right" } as const;
const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 4 });
const SEMBUNYI = new Set(["42501", "PGRST202", "42883"]);

export async function BebanKaryawanPanel({ orderId }: { orderId: string }) {
  const supabase = await createClient();
  const { data: result } = await supabase.from("opname_results").select("id")
    .eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!result?.id) return null;
  const { data, error } = await supabase.rpc("read_opname_variance_charge", { p_result_id: result.id });
  if (error) {
    if (SEMBUNYI.has(String(error.code ?? ""))) return null;
    return <div id="beban-karyawan" className="p2ban" role="status">Ringkasan selisih kurang belum dapat dimuat. Muat ulang halaman.</div>;
  }
  const r = bacaRingkasanBeban(data);
  if (!r) return <div id="beban-karyawan" className="p2ban" role="status">Ringkasan selisih kurang tidak valid. Muat ulang halaman.</div>;
  if (r.minus_count === 0 && r.charges.length === 0) return null;

  const bolehCatat = r.can_charge && !r.refuse;
  const { data: emp } = bolehCatat
    ? await supabase.from("employees").select("id, nama, jabatan, branch_id").eq("status", "Aktif").is("trashed_at", null).order("nama").limit(1000)
    : { data: null };
  // Karyawan cabang gudang opname di atas, sisanya menyusul (boleh lintas cabang).
  const karyawan = ((emp ?? []) as { id: string; nama: string; jabatan: string | null; branch_id: string | null }[])
    .sort((a, b) => Number(b.branch_id === r.branch_id) - Number(a.branch_id === r.branch_id) || a.nama.localeCompare(b.nama, "id"));
  const selisih = r.jual_total - r.hpp_total;

  return (
    <div id="beban-karyawan" className="crm-sec">
      <SecHeader num="03" title="SELISIH KURANG & BEBAN KARYAWAN"
        desc="Nilai barang yang kurang saat opname, dalam HPP (yang dijurnal sebagai beban) dan harga jual. Hanya Owner/Finance yang melihat bagian ini." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
        <div><div className="flab">Barang kurang</div><div style={{ fontSize: 13, fontWeight: 700 }}>{r.minus_count}</div></div>
        <div><div className="flab">Nilai HPP</div><div style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>{rupiah(r.hpp_total)}</div></div>
        <div><div className="flab">Nilai harga jual</div><div style={{ fontSize: 13, fontWeight: 700 }}>{rupiah(r.jual_total)}</div></div>
        <div><div className="flab">Selisih jual − HPP</div><div style={{ fontSize: 13, fontWeight: 700 }}>{rupiah(selisih)}</div></div>
      </div>
      {r.minus_lines.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>Kode</th><th>Barang</th><th style={kanan}>Kurang</th><th style={kanan}>HPP</th><th style={kanan}>Harga jual</th><th style={kanan}>Nilai harga jual</th></tr></thead>
            <tbody>
              {r.minus_lines.map((l) => (
                <tr key={l.item_id}>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{l.code}</td>
                  <td style={{ fontSize: 11.5 }}>{l.name}</td>
                  <td style={{ ...kanan, fontSize: 11.5 }}>{qty(l.qty)} {l.unit}</td>
                  <td style={{ ...kanan, fontSize: 11.5 }}>{l.hpp === null ? "—" : rupiah(l.hpp)}</td>
                  <td style={{ ...kanan, fontSize: 11.5 }}>{rupiah(l.harga_jual)}</td>
                  <td style={{ ...kanan, fontSize: 11.5, fontWeight: 600 }}>{rupiah(l.jual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.refuse && r.refuse.code !== "SUDAH" && r.refuse.code !== "TANPA_KURANG" && (
        <div className="p2ban" role="status" style={{ marginTop: 10 }}>Belum bisa dibebankan ke karyawan: {r.refuse.message}</div>
      )}
      {!r.can_charge && !r.refuse && (
        <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 10 }}>
          Membebankan selisih ke karyawan hanya bisa oleh Owner atau peran yang diberi izin &quot;Bebankan selisih opname ke karyawan&quot; di Akses Grup.
        </div>
      )}
      {bolehCatat && (
        <>
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 10 }}>
            Bila dicatat: beban selisih stok berkurang {rupiah(r.hpp_part)}{r.gain_part > 0 ? ` dan ${rupiah(r.gain_part)} (harga jual − HPP) masuk Pendapatan Lain-lain` : ""}; karyawan berutang {rupiah(r.jual_total)}.
          </div>
          <BebanKaryawanForm orderId={orderId} resultId={r.result_id} total={r.jual_total} requestKey={randomUUID()}
            karyawan={karyawan.map(({ id, nama, jabatan }) => ({ id, nama, jabatan }))} />
        </>
      )}

      {r.charges.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Riwayat beban karyawan</div>
          {r.charges.map((c) => (
            <div key={c.id} className="p2ban" style={{ display: "block", marginBottom: 8, opacity: c.cancelled_at ? 0.7 : 1 }}>
              <div><b>{rupiah(c.total)}</b> · {c.tanggal} · oleh {c.actor_name ?? "—"} · alasan: {c.reason}{c.cancelled_at ? <> · <b>DIBATALKAN</b> ({c.cancel_reason})</> : null}</div>
              <ul style={{ margin: "4px 0 4px 16px" }}>
                {c.lines.map((l) => (
                  <li key={l.advance_id}>{l.nama ?? "—"}: {rupiah(l.amount)} · kasbon {l.status === STATUS_KASBON_BATAL ? "batal" : (l.status ?? "—").toLowerCase()}{l.dibayar > 0 ? ` · sudah dibayar ${rupiah(l.dibayar)}` : ""}</li>
                ))}
              </ul>
              <div style={{ fontSize: 10.5 }}>
                <Link href={`/keuangan/jurnal?entry=${encodeURIComponent(c.journal_id)}`}>Lihat jurnal</Link>
                {c.cancel_journal_id && <> · <Link href={`/keuangan/jurnal?entry=${encodeURIComponent(c.cancel_journal_id)}`}>Jurnal pembatalan</Link></>}
                {" · "}<Link href="/hris/pengajuan">Lihat di HRIS</Link>
              </div>
              {r.can_charge && !c.cancelled_at && (
                <form action={batalBebanKaryawan} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                  <input type="hidden" name="order_id" value={orderId} />
                  <input type="hidden" name="charge_id" value={c.id} />
                  <input type="hidden" name="request_key" value={randomUUID()} />
                  <input className="fi" name="alasan" required minLength={3} maxLength={300} placeholder="Alasan pembatalan (wajib)" style={{ width: 240, height: 28, fontSize: 10.5 }} />
                  <button className="btn" type="submit">Batalkan beban</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
