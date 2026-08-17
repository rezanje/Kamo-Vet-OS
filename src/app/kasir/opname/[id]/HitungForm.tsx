"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SecHeader } from "@/components/SecHeader";
import { bukaKunci, kunciBaris, muatUlangStok, simpanHasil } from "@/app/(app)/pos/opname/actions";
import { hariIniWIB } from "@/lib/tanggal";

// Layar hitung untuk petugas toko.
//
// Yang SENGAJA tidak ada di sini: angka stok sistem dan selisih. Petugas cuma
// mengisi hitungan fisik; selisihnya baru muncul di laporan setelah disimpan.
// Datanya pun tidak dikirim ke layar ini, jadi tidak bisa diintip dari peramban.

export type BarisHitung = {
  item_id: string;
  code: string;
  name: string;
  unit: string;
  kategori: string;
  sell_price: number;
};

type Urut = "nama" | "kategori" | "harga";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function HitungForm({
  orderId,
  rows,
  terkunci,
}: {
  orderId: string;
  rows: BarisHitung[];
  terkunci: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kunci, setKunci] = useState<Record<string, number>>(terkunci);
  const [isian, setIsian] = useState<Record<string, string>>({});
  const [pesan, setPesan] = useState<string | null>(null);
  const [cari, setCari] = useState("");
  const [kategori, setKategori] = useState("");
  const [urut, setUrut] = useState<Urut>("nama");
  const [sisaSaja, setSisaSaja] = useState(false);

  const daftarKategori = useMemo(
    () => [...new Set(rows.map((r) => r.kategori).filter(Boolean))].sort(),
    [rows],
  );

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const hasil = rows.filter((r) =>
      (!kategori || r.kategori === kategori) &&
      (!sisaSaja || kunci[r.item_id] === undefined) &&
      (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)));
    const urutkan: Record<Urut, (a: BarisHitung, b: BarisHitung) => number> = {
      nama: (a, b) => a.name.localeCompare(b.name),
      kategori: (a, b) => a.kategori.localeCompare(b.kategori) || a.name.localeCompare(b.name),
      harga: (a, b) => b.sell_price - a.sell_price,
    };
    return [...hasil].sort(urutkan[urut]);
  }, [rows, cari, kategori, urut, sisaSaja, kunci]);

  const jumlahKunci = Object.keys(kunci).length;
  const jumlahIsi = rows.filter((r) => kunci[r.item_id] === undefined && isian[r.item_id]?.trim()).length;
  const belum = rows.length - jumlahKunci - jumlahIsi;

  const kunciSatu = (r: BarisHitung) => {
    const nilai = isian[r.item_id];
    if (nilai === undefined || nilai.trim() === "") {
      setPesan(`Isi dulu hitungan ${r.name}.`);
      return;
    }
    const qty = Math.max(0, Number(nilai) || 0);
    start(async () => {
      const res = await kunciBaris(orderId, r.item_id, qty);
      if (!res.ok) { setPesan(res.pesan ?? "Gagal menyimpan."); return; }
      setKunci((m) => ({ ...m, [r.item_id]: qty }));
      setIsian((m) => { const next = { ...m }; delete next[r.item_id]; return next; });
      setPesan(null);
    });
  };

  const bukaSatu = (r: BarisHitung) => {
    start(async () => {
      const res = await bukaKunci(orderId, r.item_id);
      if (!res.ok) { setPesan(res.pesan ?? "Gagal membuka kunci."); return; }
      setKunci((m) => { const next = { ...m }; delete next[r.item_id]; return next; });
      setIsian((m) => ({ ...m, [r.item_id]: String(kunci[r.item_id] ?? "") }));
      setPesan(null);
    });
  };

  const muatUlang = () => start(async () => {
    await muatUlangStok(orderId);
    router.refresh();
    setPesan("Daftar & stok sistem dimuat ulang. Hitungan yang sudah dikunci tidak berubah.");
  });

  // Yang dikirim ke server: hitungan terkunci + yang masih diketik tapi belum dikunci.
  // Barang yang tidak dihitung sama sekali tidak ikut — stoknya tidak boleh dinolkan.
  const dikirim: Record<string, number> = { ...kunci };
  for (const r of rows) {
    if (kunci[r.item_id] !== undefined) continue;
    const v = isian[r.item_id];
    if (v !== undefined && v.trim() !== "") dikirim[r.item_id] = Math.max(0, Number(v) || 0);
  }

  return (
    <form action={simpanHasil}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="kembali" value="kasir" />
      <input type="hidden" name="fisik" value={JSON.stringify(dikirim)} />

      <div className="crm-sec">
        <SecHeader
          num="02"
          title="HITUNG FISIK"
          desc={`${rows.length} barang dalam daftar hitung. Isi jumlah fisiknya lalu tekan Kunci — angka yang dikunci langsung tersimpan.`}
        />

        {pesan && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#b45309" }}>
            <i className="ti ti-info-circle" /> {pesan}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <input className="fi" placeholder="Cari kode / nama barang..." value={cari}
            onChange={(e) => setCari(e.target.value)} style={{ flex: 1, minWidth: 170 }} />
          <select className="fi" value={kategori} onChange={(e) => setKategori(e.target.value)} style={{ width: 145 }}>
            <option value="">Semua kategori</option>
            {daftarKategori.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select className="fi" value={urut} onChange={(e) => setUrut(e.target.value as Urut)} style={{ width: 135 }}>
            <option value="nama">Urut nama</option>
            <option value="kategori">Urut kategori</option>
            <option value="harga">Harga jual tertinggi</option>
          </select>
          <button type="button" className="btn-def" onClick={() => setSisaSaja((v) => !v)}
            style={{ padding: "5px 10px", fontSize: 10.5, borderColor: sisaSaja ? "var(--posb)" : undefined }}>
            <i className="ti ti-filter" /> {sisaSaja ? "Tampilkan semua" : "Sisa yang belum"}
          </button>
          <button type="button" className="btn-def" onClick={muatUlang} disabled={pending}
            style={{ padding: "5px 10px", fontSize: 10.5 }}>
            <i className="ti ti-refresh" /> Muat ulang stok sistem
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 10.5, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "#15803d" }}>{jumlahKunci} terkunci</span>
          <span style={{ color: "#b45309" }}>{jumlahIsi} terisi belum dikunci</span>
          <span style={{ color: belum ? "#b91c1c" : "var(--tm)" }}>{belum} belum dihitung</span>
        </div>

        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Kode #</th>
                <th>Nama Barang</th>
                <th>Kategori</th>
                <th style={{ textAlign: "right" }}>Harga jual</th>
                <th style={{ textAlign: "right" }}>Jumlah fisik</th>
                <th style={{ width: 108 }}>Kunci</th>
              </tr>
            </thead>
            <tbody>
              {tampil.map((r) => {
                const locked = kunci[r.item_id] !== undefined;
                return (
                  <tr key={r.item_id} style={locked ? { background: "#f0fdf4" } : undefined}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.code}</td>
                    <td style={{ fontSize: 11.5 }}>{r.name}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.kategori}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.sell_price)}</td>
                    <td style={{ textAlign: "right" }}>
                      {locked ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>
                          {kunci[r.item_id]} {r.unit}
                        </span>
                      ) : (
                        <input className="fi" type="number" min={0} step="any" inputMode="decimal"
                          placeholder="—"
                          value={isian[r.item_id] ?? ""}
                          onChange={(e) => setIsian((m) => ({ ...m, [r.item_id]: e.target.value }))}
                          style={{ width: 92, textAlign: "right" }} />
                      )}
                    </td>
                    <td>
                      {locked ? (
                        // Warna sengaja beda jauh dari tombol Kunci — buka kunci itu
                        // tindakan mundur, tidak boleh kepencet karena refleks.
                        <button type="button" onClick={() => bukaSatu(r)} disabled={pending}
                          style={{
                            fontSize: 10, padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                            border: "1.5px solid #f59e0b", background: "#fff", color: "#b45309", fontWeight: 600,
                          }}>
                          <i className="ti ti-lock-open" /> Buka
                        </button>
                      ) : (
                        <button type="button" onClick={() => kunciSatu(r)} disabled={pending}
                          style={{
                            fontSize: 10, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                            border: "1.5px solid #15803d", background: "#15803d", color: "#fff", fontWeight: 600,
                          }}>
                          <i className="ti ti-lock" /> Kunci
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {tampil.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    {rows.length === 0 ? "Tidak ada barang dalam daftar hitung ini." : "Tidak ada barang cocok saringan."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <div className="fg" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
            <label className="flab" style={{ margin: 0 }}>Tanggal hasil</label>
            <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} style={{ width: 150 }} />
          </div>
          <button type="submit" className="btn-acc" disabled={pending || Object.keys(dikirim).length === 0}>
            <i className="ti ti-clipboard-check" /> Simpan semua & sesuaikan stok
          </button>
        </div>
        <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 6 }}>
          Barang yang tidak dihitung dilewat — stoknya tidak diubah. Laporan selisih keluar setelah disimpan.
        </div>
      </div>
    </form>
  );
}
