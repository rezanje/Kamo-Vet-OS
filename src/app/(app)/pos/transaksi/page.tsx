"use client";

import Link from "next/link";

// ponytail: static prototype POS. Wires to items + stock + sales when the
// POS/Inventory module is built.
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const PRODS: [string, number][] = [
  ["Royal Canin Mini 4kg", 285000],
  ["Vetflox 100ml", 45000],
  ["Pasir Toffu 7L", 95000],
  ["Whiskas Pouch", 8500],
  ["Grooming Shampoo", 75000],
  ["Collar Kucing S", 35000],
  ["Pedigree Adult 3kg", 120000],
  ["Ivermectin 10ml", 28000],
];

const CART: [string, number, number][] = [
  ["Royal Canin Mini 4kg", 2, 285000],
  ["Grooming Shampoo", 1, 75000],
];

export default function PosPage() {
  const sub = CART.reduce((a, i) => a + i[1] * i[2], 0);
  const total = sub - 1500;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Link href="/pos" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Transaksi POS — VET CMGG</span>
      </div>

      <div style={{ marginBottom: 9, display: "flex", gap: 7 }}>
        <input
          className="fi"
          placeholder="Cari produk atau scan barcode..."
          style={{ flex: 1 }}
        />
        <select className="fi" style={{ width: 120 }}>
          <option>Semua</option>
          <option>Makanan</option>
          <option>Obat</option>
          <option>Aksesoris</option>
          <option>Grooming</option>
        </select>
      </div>

      <div className="pos-wrap">
        <div>
          <div className="pos-pgrid">
            {PRODS.map((p) => (
              <div key={p[0]} className="pos-p">
                <i className="ti ti-package" style={{ fontSize: 20, color: "var(--td)" }} />
                <div className="pos-pn">{p[0]}</div>
                <div className="pos-pp">{rp(p[1])}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="cart">
          <div style={{ fontSize: 12, fontWeight: 500 }}>
            <i
              className="ti ti-shopping-cart"
              style={{ fontSize: 14, verticalAlign: -1, color: "var(--acc)", marginRight: 5 }}
            />
            Keranjang ({CART.length} item)
          </div>
          <input className="fi" placeholder="Cari pelanggan / member..." />
          {CART.map((i) => (
            <div key={i[0]} className="ci">
              <div style={{ flex: 1, fontSize: 10.5 }}>{i[0]}</div>
              <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{i[1]}×</div>
              <div style={{ fontSize: 10.5, minWidth: 65, textAlign: "right" }}>
                {rp(i[1] * i[2])}
              </div>
            </div>
          ))}
          <div style={{ borderTop: ".5px solid var(--bd)", paddingTop: 7 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "var(--tm)",
                marginBottom: 3,
              }}
            >
              <span>Subtotal</span>
              <span>{rp(sub)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "#16a34a",
                marginBottom: 8,
              }}
            >
              <span>Poin member (150 poin)</span>
              <span>-Rp 1.500</span>
            </div>
            <div
              style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}
            >
              <span style={{ fontSize: 12, fontWeight: 500 }}>Total</span>
              <span style={{ fontSize: 17, fontWeight: 500 }}>{rp(total)}</span>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 5,
              marginBottom: 7,
            }}
          >
            <button className="btn-def" style={{ fontSize: 11 }}>
              <i className="ti ti-cash" style={{ fontSize: 12, verticalAlign: -1 }} /> Tunai
            </button>
            <button
              style={{
                padding: 7,
                border: "2px solid var(--acc)",
                borderRadius: 6,
                background: "#fdf0ea",
                cursor: "pointer",
                fontSize: 11,
                color: "#b55a35",
                fontWeight: 500,
              }}
            >
              <i className="ti ti-qrcode" style={{ fontSize: 12, verticalAlign: -1 }} /> QRIS
            </button>
          </div>
          <button
            className="pay-btn"
            onClick={() => alert("Transaksi berhasil!\nStruk dikirim via WA ke pelanggan.")}
          >
            Bayar {rp(total)}
          </button>
        </div>
      </div>
    </>
  );
}
