"use client";

// Panel bayar sekaligus untuk satu kedatangan (beberapa hewan).
// Urutannya sengaja: ANGKA dulu, baru metode — pemilik memutuskan mau bayar
// pakai apa setelah tahu jumlahnya, sama seperti layar bayar per hewan.

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { bayarRombongan } from "./actions";
import { METODE_BAYAR } from "@/lib/metode-bayar";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function LunasiRombonganForm({ visitId, jumlahPasien, total, tertahan }: {
  visitId: string;
  jumlahPasien: number;
  total: number;
  /** Nama hewan yang tagihannya tertahan persetujuan tindakan. */
  tertahan: string[];
}) {
  const [metode, setMetode] = useState("Tunai");
  const [bayar, setBayar] = useState(0);
  const [voucher, setVoucher] = useState("");

  // Potongan voucher dihitung server saat tombol ditekan (sekali untuk satu
  // kedatangan, lalu dibagi proporsional ke nota tiap hewan). Layar tidak
  // memajang angkanya supaya kasir tidak menyebut potongan yang belum tentu sah.

  // Jalur rombongan hanya untuk pelunasan penuh. Bayar sebagian harus lewat
  // hewan masing-masing, supaya jelas uangnya masuk ke tagihan yang mana.
  const kurang = Math.max(0, total - bayar);
  const kembalian = Math.max(0, bayar - total);
  const tunai = metode === "Tunai";
  const belumCukup = tunai && bayar > 0 && kurang > 0;

  return (
    <form action={bayarRombongan} style={{ marginTop: 10, paddingTop: 10, borderTop: ".5px solid #bfdbfe" }}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="metode_bayar" value={metode} />
      <input type="hidden" name="voucherCode" value={voucher} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#1e40af" }}>
          TOTAL {jumlahPasien} PASIEN YANG AKAN DILUNASI
        </span>
        <span style={{ fontSize: 26, fontWeight: 800, color: "#1e40af", lineHeight: 1.15 }}>{rp(total)}</span>
      </div>

      {tertahan.length > 0 && (
        <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 4 }}>
          <i className="ti ti-alert-triangle" /> Belum termasuk {tertahan.join(", ")} — persetujuan tindakannya belum ditandatangani.
        </div>
      )}

      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#2563eb", margin: "10px 0 6px" }}>PILIH METODE PEMBAYARAN</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
        {METODE_BAYAR.map(({ m, ic, desc }) => (
          <button key={m} type="button" onClick={() => setMetode(m)} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, cursor: "pointer", textAlign: "left",
            border: `1.5px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "#eff4ff" : "#fff",
          }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, border: `2px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "var(--posb)" : "#fff", boxShadow: metode === m ? "inset 0 0 0 2.5px #fff" : "none" }} />
            <i className={`ti ${ic}`} style={{ fontSize: 16, color: metode === m ? "var(--posb)" : "var(--tm)" }} />
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{m}</div>
              <div style={{ fontSize: 9, color: "var(--tm)" }}>{desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Kembalian hanya relevan untuk tunai — transfer/QRIS/kartu selalu pas. */}
      {tunai && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Uang diterima</span>
            <input className="fi" type="number" min={0} step={1} value={bayar || ""} placeholder="0"
              onChange={(e) => setBayar(Number(e.target.value))} style={{ width: 140, textAlign: "right" }} />
          </div>
          <div style={{ fontSize: 12 }}>
            {belumCukup ? (
              <span style={{ fontWeight: 700, color: "#b91c1c" }}>Kurang {rp(kurang)}</span>
            ) : (
              <>
                <span style={{ fontWeight: 600, color: "#15803d", marginRight: 8 }}>Kembalian</span>
                <span style={{ fontWeight: 800, color: "#15803d" }}>{rp(kembalian)}</span>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Kode voucher</span>
        <input className="fi" value={voucher} placeholder="opsional" onChange={(e) => setVoucher(e.target.value)}
          style={{ width: 150, textTransform: "uppercase" }} />
        <span style={{ fontSize: 10, color: "var(--td)" }}>
          Berlaku sekali untuk satu kedatangan — potongannya dibagi ke nota tiap hewan.
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <SubmitButton className="kpos-bayar" icon="ti-circle-check" pendingText="Memproses…"
          style={{ background: "#16a34a", padding: "9px 18px" }}>
          Lunasi semua {rp(total)}
        </SubmitButton>
        <span style={{ fontSize: 10, color: "var(--td)" }}>
          Jalur ini untuk pelunasan penuh. Perlu DP, diskon, atau ubah item? Buka hewannya satu per satu.
        </span>
      </div>
    </form>
  );
}
