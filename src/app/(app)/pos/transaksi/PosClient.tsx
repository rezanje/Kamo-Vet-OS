"use client";

import { useMemo, useState } from "react";
import { checkoutSale } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export type Item = { id: string; name: string; sell_price: number; target_species: string };
export type Pet = { id: string; name: string; species: string | null };
export type Cust = { id: string; name: string; phone: string; points: number; pets: Pet[] };
type Branch = { id: string; code: string; name: string };
type Line = { item_id: string; nama: string; qty: number; harga: number; target_species: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function PosClient({ items, customers, branches }: { items: Item[]; customers: Cust[]; branches: Branch[] }) {
  const [branchId, setBranchId] = useState("");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [custQ, setCustQ] = useState("");
  const [cust, setCust] = useState<Cust | null>(null);
  const [petId, setPetId] = useState<string>("");
  const [metode, setMetode] = useState("Tunai");
  const [discount, setDiscount] = useState(0);
  const [bayar, setBayar] = useState(0);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.name.toLowerCase().includes(s)) : items;
  }, [items, q]);

  const custHits = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s)).slice(0, 5);
  }, [customers, custQ]);

  const add = (it: Item) =>
    setCart((c) => {
      const ex = c.find((l) => l.item_id === it.id);
      if (ex) return c.map((l) => (l.item_id === it.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { item_id: it.id, nama: it.name, qty: 1, harga: it.sell_price, target_species: it.target_species }];
    });
  const setQty = (id: string, d: number) =>
    setCart((c) => c.flatMap((l) => (l.item_id === id ? (l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }]) : [l])));
  const remove = (id: string) => setCart((c) => c.filter((l) => l.item_id !== id));

  const subtotal = cart.reduce((a, l) => a + l.qty * l.harga, 0);
  const total = Math.max(0, subtotal - discount);
  const kembali = Math.max(0, bayar - total);
  const poin = cust ? Math.floor(total / 1000) : 0;
  const kurang = metode === "Tunai" && bayar < total;
  const canPay = branchId && cart.length > 0 && !kurang;

  const pickCust = (c: Cust) => { setCust(c); setCustQ(c.name); setPetId(""); };
  const clearCust = () => { setCust(null); setCustQ(""); setPetId(""); };

  return (
    <form action={checkoutSale}>
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="customerId" value={cust?.id ?? ""} />
      <input type="hidden" name="petId" value={petId} />
      <input type="hidden" name="metode" value={metode} />
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="bayar" value={bayar} />
      <input type="hidden" name="cart" value={JSON.stringify(cart)} />

      <div style={{ marginBottom: 9, display: "flex", gap: 7 }}>
        <select className="fi" value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ width: 220 }} required>
          <option value="">Pilih cabang *</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="fi" placeholder="Cari produk..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>

      <div className="pos-wrap">
        <div>
          <div className="pos-pgrid">
            {shown.map((it) => (
              <div key={it.id} className="pos-p" onClick={() => add(it)}>
                <i className="ti ti-package" style={{ fontSize: 20, color: "var(--td)" }} />
                <div className="pos-pn">{it.name}</div>
                <div className="pos-pp">{rp(it.sell_price)}</div>
                <div style={{ fontSize: 8, color: "var(--td)", marginTop: 2 }}>{it.target_species}</div>
              </div>
            ))}
            {shown.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--td)", fontSize: 11, padding: 20 }}>Produk tidak ditemukan.</div>}
          </div>
        </div>

        <div className="cart">
          <div style={{ fontSize: 12, fontWeight: 500 }}>
            <i className="ti ti-shopping-cart" style={{ fontSize: 14, verticalAlign: -1, color: "var(--acc)", marginRight: 5 }} />
            Keranjang ({cart.length})
          </div>

          {/* Pelanggan */}
          <div style={{ position: "relative" }}>
            <input className="fi" placeholder="Cari pelanggan / member..." value={custQ}
              onChange={(e) => { setCustQ(e.target.value); setCust(null); }} />
            {cust && <i className="ti ti-x" onClick={clearCust} style={{ position: "absolute", right: 8, top: 8, cursor: "pointer", color: "var(--td)", fontSize: 13 }} />}
            {!cust && custHits.length > 0 && (
              <div style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, background: "#fff", border: ".5px solid var(--bd)", borderRadius: 6, marginTop: 2, boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}>
                {custHits.map((c) => (
                  <div key={c.id} onClick={() => pickCust(c)} style={{ padding: "6px 9px", cursor: "pointer", fontSize: 11, borderBottom: ".5px solid var(--bd)" }}>
                    {c.name} <span style={{ color: "var(--td)" }}>· {c.phone}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {cust && (
            <div style={{ fontSize: 10, color: "var(--tm)" }}>
              {cust.points.toLocaleString("id-ID")} poin
              {cust.pets.length > 0 && (
                <span style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                  {cust.pets.map((p) => (
                    <button type="button" key={p.id} onClick={() => setPetId(petId === p.id ? "" : p.id)}
                      style={{ padding: "2px 7px", borderRadius: 20, border: ".5px solid var(--bd)", cursor: "pointer", fontSize: 9.5,
                        background: petId === p.id ? "var(--sb)" : "#fff", color: petId === p.id ? "#fff" : "var(--tm)" }}>
                      {p.name} ({p.species})
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}

          {/* Items */}
          {cart.map((l) => (
            <div key={l.item_id} className="ci">
              <div style={{ flex: 1, fontSize: 10.5 }}>{l.nama}</div>
              <button type="button" onClick={() => setQty(l.item_id, -1)} className="back-btn" style={{ fontSize: 12 }}><i className="ti ti-minus" /></button>
              <span style={{ fontSize: 10.5, minWidth: 14, textAlign: "center" }}>{l.qty}</span>
              <button type="button" onClick={() => setQty(l.item_id, 1)} className="back-btn" style={{ fontSize: 12 }}><i className="ti ti-plus" /></button>
              <div style={{ fontSize: 10.5, minWidth: 62, textAlign: "right" }}>{rp(l.qty * l.harga)}</div>
              <button type="button" onClick={() => remove(l.item_id)} className="back-btn" style={{ color: "#b91c1c" }}><i className="ti ti-trash" /></button>
            </div>
          ))}
          {cart.length === 0 && <div style={{ fontSize: 10.5, color: "var(--td)", textAlign: "center", padding: "8px 0" }}>Klik produk untuk menambah.</div>}

          {/* Totals */}
          <div style={{ borderTop: ".5px solid var(--bd)", paddingTop: 7 }}>
            <Row k="Subtotal" v={rp(subtotal)} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, color: "var(--tm)", margin: "3px 0" }}>
              <span>Diskon</span>
              <input className="fi" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 90, textAlign: "right", padding: "3px 6px" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0" }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>Total</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: "var(--acc)" }}>{rp(total)}</span>
            </div>
            {cust && <div style={{ fontSize: 9.5, color: "#16a34a", textAlign: "right" }}>+{poin} poin untuk {cust.name.split(" ")[0]}</div>}
          </div>

          {/* Metode */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            {["Tunai", "QRIS", "Transfer"].map((m) => (
              <button type="button" key={m} onClick={() => setMetode(m)} className="back-btn"
                style={{ padding: "5px 0", justifyContent: "center", borderRadius: 6, border: ".5px solid var(--bd)", fontSize: 10.5,
                  background: metode === m ? "var(--sb)" : "#fff", color: metode === m ? "#fff" : "var(--tm)" }}>{m}</button>
            ))}
          </div>
          {metode === "Tunai" && (
            <div style={{ marginTop: 6 }}>
              <input className="fi" type="number" min={0} placeholder="Uang dibayar" value={bayar || ""} onChange={(e) => setBayar(Number(e.target.value))} />
              {bayar > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4, color: kurang ? "#b91c1c" : "#16a34a" }}>
                <span>{kurang ? "Kurang" : "Kembali"}</span><span>{rp(kurang ? total - bayar : kembali)}</span>
              </div>}
            </div>
          )}

          <SubmitButton className="pay-btn" icon="ti-circle-check" disabled={!canPay} style={{ marginTop: 8, opacity: canPay ? 1 : 0.5 }} pendingText="Memproses…">Bayar {rp(total)}</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--tm)" }}><span>{k}</span><span>{v}</span></div>;
}
