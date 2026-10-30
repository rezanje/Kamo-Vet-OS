"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { batalkanPengirimanPermintaan } from "../actions";

export function BatalKirimPermintaanForm({ userId, requestId }: { userId: string; requestId: string }) {
  return (
    <div className="crm-sec" id="batal-kirim">
      <SecHeader
        num="04"
        title="BATALKAN PENGIRIMAN"
        desc="Dipakai kalau gudang salah kirim. Hanya selama cabang belum mencatat penerimaan."
      />
      <CorrectionTransactionForm userId={userId} scope={`stock-request-ship-cancel:${requestId}`} action={batalkanPengirimanPermintaan}>
        {({ ready }) => <>
          <input type="hidden" name="id" value={requestId} />
          <p style={{ fontSize: 11, color: "var(--tm)", marginTop: 0 }}>
            Barang yang masih di perjalanan kembali ke stok gudang pengirim dengan harga pokok aslinya,
            dan permintaan ini kembali ke status Disetujui supaya bisa dikirim ulang dengan isi yang benar.
            Kalau cabang sudah menekan Terima barang, pembatalan ditolak — selesaikan lewat penerimaan.
          </p>
          <label className="flab" htmlFor="request-ship-cancel-reason">Alasan pembatalan</label>
          <input className="fi" id="request-ship-cancel-reason" name="alasan" minLength={3} maxLength={1000} required
            placeholder="Contoh: salah barang, kiriman ditahan di gudang" />
          <div style={{ marginTop: 8 }}>
            <SubmitButton className="btn-def" style={{ color: "#b91c1c" }} icon="ti-ban" name="tindakan" value="batal" disabled={!ready}>
              Batalkan pengiriman
            </SubmitButton>
          </div>
        </>}
      </CorrectionTransactionForm>
    </div>
  );
}
