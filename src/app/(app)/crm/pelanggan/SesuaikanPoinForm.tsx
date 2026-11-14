"use client";

import { sesuaikanPoin } from "./actions";
import { ALASAN_POIN_MAKS } from "@/lib/poin-manual";

/**
 * D1 (meeting 12 Nov 2026): form tambah/kurangi poin manual. Tampil hanya bila database menyatakan boleh
 * (Owner, atau peran yang diberi izin "Sesuaikan poin pelanggan"). Kunci permintaan dibuat sekali per form saat dikirim,
 * jadi klik ganda tidak menambah poin dua kali.
 */
export function SesuaikanPoinForm({ id, phone, saldo }: { id: string; phone: string; saldo: number }) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "5px 10px", cursor: "pointer", listStyle: "none" }}>
        <i className="ti ti-star" /> Sesuaikan poin
      </summary>
      <form
        action={sesuaikanPoin}
        aria-label="Sesuaikan poin"
        onSubmit={(e) => {
          const kunci = e.currentTarget.elements.namedItem("request_key") as HTMLInputElement | null;
          if (kunci && !kunci.value) kunci.value = crypto.randomUUID();
        }}
        style={{ marginTop: 8, display: "grid", gap: 8, padding: 10, border: ".5px solid var(--bd)", borderRadius: 8 }}
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="request_key" defaultValue="" />
        <div style={{ fontSize: 10, color: "var(--tm)" }}>Saldo sekarang: <b>{saldo.toLocaleString("id-ID")} poin</b>. Saldo tidak bisa dibuat minus.</div>
        <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
          <label><input type="radio" name="arah" value="tambah" defaultChecked /> Tambah</label>
          <label><input type="radio" name="arah" value="kurang" /> Kurangi</label>
        </div>
        <label style={{ fontSize: 10, color: "var(--tm)" }}>Jumlah poin
          <input name="jumlah" className="fi" required inputMode="numeric" pattern="[0-9.,\s]+" placeholder="mis. 1500" style={{ display: "block", width: "100%", fontSize: 12 }} />
        </label>
        <label style={{ fontSize: 10, color: "var(--tm)" }}>Alasan (wajib)
          <textarea name="alasan" className="fi" required minLength={3} maxLength={ALASAN_POIN_MAKS} rows={2} placeholder="mis. Saldo poin dari sistem lama / hadiah quest" style={{ display: "block", width: "100%", fontSize: 12 }} />
        </label>
        <div style={{ fontSize: 10, color: "var(--tm)" }}>Tercatat di riwayat poin & log aktivitas (siapa, kapan, alasan).</div>
        <button type="submit" className="btn-acc" style={{ justifySelf: "start", fontSize: 11, padding: "5px 12px" }}>Simpan</button>
      </form>
    </details>
  );
}
