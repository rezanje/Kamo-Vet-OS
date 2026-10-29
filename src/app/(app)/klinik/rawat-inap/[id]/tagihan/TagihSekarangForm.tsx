"use client";
import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { tagihSekarang } from "./actions";
import { nilaiBarisResep, uangMukaTerpakai, type BarisResep } from "@/lib/tagihan-berjalan";
import { kurangUangMuka, uangMukaMinimal } from "@/lib/dp-minimal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/**
 * "Tagih sekarang" — manual, tidak pernah otomatis saat catatan harian disimpan.
 *
 * Yang ditagih hanya baris yang dicentang. Angka di layar dihitung ulang server;
 * ini supaya staf melihat dulu berapa yang akan jadi omzet dan berapa uang muka
 * minimal yang harus sudah diterima.
 */
export function TagihSekarangForm({
  recordId, visitId, requestKey, baris, ppnRate, minDpPercent, saldoUangMuka, bolehTerobos,
}: {
  recordId: string; visitId: string; requestKey: string;
  baris: BarisResep[]; ppnRate: number; minDpPercent: number;
  saldoUangMuka: number; bolehTerobos: boolean;
}) {
  const [dipilih, setDipilih] = useState<string[]>(() => baris.map((b) => b.id));
  const pilih = (id: string) =>
    setDipilih((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const { subtotal, tax, total } = useMemo(() => {
    const sub = baris.filter((b) => dipilih.includes(b.id)).reduce((s, b) => s + nilaiBarisResep(b), 0);
    const pajak = ppnRate > 0 && sub > 0 ? Math.round((sub * ppnRate) / 100) : 0;
    return { subtotal: sub, tax: pajak, total: sub + pajak };
  }, [baris, dipilih, ppnRate]);

  const terpakai = uangMukaTerpakai(saldoUangMuka, total);
  const kurang = kurangUangMuka(total, terpakai, minDpPercent);

  if (!baris.length) {
    return (
      <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
        Semua obat, tindakan, dan jasa yang tercatat sudah masuk tagihan tahap. Item baru yang
        diinput dokter akan muncul di sini untuk ditagih pada tahap berikutnya.
      </div>
    );
  }

  return (
    <form action={tagihSekarang}>
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="ids" value={JSON.stringify(dipilih)} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Item</th><th style={{ textAlign: "center" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Harga</th><th style={{ textAlign: "right" }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b) => (
              <tr key={b.id}>
                <td>
                  <input type="checkbox" aria-label={`Tagih ${b.nama_obat}`}
                    checked={dipilih.includes(b.id)} onChange={() => pilih(b.id)} />
                </td>
                <td style={{ fontWeight: 500 }}>
                  {b.nama_obat}
                  <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                    {b.jenis === "jasa" ? "Jasa / tindakan" : "Obat / barang"}
                    {b.kategori ? ` · ${b.kategori}` : ""}{b.satuan ? ` · ${b.satuan}` : ""}
                  </div>
                </td>
                <td style={{ textAlign: "center" }}>{b.qty}</td>
                <td style={{ textAlign: "right" }}>{rp(Number(b.harga) || 0)}</td>
                <td style={{ textAlign: "right" }}>{rp(nilaiBarisResep(b))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, marginLeft: "auto", width: 260, fontSize: 11.5 }}>
        <Baris label="Subtotal" value={rp(subtotal)} />
        {ppnRate > 0 && <Baris label={`PPN ${ppnRate}%`} value={rp(tax)} />}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--bd)" }}>
          <b>Total tahap ini</b><b style={{ color: "var(--acc)" }}>{rp(total)}</b>
        </div>
        <Baris label="Uang muka pemilik dipakai" value={rp(terpakai)} />
        <Baris label={`Uang muka minimal ${minDpPercent}%`} value={rp(uangMukaMinimal(total, minDpPercent))} />
      </div>

      {kurang > 0 && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 10 }}>
          <i className="ti ti-alert-triangle" /> Kurang {rp(kurang)} dari uang muka minimal.
          {bolehTerobos
            ? " Terima pembayaran dulu, atau isi alasan di bawah untuk tetap menagih."
            : " Terima pembayaran dulu, atau minta OWNER/ADMIN/FINANCE yang menagih dengan alasan."}
        </div>
      )}
      {kurang > 0 && bolehTerobos && (
        <div className="fg" style={{ marginTop: 8 }}>
          <label className="flab" htmlFor="dp_override_reason">Alasan menagih di bawah uang muka minimal</label>
          <input className="fi" id="dp_override_reason" name="dp_override_reason" maxLength={500}
            placeholder="Mis. pemilik transfer besok pagi, disetujui pemilik klinik" />
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
            Alasan, nama, dan waktunya tercatat permanen di catatan penerobosan uang muka.
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}>
        <SubmitButton className="btn-acc" icon="ti-file-invoice" pendingText="Menagih…"
          disabled={!dipilih.length || total <= 0}>
          Tagih sekarang
        </SubmitButton>
      </div>
    </form>
  );
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
      <span style={{ color: "var(--tm)" }}>{label}</span><span>{value}</span>
    </div>
  );
}
