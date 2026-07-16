"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanRekamMedis } from "./actions";
import { racikanTotal, type RacikanIngredient } from "@/lib/racikan";

export type ItemLite = { id: string; name: string; unit: string; sell_price: number; stok: number };
type CartRow = {
  key: string; item_id: string | null; nama_obat: string; qty: number; satuan: string; harga: number;
  jenis: "obat" | "jasa" | "racikan";
  ingredients?: RacikanIngredient[]; dosage_form?: string; aturan_pakai?: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Field kiri dgn ikon berwarna (gaya referensi).
function ExamField({ icon, color, label, children }: { icon: string; color: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "start", padding: "8px 0", borderBottom: ".5px solid var(--bd)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
        <i className={`ti ${icon}`} style={{ color, fontSize: 16, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--tx)" }}>{label}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function RekamForm({ visitId, petId, patient, items, bahanItems, currentWeight }: {
  visitId: string; petId: string;
  patient: { name: string; species: string; breed: string | null; noRM: string; tglPeriksa: string; dokter: string; owner: string; phone: string; address: string; tier: string; keluhan: string | null; photo: string | null };
  items: ItemLite[];
  bahanItems: ItemLite[];
  currentWeight: number | null;
}) {
  const [tab, setTab] = useState<"Obat" | "Jasa" | "Paket" | "Racikan">("Obat");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [catatan, setCatatan] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [jasaNama, setJasaNama] = useState("");
  const [jasaHarga, setJasaHarga] = useState(0);

  // Builder racikan
  const [racikNama, setRacikNama] = useState("");
  const [racikForm, setRacikForm] = useState("sirup");
  const [racikAturan, setRacikAturan] = useState("");
  const [racikBahan, setRacikBahan] = useState<RacikanIngredient[]>([]);
  const [bahanSearch, setBahanSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const bahanFiltered = useMemo(
    () => bahanItems.filter((it) => it.name.toLowerCase().includes(bahanSearch.toLowerCase())).slice(0, 40),
    [bahanItems, bahanSearch],
  );
  const racikSubtotal = racikanTotal(racikBahan);

  const addBahan = (it: ItemLite) => {
    setRacikBahan((b) => {
      const ex = b.find((r) => r.item_id === it.id);
      if (ex) return b.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
      return [...b, { item_id: it.id, nama: it.name, qty: 1, satuan: it.unit, harga: it.sell_price }];
    });
  };
  const setBahanQty = (id: string, qty: number) => setRacikBahan((b) => b.map((r) => (r.item_id === id ? { ...r, qty: Math.max(1, qty) } : r)));
  const delBahan = (id: string) => setRacikBahan((b) => b.filter((r) => r.item_id !== id));

  const addRacikanToCart = () => {
    if (!racikNama.trim() || racikBahan.length === 0) return;
    const key = `racik-${cart.length}-${racikNama}`;
    setCart((c) => [...c, {
      key, item_id: null, nama_obat: racikNama.trim(), qty: 1, satuan: "racikan",
      harga: racikanTotal(racikBahan), jenis: "racikan",
      ingredients: racikBahan, dosage_form: racikForm, aturan_pakai: racikAturan.trim() || undefined,
    }]);
    setRacikNama(""); setRacikAturan(""); setRacikBahan([]); setBahanSearch("");
  };

  const filtered = useMemo(
    () => items.filter((it) => it.name.toLowerCase().includes(search.toLowerCase())).slice(0, 40),
    [items, search],
  );

  const addObat = (it: ItemLite) => {
    setCart((c) => {
      const ex = c.find((r) => r.item_id === it.id);
      if (ex) return c.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
      return [...c, { key: it.id, item_id: it.id, nama_obat: it.name, qty: 1, satuan: it.unit, harga: it.sell_price, jenis: "obat" }];
    });
  };
  const addJasa = () => {
    if (!jasaNama.trim()) return;
    setCart((c) => [...c, { key: `jasa-${c.length}-${jasaNama}`, item_id: null, nama_obat: jasaNama.trim(), qty: 1, satuan: "jasa", harga: jasaHarga, jenis: "jasa" }]);
    setJasaNama(""); setJasaHarga(0);
  };
  const setQty = (key: string, qty: number) => setCart((c) => c.map((r) => (r.key === key ? { ...r, qty: Math.max(1, qty) } : r)));
  const del = (key: string) => setCart((c) => c.filter((r) => r.key !== key));
  const clear = () => setCart([]);

  const subtotal = cart.reduce((a, r) => a + r.qty * r.harga, 0);
  const discountVal = Math.round((subtotal * discountPct) / 100);
  const ppn = 0; // ponytail: PPN 0% (display); tarif final ditentukan kasir saat pembayaran
  const total = Math.max(0, subtotal - discountVal + ppn);

  return (
    <form action={simpanRekamMedis}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="petId" value={petId} />
      <input type="hidden" name="resep" value={JSON.stringify(cart)} />
      <input type="hidden" name="catatan_resep" value={catatan} />

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* ================= KIRI: data pasien + pemeriksaan ================= */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>DATA PASIEN</div>

          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ width: 72, height: 72, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
              {patient.photo
                ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <i className="ti ti-paw" style={{ fontSize: 30, color: "var(--td)" }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
                <span className="bge b">{patient.species}{patient.breed ? ` / ${patient.breed}` : ""}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", marginTop: 6, fontSize: 10.5 }}>
                <MiniKV k="No. RM" v={patient.noRM} />
                <MiniKV k="Tgl Periksa" v={patient.tglPeriksa} />
                <MiniKV k="Pemilik" v={patient.owner} />
                <MiniKV k="Dokter" v={patient.dokter || "—"} />
                <MiniKV k="No. HP" v={patient.phone} />
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: "var(--tm)", minWidth: 62 }}>Kategori</span>
                  <span className="bge" style={{ background: "#f3f4f6", color: "#4b5563", fontWeight: 600 }}><i className="ti ti-award" style={{ marginRight: 3 }} />{patient.tier}</span>
                </div>
              </div>
            </div>
          </div>

          <ExamField icon="ti-message-2" color="#2563eb" label="Keluhan">
            <input className="fi" name="keluhan" defaultValue={patient.keluhan ?? ""} placeholder="Keluhan utama pasien" />
          </ExamField>
          <ExamField icon="ti-file-text" color="#2563eb" label="Anamnesa">
            <textarea className="fi" name="anamnesis" rows={2} placeholder="Riwayat & perjalanan penyakit" style={{ resize: "vertical" }} />
          </ExamField>
          <ExamField icon="ti-weight" color="#0891b2" label="Berat Badan">
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <input className="fi" name="berat" type="number" step="0.1" defaultValue={currentWeight ?? undefined} placeholder="12.5" style={{ borderRadius: "6px 0 0 6px" }} />
              <span style={{ background: "var(--sf1)", border: ".5px solid var(--bd)", borderLeft: "none", borderRadius: "0 6px 6px 0", padding: "6px 10px", fontSize: 11, color: "var(--tm)" }}>kg</span>
            </div>
          </ExamField>
          <ExamField icon="ti-temperature" color="#dc2626" label="Suhu Badan">
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <input className="fi" name="suhu" type="number" step="0.1" placeholder="39.5" style={{ borderRadius: "6px 0 0 6px" }} />
              <span style={{ background: "var(--sf1)", border: ".5px solid var(--bd)", borderLeft: "none", borderRadius: "0 6px 6px 0", padding: "6px 10px", fontSize: 11, color: "var(--tm)" }}>°C</span>
            </div>
          </ExamField>
          <ExamField icon="ti-activity" color="#16a34a" label="Gejala Klinis">
            <input className="fi" name="gejala_klinis" placeholder="mis. hidung berair, nafas cepat" />
          </ExamField>
          <ExamField icon="ti-flask" color="#7c3aed" label="Hasil Pemeriksaan Penunjang">
            <input className="fi" name="hasil_penunjang" placeholder="mis. Foto thorax normal" />
          </ExamField>
          <ExamField icon="ti-stethoscope" color="#2563eb" label="Diagnosa">
            <textarea className="fi" name="diagnosis" rows={2} placeholder="mis. ISPA (Infeksi Saluran Pernapasan Atas)" style={{ resize: "vertical" }} />
          </ExamField>
          <ExamField icon="ti-calendar-event" color="#d97706" label="Follow Up">
            <input className="fi" name="follow_up" placeholder="Rencana kontrol berikutnya" />
          </ExamField>
        </div>

        {/* ================= KANAN: POS obat & jasa ================= */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>
            <i className="ti ti-shopping-cart" style={{ color: "#2563eb" }} /> INPUT OBAT &amp; JASA (POS)
          </div>

          {/* Tab jenis */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {([["Obat", "ti-pill"], ["Jasa", "ti-stethoscope"], ["Paket", "ti-package"], ["Racikan", "ti-flask"]] as const).map(([t, ic]) => (
              <button key={t} type="button" onClick={() => setTab(t)} className="back-btn" style={{
                flex: 1, justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: ".5px solid var(--bd)", background: tab === t ? "#2563eb" : "#fff", color: tab === t ? "#fff" : "var(--tm)",
              }}><i className={`ti ${ic}`} /> {t}</button>
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
                  <div style={{ maxHeight: 340, overflowY: "auto", overflowX: "auto" }}>
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
                  <input className="fi" placeholder="Nama jasa (mis. Konsultasi, Scaling gigi)" value={jasaNama} onChange={(e) => setJasaNama(e.target.value)} />
                  <input className="fi" type="number" min={0} step={1000} placeholder="Harga" value={jasaHarga || ""} onChange={(e) => setJasaHarga(Number(e.target.value))} />
                  <button type="button" onClick={addJasa} className="btn-acc" style={{ background: "#2563eb", justifyContent: "center" }}><i className="ti ti-plus" /> Tambah jasa</button>
                </div>
              )}
              {tab === "Paket" && (
                <div style={{ fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Paket bundling — dalam pengembangan.</div>
              )}
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
                  <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 0" }}>Belum ada item. Tambah obat/jasa dari kiri.</div>
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
                            <div style={{ fontSize: 9, color: "var(--tm)" }}>{rp(r.harga)} · {r.satuan}</div>
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
                            <input className="fi" type="number" min={1} value={r.qty} onChange={(e) => setQty(r.key, Number(e.target.value))} style={{ width: 42, padding: "2px 4px", textAlign: "center", fontSize: 10.5 }} />
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
                <label className="flab">Catatan resep (aturan pakai)</label>
                <textarea className="fi" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. Amoxicillin 2x sehari 1 tablet…" style={{ resize: "vertical" }} />
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
                <div style={{ fontSize: 9, color: "var(--td)", marginTop: 6 }}>Harga & diskon final dikonfirmasi kasir di tahap pembayaran.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Aksi */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <SubmitButton className="btn-def" icon="ti-printer" name="next" value="resep" style={{ padding: "10px 20px", fontSize: 13 }} pendingText="Menyimpan…">Simpan &amp; Cetak Resep</SubmitButton>
        <SubmitButton className="btn-acc" icon="ti-bed" name="next" value="rawatinap" style={{ padding: "10px 20px", fontSize: 13, background: "#16a34a" }} pendingText="Menyimpan…">Simpan &amp; Lanjut Rawat Inap</SubmitButton>
      </div>
    </form>
  );
}

function MiniKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      <span style={{ color: "var(--tm)", minWidth: 62 }}>{k}</span>
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
