import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { hariIniWIB } from "@/lib/followup";
import {
  susunMonitor, ringkasMonitor, LABEL_STATUS, WARNA_STATUS,
  type LapisanStok, type StatusExp,
} from "@/lib/kadaluarsa";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const SARINGAN: Record<string, { label: string; muat: (s: StatusExp) => boolean }> = {
  perhatian: { label: "Perlu tindakan (lewat & ≤ 90 hari)", muat: (s) => s !== "aman" },
  lewat: { label: "Sudah kadaluarsa saja", muat: (s) => s === "lewat" },
  semua: { label: "Semua stok bertanggal", muat: () => true },
};

export default async function MonitorExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ gudang?: string; saring?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const hariIni = hariIniWIB();
  const saring = SARINGAN[sp.saring ?? ""] ? sp.saring! : "perhatian";

  const { data: whData } = await supabase
    .from("warehouses").select("id, name").eq("is_active", true).order("name");
  const gudangList = (whData ?? []) as { id: string; name: string }[];
  const gudang = gudangList.some((w) => w.id === sp.gudang) ? sp.gudang! : "";

  // Hanya lapisan yang masih ada sisanya: yang sudah habis terpakai tidak perlu
  // diawasi lagi, sekalipun tanggalnya sudah lewat.
  let q = supabase
    .from("stock_layers")
    .select("item_id, qty_left, unit_cost, exp_date, warehouse_id, items(name, unit), warehouses(name)")
    .gt("qty_left", 0)
    .not("exp_date", "is", null)
    .order("exp_date");
  if (gudang) q = q.eq("warehouse_id", gudang);
  const { data: layerData } = await q;

  type Row = {
    item_id: string; qty_left: number; unit_cost: number; exp_date: string;
    items: Rel<{ name: string; unit: string }>; warehouses: Rel<{ name: string }>;
  };
  const layers: LapisanStok[] = ((layerData ?? []) as Row[]).map((l) => ({
    itemId: l.item_id,
    namaBarang: one(l.items)?.name ?? "—",
    satuan: one(l.items)?.unit ?? "",
    gudang: one(l.warehouses)?.name ?? "—",
    qty: Number(l.qty_left) || 0,
    expDate: l.exp_date,
    nilai: (Number(l.qty_left) || 0) * (Number(l.unit_cost) || 0),
  }));

  const semua = susunMonitor(layers, hariIni);
  const baris = semua.filter((b) => SARINGAN[saring].muat(b.status));
  const ringkas = ringkasMonitor(semua);

  // Barang yang ditandai punya masa kadaluarsa tapi stoknya masuk tanpa tanggal —
  // ini titik butanya: tidak akan pernah muncul di daftar mana pun.
  const { count: tanpaTanggal } = await supabase
    .from("stock_layers")
    .select("items!inner(track_expiry)", { count: "exact", head: true })
    .gt("qty_left", 0).is("exp_date", null).eq("items.track_expiry", true);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Monitor Expired</span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Kartu label="Sudah kadaluarsa" nilai={`${ringkas.lewat} barang`} sub={rp(ringkas.nilaiLewat)} warna="#b91c1c" bg="#fef2f2" />
        <Kartu label="Kadaluarsa ≤ 30 hari" nilai={`${ringkas.kritis} barang`} sub={rp(ringkas.nilaiKritis)} warna="#c2410c" bg="#fff7ed" />
        <Kartu label="Kadaluarsa ≤ 90 hari" nilai={`${ringkas.waspada} barang`} sub="masih bisa didorong jual" warna="#b45309" bg="#fffbeb" />
        <Kartu label="Nilai terancam hangus" nilai={rp(ringkas.nilaiTerancam)} sub="lewat + ≤ 30 hari" warna="#1e40af" bg="#eff6ff" />
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01" title="STOK MENDEKATI KADALUARSA"
          desc="Dihitung per kiriman, bukan per barang — obat yang sama bisa punya dua tanggal berbeda."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select className="fi" name="gudang" defaultValue={gudang} style={{ fontSize: 11, height: 30, width: 170 }}>
                <option value="">Semua gudang</option>
                {gudangList.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select className="fi" name="saring" defaultValue={saring} style={{ fontSize: 11, height: 30, width: 210 }}>
                {Object.entries(SARINGAN).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Tampilkan</button>
            </form>
          }
        />

        {baris.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)" }}>
            Tidak ada stok yang cocok dengan saringan ini.
            {semua.length === 0 && " Tanggal kadaluarsa diisi saat penerimaan barang, pada barang yang ditandai punya masa simpan."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>Barang</th>
                  <th>Gudang</th>
                  <th style={{ textAlign: "right" }}>Sisa stok</th>
                  <th>Kadaluarsa</th>
                  <th style={{ textAlign: "right" }}>Nilai</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {baris.map((b, i) => {
                  const w = WARNA_STATUS[b.status];
                  return (
                    <tr key={`${b.itemId}-${b.expDate}-${i}`}>
                      <td style={{ fontSize: 11.5, fontWeight: 500 }}>{b.namaBarang}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{b.gudang}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{b.qty} {b.satuan}</td>
                      <td style={{ fontSize: 11 }}>
                        {new Date(`${b.expDate}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                        <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                          {b.sisaHari < 0 ? `lewat ${Math.abs(b.sisaHari)} hari` : `${b.sisaHari} hari lagi`}
                        </div>
                      </td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(b.nilai)}</td>
                      <td>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                          background: w.bg, color: w.fg,
                        }}>{LABEL_STATUS[b.status]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {(tanpaTanggal ?? 0) > 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 10 }}>
            <i className="ti ti-alert-triangle" /> {tanpaTanggal} kiriman barang bermasa-simpan masuk tanpa tanggal kadaluarsa —
            barang itu tidak akan pernah muncul di daftar ini. Isi tanggalnya saat penerimaan barang berikutnya.
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--td)" }}>
          Barang yang sudah lewat tanggal tetap terhitung sebagai stok sampai dikeluarkan lewat{" "}
          <Link href="/pos/opname" style={{ color: "#2563eb" }}>Stok Opname</Link> — daftar ini yang memberi tahu mana yang perlu ditarik.
        </div>
      </div>
    </>
  );
}

function Kartu({ label, nilai, sub, warna, bg }: { label: string; nilai: string; sub: string; warna: string; bg: string }) {
  return (
    <div className="card" style={{ flex: "1 1 190px", background: bg, borderColor: "transparent" }}>
      <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: warna, lineHeight: 1.3 }}>{nilai}</div>
      <div style={{ fontSize: 10, color: "var(--td)" }}>{sub}</div>
    </div>
  );
}
