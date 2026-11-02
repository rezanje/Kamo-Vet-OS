import type { ReactNode } from "react";
import type { RincianTutupShiftData } from "@/lib/rincian-tutup-shift-server";
import { namaBulan, namaPeriode, tanggalPanjang, type RingkasanTarget } from "@/lib/rincian-tutup-shift";

const rp = (n: number) => (n < 0 ? "− " : "") + "Rp " + Math.round(Math.abs(n)).toLocaleString("id-ID");
const persen = (n: number) => {
  const bulat = n < 10 && Math.round(n) !== n ? Math.round(n * 10) / 10 : Math.round(n);
  return `${bulat.toLocaleString("id-ID")}%`;
};
const jam = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

const HIJAU = "#15803d", BIRU = "#1d4ed8", MERAH = "#b91c1c", NAVY = "#0f1f3d", ORANYE = "#c2410c";

/**
 * Kartu Rincian Tutup Shift — tata letak mengikuti contoh dari pemilik toko
 * (VN 2 Nov 2026). Dipakai layar kasir sesudah tutup shift dan layar riwayat.
 */
export function RincianTutupShift({ data, footer }: { data: RincianTutupShiftData; footer?: ReactNode }) {
  const { pembayaran: bayar, selisih } = data;
  const warnaSelisih = selisih === 0 ? HIJAU : selisih > 0 ? BIRU : MERAH;
  const ketSelisih = selisih === 0 ? "Kas cocok" : selisih > 0 ? "Kas lebih" : "Kas kurang";

  return (
    <div className="card pshop-card rts-card" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 560, padding: "20px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, letterSpacing: ".02em" }}>
          <i className="ti ti-cash-register" style={{ marginRight: 6 }} />RINCIAN TUTUP SHIFT
        </div>
        <div style={{ fontSize: 12.5, color: NAVY }}>
          <i className="ti ti-calendar" style={{ marginRight: 4 }} />{tanggalPanjang(data.tanggal)}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 4 }}>
        {data.cabang}{data.jenis === "klinik" ? " · Klinik" : " · Petshop"}
        {data.kasir ? ` · ${data.kasir}` : ""}
        {` · ${jam(data.openedAt)} – ${data.closedAt ? jam(data.closedAt) : "belum ditutup"}`}
      </div>

      <div style={{ textAlign: "center", padding: "14px 0 12px" }}>
        <div style={{ fontSize: 12, color: NAVY, letterSpacing: ".04em" }}>
          {data.jenis === "klinik" ? "UANG MASUK SHIFT INI" : "OMSET SHIFT INI"}
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, color: NAVY, lineHeight: 1.15, marginTop: 2 }}>{rp(bayar.omset)}</div>
      </div>

      <div style={{ borderTop: "1px solid var(--bd)", padding: "10px 2px", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span style={{ color: NAVY }}>MODAL AWAL</span>
        <b>{rp(data.modalAwal)}</b>
      </div>

      <Kotak warna={HIJAU} latar="#fff" garis="var(--bd)" ikon="ti-cash" judul="PEMBAYARAN TUNAI" nilai={rp(bayar.tunai)} />

      <Kotak warna={BIRU} latar="#fff" garis="var(--bd)" ikon="ti-qrcode" judul="PEMBAYARAN NON TUNAI" nilai={rp(bayar.nonTunai)}>
        {bayar.nonTunaiRincian.map((r) => <Butir key={r.metode} label={r.metode} nilai={rp(r.jumlah)} />)}
      </Kotak>

      <Kotak warna={MERAH} latar="#fef2f2" garis="#fecaca" ikon="ti-receipt-2" judul="PENGELUARAN" nilai={rp(data.pengeluaranTunai)}>
        {data.pengeluaranTunaiRincian.map((r, i) => <Butir key={i} label={r.keterangan} nilai={rp(r.jumlah)} />)}
        {data.pengeluaranNonTunai > 0 && (
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 4 }}>
            + {rp(data.pengeluaranNonTunai)} dibayar dari rekening (tidak mengurangi uang laci).
          </div>
        )}
      </Kotak>

      <div style={{ borderTop: "1px solid var(--bd)", marginTop: 4, padding: "8px 2px 0" }}>
        <Baris label="TOTAL KAS SEHARUSNYA" nilai={rp(data.kasSeharusnya)} />
        <Baris label="KAS FISIK DIHITUNG" nilai={rp(data.kasFisik)} />
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
        background: selisih === 0 ? "#ecfdf3" : selisih > 0 ? "#eff6ff" : "#fef2f2",
        border: `1px solid ${selisih === 0 ? "#86efac" : selisih > 0 ? "#bfdbfe" : "#fca5a5"}`,
        borderRadius: 8, padding: "10px 12px", marginTop: 8,
      }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: warnaSelisih }}>
          <i className={`ti ti-${selisih === 0 ? "circle-check" : "alert-circle"}`} style={{ marginRight: 6 }} />
          SELISIH KAS
          {selisih !== 0 && <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 6 }}>({ketSelisih})</span>}
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, color: warnaSelisih }}>{selisih > 0 ? "+ " : ""}{rp(selisih)}</span>
      </div>

      {data.target && <BagianTarget target={data.target} />}

      {footer}
    </div>
  );
}

function BagianTarget({ target }: { target: RingkasanTarget | { error: string } }) {
  if ("error" in target) {
    return (
      <div style={{ marginTop: 16, fontSize: 11.5, color: "var(--tm)", background: "#f8fafc", border: "1px solid var(--bd)", borderRadius: 8, padding: "10px 12px" }}>
        <i className="ti ti-info-circle" style={{ marginRight: 4 }} />{target.error}
      </div>
    );
  }
  const t = target;
  const bulan = namaBulan(t.periode);
  const tercapai = t.persenHarian !== null && t.persenHarian >= 100;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, letterSpacing: ".03em", marginBottom: 8 }}>
        <i className="ti ti-chart-bar" style={{ marginRight: 5 }} />RINGKASAN OMSET BULAN {namaPeriode(t.periode).toUpperCase()}
      </div>

      <div className="rts-grid2" style={{ border: "1px solid var(--bd)", borderRadius: 10, padding: 12 }}>
        <div>
          <div style={{ fontSize: 10.5, color: NAVY }}>TOTAL OMSET BULAN INI</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: BIRU, marginTop: 2 }}>{rp(t.omsetBulan)}</div>
          {t.persenBulan !== null && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 6 }}>
                <span style={{ color: NAVY }}>Pencapaian target bulan ini</span>
                <b style={{ color: BIRU }}>{persen(t.persenBulan)}</b>
              </div>
              <Bar persen={t.persenBulan} warna={BIRU} />
            </>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: NAVY }}>TARGET OMSET BULAN {bulan.toUpperCase()}</div>
          {t.target === null ? (
            <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 4 }}>
              Target bulan ini belum diatur. Owner/Admin bisa mengisinya di menu Target Penjualan (pilih cabang ini, diukur dari omzet).
            </div>
          ) : (
            <>
              <div style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginTop: 2 }}>{rp(t.target)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 6 }}>
                <span style={{ color: NAVY }}>Sisa target bulan ini</span>
                <span>{rp(t.sisaTarget ?? 0)}</span>
              </div>
              <Bar persen={t.target > 0 ? ((t.sisaTarget ?? 0) / t.target) * 100 : 0} warna="#cbd5e1" />
            </>
          )}
        </div>
      </div>

      <div className="rts-grid3" style={{ marginTop: 10, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 12 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: ORANYE }}><i className="ti ti-target-arrow" style={{ marginRight: 4 }} />TARGET HARIAN</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: NAVY, marginTop: 2 }}>{t.targetHarian === null ? "—" : rp(t.targetHarian)}</div>
          <div style={{ fontSize: 10.5, color: "var(--tm)" }}>(target per hari)</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: NAVY }}>PENJUALAN HARI INI</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: NAVY, marginTop: 2 }}>{rp(t.penjualanHari)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10.5, color: HIJAU }}>PENCAPAIAN TARGET HARIAN</div>
          {t.persenHarian === null ? (
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--tm)", marginTop: 2 }}>—</div>
          ) : (
            <>
              <div style={{ fontSize: 26, fontWeight: 800, color: tercapai ? HIJAU : ORANYE, lineHeight: 1.2 }}>{persen(t.persenHarian)}</div>
              <Bar persen={t.persenHarian} warna={tercapai ? HIJAU : ORANYE} />
              <div style={{
                display: "inline-block", marginTop: 6, fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                color: tercapai ? HIJAU : ORANYE, background: tercapai ? "#ecfdf3" : "#fff7ed",
                border: `1px solid ${tercapai ? "#86efac" : "#fed7aa"}`,
              }}>
                <i className={`ti ti-${tercapai ? "circle-check" : "clock"}`} style={{ marginRight: 4 }} />
                {tercapai ? "TARGET TERLAMPAUI" : "BELUM TERCAPAI"}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10.5, color: "#1e3a8a", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 10px" }}>
        <i className="ti ti-info-circle" style={{ marginRight: 4 }} />
        {t.target !== null && <>Target harian = target bulan ini dibagi jumlah hari di bulan {bulan} ({t.jumlahHari} hari). </>}
        Omset bulan &amp; penjualan hari ini = semua penjualan toko di cabang ini (semua kasir) sampai jam shift ini ditutup.
      </div>
    </div>
  );
}

function Kotak({ warna, latar, garis, ikon, judul, nilai, children }: {
  warna: string; latar: string; garis: string; ikon: string; judul: string; nilai: string; children?: ReactNode;
}) {
  return (
    <div style={{ background: latar, border: `1px solid ${garis}`, borderRadius: 10, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: warna }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: warna, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className={`ti ${ikon}`} style={{ fontSize: 15 }} />
          </span>
          {judul}
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, color: warna, whiteSpace: "nowrap" }}>{nilai}</span>
      </div>
      {children}
    </div>
  );
}

function Butir({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "3px 0 0 34px" }}>
      <span>• {label}</span>
      <span style={{ whiteSpace: "nowrap" }}>{nilai}</span>
    </div>
  );
}

function Baris({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
      <span style={{ color: NAVY }}>{label}</span>
      <b>{nilai}</b>
    </div>
  );
}

function Bar({ persen, warna }: { persen: number; warna: string }) {
  const lebar = Math.max(0, Math.min(100, persen));
  return (
    <div style={{ height: 6, borderRadius: 999, background: "#e5e7eb", marginTop: 5, overflow: "hidden" }}>
      <div style={{ width: `${lebar}%`, height: "100%", background: warna, borderRadius: 999 }} />
    </div>
  );
}
