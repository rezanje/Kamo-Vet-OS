import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { bayarUangMuka, batalkanUangMuka } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type UM = {
  id: string; no_um: string; tanggal: string; jumlah: number; terpakai: number;
  metode: string; catatan: string | null; status: string;
  suppliers: Rel<{ nama: string }>;
  purchase_orders: Rel<{ no_po: string | null }>;
};

export default async function UangMukaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: umData }, { data: supData }, { data: poData }, rekening] = await Promise.all([
    supabase.from("purchase_advances")
      .select("id, no_um, tanggal, jumlah, terpakai, metode, catatan, status, suppliers(nama), purchase_orders(no_po)")
      .order("tanggal", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, nama").order("nama"),
    supabase.from("purchase_orders").select("id, no_po, supplier_id, status").in("status", ["Draft", "Dipesan"]).order("tanggal", { ascending: false }),
    loadRekeningAktif(supabase),
  ]);

  const daftar = (umData ?? []) as unknown as UM[];
  const pemasok = (supData ?? []) as { id: string; nama: string }[];
  const po = (poData ?? []) as { id: string; no_po: string | null; supplier_id: string | null }[];

  const aktif = daftar.filter((u) => u.status === "aktif");
  const totalSisa = aktif.reduce((a, u) => a + (Number(u.jumlah) - Number(u.terpakai)), 0);

  return (
    <MasterPage
      back="/pembelian" icon="ti-cash-banknote" title="UANG MUKA PEMBELIAN"
      desc="DP ke pemasok — tercatat sebagai hak tagih, bukan beban"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa mencatat uang muka."
    >
      <div className="crm-sec">
        <SecHeader
          num="01" title="BAYAR UANG MUKA"
          desc="Uang keluar sekarang, dipotongkan otomatis saat melunasi hutang pemasok itu."
        />

        {boleh && (
          <form action={bayarUangMuka}>
            <div className="frow">
              <div>
                <label className="flab">Pemasok *</label>
                <select className="fi" name="supplier_id" defaultValue="" required>
                  <option value="">— pilih pemasok —</option>
                  {pemasok.map((s) => <option key={s.id} value={s.id}>{s.nama}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Untuk PO (opsional)</label>
                <select className="fi" name="po_id" defaultValue="">
                  <option value="">— belum terkait PO —</option>
                  {po.map((p) => <option key={p.id} value={p.id}>{p.no_po ?? p.id.slice(0, 8)}</option>)}
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
              <PilihRekening rekening={rekening} label="Dibayar dari" width={170} />
              <div>
                <label className="flab">Catatan</label>
                <input className="fi" name="catatan" placeholder="opsional" />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <SubmitButton className="btn-acc" icon="ti-cash" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                  Bayar uang muka
                </SubmitButton>
              </div>
            </div>
          </form>
        )}
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="02" title="DAFTAR UANG MUKA"
          desc={`Sisa yang belum terpakai: ${rp(totalSisa)}.`}
        />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. dokumen</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Pemasok</th>
                <th style={{ width: 120 }}>PO</th>
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
                    <td style={{ fontSize: 11.5 }}>{one(u.suppliers)?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{one(u.purchase_orders)?.no_po ?? "—"}</td>
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
                          <form action={batalkanUangMuka}>
                            <input type="hidden" name="id" value={u.id} />
                            <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                              Batalkan
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
                  Belum ada uang muka ke pemasok.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
