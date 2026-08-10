import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { BarisJualForm, type ItemJual } from "../BarisJualForm";
import { buatPesanan } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const BADGE: Record<string, string> = { draft: "", diproses: "o", selesai: "g", batal: "x" };
const LABEL: Record<string, string> = { draft: "Draft", diproses: "Diproses", selesai: "Selesai", batal: "Batal" };

type Pesanan = {
  id: string; no_pesanan: string; tanggal: string; rencana_kirim: string | null;
  total: number; status: string;
  customers: Rel<{ name: string }>;
  sales_order_items: { qty: number; qty_kirim: number; qty_faktur: number }[] | null;
};

export default async function PesananPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const boleh = await bolehTransaksiKas();

  const [{ data: docData }, { data: custData }, { data: cabData }, { data: gudangData }, { data: itemData }] =
    await Promise.all([
      supabase.from("sales_orders")
        .select("id, no_pesanan, tanggal, rencana_kirim, total, status, customers(name), sales_order_items(qty, qty_kirim, qty_faktur)")
        .order("tanggal", { ascending: false }).order("created_at", { ascending: false }).limit(200),
      supabase.from("customers").select("id, name, phone").order("name").limit(500),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
      supabase.from("items").select("id, code, name, unit, sell_price").eq("is_active", true).order("name"),
    ]);

  const dok = (docData ?? []) as unknown as Pesanan[];
  const pelanggan = (custData ?? []) as { id: string; name: string; phone: string }[];
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  const gudang = (gudangData ?? []) as { id: string; name: string }[];
  const items = (itemData ?? []) as ItemJual[];

  const progres = (p: Pesanan) => {
    const b = p.sales_order_items ?? [];
    const qty = b.reduce((a, x) => a + Number(x.qty), 0);
    const kirim = b.reduce((a, x) => a + Number(x.qty_kirim), 0);
    const faktur = b.reduce((a, x) => a + Number(x.qty_faktur), 0);
    return { qty, kirim, faktur };
  };

  return (
    <MasterPage
      back="/penjualan" icon="ti-shopping-bag" title="PESANAN PENJUALAN"
      desc="Pesanan pelanggan — sumber pengiriman & faktur"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Kamu belum punya hak membuat pesanan."
    >
      {boleh && (
        <div className="crm-sec">
          <SecHeader num="01" title="BUAT PESANAN" desc="Gudang menentukan stok mana yang dipotong saat barang dikirim." />
          <form action={buatPesanan}>
            <div className="frow">
              <div>
                <label className="flab">Pelanggan *</label>
                <select className="fi" name="customer_id" defaultValue="" required>
                  <option value="">— pilih pelanggan —</option>
                  {pelanggan.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Cabang</label>
                <select className="fi" name="branch_id" defaultValue="">
                  <option value="">— tanpa cabang —</option>
                  {cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Gudang pengirim</label>
                <select className="fi" name="warehouse_id" defaultValue="">
                  <option value="">— tanpa potong stok —</option>
                  {gudang.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Tanggal</label>
                <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} />
              </div>
              <div>
                <label className="flab">Rencana kirim</label>
                <input className="fi" type="date" name="rencana_kirim" />
              </div>
              <div>
                <label className="flab">Catatan</label>
                <input className="fi" name="catatan" placeholder="opsional" />
              </div>
            </div>

            <BarisJualForm items={items} listId="so-items" />

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                Simpan pesanan
              </SubmitButton>
            </div>
          </form>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num={boleh ? "02" : "01"} title="DAFTAR PESANAN" desc="Klik nomornya untuk mengirim barang atau menerbitkan faktur." />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. pesanan</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Pelanggan</th>
                <th style={{ width: 110 }}>Rencana kirim</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai</th>
                <th style={{ width: 160 }}>Kirim / tagih</th>
                <th style={{ width: 100 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {dok.map((d) => {
                const p = progres(d);
                return (
                  <tr key={d.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      <Link href={`/penjualan/pesanan/${d.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                        {d.no_pesanan}
                      </Link>
                    </td>
                    <td style={{ fontSize: 11 }}>{tgl(d.tanggal)}</td>
                    <td style={{ fontSize: 11.5 }}>{one(d.customers)?.name ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{tgl(d.rencana_kirim)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(d.total))}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {p.kirim}/{p.qty} dikirim · {p.faktur}/{p.qty} ditagih
                    </td>
                    <td><span className={`bge ${BADGE[d.status] ?? ""}`}>{LABEL[d.status] ?? d.status}</span></td>
                  </tr>
                );
              })}
              {dok.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada pesanan penjualan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
