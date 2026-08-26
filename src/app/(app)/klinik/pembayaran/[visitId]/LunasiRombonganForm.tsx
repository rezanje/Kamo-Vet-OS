"use client";

// Panel bayar sekaligus untuk satu kedatangan (beberapa hewan).
//
// Bentuknya sengaja disamakan dengan layar bayar per hewan (keputusan meeting
// 14 Agustus): total, metode, promo, voucher, dan poin ada di tempat yang sama,
// dan tombolnya "Bayar & Selesai" — bukan tombol khusus "lunasi semua" yang dulu
// membuat jalur ini terasa seperti fitur lain.

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { bayarRombongan } from "./actions";
import { METODE_BAYAR } from "@/lib/metode-bayar";
import { normalizeKode, pesanVoucherDitolak, potonganVoucher } from "@/lib/voucher";
import type { BekalPotongan } from "@/lib/tagihan-klinik";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function LunasiRombonganForm({ visitId, jumlahPasien, total, tertahan, bekal, promoTotal = 0 }: {
  visitId: string;
  jumlahPasien: number;
  /** Perkiraan total seluruh hewan — sudah termasuk promo & diskon golongan. */
  total: number;
  /** Nama hewan yang tagihannya tertahan persetujuan tindakan. */
  tertahan: string[];
  bekal: BekalPotongan;
  /** Potongan promo & golongan yang sudah tercermin di `total` — untuk ditampilkan. */
  promoTotal?: number;
}) {
  const [metode, setMetode] = useState("Tunai");
  const [bayar, setBayar] = useState(0);
  const [voucher, setVoucher] = useState("");
  const [poinPakai, setPoinPakai] = useState(0);

  // Angka di layar memakai rumus yang sama dengan server, tapi server tetap
  // menghitung ulang saat tombol ditekan — layar tidak menentukan uang.
  const voucherRow = bekal.vouchers.find((v) => v.code === normalizeKode(voucher));
  const tolakVoucher = voucher.trim() === "" ? null : pesanVoucherDitolak(voucherRow ?? null, bekal.hariIni, {
    dasar: total, adaPromoOtomatis: promoTotal > 0,
    customerId: bekal.customerId, categoryId: bekal.categoryId,
  });
  const voucherVal = voucherRow && !tolakVoucher ? potonganVoucher(total, voucherRow) : 0;

  const setelahVoucher = Math.max(0, total - voucherVal);
  const poinMaks = Math.min(bekal.poinSaldo, setelahVoucher);
  const poinDipakai = Math.min(Math.max(0, Math.floor(poinPakai)), poinMaks);
  const tagihan = Math.max(0, setelahVoucher - poinDipakai);

  // Jalur rombongan hanya untuk pelunasan penuh. Bayar sebagian harus lewat
  // hewan masing-masing, supaya jelas uangnya masuk ke tagihan yang mana.
  const kurang = Math.max(0, tagihan - bayar);
  const kembalian = Math.max(0, bayar - tagihan);
  const tunai = metode === "Tunai";
  const belumCukup = tunai && bayar > 0 && kurang > 0;

  return (
    <form action={bayarRombongan} style={{ marginTop: 10, paddingTop: 10, borderTop: ".5px solid #bfdbfe" }}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="metode_bayar" value={metode} />
      <input type="hidden" name="voucherCode" value={voucher} />
      <input type="hidden" name="poinDigunakan" value={poinDipakai} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--posb-dk)" }}>
          TOTAL {jumlahPasien} PASIEN
        </span>
        <span style={{ fontSize: 26, fontWeight: 800, color: "var(--posb-dk)", lineHeight: 1.15 }}>{rp(tagihan)}</span>
      </div>

      {tertahan.length > 0 && (
        <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 4 }}>
          <i className="ti ti-alert-triangle" /> Belum termasuk {tertahan.join(", ")} — persetujuan tindakannya belum ditandatangani.
        </div>
      )}

      {/* Rincian potongan — bentuknya sama dengan layar bayar per hewan. */}
      <div style={{ marginTop: 10, maxWidth: 340 }}>
        <Baris label="Tagihan seluruh hewan" nilai={rp(total)} />
        {promoTotal > 0 && <Baris label="Promo & diskon golongan" nilai={`sudah termasuk`} redup />}
        {voucherVal > 0 && <Baris label="Potongan voucher" nilai={`- ${rp(voucherVal)}`} />}
        {poinDipakai > 0 && <Baris label="Potongan poin" nilai={`- ${rp(poinDipakai)}`} />}
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--posb)", margin: "10px 0 6px" }}>PILIH METODE PEMBAYARAN</div>
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Kode voucher</span>
        <input className="fi" value={voucher} placeholder="opsional" onChange={(e) => setVoucher(e.target.value)}
          style={{ width: 150, textTransform: "uppercase", borderColor: tolakVoucher ? "#fca5a5" : undefined }} />
        {tolakVoucher
          ? <span style={{ fontSize: 10, color: "#b91c1c" }}>{tolakVoucher}</span>
          : <span style={{ fontSize: 10, color: "var(--td)" }}>
              Berlaku sekali untuk satu kedatangan — potongannya dibagi ke nota tiap hewan.
            </span>}
      </div>

      {bekal.poinSaldo > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Pakai poin</span>
          <input className="fi" type="number" min={0} max={poinMaks} step={1} value={poinPakai || ""} placeholder="0"
            onChange={(e) => setPoinPakai(Number(e.target.value))} style={{ width: 120, textAlign: "right" }} />
          <span style={{ fontSize: 10, color: "var(--td)" }}>
            Saldo {bekal.poinSaldo.toLocaleString("id-ID")} poin · 1 poin = Rp1, dibagi ke nota tiap hewan.
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <SubmitButton className="kpos-bayar" icon="ti-circle-check" pendingText="Memproses…"
          style={{ background: "#16a34a", padding: "9px 18px" }}>
          Bayar &amp; Selesai {rp(tagihan)}
        </SubmitButton>
        <span style={{ fontSize: 10, color: "var(--td)" }}>
          Jalur ini untuk pelunasan penuh. Perlu DP, diskon per item, atau ubah isi tagihan? Buka hewannya satu per satu.
        </span>
      </div>
    </form>
  );
}

function Baris({ label, nilai, redup }: { label: string; nilai: string; redup?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: redup ? 400 : 600, color: redup ? "var(--td)" : undefined }}>{nilai}</span>
    </div>
  );
}
