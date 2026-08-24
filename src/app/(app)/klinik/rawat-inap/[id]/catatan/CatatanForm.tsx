"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/client";
import { racikanTotal, type RacikanIngredient } from "@/lib/racikan";
import { OPSI_MAKAN, OPSI_MINUM, OPSI_BAB, OPSI_PIPIS, OPSI_KOMUNIKASI } from "@/lib/monitoring-inap";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { addDailyLogPos } from "../../actions";

export type ItemLite = { id: string; name: string; unit: string; sell_price: number; stok: number; units?: ItemUnit[] };
type CartRow = {
  key: string; item_id: string | null; nama_obat: string; qty: number; satuan: string; harga: number;
  faktor: number;
  jenis: "obat" | "jasa" | "racikan";
  ingredients?: RacikanIngredient[]; dosage_form?: string; aturan_pakai?: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const TABS = [
  { id: "Obat", icon: "ti-capsule" },
  { id: "Jasa", icon: "ti-stethoscope" },
  { id: "Paket", icon: "ti-gift" },
  { id: "Racikan", icon: "ti-flask" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function CatatanForm({ recordId, backHref, patient, items, bahanItems }: {
  recordId: string; backHref: string;
  patient: { name: string; species: string; breed: string | null; noRM: string; owner: string; phone: string; address: string; tglMasuk: string; dokter: string; kondisi: string; photo: string | null };
  items: ItemLite[];
  bahanItems: ItemLite[];
}) {
  const [tab, setTab] = useState<Tab>("Obat");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [catatan, setCatatan] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [jasaNama, setJasaNama] = useState("");
  const [jasaHarga, setJasaHarga] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Foto perkembangan pasien: diunggah dari sini supaya dokter/perawat tidak perlu
  // kirim lewat WA lalu ditempel manual belakangan.
  const [fotoUrl, setFotoUrl] = useState("");
  const [fotoPratinjau, setFotoPratinjau] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  async function pilihFoto(file: File | undefined) {
    if (!file) return;
    setFotoPratinjau(URL.createObjectURL(file));
    setUploading(true);
    setUploadErr("");
    try {
      const supabase = createClient();
      const path = `inap/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`;
      const { error } = await supabase.storage.from("pet-photos").upload(path, file, { upsert: true });
      if (error) throw error;
      setFotoUrl(supabase.storage.from("pet-photos").getPublicUrl(path).data.publicUrl);
    } catch (err) {
      // Pratinjau lokal tidak boleh ikut tersimpan — alamatnya mati begitu halaman ditutup.
      setFotoUrl("");
      setUploadErr(err instanceof Error ? err.message : "Gagal unggah foto");
    } finally {
      setUploading(false);
    }
  }

  // Builder racikan — alur & field sama seperti tab Racikan di form pemeriksaan.
  const [racikNama, setRacikNama] = useState("");
  const [racikForm, setRacikForm] = useState("sirup");
  const [racikAturan, setRacikAturan] = useState("");
  const [racikBahan, setRacikBahan] = useState<RacikanIngredient[]>([]);
  const [bahanSearch, setBahanSearch] = useState("");

  const filtered = useMemo(() => items.filter((it) => it.name.toLowerCase().includes(search.toLowerCase())).slice(0, 40), [items, search]);
  const bahanFiltered = useMemo(() => bahanItems.filter((it) => it.name.toLowerCase().includes(bahanSearch.toLowerCase())).slice(0, 40), [bahanItems, bahanSearch]);
  const racikSubtotal = racikanTotal(racikBahan);

  const addObat = (it: ItemLite) => setCart((c) => {
    const ex = c.find((r) => r.item_id === it.id);
    if (ex) return c.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
    const u = (it.units ?? [])[0];
    return [...c, {
      key: it.id, item_id: it.id, nama_obat: it.name, qty: 1,
      satuan: u?.unit ?? it.unit, harga: u?.sell_price ?? it.sell_price, faktor: u?.factor ?? 1, jenis: "obat",
    }];
  });
  const addJasa = () => {
    if (!jasaNama.trim()) return;
    setCart((c) => [...c, { key: `jasa-${c.length}-${jasaNama}`, item_id: null, nama_obat: jasaNama.trim(), qty: 1, satuan: "jasa", faktor: 1, harga: jasaHarga, jenis: "jasa" }]);
    setJasaNama(""); setJasaHarga(0);
  };
  const addBahan = (it: ItemLite) => setRacikBahan((b) => {
    const ex = b.find((r) => r.item_id === it.id);
    if (ex) return b.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
    return [...b, { item_id: it.id, nama: it.name, qty: 1, satuan: it.unit, harga: it.sell_price }];
  });
  const setBahanQty = (id: string, qty: number) => setRacikBahan((b) => b.map((r) => (r.item_id === id ? { ...r, qty: Math.max(1, qty) } : r)));
  const delBahan = (id: string) => setRacikBahan((b) => b.filter((r) => r.item_id !== id));
  const addRacikanToCart = () => {
    if (!racikNama.trim() || racikBahan.length === 0) return;
    setCart((c) => [...c, {
      key: `racik-${c.length}-${racikNama}`, item_id: null, nama_obat: racikNama.trim(), qty: 1, satuan: "racikan", faktor: 1,
      harga: racikanTotal(racikBahan), jenis: "racikan",
      ingredients: racikBahan, dosage_form: racikForm, aturan_pakai: racikAturan.trim() || undefined,
    }]);
    setRacikNama(""); setRacikAturan(""); setRacikBahan([]); setBahanSearch("");
  };

  const setQty = (key: string, qty: number) => setCart((c) => c.map((r) => (r.key === key ? { ...r, qty: Math.max(1, qty) } : r)));
  // Satuan berjenjang: ganti ml→btl, harga & faktor ikut satuan yang dipilih.
  const unitsOf = (itemId: string | null) => (itemId ? items.find((i) => i.id === itemId)?.units ?? [] : []);
  const setSatuan = (key: string, itemId: string | null, unit: string) =>
    setCart((c) => c.map((r) => {
      if (r.key !== key) return r;
      const u = pickUnit(unitsOf(itemId), unit);
      return u ? { ...r, satuan: u.unit, harga: u.sell_price, faktor: u.factor } : r;
    }));
  const del = (key: string) => setCart((c) => c.filter((r) => r.key !== key));
  const clear = () => setCart([]);

  const subtotal = cart.reduce((a, r) => a + r.qty * r.harga, 0);
  const discountVal = Math.round((subtotal * discountPct) / 100);
  const ppn = 0; // ponytail: PPN 0% (display); tarif final ditentukan kasir saat pembayaran
  const total = Math.max(0, subtotal - discountVal + ppn);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <form action={addDailyLogPos}>
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="resep" value={JSON.stringify(cart)} />
      <input type="hidden" name="catatan_resep" value={catatan} />
      <input type="hidden" name="foto_url" value={fotoUrl} />

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* ===== KIRI: data pasien + detail rawat inap ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>DATA PASIEN</div>
          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ width: 84, height: 84, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
              {patient.photo ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 34, color: "var(--td)" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
                <span className="bge b">{patient.species}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", marginTop: 6, fontSize: 10.5 }}>
                <MiniKV k="Pemilik" v={patient.owner} />
                <MiniKV k="No. RM" v={patient.noRM} />
                <MiniKV k="No. HP" v={patient.phone} />
                <MiniKV k="Jenis / Ras" v={patient.breed ? `${patient.species} / ${patient.breed}` : patient.species} />
                <MiniKV k="Alamat" v={patient.address} />
                <MiniKV k="Tanggal Masuk" v={patient.tglMasuk} />
                <MiniKV k="Kondisi" v={patient.kondisi} />
                <MiniKV k="Dokter PJ" v={patient.dokter || "—"} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 16, color: "#2563eb" }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#2563eb" }}>DETAIL RAWAT INAP</span>
          </div>

          <div className="frow">
            <div>
              <label className="flab">Tanggal *</label>
              <input className="fi" type="date" name="log_date" defaultValue={todayStr} required />
            </div>
            <div>
              <label className="flab">Waktu *</label>
              <input className="fi" type="time" name="log_time" defaultValue={timeStr} required />
            </div>
          </div>
          {/* Pemantauan harian: dipisah jadi kolom sendiri supaya bisa dihitung &
              digrafikkan (permintaan Drh. Ilham). Kolom kosong = belum diperiksa,
              bukan "tidak ada" — bedanya penting untuk hitungan hari tanpa BAB. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 8px" }}>
            <i className="ti ti-activity-heartbeat" style={{ fontSize: 15, color: "#16a34a" }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16a34a" }}>PEMANTAUAN HARIAN</span>
            <span style={{ fontSize: 9.5, color: "var(--td)" }}>kosongkan yang belum diperiksa</span>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Berat badan (kg)</label>
              <input className="fi" type="number" name="berat" min={0} max={200} step="0.01" placeholder="mis. 12.5" />
            </div>
            <div>
              <label className="flab">Suhu tubuh (°C)</label>
              <input className="fi" type="number" name="suhu" min={25} max={45} step="0.1" placeholder="mis. 38.6" />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Makan</label>
              <select className="fi" name="makan" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_MAKAN.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Minum</label>
              <select className="fi" name="minum" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_MINUM.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">BAB</label>
              <select className="fi" name="bab" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_BAB.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">BAK (pipis)</label>
              <select className="fi" name="pipis" defaultValue="">
                <option value="">— belum dinilai —</option>
                {OPSI_PIPIS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="fg">
            <label className="flab">Foto pasien hari ini</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 62, height: 62, borderRadius: 9, background: "var(--sf1)", border: ".5px solid var(--bd)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {fotoPratinjau || fotoUrl
                  ? <img src={fotoUrl || fotoPratinjau} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <i className="ti ti-camera" style={{ fontSize: 22, color: "var(--td)" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input type="file" accept="image/*" className="fi" style={{ fontSize: 10.5, padding: 5 }}
                  onChange={(e) => pilihFoto(e.target.files?.[0])} />
                <div style={{ fontSize: 9.5, color: uploadErr ? "#b91c1c" : "var(--td)", marginTop: 3 }}>
                  {uploading ? "Mengunggah foto…" : uploadErr || "JPG/PNG. Foto tersimpan per tanggal, jadi perkembangannya bisa dibandingkan."}
                </div>
              </div>
            </div>
          </div>

          <div className="fg">
            <label className="flab">Kondisi umum pasien *</label>
            <textarea className="fi" name="condition_note" required rows={2} placeholder="mis. Lemas berkurang, respons membaik, masih batuk sesekali" style={{ resize: "vertical" }} />
          </div>
          <div className="fg">
            <label className="flab">Tindakan / perawatan</label>
            <textarea className="fi" name="tindakan" rows={2} placeholder="mis. Wound dressing, terapi cairan, injeksi antibiotik, observasi" style={{ resize: "vertical" }} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Obat yang ditagihkan cukup dipilih di panel kanan — kolom ini untuk tindakan medisnya.
            </div>
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={2} placeholder="mis. Nafsu makan mulai kembali, rencana cek darah ulang besok" style={{ resize: "vertical" }} />
          </div>

          {/* Komunikasi ke pemilik: shift berikutnya harus tahu owner sudah dikabari
              apa, tanpa perlu bertanya ke orang yang sudah pulang. */}
          <div className="frow">
            <div style={{ flex: 2 }}>
              <label className="flab">Yang disampaikan ke pemilik hari ini</label>
              <textarea className="fi" name="komunikasi_owner" rows={2}
                placeholder="mis. Owner dikabari hasil rontgen & rencana operasi besok, owner setuju" style={{ resize: "vertical" }} />
            </div>
            <div>
              <label className="flab">Lewat</label>
              <select className="fi" name="komunikasi_via" defaultValue="">
                <option value="">— belum dihubungi —</option>
                {OPSI_KOMUNIKASI.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Oleh dokter</label>
              <input className="fi" name="doctor_name" defaultValue={patient.dokter} placeholder="Drh. ..." />
            </div>
            <div>
              <label className="flab">Ubah kondisi</label>
              <select className="fi" name="new_status" defaultValue="">
                <option value="">— tetap ({patient.kondisi})</option>
                <option value="stabil">Stabil</option>
                <option value="kritis">Kritis</option>
                <option value="sembuh">Sembuh / Boleh Pulang</option>
                <option value="rip">RIP (Meninggal)</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Link href={backHref} className="btn-def">Batal</Link>
            <SubmitButton className="pay-btn" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ width: "auto", flex: 1 }}>Simpan Catatan Rawat Inap</SubmitButton>
          </div>
        </div>

        {/* ===== KANAN: POS obat & jasa ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>
            <i className="ti ti-shopping-cart" style={{ color: "#2563eb" }} /> INPUT OBAT &amp; JASA (POS)
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className="back-btn" style={{
                flex: 1, justifyContent: "center", padding: "8px 0", borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                border: ".5px solid var(--bd)", background: tab === t.id ? "#2563eb" : "#fff", color: tab === t.id ? "#fff" : "var(--tm)",
              }}><i className={`ti ${t.icon}`} /> {t.id}</button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
            {/* Daftar item */}
            <div>
              {tab === "Obat" && (
                <>
                  <div style={{ position: "relative", marginBottom: 8 }}>
                    <input className="fi" placeholder="Cari nama obat / scan barcode…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingRight: 28 }} />
                    <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tm)", marginBottom: 5 }}>DAFTAR OBAT</div>
                  <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto" }}>
                    <table className="tbl" style={{ minWidth: 260 }}>
                      <thead>
                        <tr><th>Nama Obat</th><th style={{ textAlign: "center" }}>Stok</th><th style={{ textAlign: "right" }}>Harga</th><th style={{ width: 32 }} /></tr>
                      </thead>
                      <tbody>
                        {filtered.map((it) => (
                          <tr key={it.id}>
                            <td style={{ fontSize: 11, fontWeight: 500 }}>{it.name}</td>
                            <td style={{ textAlign: "center", fontSize: 10.5, color: it.stok <= 0 ? "#b91c1c" : "var(--tm)" }}>{it.stok} {it.unit}</td>
                            <td style={{ textAlign: "right", fontSize: 11 }}>{rp(it.sell_price)}</td>
                            <td style={{ textAlign: "center" }}>
                              <button type="button" onClick={() => addObat(it)} className="btn-acc" style={{ padding: "2px 7px", fontSize: 11, background: "#16a34a" }} title="Tambah"><i className="ti ti-plus" /></button>
                            </td>
                          </tr>
                        ))}
                        {filtered.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Tidak ada obat.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {tab === "Jasa" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input className="fi" placeholder="Nama jasa (mis. Rawat inap/hari)" value={jasaNama} onChange={(e) => setJasaNama(e.target.value)} />
                  <input className="fi" type="number" min={0} step="any" placeholder="Harga" value={jasaHarga || ""} onChange={(e) => setJasaHarga(Number(e.target.value))} />
                  <button type="button" onClick={addJasa} className="btn-acc" style={{ background: "#2563eb", justifyContent: "center" }}><i className="ti ti-plus" /> Tambah jasa</button>
                </div>
              )}
              {tab === "Paket" && <div style={{ fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Paket bundling — dalam pengembangan.</div>}
              {tab === "Racikan" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input className="fi" placeholder="Nama racikan (mis. Puyer Batuk)" value={racikNama} onChange={(e) => setRacikNama(e.target.value)} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <select className="fi" value={racikForm} onChange={(e) => setRacikForm(e.target.value)} style={{ fontSize: 11.5 }}>
                      {["sirup", "nebul", "salep", "puyer", "kapsul", "lainnya"].map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input className="fi" placeholder="Aturan pakai (opsional)" value={racikAturan} onChange={(e) => setRacikAturan(e.target.value)} />
                  </div>
                  <div style={{ position: "relative" }}>
                    <input className="fi" placeholder="Cari bahan baku..." value={bahanSearch} onChange={(e) => setBahanSearch(e.target.value)} style={{ paddingRight: 28 }} />
                    <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
                  </div>
                  <div style={{ maxHeight: 140, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
                    {bahanItems.length === 0 && <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 10px" }}>Belum ada bahan baku. Tandai di menu Kelola Bahan Baku.</div>}
                    {bahanFiltered.map((it) => (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderBottom: ".5px solid var(--bd)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 500 }}>{it.name}</div>
                          <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Stok {it.stok} {it.unit} · {rp(it.sell_price)}</div>
                        </div>
                        <button type="button" onClick={() => addBahan(it)} className="btn-acc" style={{ padding: "2px 7px", fontSize: 11, background: "#16a34a" }}><i className="ti ti-plus" /></button>
                      </div>
                    ))}
                  </div>
                  {racikBahan.length > 0 && (
                    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 8 }}>
                      {racikBahan.map((b) => (
                        <div key={b.item_id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ flex: 1, fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.nama}</span>
                          <input className="fi" type="number" min={1} value={b.qty} onChange={(e) => setBahanQty(b.item_id, Number(e.target.value))} style={{ width: 46, padding: "2px 4px", textAlign: "center", fontSize: 10.5 }} />
                          <span style={{ fontSize: 10, color: "var(--tm)" }}>{b.satuan}</span>
                          <span style={{ fontSize: 10.5, width: 62, textAlign: "right" }}>{rp(b.qty * b.harga)}</span>
                          <i className="ti ti-x" onClick={() => delBahan(b.item_id)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} />
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: ".5px solid var(--bd)", paddingTop: 5, marginTop: 3, fontSize: 11.5, fontWeight: 700 }}>
                        <span>Estimasi</span><span style={{ color: "#2563eb" }}>{rp(racikSubtotal)}</span>
                      </div>
                    </div>
                  )}
                  <button type="button" onClick={addRacikanToCart} disabled={!racikNama.trim() || racikBahan.length === 0}
                    className="btn-acc" style={{ justifyContent: "center", background: "#2563eb", opacity: (!racikNama.trim() || racikBahan.length === 0) ? .5 : 1 }}>
                    <i className="ti ti-plus" /> Tambah racikan ke keranjang
                  </button>
                </div>
              )}
            </div>

            {/* Keranjang */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#2563eb" }}>KERANJANG ({cart.length})</span>
                {cart.length > 0 && <button type="button" onClick={clear} className="back-btn" style={{ fontSize: 10, color: "#b91c1c" }}>Hapus semua</button>}
              </div>
              <div style={{ minHeight: 60, overflowX: "auto" }}>
                {cart.length === 0 ? (
                  <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 0" }}>Belum ada item. Tambah obat/jasa/racikan dari kiri.</div>
                ) : (
                  <table className="tbl" style={{ minWidth: 300 }}>
                    <thead>
                      <tr><th>Nama</th><th style={{ textAlign: "center", width: 48 }}>Qty</th><th style={{ textAlign: "right" }}>Subtotal</th><th style={{ width: 26 }} /></tr>
                    </thead>
                    <tbody>
                      {cart.map((r) => (
                        <tr key={r.key}>
                          <td style={{ fontSize: 10.5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              {r.jenis === "racikan" && (
                                <i className={`ti ti-chevron-${expanded[r.key] ? "down" : "right"}`} style={{ cursor: "pointer", fontSize: 12, color: "var(--tm)" }}
                                  onClick={() => setExpanded((e) => ({ ...e, [r.key]: !e[r.key] }))} />
                              )}
                              <span>{r.nama_obat}</span>
                              {r.jenis === "racikan" && <span className="bge b" style={{ fontSize: 8 }}>racikan</span>}
                            </div>
                            <div style={{ fontSize: 9, color: "var(--tm)", display: "flex", alignItems: "center", gap: 4 }}>
                              <span>{rp(r.harga)} /</span>
                              {unitsOf(r.item_id).length > 1 && r.jenis === "obat" ? (
                                <select className="fi" value={r.satuan} onChange={(e) => setSatuan(r.key, r.item_id, e.target.value)}
                                  style={{ width: 62, padding: "1px 3px", fontSize: 9.5 }} title="Satuan">
                                  {unitsOf(r.item_id).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                                </select>
                              ) : <span>{r.satuan}</span>}
                            </div>
                            {r.jenis === "racikan" && expanded[r.key] && (
                              <div style={{ marginTop: 4, paddingLeft: 14, borderLeft: "2px solid var(--bd)" }}>
                                {(r.ingredients ?? []).map((b) => (
                                  <div key={b.item_id} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 9, color: "var(--tm)" }}>
                                    <span>{b.nama} × {b.qty} {b.satuan}</span><span>{rp(b.qty * b.harga)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {r.jenis === "racikan"
                              ? <span style={{ fontSize: 10.5 }}>1</span>
                              : <input className="fi" type="number" min={1} value={r.qty} onChange={(e) => setQty(r.key, Number(e.target.value))} style={{ width: 42, padding: "2px 4px", textAlign: "center", fontSize: 10.5 }} />}
                          </td>
                          <td style={{ textAlign: "right", fontSize: 10.5, fontWeight: 600 }}>{rp(r.qty * r.harga)}</td>
                          <td style={{ textAlign: "center" }}>
                            <i className="ti ti-x" onClick={() => del(r.key)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} title="Hapus" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <label className="flab">Catatan resep / keterangan</label>
                <textarea className="fi" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Aturan pakai obat…" style={{ resize: "vertical" }} />
              </div>

              <div style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 8 }}>
                <Row k="Subtotal" v={rp(subtotal)} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                  <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Diskon</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <input className="fi" type="number" min={0} max={100} value={discountPct || ""} onChange={(e) => setDiscountPct(Math.min(100, Math.max(0, Number(e.target.value))))} style={{ width: 54, padding: "3px 6px", textAlign: "right" }} />
                    <span style={{ fontSize: 11, color: "var(--tm)" }}>%</span>
                    <span style={{ fontSize: 11, width: 72, textAlign: "right", color: "#b91c1c" }}>{discountVal > 0 ? `-${rp(discountVal)}` : rp(0)}</span>
                  </span>
                </div>
                <Row k="PPN (0%)" v={rp(ppn)} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 0", borderTop: "1px solid var(--bd)", marginTop: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>TOTAL</span>
                  <span style={{ fontSize: 17, fontWeight: 800, color: "#2563eb" }}>{rp(total)}</span>
                </div>
                <div style={{ fontSize: 9, color: "var(--td)", marginTop: 6 }}>Obat, jasa &amp; racikan masuk resep visit → ikut tagihan saat pasien pulang.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 6, marginTop: 12 }}>
                <SubmitButton className="btn-def" icon="ti-printer" name="cetak" value="1" pendingText="…" style={{ padding: "9px 0", fontSize: 11.5 }}>Simpan &amp; Cetak</SubmitButton>
                <SubmitButton className="btn-acc" icon="ti-circle-check" name="cetak" value="0" pendingText="Menyimpan…" style={{ justifyContent: "center", padding: "9px 0", fontSize: 12, background: "#16a34a" }}>Simpan Catatan &amp; Lanjut</SubmitButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function MiniKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      <span style={{ color: "var(--tm)", minWidth: 74 }}>{k}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>: {v}</span>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{k}</span>
      <span style={{ fontWeight: 500 }}>{v}</span>
    </div>
  );
}
