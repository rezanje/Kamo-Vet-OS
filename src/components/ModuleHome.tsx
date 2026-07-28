"use client";

import Link from "next/link";
import { MODULE_LABEL, TILES, type Tile } from "@/lib/nav";

function TileCard({ tile }: { tile: Tile }) {
  const inner = (
    <>
      {tile.p2 && <span className="ph2">Fase 2</span>}
      {tile.nw && <span className="nbdg">Baru</span>}
      <div className="ticon" style={{ background: tile.bg }}>
        <i className={`ti ${tile.icon}`} style={{ color: tile.fg }} />
      </div>
      <div className="tlabel">{tile.label}</div>
    </>
  );

  if (tile.href) {
    return (
      <Link href={tile.href} className="tile">
        {inner}
      </Link>
    );
  }

  const msg = tile.p2
    ? "Fitur ini tersedia di Fase 2."
    : `${tile.label} — halaman ini dalam pengembangan.`;
  return (
    <div
      className="tile"
      style={tile.p2 ? { opacity: 0.65 } : undefined}
      onClick={() => alert(msg)}
    >
      {inner}
    </div>
  );
}

// Deretan kotak menu saja (tanpa judul halaman) — dipakai modul yang halaman
// root-nya sudah punya konten sendiri (Penjualan, Pembelian) supaya submenunya
// tetap punya pintu masuk.
export function TileGrid({ moduleId }: { moduleId: string }) {
  const tiles = TILES[moduleId] ?? [];
  return (
    <div className="tile-grid">
      {tiles.map((t) => (
        <TileCard key={t.label} tile={t} />
      ))}
    </div>
  );
}

export function ModuleHome({ moduleId }: { moduleId: string }) {
  return (
    <>
      <div className="pg-hd">{MODULE_LABEL[moduleId]}</div>
      <div className="pg-sub">Pilih fitur yang ingin diakses</div>
      <TileGrid moduleId={moduleId} />
    </>
  );
}
