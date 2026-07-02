"use client";

import { useMemo, useState } from "react";
import { checkoutKasir, simpanDraft, hapusDraft } from "./checkout";

export type ItemRow = { id: string; code: string; name: string; harga: number; kategori: string; stok: number };
export type CustRow = { id: string; name: string; phone: string; points: number; tier: string | null; keanggotaan: string; trx: number };
export type DraftRow = { id: string; customer_id: string | null; cart: CartLine[]; created_at: string };
export type VoucherRow = { code: string; tipe: string; nilai: number };
type CartLine = { item_id: string; nama: string; qty: number; harga: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const TIER_BADGE: Record<string, { bg: string; color: string }> = {
  Bronze: { bg: "#fef3c7", color: "#92400e" },
  Silver: { bg: "#f3f4f6", color: "#4b5563" },
  Gold: { bg: "#fef9c3", color: "#713f12" },
  Platinum: { bg: "#ede9fe", color: "#5b21b6" },
};

export function KasirClient({ branchName, items, customers, drafts, vouchers, error }: {
  branchName: string; items: ItemRow[]; customers: CustRow[]; drafts: DraftRow[]; vouchers: VoucherRow[]; error?: string;
}) {
  const [q, setQ] = useState("");
  const [kat, setKat] = useState("Semua");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [custQ, setCustQ] = useState("");
  const [cust, setCust] = useState<CustRow | null>(null);
  const [diskon, setDiskon] = useState(0);
  const [diskonPct, setDiskonPct] = useState(false);
  const [poin, setPoin] = useState(0);
  const [voucher, setVoucher] = useState("");
  const [metode, setMetode] = useState("Tunai");
  const [bayar, setBayar] = useState(0);
  const [draftId, setDraftId] = useState<string | null>(null);

  const kategoris = useMemo(() => ["Semua", ...new Set(items.map((i) => i.kategori))], [items]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) =>
      (kat === "Semua" || i.kategori === kat) &&
      (!s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s))
    );
  }, [items, q, kat]);

  const custHits = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s || cust) return [];
    return customers.filter((c) => c.phone.replace(/\D/g, "").includes(s.replace(/\D/g, "")) || c.name.toLowerCase().includes(s)).slice(0, 5);
  }, [customers, custQ, cust]);

  const add = (it: ItemRow) =>
    setCart((c) => {
      const ex = c.find((l) => l.item_id === it.id);
      if (ex) return c.map((l) => (l.item_id === it.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { item_id: it.id, nama: it.name, qty: 1, harga: it.harga }];
    });
  const setQty = (id: string, d: number) =>
    setCart((c) => c.flatMap((l) => (l.item_id === id ? (l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }]) : [l])));

  const subtotal = cart.reduce((a, l) => a + l.qty * l.harga, 0);
  const diskonVal = diskonPct ? Math.round((subtotal * diskon) / 100) : diskon;
  const v = vouchers.find((x) => x.code === voucher.trim().toUpperCase());
  const voucherVal = v ? (v.tipe === "persen" ? Math.round((subtotal * Number(v.nilai)) / 100) : Number(v.nilai)) : 0;
  const voucherInvalid = voucher.trim() !== "" && !v;
  const maxPoin = cust ? Math.min(cust.points, Math.max(0, subtotal - diskonVal - voucherVal)) : 0;
  const poinUsed = Math.min(poin, maxPoin);
  const total = Math.max(0, subtotal - diskonVal - voucherVal - poinUsed);
  const kembali = Math.max(0, bayar - total);
  const kurang = metode === "Tunai" && bayar < total;
  const canPay = cart.length > 0 && !kurang && !voucherInvalid;

  const loadDraft = (d: DraftRow) => {
    setCart(d.cart ?? []);
    setDraftId(d.id);
    const c = customers.find((x) => x.id === d.customer_id) ?? null;
    setCust(c);
    setCustQ(c?.name ?? "");
  };

  return (
    <>
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {/* DATA CUSTOMER strip */}
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ minWidth: 230, position: "relative" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--sb)", letterSpacing: ".05em", marginBottom: 4 }}>DATA CUSTOMER</div>
          <div style={{ position: "relative" }}>
            <input className="fi" placeholder="Masukkan nomor HP / nama..." value={custQ}
              onChange={(e) => { setCustQ(e.target.value); setCust(null); setPoin(0); }} />
            {cust && <i className="ti ti-x" onClick={() => { setCust(null); setCustQ(""); setPoin(0); }}
              style={{ position: "absolute", right: 8, top: 8, cursor: "pointer", color: "var(--td)" }} />}
          </div>
          {custHits.length > 0 && (
            <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "#fff", border: ".5px solid var(--bd)", borderRadius: 7, marginTop: 3, boxShadow: "0 4px 12px rgba(0,0,0,.12)" }}>
              {custHits.map((c) => (
                <div key={c.id} onClick={() => { setCust(c); setCustQ(c.name); }}
                  style={{ padding: "7px 10px", cursor: "pointer", fontSize: 11.5, borderBottom: ".5px solid var(--bd)" }}>
                  {c.name} <span style={{ color: "var(--td)" }}>· {c.phone}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {cust ? (
          <>
            <CustStat icon="ti-user" label={cust.name} sub={cust.phone} />
            <CustStat icon="ti-star" label={`${cust.points.toLocaleString("id-ID")} Poin`} sub="Jumlah poin" accent />
            <div>
              <span className="bge" style={{ ...(TIER_BADGE[cust.tier ?? ""] ?? { bg: "#f3f4f6", color: "#6b7280" }), fontSize: 11, padding: "3px 12px" }}>
                <i className="ti ti-crown" style={{ marginRight: 4 }} />{cust.keanggotaan === "Member" ? cust.tier ?? "Member" : "Non Member"}
              </span>
              <div style={{ fontSize: 9, color: "var(--td)", marginTop: 3, textAlign: "center" }}>Kategori</div>
            </div>
            <CustStat icon="ti-shopping-bag" label={`${cust.trx}`} sub="Total transaksi" />
          </>
        ) : (
          <span style={{ fontSize: 11, color: "var(--td)" }}>Transaksi umum (tanpa member) — cari pelanggan untuk poin & tier.</span>
        )}
        {drafts.length > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ fontSize: 9.5, color: "var(--tm)" }}>Draft:</span>
            {drafts.slice(0, 3).map((d, i) => (
              <span key={d.id} style={{ display: "inline-flex", gap: 4 }}>
                <button type="button" onClick={() => loadDraft(d)} className="btn-def" style={{ padding: "3px 9px", fontSize: 10 }}>
                  <i className="ti ti-file-import" /> #{i + 1} ({(d.cart ?? []).length} item)
                </button>
                <form action={hapusDraft}>
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" className="back-btn" style={{ color: "#b91c1c", fontSize: 11 }} title="Hapus draft"><i className="ti ti-trash" /></button>
                </form>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 12, alignItems: "start" }}>
        {/* DAFTAR PRODUK */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "11px 13px", borderBottom: ".5px solid var(--bd)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em" }}>DAFTAR PRODUK</span>
            <span style={{ fontSize: 9.5, color: "var(--td)" }}>{branchName}</span>
            <div style={{ marginLeft: "auto", position: "relative", width: 220 }}>
              <input className="fi" placeholder="Cari nama / kode barang..." value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: 11, paddingRight: 26 }} />
              <i className="ti ti-search" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 12 }} />
            </div>
          </div>
          <div style={{ padding: "8px 13px 0", display: "flex", gap: 4, flexWrap: "wrap" }}>
            {kategoris.map((k) => (
              <button key={k} type="button" onClick={() => setKat(k)} className="back-btn"
                style={{ padding: "4px 11px", borderRadius: 20, fontSize: 10.5, border: ".5px solid var(--bd)",
                  background: kat === k ? "var(--sb)" : "#fff", color: kat === k ? "#fff" : "var(--tm)" }}>
                {k}
              </button>
            ))}
          </div>
          <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th>Kode</th><th>Nama Barang</th><th>Kategori</th><th style={{ textAlign: "right" }}>Harga</th><th style={{ textAlign: "center" }}>Stok</th><th style={{ width: 40 }} /></tr>
              </thead>
              <tbody>
                {shown.map((it) => (
                  <tr key={it.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{it.code}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.name}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.kategori}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(it.harga)}</td>
                    <td style={{ textAlign: "center", fontSize: 11, color: it.stok <= 0 ? "#b91c1c" : it.stok < 10 ? "#b55a35" : "var(--tm)" }}>{it.stok}</td>
                    <td style={{ textAlign: "center" }}>
                      <button type="button" onClick={() => add(it)} className="btn-acc" style={{ padding: "3px 8px", fontSize: 11 }} title="Tambah"><i className="ti ti-plus" /></button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Produk tidak ditemukan.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* KERANJANG BELANJA */}
        <form action={checkoutKasir} className="card">
          <input type="hidden" name="customerId" value={cust?.id ?? ""} />
          <input type="hidden" name="cart" value={JSON.stringify(cart)} />
          <input type="hidden" name="diskon" value={diskonVal} />
          <input type="hidden" name="poinDigunakan" value={poinUsed} />
          <input type="hidden" name="voucherCode" value={v ? v.code : ""} />
          <input type="hidden" name="metode" value={metode} />
          <input type="hidden" name="bayar" value={bayar} />
          {draftId && <input type="hidden" name="draftId" value={draftId} />}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em" }}>KERANJANG BELANJA</span>
            {cart.length > 0 && (
              <button type="button" onClick={() => { setCart([]); setDraftId(null); }} className="back-btn" style={{ color: "#b91c1c", fontSize: 10.5 }}>
                <i className="ti ti-trash" /> Kosongkan
              </button>
            )}
          </div>

          <div style={{ maxHeight: 190, overflowY: "auto", marginBottom: 8 }}>
            {cart.map((l) => (
              <div key={l.item_id} className="ci">
                <div style={{ flex: 1, fontSize: 10.5 }}>{l.nama}<div style={{ fontSize: 9.5, color: "var(--td)" }}>{rp(l.harga)}</div></div>
                <button type="button" onClick={() => setQty(l.item_id, -1)} className="back-btn"><i className="ti ti-minus" /></button>
                <span style={{ fontSize: 11, minWidth: 16, textAlign: "center" }}>{l.qty}</span>
                <button type="button" onClick={() => setQty(l.item_id, 1)} className="back-btn"><i className="ti ti-plus" /></button>
                <div style={{ fontSize: 10.5, minWidth: 64, textAlign: "right", fontWeight: 500 }}>{rp(l.qty * l.harga)}</div>
              </div>
            ))}
            {cart.length === 0 && <div style={{ fontSize: 10.5, color: "var(--td)", textAlign: "center", padding: "16px 0" }}>Klik <i className="ti ti-plus" /> pada produk untuk menambah.</div>}
          </div>

          <div style={{ borderTop: ".5px solid var(--bd)", paddingTop: 8 }}>
            <Row k={`Total item`} v={`${cart.reduce((a, l) => a + l.qty, 0)}`} />
            <Row k="Subtotal" v={rp(subtotal)} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0", gap: 6 }}>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Diskon</span>
              <span style={{ display: "flex", gap: 4 }}>
                <input className="fi" type="number" min={0} value={diskon || ""} onChange={(e) => setDiskon(Number(e.target.value))} placeholder="0" style={{ width: 90, padding: "3px 7px", textAlign: "right", fontSize: 11 }} />
                <button type="button" onClick={() => setDiskonPct(!diskonPct)} className="btn-def" style={{ padding: "2px 8px", fontSize: 10 }}>{diskonPct ? "%" : "Rp"}</button>
              </span>
            </div>
            {diskonVal > 0 && <Row k="" v={`- ${rp(diskonVal)}`} red />}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0" }}>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Poin digunakan {cust ? `(maks ${maxPoin.toLocaleString("id-ID")})` : ""}</span>
              <input className="fi" type="number" min={0} max={maxPoin} value={poin || ""} disabled={!cust}
                onChange={(e) => setPoin(Number(e.target.value))} placeholder="0" style={{ width: 90, padding: "3px 7px", textAlign: "right", fontSize: 11 }} />
            </div>
            {poinUsed > 0 && <Row k="" v={`- ${rp(poinUsed)}`} red />}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0" }}>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Kode voucher</span>
              <input className="fi" value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="mis. HEMAT10"
                style={{ width: 110, padding: "3px 7px", fontSize: 11, textTransform: "uppercase", borderColor: voucherInvalid ? "#fca5a5" : undefined }} />
            </div>
            {voucherVal > 0 && <Row k="" v={`- ${rp(voucherVal)}`} red />}
            {voucherInvalid && <div style={{ fontSize: 9.5, color: "#b91c1c", textAlign: "right" }}>Kode tidak dikenal</div>}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0", paddingTop: 6, borderTop: "1px solid var(--bd)" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--sb)" }}>TOTAL</span>
              <span style={{ fontSize: 19, fontWeight: 800, color: "var(--sb)" }}>{rp(total)}</span>
            </div>

            <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em", marginBottom: 5 }}>METODE PEMBAYARAN</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 8 }}>
              {[
                { m: "Tunai", ic: "ti-cash" },
                { m: "Debit", ic: "ti-credit-card" },
                { m: "QRIS", ic: "ti-qrcode" },
                { m: "E-Wallet", ic: "ti-wallet" },
              ].map(({ m, ic }) => (
                <button key={m} type="button" onClick={() => setMetode(m)} className="back-btn"
                  style={{ padding: "7px 0", justifyContent: "center", borderRadius: 7, fontSize: 11, border: metode === m ? "1.5px solid var(--sb)" : ".5px solid var(--bd)",
                    background: metode === m ? "#eff6ff" : "#fff", color: metode === m ? "var(--sb)" : "var(--tm)", fontWeight: metode === m ? 600 : 400 }}>
                  <i className={`ti ${ic}`} style={{ marginRight: 4 }} /> {m}
                </button>
              ))}
            </div>

            {metode === "Tunai" && (
              <div style={{ marginBottom: 8 }}>
                <input className="fi" type="number" min={0} placeholder="Uang bayar" value={bayar || ""} onChange={(e) => setBayar(Number(e.target.value))} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4, color: kurang ? "#b91c1c" : "#15803d" }}>
                  <span>{kurang ? "Kurang" : "Kembalian"}</span><span>{rp(kurang ? total - bayar : kembali)}</span>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 6 }}>
              <button type="submit" formAction={simpanDraft} className="btn-def" style={{ padding: "9px 0", fontSize: 11.5 }} disabled={cart.length === 0}>
                <i className="ti ti-device-floppy" /> Simpan Draft
              </button>
              <button type="submit" className="pay-btn" disabled={!canPay} style={{ opacity: canPay ? 1 : 0.5, cursor: canPay ? "pointer" : "not-allowed" }}>
                <i className="ti ti-circle-check" /> Bayar {rp(total)}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

function CustStat({ icon, label, sub, accent }: { icon: string; label: string; sub: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <i className={`ti ${icon}`} style={{ fontSize: 18, color: accent ? "var(--acc)" : "var(--sb)" }} />
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 9, color: "var(--td)" }}>{sub}</div>
      </div>
    </div>
  );
}
function Row({ k, v, red }: { k: string; v: string; red?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: red ? "#b91c1c" : "var(--tm)", margin: "2px 0" }}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
