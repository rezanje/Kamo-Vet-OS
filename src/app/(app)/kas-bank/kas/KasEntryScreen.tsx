import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { LampiranPicker } from "@/components/LampiranPicker";
import { getAccountBalances } from "@/lib/ledger";
import { hariIniWIB } from "@/lib/tanggal";
import { akunLawanTerlarang, type JenisKas } from "@/lib/kas-entry";
import { simpanKasEntry, batalkanKasEntry } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Baris = {
  id: string; no_bukti: string; tanggal: string; jumlah: number; lawan_code: string;
  keterangan: string | null; voided_at: string | null;
  rekening: Rel<{ nama: string }>; branches: Rel<{ name: string }>;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) =>
  new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

// Akun lawan yang masuk akal per jenis: kas keluar biasanya beban, kas masuk
// biasanya pendapatan/ekuitas. Tipe lain tetap boleh — cuma diurutkan belakangan.
const URUTAN: Record<JenisKas, string[]> = {
  Keluar: ["BEBAN", "ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN"],
  Masuk: ["PENDAPATAN", "EKUITAS", "LIABILITAS", "ASET", "BEBAN"],
};

export async function KasEntryScreen({
  jenis, searchParams,
}: {
  jenis: JenisKas;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();
  const keluar = jenis === "Keluar";

  const [{ data: rekData }, { data: coaData }, { data: branches }, { data: rows }, saldoAkun] = await Promise.all([
    supabase.from("cash_accounts").select("id, nama, coa_code").eq("is_active", true).order("nama"),
    supabase.from("coa_accounts").select("code, name, type").eq("is_active", true).order("code"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("cash_entries")
      .select("id, no_bukti, tanggal, jumlah, lawan_code, keterangan, voided_at, rekening:account_id(nama), branches(name)")
      .eq("jenis", jenis)
      .order("tanggal", { ascending: false }).order("created_at", { ascending: false }).limit(50),
    getAccountBalances(supabase),
  ]);

  const rekening = (rekData ?? []) as { id: string; nama: string; coa_code: string }[];
  const saldoPerKode = new Map(saldoAkun.map((a) => [a.code, a.saldo]));
  const daftar = (rows ?? []) as unknown as Baris[];

  // Rekening kas/bank dikeluarkan dari pilihan akun lawan — pindah antar rekening
  // punya menunya sendiri (Transfer Bank).
  const terlarang = akunLawanTerlarang(rekening.map((r) => r.coa_code));
  const coa = ((coaData ?? []) as { code: string; name: string; type: string }[])
    .filter((a) => !terlarang.has(a.code))
    .sort((a, b) => {
      const ia = URUTAN[jenis].indexOf(a.type);
      const ib = URUTAN[jenis].indexOf(b.type);
      return ia === ib ? a.code.localeCompare(b.code) : ia - ib;
    });
  const namaAkun = new Map(coa.map((a) => [a.code, a.name]));

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/kas-bank" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11, flexShrink: 0,
          background: keluar ? "#fef2f2" : "#e8f5ee",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <i className={`ti ${keluar ? "ti-cash-off" : "ti-cash-banknote"}`}
            style={{ fontSize: 22, color: keluar ? "#b91c1c" : "#16a34a" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>
            KAS {keluar ? "KELUAR" : "MASUK"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
            {keluar
              ? "Kas kecil (petty cash) & pengeluaran tanpa faktur — galon, parkir, ongkir, dsb"
              : "Uang masuk tanpa faktur — isi ulang kas kecil, setoran modal, pendapatan lain"}
          </div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success === "batal" ? "Transaksi dibatalkan." : "Transaksi tersimpan."}
        </div>
      )}
      <div className="p2ban">
        <i className="ti ti-info-circle" /> Pelunasan hutang pemasok / piutang pelanggan tidak lewat sini —
        pakai menu{" "}
        <Link href="/keuangan/hutang" style={{ color: "#2563eb" }}>Pembayaran Hutang</Link> atau{" "}
        <Link href="/keuangan/piutang" style={{ color: "#2563eb" }}>Penerimaan Piutang</Link> supaya sisa tagihannya ikut berkurang.
      </div>
      {!boleh && <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN/FINANCE yang bisa mencatat kas masuk/keluar.</div>}
      {rekening.length === 0 && (
        <div className="p2ban">
          <i className="ti ti-info-circle" /> Belum ada rekening aktif. Tambah di{" "}
          <Link href="/kas-bank/rekening" style={{ color: "#2563eb" }}>Daftar Rekening</Link>.
        </div>
      )}

      {boleh && rekening.length > 0 && (
        <form action={simpanKasEntry} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="jenis" value={jenis} />
          <div className="frow">
            <div>
              <label className="flab">Tanggal *</label>
              <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required />
            </div>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id" defaultValue="">
                <option value="">— Pusat / tanpa cabang —</option>
                {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">{keluar ? "Dibayar dari rekening *" : "Masuk ke rekening *"}</label>
              <select className="fi" name="account_id" defaultValue="" required>
                <option value="">— pilih —</option>
                {rekening.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nama} — {rp(saldoPerKode.get(r.coa_code) ?? 0)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab">{keluar ? "Untuk akun (beban) *" : "Dari akun *"}</label>
              <select className="fi" name="lawan_code" defaultValue="" required>
                <option value="">— pilih —</option>
                {coa.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">Jumlah *</label>
              <input className="fi" type="number" name="jumlah" min={1} step="any" required />
            </div>
            <div>
              <label className="flab">Keterangan</label>
              <input className="fi" name="keterangan" placeholder={keluar ? "mis. beli galon 2 buah" : "mis. isi ulang kas kecil"} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="flab">Lampiran bukti {keluar ? "*" : "(opsional)"}</label>
            <LampiranPicker folder="pengeluaran" wajib={keluar} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…">
              Simpan kas {keluar ? "keluar" : "masuk"}
            </SubmitButton>
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 140 }}>No.</th>
                <th style={{ width: 100 }}>Tanggal</th>
                <th style={{ width: 150 }}>Rekening</th>
                <th>Akun lawan</th>
                <th style={{ width: 120, textAlign: "right" }}>Jumlah</th>
                <th style={{ width: 120 }}>Cabang</th>
                <th style={{ width: 90 }}>Status</th>
                {boleh && <th style={{ width: 110 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {daftar.map((t) => (
                <tr key={t.id} style={t.voided_at ? { opacity: 0.55 } : undefined}>
                  <td style={{ fontSize: 10.5, fontWeight: 600 }}>{t.no_bukti}</td>
                  <td style={{ fontSize: 10.5 }}>{fmtTgl(t.tanggal)}</td>
                  <td style={{ fontSize: 11 }}>{one(t.rekening)?.nama ?? "—"}</td>
                  <td style={{ fontSize: 11 }}>
                    {t.lawan_code} — {namaAkun.get(t.lawan_code) ?? "—"}
                    {t.keterangan && <div style={{ fontSize: 9.5, color: "var(--td)" }}>{t.keterangan}</div>}
                  </td>
                  <td style={{ fontSize: 11, textAlign: "right", fontWeight: 600 }}>{rp(Number(t.jumlah))}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{one(t.branches)?.name ?? "Pusat"}</td>
                  <td>
                    <span className={`bge ${t.voided_at ? "x" : "g"}`}>{t.voided_at ? "Dibatalkan" : "Aktif"}</span>
                  </td>
                  {boleh && (
                    <td>
                      {!t.voided_at && (
                        <form action={batalkanKasEntry}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="jenis" value={jenis} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                            Batalkan
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr><td colSpan={boleh ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada kas {keluar ? "keluar" : "masuk"}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 10 }}>
        Transaksi tidak bisa dihapus — dibatalkan dengan jurnal balik bertanggal sama, supaya laporan
        bulan mana pun tidak ikut bergeser.
      </div>
    </>
  );
}
