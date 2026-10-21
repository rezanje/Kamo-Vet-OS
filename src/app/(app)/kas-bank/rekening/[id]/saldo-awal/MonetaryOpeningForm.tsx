"use client";

import { useRef, useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import type { MonetaryOpeningLine, MonetaryOpeningPreview } from "@/lib/monetary-opening";
import { correctMonetaryOpening, previewMonetaryOpening } from "./actions";

const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

export function MonetaryOpeningForm({ userId, accountId }: { userId: string; accountId: string }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<MonetaryOpeningPreview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  function invalidate() { generation.current++; setPreview(undefined); setError(""); setLoading(false); }
  async function inspect() {
    const request = ++generation.current;
    setPreview(undefined); setError(""); setLoading(true);
    const form = new FormData();
    form.set("account_id", accountId); form.set("amount", amount); form.set("reason", reason);
    try {
      const result = await previewMonetaryOpening(form);
      if (generation.current !== request) return;
      setPreview(result.preview); setError(result.error ?? "");
    } catch {
      if (generation.current === request) setError("Preview belum diterima. Isian tetap tersedia; coba periksa lagi.");
    } finally { if (generation.current === request) setLoading(false); }
  }
  const valid = amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0 && reason.trim().length >= 3;
  return <CorrectionTransactionForm userId={userId} scope={`monetary-opening:${accountId}`} action={correctMonetaryOpening}
    state={{ snapshot: { amount, reason }, restore(value) {
      if (typeof value.amount !== "string" || typeof value.reason !== "string") return false;
      invalidate(); setAmount(value.amount); setReason(value.reason); return true;
    }, reset() { invalidate(); setAmount(""); setReason(""); } }}>
    {({ ready }) => <>
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="preview" value={preview ? JSON.stringify(preview) : ""} />
      <p>Koreksi ini memperbaiki catatan saldo pembuka rekening. Transaksi setelahnya tetap tersimpan dan penyeimbangnya masuk Modal Pemilik.</p>
      <p>Saldo berjalan pada preview mencakup seluruh jurnal rekening di semua cabang terkait, termasuk jurnal bertanggal mendatang yang sudah tercatat.</p>
      <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
        <label className="flab">Saldo pembuka yang benar (Rp)
          <input className="fi" name="amount" type="number" min="0" max="1000000000000" step="0.01" value={amount}
            onChange={e => { invalidate(); setAmount(e.target.value); }} />
        </label>
        <label className="flab">Alasan koreksi
          <textarea className="fi" name="reason" minLength={3} maxLength={1000} value={reason}
            onChange={e => { invalidate(); setReason(e.target.value); }} />
        </label>
      </div>
      {error && <div className="p2ban" role="alert">{error}</div>}
      <button className="btn-def" type="button" disabled={!ready || !valid || loading} onClick={inspect} style={{ margin: "12px 0" }}>
        {loading ? "Memeriksa dampak…" : "Preview dampak"}
      </button>
      {preview && <section aria-label="Preview dampak saldo awal" className="crm-sec">
        <p>Posisi pembuka per {preview.tanggal}{preview.original_no_jurnal ? ` · ${preview.original_no_jurnal}` : " · Pembuka sebelumnya nol"}</p>
        <dl>
          <dt>Saldo pembuka lama</dt><dd>{rp(preview.old_amount)}</dd>
          <dt>Saldo pembuka baru</dt><dd>{rp(preview.new_amount)}</dd>
          <dt>Perubahan saldo</dt><dd>{rp(preview.delta)}</dd>
          <dt>Saldo berjalan sebelum koreksi</dt><dd>{rp(preview.balance_before)}</dd>
          <dt>Saldo berjalan setelah koreksi</dt><dd>{rp(preview.balance_after)}</dd>
        </dl>
        <p>Alasan: {preview.reason}</p>
        <Journal title="Jurnal pembalik bagian moneter" lines={preview.reversal} />
        <Journal title="Jurnal pengganti bagian moneter" lines={preview.replacement} />
        <p>Periksa angka di atas sebelum menyimpan. Perubahan transaksi, periode, atau rekonsiliasi akan diperiksa kembali saat penyimpanan.</p>
      </section>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <SubmitButton className="btn-acc" disabled={!ready || !preview || loading} pendingText="Menyimpan koreksi…">Simpan koreksi saldo awal</SubmitButton>
        <button type="submit" className="btn-def" name="intent" value="recover" formNoValidate disabled={!ready}>Periksa hasil permintaan sebelumnya</button>
      </div>
    </>}
  </CorrectionTransactionForm>;
}

function Journal({ title, lines }: { title: string; lines: MonetaryOpeningLine[] }) {
  return <div style={{ overflowX: "auto", margin: "12px 0" }}>
    <p><strong>{title}</strong></p>
    <table className="tbl"><thead><tr><th>Akun</th><th>Debit</th><th>Kredit</th></tr></thead>
      <tbody>{lines.map(line => <tr key={line.code}><td>{line.code === "3101" ? "3101 · Modal Pemilik" : line.code}</td><td>{rp(line.debit)}</td><td>{rp(line.credit)}</td></tr>)}</tbody>
    </table>
  </div>;
}
