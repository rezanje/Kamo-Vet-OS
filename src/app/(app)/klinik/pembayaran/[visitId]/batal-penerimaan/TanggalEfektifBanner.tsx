import { createClient } from "@/lib/supabase/server";
import { bacaBolehBatalPenerimaan } from "@/lib/batal-penerimaan-akses";
import { lepasTanggalEfektif } from "./actions";

export type TagihanBanner = { id: string; no: string | null };
type Jendela = { invoice_id: string; effective_date: string; opened_at: string };

/**
 * Pemberitahuan di halaman tagihan untuk Owner / peran berizin: tagihan ini memakai tanggal pembukuan lain (dipilih saat Batalkan penerimaan).
 * Peran lain tidak melihat apa pun. Gagal membaca = tidak menampilkan apa pun (tidak pernah merusak halaman tagihan).
 */
export async function TanggalEfektifBanner({ visitId, tagihan }: { visitId: string; tagihan: TagihanBanner[] }) {
  let rows: Jendela[] = [];
  let boleh = false;
  try {
    const ids = tagihan.map((t) => t.id).filter(Boolean);
    if (!ids.length) return null;
    const db = await createClient();
    const { data, error } = await db.from("clinic_backdate_windows").select("invoice_id, effective_date, opened_at").in("invoice_id", ids).eq("status", "terbuka");
    if (error || !data?.length) return null;
    rows = data as Jendela[];
    boleh = (await bacaBolehBatalPenerimaan(db)) === true;
    if (!boleh) return null;
  } catch {
    return null;
  }
  return <div className="p2ban" role="note" style={{ marginBottom: 10 }} data-testid="tanggal-efektif">
    {rows.map((w) => {
      const t = tagihan.find((x) => x.id === w.invoice_id);
      return <div key={w.invoice_id} style={{ marginBottom: 6 }}>
        <b>Tanggal pembukuan diubah ke {w.effective_date}</b> (tagihan {t?.no ?? ""}). Koreksi dan penerimaan berikutnya dicatat di tanggal itu; uang fisik tetap hari ini.
        {boleh && <form action={lepasTanggalEfektif} style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="invoice_id" value={w.invoice_id} />
          <input type="hidden" name="visit_id" value={visitId} />
          <input name="reason" className="fi" maxLength={500} required minLength={3} placeholder="Alasan" style={{ maxWidth: 260 }} aria-label="Alasan kembali ke tanggal hari ini" />
          <button type="submit" className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }}>Pakai tanggal hari ini</button>
        </form>}
      </div>;
    })}
  </div>;
}
