import { createClient } from "@/lib/supabase/server";
import { StockCorrectionForm } from "./StockCorrectionForm";
import type { StockCorrectionKind, StockCorrectionState } from "@/lib/stock-correction-types";

export async function StockCorrectionPanel({ kind, documentId }: { kind: StockCorrectionKind; documentId: string }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: profile } = await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" || profile.is_active !== true) return null;
  const { data, error } = await db.rpc("get_stock_document_correction", { p_kind: kind, p_id: documentId });
  if (error || !data) return <div role="status" className="p2ban">Koreksi belum tersedia: {error?.message ?? "dokumen tidak dapat diperiksa"}</div>;
  const state = data as StockCorrectionState;
  return <>
    <StockCorrectionForm key={`${kind}:${documentId}:${state.revision}`} userId={user.id} kind={kind} documentId={documentId} revision={state.revision} rows={state.rows} />
    {state.history.length > 0 && <div className="crm-sec"><h3>Riwayat koreksi · dokumen asal tetap tersimpan</h3>{state.history.map(entry => <details key={entry.id}>
      <summary>Revisi {entry.revision} · {new Date(entry.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB · {entry.reason}</summary>
      <p>Pelaku: {entry.created_by}. Dokumen koreksi: {entry.id}.</p>
      {entry.after_rows.map(row => <p key={row.item_id}>{row.name}: {entry.before_rows.find(old => old.item_id === row.item_id)?.qty} → {row.qty}</p>)}
      <p>Jurnal pembalikan: {entry.reversal_journal_ids.join(", ") || "Tidak ada nilai sumber"}. Jurnal pengganti: {entry.replacement_journal_id ?? "Nilai nol"}.</p>
    </details>)}</div>}
  </>;
}
