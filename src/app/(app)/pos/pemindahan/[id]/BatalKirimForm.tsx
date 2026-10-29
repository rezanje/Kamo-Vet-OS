"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { SecHeader } from "@/components/SecHeader";
import { batalkanPengiriman } from "../actions";

export function BatalKirimForm({ userId, transferId, nomor }: { userId: string; transferId: string; nomor: string }) {
  return (
    <div className="crm-sec" id="batal">
      <SecHeader
        num="04"
        title="BATALKAN PENGIRIMAN"
        desc="Dipakai kalau gudang salah barang atau salah jumlah. Hanya selama gudang tujuan belum menerima apa pun."
      />
      <CorrectionTransactionForm userId={userId} scope={`stock-transfer-cancel:${transferId}`} action={batalkanPengiriman}>
        {({ ready }) => <>
          <input type="hidden" name="transfer_id" value={transferId} />
          <p style={{ fontSize: 11, color: "var(--tm)", marginTop: 0 }}>
            Barang yang masih di Transit kembali ke gudang asal dengan harga pokok dan tanggal kedaluwarsa
            aslinya. Dokumen {nomor} tidak dihapus — tetap tersimpan dengan status Dibatalkan beserta alasannya.
            Begitu ada satu dokumen Terima Barang, pembatalan ditolak dan koreksinya lewat pemindahan balik.
          </p>
          <label className="flab" htmlFor="transfer-cancel-reason">Alasan pembatalan</label>
          <input className="fi" id="transfer-cancel-reason" name="alasan" minLength={3} maxLength={1000} required
            placeholder="Contoh: salah barang, kiriman diganti dokumen baru" />
          <div style={{ marginTop: 8 }}>
            <SubmitButton className="btn-def" style={{ color: "#b91c1c" }} icon="ti-ban" name="tindakan" value="batal" disabled={!ready}>Batalkan pengiriman</SubmitButton>
          </div>
        </>}
      </CorrectionTransactionForm>
    </div>
  );
}
