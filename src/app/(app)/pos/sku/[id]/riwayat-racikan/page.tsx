import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import {
  readRiwayatIndukRacikan, ringkasRiwayat, tautanBaris, type RiwayatRacikanBaris,
} from "@/lib/riwayat-induk-racikan";

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const statusLabel: Record<string, string> = {
  pending: "Menunggu diracik", ready: "Siap diserahkan", handed_over: "Sudah diserahkan", void: "Void",
};

// I09: riwayat SKU induk racikan nonstok — seperti kartu stok, tetapi virtual.
// Masuk = racikan dibuat, Keluar = racikan ditagih. Tidak ada stok fisik dan tidak ada harga.
export default async function RiwayatIndukRacikanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const hariIni = hariIniWIB();
  const dari = sp.dari && TANGGAL.test(sp.dari) ? sp.dari : `${hariIni.slice(0, 8)}01`;
  const sampai = sp.sampai && TANGGAL.test(sp.sampai) ? sp.sampai : hariIni;
  const supabase = await createClient();

  const { data: item, error: itemError } = await supabase
    .from("items").select("id, code, name, unit").eq("id", id).maybeSingle();
  // A failed read is not evidence that the SKU is missing.
  if (itemError) throw new Error("Barang belum dapat dimuat. Coba muat ulang.");
  if (!item) notFound();

  let rows: RiwayatRacikanBaris[] = [];
  let loadError = "";
  if (dari > sampai) loadError = "Tanggal \"Dari\" tidak boleh setelah tanggal \"Sampai\".";
  else {
    try {
      rows = await readRiwayatIndukRacikan(supabase, id, dari, sampai);
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Riwayat racikan belum dapat dimuat lengkap. Coba muat ulang.";
    }
  }
  const ringkas = ringkasRiwayat(rows);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <Link href={`/pos/sku/${encodeURIComponent(id)}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke barang</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Riwayat Racikan</span>
      </div>

      <form method="get" className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ width: 140 }}>
            <label className="flab" htmlFor="riwayat-dari">Dari</label>
            <input id="riwayat-dari" className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div style={{ width: 140 }}>
            <label className="flab" htmlFor="riwayat-sampai">Sampai</label>
            <input id="riwayat-sampai" className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <SubmitButton className="btn-def" icon="ti-refresh" pendingText="Memuat…">Tampilkan</SubmitButton>
        </div>
      </form>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
          <i className="ti ti-flask" /> {item.name}
          {item.code && <small style={{ display: "block", fontWeight: 400, color: "var(--tm)" }}>Kode: {item.code}</small>}
        </div>
        <p style={{ fontSize: 11, color: "var(--tm)", margin: "0 0 8px" }}>
          Induk racikan adalah identitas penjualan nonstok: tidak punya stok fisik. Masuk = racikan dibuat,
          Keluar = racikan ditagih di invoice klinik. Stok fisik dan mutasinya ada pada bahan racikan.
        </p>
        {!loadError && <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 11 }}>
          <Angka label="Racikan dibuat" nilai={ringkas.dibuat} warna="#15803d" />
          <Angka label="Racikan ditagih" nilai={ringkas.ditagih} warna="#b91c1c" />
          {ringkas.racikanVoid > 0 && <Angka label="Racikan void (tidak dihitung)" nilai={ringkas.racikanVoid} />}
          {ringkas.invoiceBatal > 0 && <Angka label="Invoice dibatalkan (tidak dihitung)" nilai={ringkas.invoiceBatal} />}
        </div>}
      </div>

      {loadError ? (
        <div className="crm-sec" role="alert" style={{ textAlign: "center", color: "#b91c1c", fontSize: 11, padding: "26px 0" }}>
          {loadError}
        </div>
      ) : (
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            <i className="ti ti-list-details" /> Riwayat {dari} s/d {sampai}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ width: 92 }}>Tanggal</th>
                  <th style={{ width: 150 }}>No. Racikan</th>
                  <th>Dokumen sumber</th>
                  <th>Kunjungan / pasien</th>
                  <th style={{ width: 150 }}>Invoice</th>
                  <th style={{ width: 70, textAlign: "right" }}>Masuk</th>
                  <th style={{ width: 70, textAlign: "right" }}>Keluar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <Baris key={row.id} row={row} />)}
                {rows.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                    Tidak ada racikan dibuat atau ditagih di rentang tanggal ini.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Baris dari cabang yang tidak bisa Anda buka tetap dihitung; nomornya ditampilkan tanpa tautan dan tanpa nama pasien.
            Jumlah dalam satuan racikan.
          </div>
        </div>
      )}
    </>
  );
}

function Baris({ row }: { row: RiwayatRacikanBaris }) {
  const link = tautanBaris(row);
  const tidakDihitung = row.arah === "masuk" ? row.statusRacikan === "void" : row.invoiceBatal;
  const qty = row.qty.toLocaleString("id-ID", { maximumFractionDigits: 4 });
  return (
    <tr style={tidakDihitung ? { color: "var(--td)" } : undefined}>
      <td style={{ fontSize: 10.5 }}>{row.tanggal}</td>
      <td style={{ fontSize: 10.5, fontFamily: "var(--mono, monospace)" }}>
        {link.racikan ? <Link href={link.racikan}>{row.nomorRacikan}</Link> : row.nomorRacikan}
        {row.namaRacikan && <div style={{ fontFamily: "inherit", color: "var(--tm)" }}>{row.namaRacikan}</div>}
      </td>
      <td style={{ fontSize: 11 }}>
        {row.arah === "masuk" ? <>Racikan dibuat · {row.sumber}</> : <>Racikan ditagih</>}
        {row.arah === "masuk" && <span className={`bge ${row.statusRacikan === "void" ? "r" : "b"}`} style={{ marginLeft: 6 }}>
          {statusLabel[row.statusRacikan] ?? row.statusRacikan}
        </span>}
      </td>
      <td style={{ fontSize: 11 }}>
        {link.kunjungan ? <Link href={link.kunjungan}>{[row.pasien, row.pelanggan].filter(Boolean).join(" · ") || "Buka kunjungan"}</Link>
          : <span style={{ color: "var(--tm)" }}>{row.bisaDibuka ? "—" : "Cabang lain"}</span>}
        {row.cabang && <div style={{ fontSize: 10, color: "var(--tm)" }}>{row.cabang}</div>}
      </td>
      <td style={{ fontSize: 10.5, fontFamily: "var(--mono, monospace)" }}>
        {row.arah === "keluar" ? <>
          {link.invoice ? <Link href={link.invoice}>{row.nomorInvoice ?? "Buka invoice"}</Link> : (row.nomorInvoice ?? "Invoice tanpa nomor")}
          {row.invoiceBatal && <span className="bge r" style={{ marginLeft: 6 }}>Dibatalkan</span>}
        </> : "·"}
      </td>
      <td style={{ textAlign: "right", fontSize: 11, color: row.arah === "masuk" && !tidakDihitung ? "#15803d" : "var(--td)" }}>
        {row.arah === "masuk" ? qty : "·"}
      </td>
      <td style={{ textAlign: "right", fontSize: 11, color: row.arah === "keluar" && !tidakDihitung ? "#b91c1c" : "var(--td)" }}>
        {row.arah === "keluar" ? qty : "·"}
      </td>
    </tr>
  );
}

function Angka({ label, nilai, warna }: { label: string; nilai: number; warna?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: warna }}>{nilai.toLocaleString("id-ID")}</div>
    </div>
  );
}
