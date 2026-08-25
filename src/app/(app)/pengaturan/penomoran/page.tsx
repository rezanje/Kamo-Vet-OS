import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FORMAT_BAWAAN, bangunPrefix, contohNomor, formatNomor } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { kembalikanBawaan, simpanFormatNomor } from "./actions";

// Penomoran Dokumen (S5) — awalan, jumlah digit, dan kapan nomor mengulang dari 1
// diatur di sini, bukan lewat developer.
//
// Kapan nomor mengulang ditentukan oleh token tanggal di awalannya: awalan yang
// mengandung {MM} otomatis mengulang tiap bulan, {DD} tiap hari, hanya {YYYY} tiap
// tahun, dan tanpa token sama sekali berarti berlanjut terus.

const KELOMPOK = ["Pembelian", "Penjualan", "Kasir & Klinik", "Persediaan", "Kas & Bank"] as const;

function siklus(pola: string): string {
  if (pola.includes("{DD}")) return "mengulang tiap hari";
  if (pola.includes("{MM}")) return "mengulang tiap bulan";
  if (pola.includes("{YYYY}") || pola.includes("{YY}")) return "mengulang tiap tahun";
  return "berlanjut terus";
}

export default async function PenomoranPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) redirect("/pengaturan");

  const hariIni = hariIniWIB();
  // Nomor terakhir yang benar-benar terpakai per seri sengaja tidak ditampilkan:
  // datanya tersebar di 20-an tabel dan layar pengaturan tidak perlu menariknya semua.
  const { data: simpanan } = await supabase
    .from("document_numbering").select("jenis, pola, digit, updated_at");

  type Simpanan = { jenis: string; pola: string; digit: number; updated_at: string };
  const diubah = new Map(((simpanan ?? []) as Simpanan[]).map((r) => [r.jenis, r]));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penomoran Dokumen</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534", marginBottom: 12 }}>
          <i className="ti ti-check" /> {success}
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Cara mengisinya</div>
        <div style={{ fontSize: 11, color: "var(--tm)", lineHeight: 1.7 }}>
          Isi <b>awalan</b> dengan teks bebas ditambah token tanggal:{" "}
          <code>{"{YYYY}"}</code> tahun 4 digit · <code>{"{YY}"}</code> tahun 2 digit ·{" "}
          <code>{"{MM}"}</code> bulan · <code>{"{DD}"}</code> tanggal.<br />
          Kapan nomor mengulang dari 1 mengikuti token yang dipakai — pakai {"{MM}"} kalau mau
          mengulang tiap bulan, {"{DD}"} kalau tiap hari, dan hilangkan semua token kalau
          nomornya mau berlanjut terus.<br />
          <b style={{ color: "#b45309" }}>Ubahlah di awal periode.</b> Mengganti awalan atau jumlah
          digit di tengah bulan membuat satu seri punya dua bentuk nomor — dokumennya tetap aman
          dan tidak ada yang tertimpa, tapi daftarnya jadi tidak enak dibaca.
        </div>
      </div>

      {KELOMPOK.map((k) => (
        <div className="crm-sec" key={k} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 10 }}>{k.toUpperCase()}</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Dokumen</th>
                  <th style={{ width: 210 }}>Awalan</th>
                  <th style={{ width: 90 }}>Digit</th>
                  <th style={{ width: 190 }}>Contoh nomor hari ini</th>
                  <th style={{ width: 140 }}>Siklus</th>
                  <th style={{ width: 150 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {FORMAT_BAWAAN.filter((f) => f.kelompok === k).map((f) => {
                  const ubah = diubah.get(f.jenis);
                  const pola = ubah?.pola ?? f.pola;
                  const digit = ubah?.digit ?? f.digit;
                  return (
                    <tr key={f.jenis}>
                      <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                        {f.label}
                        {ubah && <span style={{ fontSize: 9, color: "#b45309", marginLeft: 6 }}>diubah</span>}
                        <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                          bawaan: {contohNomor(f.pola, f.digit, hariIni)}
                        </div>
                      </td>
                      <td>
                        <form action={simpanFormatNomor} id={`f-${f.jenis}`}>
                          <input type="hidden" name="jenis" value={f.jenis} />
                          <input className="fi" name="pola" defaultValue={pola} style={{ fontSize: 11 }} />
                        </form>
                      </td>
                      <td>
                        <input className="fi" form={`f-${f.jenis}`} name="digit" type="number"
                          min={1} max={8} defaultValue={digit} style={{ fontSize: 11 }} />
                      </td>
                      <td style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                        {formatNomor(bangunPrefix(pola, hariIni), 1, digit)}
                      </td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{siklus(pola)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="submit" form={`f-${f.jenis}`} className="btn-acc" style={{ fontSize: 10.5, padding: "5px 10px" }}>
                            Simpan
                          </button>
                          {ubah && (
                            <form action={kembalikanBawaan}>
                              <input type="hidden" name="jenis" value={f.jenis} />
                              <button type="submit" className="btn-def" style={{ fontSize: 10.5, padding: "5px 10px" }}>
                                Bawaan
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 4, lineHeight: 1.7 }}>
        Nomor jurnal akuntansi (JRN) sengaja tidak bisa diubah dari sini. Itu nomor internal
        pembukuan yang dipakai menelusuri tiap transaksi ke jurnalnya; mengubah bentuknya
        tidak menambah manfaat dan berisiko memutus penelusuran dokumen lama.
      </div>
    </>
  );
}
