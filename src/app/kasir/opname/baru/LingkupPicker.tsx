"use client";

// Lingkup opname: daftar otomatis, seluruh gudang, atau sebagian barang saja.
//
// Bawaannya DAFTAR OTOMATIS (keputusan meeting 14 Agustus): 20 barang terlaris +
// 10 acak. Barang cepat laku paling rawan selisih; yang acak menangkap barang
// hilang yang tidak laku. Toko tidak sanggup menutup lapak untuk hitung penuh
// tiap hari, tapi 30 barang sehari bisa.

import { useMemo, useState } from "react";

export type ItemPilihan = { id: string; code: string; name: string; kategori: string };

type Mode = "auto" | "penuh" | "parsial";

const TERLARIS = 20;
const ACAK = 10;

export function LingkupPicker({ items }: { items: ItemPilihan[] }) {
  const [mode, setMode] = useState<Mode>("auto");
  const parsial = mode === "parsial";
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [cari, setCari] = useState("");
  const [kategori, setKategori] = useState("");

  const daftarKategori = useMemo(
    () => [...new Set(items.map((i) => i.kategori).filter(Boolean))].sort(),
    [items],
  );

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return items.filter((i) =>
      (!kategori || i.kategori === kategori) &&
      (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)));
  }, [items, cari, kategori]);

  const toggle = (id: string) => setPilih((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Pilih/hapus sekaligus hanya untuk yang SEDANG tampil — kalau menyapu seluruh
  // master, filter kategori jadi tidak ada gunanya.
  const pilihTampil = () => setPilih((s) => new Set([...s, ...tampil.map((i) => i.id)]));
  const hapusTampil = () => setPilih((s) => {
    const next = new Set(s);
    for (const i of tampil) next.delete(i.id);
    return next;
  });

  return (
    <div className="fg" style={{ marginBottom: 10 }}>
      <label className="flab">Lingkup hitung</label>
      {/* Kosong = seluruh gudang; server memperlakukan daftar kosong sebagai opname penuh.
          Mode "auto" membiarkan server yang menyusun daftarnya. */}
      <input type="hidden" name="lingkup_items" value={parsial ? [...pilih].join(",") : ""} />
      <input type="hidden" name="lingkup_mode" value={mode === "auto" ? "auto" : ""} />
      <input type="hidden" name="auto_terlaris" value={TERLARIS} />
      <input type="hidden" name="auto_acak" value={ACAK} />

      <div style={{ display: "flex", gap: 6, marginBottom: parsial ? 8 : 0, flexWrap: "wrap" }}>
        {([
          { v: "auto", label: `${TERLARIS + ACAK} barang otomatis`, desc: `${TERLARIS} terlaris + ${ACAK} acak` },
          { v: "penuh", label: "Seluruh gudang", desc: "Semua barang dihitung" },
          { v: "parsial", label: "Pilih sendiri", desc: "Sisanya tidak tersentuh" },
        ] as { v: Mode; label: string; desc: string }[]).map((o) => (
          <button key={o.v} type="button" onClick={() => setMode(o.v)} style={{
            flex: "1 1 150px", textAlign: "left", padding: "8px 10px", borderRadius: 8, cursor: "pointer",
            border: `1.5px solid ${mode === o.v ? "var(--posb)" : "var(--bd)"}`,
            background: mode === o.v ? "#eff4ff" : "#fff",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{o.label}</div>
            <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{o.desc}</div>
          </button>
        ))}
      </div>

      {mode === "auto" && (
        <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 6 }}>
          Daftar disusun sistem saat tombol mulai ditekan — petugas tidak bisa memilih barang yang dihitung.
        </div>
      )}

      {parsial && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <input className="fi" value={cari} onChange={(e) => setCari(e.target.value)}
              placeholder="Cari nama / kode barang" style={{ flex: 1, minWidth: 160 }} />
            <select className="fi" value={kategori} onChange={(e) => setKategori(e.target.value)} style={{ width: 150 }}>
              <option value="">Semua kategori</option>
              {daftarKategori.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <button type="button" className="btn-def" onClick={pilihTampil} style={{ padding: "3px 9px", fontSize: 10.5 }}>
              Pilih semua yang tampil ({tampil.length})
            </button>
            <button type="button" className="btn-def" onClick={hapusTampil} style={{ padding: "3px 9px", fontSize: 10.5 }}>
              Hapus pilihan
            </button>
            <span style={{ fontSize: 11, fontWeight: 700, color: pilih.size ? "#15803d" : "#b91c1c" }}>
              {pilih.size} barang dipilih
            </span>
          </div>

          <div style={{ maxHeight: 220, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
            {tampil.map((i) => (
              <label key={i.id} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", cursor: "pointer",
                borderBottom: ".5px solid var(--bd)", fontSize: 11.5,
              }}>
                <input type="checkbox" checked={pilih.has(i.id)} onChange={() => toggle(i.id)} />
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--tm)", width: 78 }}>{i.code}</span>
                <span style={{ flex: 1 }}>{i.name}</span>
                <span style={{ fontSize: 9.5, color: "var(--td)" }}>{i.kategori}</span>
              </label>
            ))}
            {tampil.length === 0 && (
              <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "var(--td)" }}>Tidak ada barang cocok.</div>
            )}
          </div>
          {pilih.size === 0 && (
            <div style={{ fontSize: 10, color: "#b45309", marginTop: 5 }}>
              <i className="ti ti-alert-triangle" /> Pilih minimal satu barang, atau kembali ke &quot;Seluruh gudang&quot;.
            </div>
          )}
        </>
      )}
    </div>
  );
}
