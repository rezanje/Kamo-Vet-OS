"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { analisisImpor, isPaket, kebutuhanIsiPaket, kunciBaris, satuanBarang, type AnalisisPesanan, type ExistingOrders } from "@/lib/shopee-import-match";
import { pratinjauImporShopee, simpanImporShopee, type HasilImporOrder, type PratinjauImpor, type PilihanImpor } from "./actions";

import { labelTipeGudang, type CabangImpor } from "@/lib/online-gudang";

const rp = (n: number) => `Rp ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const angka = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
const CHUNK = 10;
const STATUS_LABEL: Record<AnalisisPesanan["status"], { teks: string; bg: string; fg: string }> = {
  siap: { teks: "Siap disimpan", bg: "#e8f5ee", fg: "#15803d" },
  "perlu-perbaikan": { teks: "Perlu diperiksa", bg: "#fffbeb", fg: "#b45309" },
  duplikat: { teks: "Sudah diimpor", bg: "#eff6ff", fg: "#1d4ed8" },
  dilewati: { teks: "Dilewati", bg: "#f4f4f5", fg: "#3f3f46" },
};
const WARNA: Record<string, string> = { blok: "#b91c1c", peringatan: "#b45309", info: "var(--tm)" };
const KIND_LABEL: Record<string, string> = {
  sku: "cocok SKU", nama: "cocok nama", "nama-normal": "cocok nama (dirapikan)", perkiraan: "perkiraan", ambigu: "ambigu", tidak: "belum cocok",
};

// E4 (meeting 12 Nov 2026): yang dipilih CABANG, gudangnya ditentukan sistem (gudang utama cabang).
// Akun dengan satu cabang: terkunci otomatis. Server menghitung ulang gudang dari cabang yang dikirim.
export function ShopeeImportWorkspace({ cabang, terkunci, defaultBranchId, isOwner }: { cabang: CabangImpor[]; terkunci: boolean; defaultBranchId: string; isOwner: boolean }) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const terpilih = cabang.find(c => c.id === branchId) ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PratinjauImpor | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [konfirmasi, setKonfirmasi] = useState<Set<string>>(new Set());
  const [satuan, setSatuan] = useState<Record<string, string>>({});
  const [sertakan, setSertakan] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<ExistingOrders>({});
  const [results, setResults] = useState<Record<string, HasilImporOrder>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);

  const analisis = useMemo(() => preview && !preview.error
    ? analisisImpor(preview.orders, preview.catalog, { existing: { ...preview.existing, ...saved }, overrides, konfirmasi, sertakan, satuan })
    : [], [preview, saved, overrides, konfirmasi, sertakan, satuan]);
  const siap = analisis.filter(a => a.saveable);
  // E2: barang Grup (paket/bundling) ditandai di pilihan barang.
  const catalogPicker = useMemo(() => (preview?.catalog ?? []).map(c => ({ id: c.id, code: c.code, name: isPaket(c) ? `${c.name} (paket)` : c.name })), [preview]);

  function reset() { setPreview(null); setOverrides({}); setKonfirmasi(new Set()); setSatuan({}); setSertakan(new Set()); setSaved({}); setResults({}); setMessage(""); }

  async function baca() {
    if (busyRef.current) return;
    if (!terpilih) { setMessage("Pilih cabang tujuan dulu."); return; }
    if (!file) { setMessage("Pilih file Excel (.xlsx) ekspor pesanan Shopee dulu."); return; }
    busyRef.current = true; setBusy(true); reset();
    try {
      const fd = new FormData();
      fd.set("file", file); fd.set("branch_id", branchId);
      const r = await pratinjauImporShopee(fd);
      setPreview(r);
      setMessage(r.error ?? `${r.orders.length} pesanan terbaca. Periksa kecocokan barang sebelum menyimpan.`);
    } catch { setMessage("Pratinjau gagal dimuat. Coba lagi."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function simpan() {
    // Ref (bukan state) supaya klik ganda sebelum render ulang tetap hanya satu permintaan.
    if (busyRef.current || !file || siap.length === 0) return;
    busyRef.current = true; setBusy(true); setMessage("");
    const hasil: Record<string, HasilImporOrder> = {};
    const pilihan: PilihanImpor[] = siap.map(a => ({
      orderNo: a.order.orderNo,
      items: a.lines.map(l => l.item?.id ?? ""),
      satuan: a.lines.map(l => l.satuan?.unit ?? ""),
      ...(a.order.importable ? {} : { sertakan: true }),
    }));
    try {
      for (let i = 0; i < pilihan.length; i += CHUNK) {
        const potong = pilihan.slice(i, i + CHUNK);
        const fd = new FormData();
        fd.set("file", file); fd.set("branch_id", branchId); fd.set("selection", JSON.stringify(potong));
        let r: Awaited<ReturnType<typeof simpanImporShopee>>;
        try { r = await simpanImporShopee(fd); }
        catch { r = { ok: false, results: potong.map(p => ({ orderNo: p.orderNo, status: "error" as const, message: "Hasil simpan belum dapat dipastikan. Muat ulang pratinjau untuk melihat order yang sudah tercatat." })) }; }
        if (r.error) r = { ok: false, results: potong.map(p => ({ orderNo: p.orderNo, status: "error" as const, message: r.error! })) };
        for (const x of r.results) hasil[x.orderNo] = x;
      }
    } finally { busyRef.current = false; setBusy(false); }
    setResults(prev => ({ ...prev, ...hasil }));
    setSaved(prev => {
      const next = { ...prev };
      for (const x of Object.values(hasil)) if (x.status === "ok" || x.status === "duplikat") next[x.orderNo] = { noStruk: x.documentNo ?? null, voided: false };
      return next;
    });
    const vals = Object.values(hasil);
    const ok = vals.filter(x => x.status === "ok").length, dup = vals.filter(x => x.status === "duplikat").length, err = vals.filter(x => x.status === "error" || x.status === "dilewati").length;
    setMessage(`Selesai: ${ok} tersimpan, ${dup} sudah ada, ${err} gagal/dilewati.`);
  }

  const toggle = (set: Set<string>, key: string, on: boolean) => { const n = new Set(set); if (on) n.add(key); else n.delete(key); return n; };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ fontSize: 12, color: "var(--tm)" }}>
        Unggah ekspor pesanan Shopee (.xlsx, Seller Centre → Pesanan → Ekspor). Satu No. Pesanan = satu order online; pesanan Pembatalan diajukan, Dibatalkan, dan Belum Bayar
        dilewati. Harga yang dicatat = Harga Setelah Diskon; komisi dihitung nanti saat dana cair (Tandai cair). Pesanan yang sudah pernah diimpor tidak dobel.
        Bundling/paket: buat barang Grup di master dengan kode = SKU Shopee; stok yang keluar adalah isi paketnya.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        {terkunci && terpilih ? (
          <div className="fg" style={{ minWidth: 240 }}>
            <span className="flab">Cabang &amp; gudang</span>
            <div className="fi" aria-label="Gudang impor" style={{ background: "var(--bg2, #f8fafc)" }}>
              {terpilih.name} · {terpilih.gudang.name}
            </div>
            <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Otomatis dari cabang akun ini.</span>
          </div>
        ) : (
          <div className="fg" style={{ minWidth: 260 }}>
            <label className="flab" htmlFor="cabang-impor">Cabang *</label>
            <select id="cabang-impor" className="fi" aria-label="Cabang impor" value={branchId} onChange={e => { setBranchId(e.target.value); reset(); }}>
              <option value="">Pilih cabang</option>
              {cabang.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span style={{ fontSize: 10.5, color: "var(--tm)" }}>
              {terpilih ? <>Gudang otomatis: <b>{terpilih.gudang.name}</b> ({labelTipeGudang(terpilih.gudang.type)})</> : "Gudang mengikuti cabang yang dipilih."}
            </span>
          </div>
        )}
        <div className="fg" style={{ minWidth: 260 }}>
          <label className="flab" htmlFor="file-impor">File pesanan Shopee (.xlsx)</label>
          <input id="file-impor" className="fi" type="file" aria-label="File pesanan Shopee" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] ?? null); reset(); }} />
        </div>
        <button type="button" className="btn-def" disabled={busy} onClick={baca}><i className="ti ti-eye" /> Pratinjau</button>
      </div>

      {message && <div role="status" className="p2ban">{message}</div>}

      {analisis.map(a => {
        const st = STATUS_LABEL[a.status];
        const hasil = results[a.order.orderNo];
        return (
          <section key={a.order.orderNo} data-order={a.order.orderNo} data-status={a.status} className="crm-sec" style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <strong style={{ fontSize: 12 }}>{a.order.orderNo}</strong>
              <span className="bge" style={{ background: st.bg, color: st.fg, fontSize: 10 }}>{st.teks}</span>
              <span style={{ fontSize: 11, color: "var(--tm)" }}>{a.order.tanggal ?? "—"} · pembeli {a.order.buyer || "—"} · {a.order.metodeBayar || "—"} · status Shopee: {a.order.status}</span>
              <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600 }}>
                Total dicatat {rp(a.totalDicatat)}{a.order.totalPembayaran !== null && <span style={{ fontWeight: 400, color: "var(--tm)" }}> · Total Pembayaran Shopee {rp(a.order.totalPembayaran)}</span>}
              </span>
            </div>
            {a.alasan && <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 4 }}>{a.alasan}</div>}
            {isOwner && !a.order.importable && a.order.dataValid && a.status !== "duplikat" && (
              <label style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                <input type="checkbox" aria-label={`Sertakan ${a.order.orderNo}`} checked={sertakan.has(a.order.orderNo)} onChange={e => setSertakan(s => toggle(s, a.order.orderNo, e.target.checked))} />
                {" "}Sertakan pesanan ini (keputusan Owner)
              </label>
            )}
            {hasil && (
              <div data-result={a.order.orderNo} role="status" style={{ fontSize: 11.5, marginBottom: 4, color: hasil.status === "ok" ? "#15803d" : hasil.status === "duplikat" ? "#1d4ed8" : "#b91c1c" }}>
                {hasil.status === "ok" ? "✔ " : hasil.status === "duplikat" ? "• " : "✖ "}{hasil.message}
              </div>
            )}
            {a.warnings.map((w, i) => <div key={i} style={{ fontSize: 10.5, color: WARNA[w.level] }}>{w.level === "blok" ? "⛔ " : w.level === "peringatan" ? "⚠ " : "ℹ "}{w.text}</div>)}
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 920, marginTop: 6 }}>
                <thead><tr><th>Produk di Shopee</th><th>Barang master</th><th>Satuan</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Harga dibebankan</th><th style={{ textAlign: "right" }}>Subtotal</th></tr></thead>
                <tbody>
                  {a.lines.map(l => {
                    const key = kunciBaris(a.order.orderNo, l.index);
                    const perkiraan = l.match.kind === "perkiraan" && !Object.prototype.hasOwnProperty.call(overrides, key);
                    return (
                      <tr key={key}>
                        <td style={{ fontSize: 10.5, maxWidth: 280 }}>
                          <div>{l.namaProduk}</div>
                          {(l.variasi || l.skuInduk || l.skuRef) && <div style={{ color: "var(--tm)" }}>{[l.variasi, l.skuInduk && `SKU Induk: ${l.skuInduk}`, l.skuRef && `Ref: ${l.skuRef}`].filter(Boolean).join(" · ")}</div>}
                        </td>
                        <td style={{ minWidth: 240 }}>
                          <SearchableItemPicker items={catalogPicker} value={l.item?.id ?? ""} ariaLabel={`Barang ${a.order.orderNo} baris ${l.index + 1}`}
                            onChange={id => {
                              setOverrides(o => ({ ...o, [key]: id || null }));
                              // Satuan barang lama belum tentu ada di barang baru → kembali ke tebakan/satuan dasar.
                              setSatuan(s => { const n = { ...s }; delete n[key]; return n; });
                            }} />
                          <div style={{ fontSize: 10, color: "var(--tm)" }}>
                            {l.item ? `Master: ${l.item.name} · ` : ""}{KIND_LABEL[l.match.kind]}
                          </div>
                          {l.item && isPaket(l.item) && (
                            <div data-paket={key} style={{ fontSize: 10, color: "var(--tm)", marginTop: 2 }}>
                              <div style={{ fontWeight: 600 }}>Isi paket (stok &amp; HPP dari isi):</div>
                              {(l.item.grup ?? []).length === 0 && <div>—</div>}
                              {(l.item.grup ?? []).map(isi => {
                                const keb = kebutuhanIsiPaket(l.item!, l.qty).find(k => k.isi.id === isi.id);
                                return (
                                  <div key={isi.id}>
                                    {angka(isi.qtyDasar)} {isi.unit} {isi.name}
                                    {keb ? <> · butuh {angka(keb.butuh)} {isi.unit} · stok {angka(isi.stock)}{keb.butuh > isi.stock ? <b style={{ color: "#b45309" }}> (kurang)</b> : null}</> : <> · tanpa stok</>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {perkiraan && l.item && (
                            <label style={{ fontSize: 10.5, display: "block" }}>
                              <input type="checkbox" aria-label={`Konfirmasi kecocokan ${a.order.orderNo} baris ${l.index + 1}`} checked={konfirmasi.has(key)}
                                onChange={e => setKonfirmasi(s => toggle(s, key, e.target.checked))} /> Sudah saya periksa, barang ini benar
                            </label>
                          )}
                          {l.warnings.map((w, i) => <div key={i} style={{ fontSize: 10, color: WARNA[w.level] }}>{w.level === "blok" ? "⛔ " : w.level === "peringatan" ? "⚠ " : "ℹ "}{w.text}</div>)}
                        </td>
                        <td style={{ minWidth: 110 }}>
                          {l.item && l.satuan ? (() => {
                            const daftar = satuanBarang(l.item);
                            const dasar = daftar[0];
                            return (
                              <>
                                {daftar.length > 1 ? (
                                  <select className="fi" aria-label={`Satuan ${a.order.orderNo} baris ${l.index + 1}`} value={l.satuan.unit}
                                    onChange={e => setSatuan(s => ({ ...s, [key]: e.target.value }))}>
                                    {daftar.map(u => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                                  </select>
                                ) : (
                                  <span style={{ fontSize: 11.5 }} aria-label={`Satuan ${a.order.orderNo} baris ${l.index + 1}`}>{l.satuan.unit || "—"}</span>
                                )}
                                {isPaket(l.item) && <div style={{ fontSize: 9.5, color: "var(--tm)" }}>paket: satuan dasar saja</div>}
                                {l.satuan.factor !== 1 && (
                                  <div style={{ fontSize: 9.5, color: "var(--tm)" }}>stok keluar {String(Math.round(l.qty * l.satuan.factor * 1000) / 1000).replace(".", ",")} {dasar.unit}</div>
                                )}
                              </>
                            );
                          })() : <span style={{ fontSize: 11.5, color: "var(--tm)" }}>—</span>}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11.5 }}>{l.qty}</td>
                        <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(l.harga)}{l.hargaAwal !== l.harga && <div style={{ fontSize: 9.5, color: "var(--tm)" }}>awal {rp(l.hargaAwal)}</div>}</td>
                        <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(l.qty * l.harga)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {analisis.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Link href="/penjualan/online" className="btn-def" style={{ textDecoration: "none" }}>Kembali</Link>
          <button type="button" className="btn-acc" disabled={busy || siap.length === 0} onClick={simpan}>
            <i className="ti ti-device-floppy" /> Simpan semua ({siap.length} pesanan)
          </button>
        </div>
      )}
    </div>
  );
}
