import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { hariIniWIB } from "@/lib/tanggal";
import { simpanPenyesuaian } from "../actions";
import { BarisForm, type BarangStok } from "./BarisForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const ALASAN_LABEL: { v: string; label: string }[] = [
  { v: "rusak", label: "Rusak" },
  { v: "hilang", label: "Hilang" },
  { v: "kadaluarsa", label: "Kadaluarsa" },
  { v: "temuan", label: "Temuan (barang lebih)" },
  { v: "lainnya", label: "Lainnya" },
];

export default async function PenyesuaianBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string; error?: string }>;
}) {
  const { wh, error } = await searchParams;
  const supabase = await createClient();

  const { data: whRaw } = await supabase
    .from("warehouses").select("id, code, name").eq("is_active", true).order("name");
  const gudang = (whRaw ?? []) as { id: string; code: string; name: string }[];
  const dipilih = gudang.find((g) => g.id === wh) ?? gudang[0] ?? null;

  let barang: BarangStok[] = [];
  if (dipilih) {
    const { data: stokRaw } = await supabase
      .from("stock").select("item_id, qty, items(code, name, unit)")
      .eq("warehouse_id", dipilih.id);
    type StokRow = { item_id: string; qty: number; items: Rel<{ code: string; name: string; unit: string | null }> };
    barang = ((stokRaw ?? []) as unknown as StokRow[])
      .map((s) => {
        const it = one(s.items);
        return {
          item_id: s.item_id,
          code: it?.code ?? "—",
          nama: it?.name ?? "—",
          unit: it?.unit ?? "",
          qty: Number(s.qty),
        };
      })
      .sort((a, b) => a.nama.localeCompare(b.nama));
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Link href="/pos/penyesuaian" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penyesuaian Baru</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec" style={{ paddingBottom: 12 }}>
        <div style={{ fontSize: 10, color: "var(--tm)", marginBottom: 8 }}>Pilih gudang</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {gudang.length === 0 && <span style={{ fontSize: 11, color: "var(--td)" }}>Belum ada gudang aktif.</span>}
          {gudang.map((g) => (
            <Link key={g.id} href={`/pos/penyesuaian/baru?wh=${g.id}`}
              className={dipilih?.id === g.id ? "btn-acc" : "btn-def"} style={{ fontSize: 11 }}>
              <i className="ti ti-building-warehouse" /> {g.name}
            </Link>
          ))}
        </div>
      </div>

      {dipilih && (
        <form action={simpanPenyesuaian}>
          <input type="hidden" name="warehouse_id" value={dipilih.id} />

          <div className="crm-sec">
            <SecHeader
              num="01"
              title="PENYESUAIAN PERSEDIAAN"
              desc={`${dipilih.name} · isi jumlah baru hanya untuk barang yang berubah. Barang lain tidak tersentuh.`}
            />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ width: 170 }}>
                <label className="flab">Tanggal *</label>
                <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required />
              </div>
              <div style={{ width: 210 }}>
                <label className="flab">Alasan *</label>
                <select className="fi" name="alasan" required defaultValue="">
                  <option value="" disabled>Pilih alasan</option>
                  {ALASAN_LABEL.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <label className="flab">Keterangan</label>
                <input className="fi" name="keterangan" maxLength={200}
                  placeholder='mis. "kemasan sobek kena air, dibuang"' />
              </div>
            </div>

            <BarisForm barang={barang} />
          </div>
        </form>
      )}
    </>
  );
}
