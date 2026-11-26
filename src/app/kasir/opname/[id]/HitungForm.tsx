"use client";

import { NumberInput } from "@/components/NumberInput";
import { draftRecord, draftString } from "@/components/TransactionDraft";
import { PreservedForm, LocalTransactionDraft } from "@/components/LocalTransactionDraft";

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SecHeader } from "@/components/SecHeader";
import { bukaKunci, kunciBaris, muatUlangStok, periksaJumlahTakWajar, simpanHasil } from "@/app/(app)/pos/opname/actions";
import { KonfirmasiJumlah, PetunjukSatuan, SatuanBesar, type ButirKonfirmasi } from "@/components/SatuanHitung";
import { teksKemasan, type SatuanTurunan } from "@/lib/opname-jumlah-tak-wajar";
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
  /** Satuan lain barang ini dari item_units (factor = isi dalam satuan dasar). Kosong/tidak ada = tidak ditampilkan. */
  turunan?: SatuanTurunan[];
};

type Urut = "nama" | "kategori" | "harga";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function HitungForm({
  orderId,
  rows,
  terkunci,
  kembali = "kasir",
}: {
  orderId: string;
  rows: BarisHitung[];
  terkunci: Record<string, number>;
  /** Layar asal: kasir petshop, atau modul Persediaan (gudang klinik / DC). */
  kembali?: "kasir" | "pos";
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
  // Jumlah janggal (mis. 1000 padahal maksudnya 1) wajib dikonfirmasi sebelum dikunci / disimpan.
  const [konfirmasi, setKonfirmasi] = useState<{ butir: ButirKonfirmasi[]; lanjut: () => void; fokusId: string } | null>(null);
  // Jumlah per barang yang sudah diperiksa/dikonfirmasi di layar ini; berubah angka = diperiksa lagi.
  const [diperiksa, setDiperiksa] = useState<Record<string, number>>({});
  const lolos = useRef(false);

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

  const fokusInput = (itemId: string) => {
    setTimeout(() => document.getElementById(`fisik-${itemId}`)?.focus(), 0);
  };

  const butirDari = (ids: string[], jumlah: Record<string, number>): ButirKonfirmasi[] =>
    ids.flatMap((id) => {
      const r = rows.find((x) => x.item_id === id);
      return r ? [{ id, nama: r.name, jumlah: jumlah[id], satuan: r.unit }] : [];
    });

  const kunciSekarang = async (r: BarisHitung, qty: number) => {
    const res = await kunciBaris(orderId, r.item_id, qty);
    if (!res.ok || res.qtyFisik === undefined) { setPesan(res.pesan ?? "Gagal menyimpan."); return; }
    const confirmedQty = res.qtyFisik;
    setKunci((m) => ({ ...m, [r.item_id]: confirmedQty }));
    setIsian((m) => { const next = { ...m }; delete next[r.item_id]; return next; });
    setPesan(confirmedQty !== qty ? "Hitungan sebelumnya tetap tersimpan. Tekan Buka untuk mengubah, lalu hitung ulang." : null);
  };

  const kunciSatu = (r: BarisHitung) => {
    const nilai = isian[r.item_id];
    if (nilai === undefined || nilai.trim() === "") {
      setPesan(`Isi dulu hitungan ${r.name}.`);
      return;
    }
    const qty = Number(nilai);
    if (!Number.isFinite(qty) || qty < 0) {
      setPesan("Isi jumlah fisik yang valid, minimal nol.");
      return;
    }
    start(async () => {
      if (diperiksa[r.item_id] !== qty) {
        const cek = await periksaJumlahTakWajar(orderId, [{ itemId: r.item_id, qty }]);
        if (!cek.ok) { setPesan(cek.pesan); return; }
        if (cek.janggal.includes(r.item_id)) {
          setKonfirmasi({
            butir: butirDari([r.item_id], { [r.item_id]: qty }), fokusId: r.item_id,
            lanjut: () => {
              setDiperiksa((m) => ({ ...m, [r.item_id]: qty }));
              start(async () => { await kunciSekarang(r, qty); });
            },
          });
          return;
        }
        setDiperiksa((m) => ({ ...m, [r.item_id]: qty }));
      }
      await kunciSekarang(r, qty);
    });
  };

  const bukaSatu = (r: BarisHitung) => {
    start(async () => {
      const res = await bukaKunci(orderId, r.item_id);
      if (!res.ok) { setPesan(res.pesan ?? "Gagal membuka kunci."); return; }
      setKunci((m) => { const next = { ...m }; delete next[r.item_id]; return next; });
      setIsian((m) => ({ ...m, [r.item_id]: String(kunci[r.item_id] ?? "") }));
      // Kunci ulang = foto stok baru. Penjualan sejak hitungan pertama sudah tercatat, jadi yang diisi
      // harus isi rak saat ini — bukan stok awal opname (insiden Meo Pouch Adult OPO.00013).
      setPesan(`Hitung ulang ${r.name}: isi jumlah yang ada di rak SEKARANG. Barang yang laku sejak hitungan pertama sudah tercatat otomatis — jangan isi stok awal opname.`);
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
  const dikirimJson = JSON.stringify(dikirim);
  const dikirimTerbaru = useRef(dikirimJson);
  useEffect(() => { dikirimTerbaru.current = dikirimJson; }, [dikirimJson]);

  // "Simpan semua": periksa dulu hitungan yang belum diperiksa (termasuk yang terkunci sebelum fitur ini ada).
  // Server yang menilai (stok sistem tidak dikirim ke layar). Ada yang janggal -> satu dialog untuk semuanya.
  const sebelumSimpan = (e: FormEvent<HTMLFormElement>) => {
    if (lolos.current) { lolos.current = false; return; }
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const snapshot = dikirimJson;
    const kirimSekarang = () => { lolos.current = true; form.requestSubmit(); };
    const baris = Object.entries(dikirim).filter(([id, qty]) => diperiksa[id] !== qty).map(([itemId, qty]) => ({ itemId, qty }));
    if (baris.length === 0) { kirimSekarang(); return; }
    start(async () => {
      const cek = await periksaJumlahTakWajar(orderId, baris);
      if (!cek.ok) { setPesan(cek.pesan); return; }
      if (dikirimTerbaru.current !== snapshot) { setPesan("Isian berubah saat diperiksa. Tekan Simpan semua sekali lagi."); return; }
      const tandai = () => setDiperiksa((m) => ({ ...m, ...Object.fromEntries(baris.map((b) => [b.itemId, b.qty])) }));
      if (cek.janggal.length === 0) { tandai(); kirimSekarang(); return; }
      setKonfirmasi({
        butir: butirDari(cek.janggal, dikirim), fokusId: cek.janggal[0],
        lanjut: () => { tandai(); kirimSekarang(); },
      });
    });
  };

  return (
    <PreservedForm action={simpanHasil} onSubmit={sebelumSimpan}>
      <LocalTransactionDraft scope={`opname-count:${orderId}`} state={{snapshot:{isian,cari,kategori,urut,sisaSaja},restore:s=>{if(!draftRecord(s.isian,draftString)||!Object.keys(s.isian).every(id=>rows.some(r=>r.item_id===id))||typeof s.cari!=="string"||typeof s.kategori!=="string"||!["nama","kategori","harga"].includes(String(s.urut))||typeof s.sisaSaja!=="boolean")return false;setIsian(Object.fromEntries(Object.entries(s.isian).filter(([id])=>terkunci[id]===undefined)));setCari(s.cari);setKategori(s.kategori);setUrut(s.urut as Urut);setSisaSaja(s.sisaSaja);return true;},reset:()=>setIsian({})}}/>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="kembali" value={kembali} />
      <input type="hidden" name="fisik" value={JSON.stringify(dikirim)} />

      <div className="crm-sec">
        <SecHeader
          num="02"
          title="HITUNG FISIK"
          desc={`${rows.length} barang dalam daftar hitung. Isi jumlah yang ada di rak saat itu lalu tekan Kunci — angka yang dikunci langsung tersimpan.`}
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

        <div data-awas-satuan style={{ fontSize: 11.5, marginBottom: 8, background: "#eff6ff", border: ".5px solid #93c5fd", color: "#1e3a8a", borderRadius: 8, padding: "6px 10px" }}>
          <i className="ti ti-ruler-measure" /> <strong>Lihat SATUAN di samping kolom isian.</strong> Isi jumlah dalam satuan itu —
          misalnya barang bersatuan <strong>1L</strong>: satu botol 1 liter ditulis <strong>1</strong>, bukan 1000.
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 10.5, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "#15803d" }}>{jumlahKunci} terkunci</span>
          <span style={{ color: "#b45309" }}>{jumlahIsi} terisi belum dikunci</span>
          <span style={{ color: belum ? "#b91c1c" : "var(--tm)" }}>{belum} belum dihitung</span>
        </div>

        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Kode #</th>
                <th>Nama Barang</th>
                <th>Kategori</th>
                <th style={{ textAlign: "right" }}>Harga jual</th>
                <th style={{ textAlign: "right" }}>Jumlah fisik &amp; satuan</th>
                <th style={{ width: 108 }}>Kunci</th>
              </tr>
            </thead>
            <tbody>
              {tampil.map((r) => {
                const locked = kunci[r.item_id] !== undefined;
                const unit = r.unit.trim();
                const kemasan = teksKemasan(unit, r.turunan);
                return (
                  <tr key={r.item_id} style={locked ? { background: "#f0fdf4" } : undefined}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.code}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {r.name}
                      {kemasan && (
                        <div data-isi-kemasan style={{ fontSize: 10, color: "var(--tm)", marginTop: 1 }}>Isi kemasan: {kemasan}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.kategori}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.sell_price)}</td>
                    <td style={{ textAlign: "right" }}>
                      {locked ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: "#15803d" }}>{kunci[r.item_id]}</span>
                          <SatuanBesar unit={unit} />
                        </span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                          <PetunjukSatuan unit={unit} htmlFor={`fisik-${r.item_id}`} />
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <NumberInput className="fi" type="number" min={0} step="any" inputMode="decimal"
                              id={`fisik-${r.item_id}`} placeholder="—"
                              aria-label={`Jumlah fisik ${r.name}${unit ? ` (${unit})` : ""}`}
                              value={isian[r.item_id] ?? ""}
                              onChange={(e) => setIsian((m) => ({ ...m, [r.item_id]: e.target.value }))}
                              style={{ width: 110, textAlign: "right", fontSize: 15, fontWeight: 700 }} />
                            <SatuanBesar unit={unit} />
                          </div>
                        </div>
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
          Barang yang tidak dihitung dilewat — stoknya tidak diubah. Barang yang laku sesudah dikunci otomatis diperhitungkan, tidak perlu dikurangi sendiri. Laporan selisih keluar setelah disimpan.
        </div>
      </div>
      {konfirmasi && (
        <KonfirmasiJumlah
          butir={konfirmasi.butir}
          onBatal={() => { const id = konfirmasi.fokusId; setKonfirmasi(null); fokusInput(id); }}
          onYa={() => { const lanjut = konfirmasi.lanjut; setKonfirmasi(null); lanjut(); }}
        />
      )}
    </PreservedForm>
  );
}
