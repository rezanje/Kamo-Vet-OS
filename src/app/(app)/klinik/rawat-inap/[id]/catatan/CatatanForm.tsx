"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { addDailyLogPos } from "../../actions";

export type ItemLite = { id: string; name: string; unit: string; sell_price: number; stok: number };
type CartRow = { key: string; item_id: string | null; nama_obat: string; qty: number; satuan: string; harga: number; jenis: "obat" | "jasa" };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function CatatanForm({ recordId, backHref, patient, items }: {
  recordId: string; backHref: string;
  patient: { name: string; species: string; breed: string | null; noRM: string; owner: string; phone: string; address: string; tglMasuk: string; dokter: string; kondisi: string; photo: string | null };
  items: ItemLite[];
}) {
  const [tab, setTab] = useState<"Obat" | "Jasa" | "Paket">("Obat");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [catatan, setCatatan] = useState("");
  const [discount, setDiscount] = useState(0);
  const [jasaNama, setJasaNama] = useState("");
  const [jasaHarga, setJasaHarga] = useState(0);

  const filtered = useMemo(() => items.filter((it) => it.name.toLowerCase().includes(search.toLowerCase())).slice(0, 40), [items, search]);

  const addObat = (it: ItemLite) => setCart((c) => {
    const ex = c.find((r) => r.item_id === it.id);
    if (ex) return c.map((r) => (r.item_id === it.id ? { ...r, qty: r.qty + 1 } : r));
    return [...c, { key: it.id, item_id: it.id, nama_obat: it.name, qty: 1, satuan: it.unit, harga: it.sell_price, jenis: "obat" }];
  });
  const addJasa = () => {
    if (!jasaNama.trim()) return;
    setCart((c) => [...c, { key: `jasa-${c.length}-${jasaNama}`, item_id: null, nama_obat: jasaNama.trim(), qty: 1, satuan: "jasa", harga: jasaHarga, jenis: "jasa" }]);
    setJasaNama(""); setJasaHarga(0);
  };
  const setQty = (key: string, qty: number) => setCart((c) => c.map((r) => (r.key === key ? { ...r, qty: Math.max(1, qty) } : r)));
  const del = (key: string) => setCart((c) => c.filter((r) => r.key !== key));
  const clear = () => setCart([]);

  const subtotal = cart.reduce((a, r) => a + r.qty * r.harga, 0);
  const total = Math.max(0, subtotal - discount);

  return (
    <form action={addDailyLogPos}>
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="resep" value={JSON.stringify(cart)} />
      <input type="hidden" name="catatan_resep" value={catatan} />

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* ===== KIRI: data pasien + detail rawat inap ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>DATA PASIEN</div>
          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ width: 72, height: 72, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
              {patient.photo ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 30, color: "var(--td)" }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
                <span className="bge b">{patient.species}{patient.breed ? ` / ${patient.breed}` : ""}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", marginTop: 6, fontSize: 10.5 }}>
                <MiniKV k="No. RM" v={patient.noRM} />
                <MiniKV k="Tgl Masuk" v={patient.tglMasuk} />
                <MiniKV k="Pemilik" v={patient.owner} />
                <MiniKV k="Dokter PIC" v={patient.dokter || "—"} />
                <MiniKV k="No. HP" v={patient.phone} />
                <MiniKV k="Kondisi" v={patient.kondisi} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 16, color: "#2563eb" }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#2563eb" }}>DETAIL RAWAT INAP</span>
          </div>

          <div className="frow">
            <div>
              <label className="flab">Kondisi pasien *</label>
              <textarea className="fi" name="condition_note" required rows={2} placeholder="mis. Lemas, batuk, nafsu makan menurun, suhu 39,5°C" style={{ resize: "vertical" }} />
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
          <div className="fg" style={{ marginTop: 8 }}>
            <label className="flab">Tindakan / perawatan</label>
            <textarea className="fi" name="tindakan" rows={2} placeholder="mis. Terapi cairan, injeksi, pemberian obat, observasi" style={{ resize: "vertical" }} />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={2} placeholder="mis. Pasien mulai menunjukkan respons baik" style={{ resize: "vertical" }} />
          </div>
          <div className="fg">
            <label className="flab">Oleh dokter</label>
            <input className="fi" name="doctor_name" defaultValue={patient.dokter} placeholder="Drh. ..." />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
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
            {(["Obat", "Jasa", "Paket"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className="back-btn" style={{
                flex: 1, justifyContent: "center", padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: ".5px solid var(--bd)", background: tab === t ? "#2563eb" : "#fff", color: tab === t ? "#fff" : "var(--tm)",
              }}>{t}</button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
            <div>
              {tab === "Obat" && (
                <>
                  <input className="fi" placeholder="Cari nama obat…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
                  <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                    {filtered.length === 0 && <div style={{ fontSize: 11, color: "var(--td)", padding: "8px 0" }}>Tidak ada obat.</div>}
                    {filtered.map((it) => (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, border: ".5px solid var(--bd)", borderRadius: 8, padding: "7px 9px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                          <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Stok {it.stok} {it.unit} · {rp(it.sell_price)}</div>
                        </div>
                        <button type="button" onClick={() => addObat(it)} className="btn-acc" style={{ padding: "3px 8px", fontSize: 11, background: "#16a34a" }}><i className="ti ti-plus" /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {tab === "Jasa" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input className="fi" placeholder="Nama jasa (mis. Rawat inap/hari)" value={jasaNama} onChange={(e) => setJasaNama(e.target.value)} />
                  <input className="fi" type="number" min={0} step={1000} placeholder="Harga" value={jasaHarga || ""} onChange={(e) => setJasaHarga(Number(e.target.value))} />
                  <button type="button" onClick={addJasa} className="btn-acc" style={{ background: "#16a34a", justifyContent: "center" }}><i className="ti ti-plus" /> Tambah jasa</button>
                </div>
              )}
              {tab === "Paket" && <div style={{ fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Paket bundling — dalam pengembangan.</div>}
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#2563eb" }}>KERANJANG ({cart.length})</span>
                {cart.length > 0 && <button type="button" onClick={clear} className="back-btn" style={{ fontSize: 10, color: "#b91c1c" }}>Hapus semua</button>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, minHeight: 60 }}>
                {cart.length === 0 && <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 0" }}>Belum ada item.</div>}
                {cart.map((r) => (
                  <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 6, borderBottom: ".5px solid var(--bd)", paddingBottom: 5 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.nama_obat}</div>
                      <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{rp(r.harga)} · {r.satuan}</div>
                    </div>
                    <input className="fi" type="number" min={1} value={r.qty} onChange={(e) => setQty(r.key, Number(e.target.value))} style={{ width: 46, padding: "3px 5px", textAlign: "center" }} />
                    <span style={{ fontSize: 10.5, fontWeight: 600, width: 62, textAlign: "right" }}>{rp(r.qty * r.harga)}</span>
                    <button type="button" onClick={() => del(r.key)} className="back-btn" style={{ color: "#b91c1c" }}><i className="ti ti-x" /></button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 10 }}>
                <label className="flab">Catatan resep / keterangan</label>
                <textarea className="fi" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Aturan pakai obat…" style={{ resize: "vertical" }} />
              </div>

              <div style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}><span style={{ color: "var(--tm)" }}>Subtotal</span><span style={{ fontWeight: 500 }}>{rp(subtotal)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--tm)" }}>Diskon</span>
                  <input className="fi" type="number" min={0} step={1000} value={discount || ""} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 90, padding: "3px 6px", textAlign: "right" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 0", borderTop: "1px solid var(--bd)", marginTop: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>TOTAL</span>
                  <span style={{ fontSize: 17, fontWeight: 800, color: "#2563eb" }}>{rp(total)}</span>
                </div>
                <div style={{ fontSize: 9, color: "var(--td)", marginTop: 6 }}>Obat & jasa masuk resep visit → ikut tagihan saat pasien pulang.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 6, marginTop: 12 }}>
                <SubmitButton className="btn-def" icon="ti-printer" name="cetak" value="1" pendingText="…" style={{ padding: "9px 0", fontSize: 11.5 }}>Simpan &amp; Cetak</SubmitButton>
                <SubmitButton className="kpos-bayar" icon="ti-circle-check" name="cetak" value="0" pendingText="Menyimpan…">Simpan Catatan &amp; Lanjut</SubmitButton>
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
      <span style={{ color: "var(--tm)", minWidth: 60 }}>{k}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>: {v}</span>
    </div>
  );
}
