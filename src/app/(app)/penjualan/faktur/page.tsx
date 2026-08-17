import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { agingBucket, agingDays, AGING_LABEL } from "@/lib/aging";
import { sisaTagihan } from "@/lib/penjualan-dokumen";
import { terimaPembayaranJual } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Faktur = {
  id: string; no_faktur: string; tanggal: string; jatuh_tempo: string;
  dpp: number; ppn: number; total: number; status: string; customer_id: string | null;
  kategori: string | null;
  catatan: string | null;
  customers: Rel<{ name: string }>;
  sales_orders: Rel<{ no_pesanan: string }>;
  sales_receipts: { jumlah: number }[] | null;
};

export default async function FakturJualPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();
  const today = hariIniWIB();

  const [{ data: invData }, { data: umData }, rekening] = await Promise.all([
    supabase.from("sales_invoices")
      .select("id, no_faktur, tanggal, jatuh_tempo, dpp, ppn, total, status, customer_id, kategori, catatan, customers(name), sales_orders(no_pesanan), sales_receipts(jumlah)")
      .order("jatuh_tempo"),
    supabase.from("sales_advances").select("id, no_um, customer_id, jumlah, terpakai").eq("status", "aktif"),
    loadRekeningAktif(supabase),
  ]);

  const faktur = (invData ?? []) as unknown as Faktur[];

  // Uang muka aktif per pelanggan, supaya DP yang sudah masuk tidak terlupa saat menagih.
  const umPerPelanggan = new Map<string, { id: string; no_um: string; sisa: number }[]>();
  for (const u of (umData ?? []) as { id: string; no_um: string; customer_id: string | null; jumlah: number; terpakai: number }[]) {
    const sisa = Number(u.jumlah) - Number(u.terpakai);
    if (!u.customer_id || sisa <= 0) continue;
    const arr = umPerPelanggan.get(u.customer_id) ?? [];
    arr.push({ id: u.id, no_um: u.no_um, sisa });
    umPerPelanggan.set(u.customer_id, arr);
  }

  const rows = faktur.map((f) => {
    const sisa = sisaTagihan(Number(f.total), (f.sales_receipts ?? []) as { jumlah: number }[]);
    return { f, sisa, hari: agingDays(f.jatuh_tempo, today), bucket: agingBucket(f.jatuh_tempo, today) };
  });
  const berjalan = rows.filter((r) => r.sisa > 0 && r.f.status !== "batal");
  const totalPiutang = berjalan.reduce((a, r) => a + r.sisa, 0);

  return (
    <MasterPage
      back="/penjualan" icon="ti-receipt-2" title="FAKTUR & PENERIMAAN PENJUALAN"
      desc="Tagihan ke pelanggan dan pelunasannya"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mencatat penerimaan."
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="01" title="DAFTAR FAKTUR"
          desc={`Piutang berjalan ${rp(totalPiutang)} dari ${berjalan.length} faktur. Faktur diterbitkan dari halaman pesanan.`}
        />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. faktur</th>
                <th style={{ width: 120 }}>Pesanan</th>
                <th>Pelanggan</th>
                <th style={{ width: 110 }}>Jatuh tempo</th>
                <th style={{ width: 130, textAlign: "right" }}>Total</th>
                <th style={{ width: 130, textAlign: "right" }}>Sisa</th>
                <th style={{ width: 110 }}>Umur</th>
                {boleh && <th style={{ width: 120 }}>Terima</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ f, sisa, bucket }) => {
                const um = umPerPelanggan.get(f.customer_id ?? "") ?? [];
                return (
                  <tr key={f.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {f.no_faktur}
                      {/* Faktur selisih stok lahir otomatis dari hasil opname, bukan dari
                          pesanan pelanggan — dibedakan supaya tidak dibaca sebagai penjualan. */}
                      {f.kategori === "selisih_stok" && (
                        <span className="bge o" style={{ marginLeft: 5 }}>Selisih stok</span>
                      )}
                      {Number(f.ppn) > 0 && (
                        <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>
                          DPP {rp(Number(f.dpp))} + PPN {rp(Number(f.ppn))}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{one(f.sales_orders)?.no_pesanan ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{one(f.customers)?.name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{tgl(f.jatuh_tempo)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(f.total))}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: sisa > 0 ? "#b45309" : "#15803d" }}>
                      {sisa > 0 ? rp(sisa) : "lunas"}
                    </td>
                    <td style={{ fontSize: 10.5 }}>
                      {sisa > 0
                        ? <span className={`bge ${bucket === "current" ? "g" : bucket === "d1_30" ? "o" : "r"}`}>{AGING_LABEL[bucket]}</span>
                        : <span className="bge g">Lunas</span>}
                    </td>
                    {boleh && (
                      <td>
                        {sisa > 0 && f.status !== "batal" && (
                          <details>
                            <summary className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
                              Terima
                            </summary>
                            <form action={terimaPembayaranJual} style={{ display: "flex", gap: 6, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
                              <input type="hidden" name="invoice_id" value={f.id} />
                              <div>
                                <label className="flab">Nominal (maks {rp(sisa)})</label>
                                <input className="fi" type="number" name="jumlah" min={1} max={sisa} step="any" defaultValue={sisa} style={{ width: 140 }} />
                              </div>
                              <div>
                                <label className="flab">Metode</label>
                                <select className="fi" name="metode" defaultValue="Transfer" style={{ width: 110 }}>
                                  {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                              </div>
                              <PilihRekening rekening={rekening} label="Masuk ke" width={150} />
                              {um.length > 0 && (
                                <div>
                                  <label className="flab">Potong uang muka</label>
                                  <select className="fi" name="advance_id" defaultValue="" style={{ width: 190 }}>
                                    <option value="">— tidak pakai —</option>
                                    {um.map((u) => <option key={u.id} value={u.id}>{u.no_um} · sisa {rp(u.sisa)}</option>)}
                                  </select>
                                </div>
                              )}
                              <div>
                                <label className="flab">Tanggal</label>
                                <input className="fi" type="date" name="tanggal" defaultValue={today} style={{ width: 140 }} />
                              </div>
                              <SubmitButton className="btn-acc" icon="ti-cash" pendingText="Menyimpan…" style={{ padding: "7px 12px", fontSize: 11 }}>
                                Simpan
                              </SubmitButton>
                            </form>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={boleh ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada faktur penjualan. Terbitkan dari halaman pesanan setelah barangnya dikirim.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
