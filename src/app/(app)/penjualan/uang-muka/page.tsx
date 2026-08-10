import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { batalkanUangMukaJual, terimaUangMukaJual } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type UM = {
  id: string; no_um: string; tanggal: string; jumlah: number; terpakai: number;
  catatan: string | null; status: string;
  customers: Rel<{ name: string }>;
  sales_orders: Rel<{ no_pesanan: string }>;
};

export default async function UangMukaJualPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: umData }, { data: custData }, { data: soData }, rekening] = await Promise.all([
    supabase.from("sales_advances")
      .select("id, no_um, tanggal, jumlah, terpakai, catatan, status, customers(name), sales_orders(no_pesanan)")
      .order("tanggal", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("customers").select("id, name, phone").order("name").limit(500),
    supabase.from("sales_orders").select("id, no_pesanan, customer_id").in("status", ["draft", "diproses"]).order("tanggal", { ascending: false }),
    loadRekeningAktif(supabase),
  ]);

  const daftar = (umData ?? []) as unknown as UM[];
  const pelanggan = (custData ?? []) as { id: string; name: string; phone: string }[];
  const pesanan = (soData ?? []) as { id: string; no_pesanan: string }[];

  const aktif = daftar.filter((u) => u.status === "aktif");
  const totalSisa = aktif.reduce((a, u) => a + (Number(u.jumlah) - Number(u.terpakai)), 0);

  return (
    <MasterPage
      back="/penjualan" icon="ti-coin" title="UANG MUKA PENJUALAN"
      desc="DP dari pelanggan — tercatat sebagai kewajiban, bukan pendapatan"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mencatat uang muka."
    >
      <div className="crm-sec">
        <SecHeader
          num="01" title="TERIMA UANG MUKA"
          desc="Uang masuk sekarang, dipotongkan otomatis saat faktur pelanggan itu dilunasi."
        />

        {boleh && (
          <form action={terimaUangMukaJual}>
            <div className="frow">
              <div>
                <label className="flab">Pelanggan *</label>
                <select className="fi" name="customer_id" defaultValue="" required>
                  <option value="">— pilih pelanggan —</option>
                  {pelanggan.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Untuk pesanan (opsional)</label>
                <select className="fi" name="order_id" defaultValue="">
                  <option value="">— belum terkait pesanan —</option>
                  {pesanan.map((s) => <option key={s.id} value={s.id}>{s.no_pesanan}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} />
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Nominal (Rp) *</label>
                <input className="fi" name="jumlah" type="number" min={1} step="any" required />
              </div>
              <div>
                <label className="flab">Metode</label>
                <select className="fi" name="metode" defaultValue="Transfer">
                  {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <PilihRekening rekening={rekening} label="Masuk ke" width={170} />
              <div>
                <label className="flab">Catatan</label>
                <input className="fi" name="catatan" placeholder="opsional" />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <SubmitButton className="btn-acc" icon="ti-cash" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                  Terima uang muka
                </SubmitButton>
              </div>
            </div>
          </form>
        )}
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="02" title="DAFTAR UANG MUKA" desc={`Sisa yang belum terpakai: ${rp(totalSisa)}.`} />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. dokumen</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Pelanggan</th>
                <th style={{ width: 130 }}>Pesanan</th>
                <th style={{ width: 130, textAlign: "right" }}>Nominal</th>
                <th style={{ width: 130, textAlign: "right" }}>Sisa</th>
                <th style={{ width: 90 }}>Status</th>
                {boleh && <th style={{ width: 90 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {daftar.map((u) => {
                const sisa = Number(u.jumlah) - Number(u.terpakai);
                return (
                  <tr key={u.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {u.no_um}
                      {u.catatan && <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>{u.catatan}</div>}
                    </td>
                    <td style={{ fontSize: 11 }}>{tgl(u.tanggal)}</td>
                    <td style={{ fontSize: 11.5 }}>{one(u.customers)?.name ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{one(u.sales_orders)?.no_pesanan ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(u.jumlah))}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: sisa > 0 ? "#15803d" : "var(--td)" }}>
                      {u.status === "batal" ? "—" : rp(sisa)}
                    </td>
                    <td>
                      <span className={`bge ${u.status === "batal" ? "x" : sisa > 0 ? "g" : "b"}`}>
                        {u.status === "batal" ? "Batal" : sisa > 0 ? "Aktif" : "Terpakai"}
                      </span>
                    </td>
                    {boleh && (
                      <td>
                        {u.status === "aktif" && Number(u.terpakai) === 0 && (
                          <form action={batalkanUangMukaJual}>
                            <input type="hidden" name="id" value={u.id} />
                            <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                              Kembalikan
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {daftar.length === 0 && (
                <tr><td colSpan={boleh ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada uang muka dari pelanggan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
