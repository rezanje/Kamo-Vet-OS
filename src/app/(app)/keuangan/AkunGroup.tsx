// Baris akun laporan keuangan yang menautkan ke buku besarnya.
//
// Dipakai Laba Rugi & Neraca supaya pertanyaan "angka ini dari mana?" cukup satu
// klik — tautannya membawa periode & cabang yang sedang dilihat, jadi angka di
// laporan dan di buku besar dijamin sama.

import Link from "next/link";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export type BarisAkun = { code: string; name: string; saldo: number };

export function AkunGroup({ title, rows, hrefAkun }: {
  title?: string;
  rows: BarisAkun[];
  hrefAkun: (code: string) => string;
}) {
  return (
    <div>
      {title && (
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", margin: "4px 0 6px" }}>{title}</div>
      )}
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--td)", padding: "2px 0" }}>—</div>
      ) : (
        rows.map((r) => (
          <Link key={r.code} href={hrefAkun(r.code)}
            title={`Lihat mutasi ${r.code} ${r.name} di buku besar`}
            style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: ".5px solid var(--bd)", color: "inherit", textDecoration: "none" }}>
            <span>
              <span style={{ color: "var(--td)", fontFamily: "monospace", fontSize: 10, marginRight: 6 }}>{r.code}</span>
              <span style={{ borderBottom: "1px dotted var(--td)" }}>{r.name}</span>
              <i className="ti ti-external-link" style={{ fontSize: 11, color: "var(--td)", marginLeft: 5 }} />
            </span>
            <span>{rp(r.saldo)}</span>
          </Link>
        ))
      )}
    </div>
  );
}

/** Petunjuk kecil di atas daftar akun — kalau tidak diberi tahu, orang tidak tahu barisnya bisa diklik. */
export function PetunjukKlikAkun() {
  return (
    <div style={{ fontSize: 10, color: "var(--tm)", marginBottom: 8 }}>
      <i className="ti ti-info-circle" /> Klik nama akun untuk melihat rincian mutasinya di buku besar.
    </div>
  );
}

/** Tautan ke buku besar satu akun, membawa periode & cabang laporan. */
export function bikinHrefAkun(f: { dari?: string; sampai?: string; cabang?: string }) {
  return (code: string) => {
    const q = new URLSearchParams({ akun: code });
    if (f.dari) q.set("dari", f.dari);
    if (f.sampai) q.set("sampai", f.sampai);
    if (f.cabang) q.set("cabang", f.cabang);
    return `/keuangan/buku-besar?${q.toString()}`;
  };
}
