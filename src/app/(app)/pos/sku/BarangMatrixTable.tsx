"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import {
  ACCURATE_MATRIX_COLUMNS,
  type AccurateMatrixColumn,
} from "@/lib/accurate-matrix";
import { kategoriWajibConsent } from "@/lib/tindakan";
import type { ItemUnit } from "@/lib/satuan";
import { toggleBarang } from "./actions";

export type BarangMatrixRow = {
  id: string;
  name: string;
  code: string | null;
  item_type: string;
  category_name: string | null;
  brand_name: string | null;
  unit: string;
  units: ItemUnit[];
  sell_price: number;
  buy_price: number;
  min_stock: number;
  supplier_name: string | null;
  buy_unit: string | null;
  min_buy: number;
  upc: string | null;
  track_expiry: boolean;
  default_discount: number;
  is_active: boolean;
  tindakan_kategori: string | null;
};

const ALL_COLUMNS: AccurateMatrixColumn[] = ACCURATE_MATRIX_COLUMNS.map((column) => column.key);
const COMPACT_COLUMNS: AccurateMatrixColumn[] = [
  "item_type", "category_name", "brand_name", "unit", "sell_price", "is_active",
];

const columnWidth: Record<AccurateMatrixColumn, number> = {
  item_type: 112,
  category_name: 150,
  brand_name: 120,
  unit: 100,
  extra_units: 220,
  sell_price: 118,
  buy_price: 118,
  min_stock: 130,
  supplier_name: 150,
  buy_unit: 100,
  min_buy: 110,
  upc: 135,
  track_expiry: 130,
  default_discount: 120,
  is_active: 92,
};

const rp = (value: number) => "Rp " + Math.round(value).toLocaleString("id-ID");
const qty = (value: number) => Number(value).toLocaleString("id-ID", { maximumFractionDigits: 4 });

function MatrixValue({ row, column }: { row: BarangMatrixRow; column: AccurateMatrixColumn }) {
  switch (column) {
    case "item_type": return row.item_type;
    case "category_name": return row.category_name || "—";
    case "brand_name": return row.brand_name || "—";
    case "unit": return row.unit;
    case "extra_units":
      return row.units.length > 0
        ? row.units.map((unit) => `${unit.unit} (${qty(unit.factor)}×; ${rp(unit.sell_price)})`).join(", ")
        : "—";
    case "sell_price": return rp(row.sell_price);
    case "buy_price": return rp(row.buy_price);
    case "min_stock": return qty(row.min_stock);
    case "supplier_name": return row.supplier_name || "—";
    case "buy_unit": return row.buy_unit || "—";
    case "min_buy": return qty(row.min_buy);
    case "upc": return row.upc || "—";
    case "track_expiry": return row.track_expiry ? "Ya" : "Tidak";
    case "default_discount": return `${qty(row.default_discount)}%`;
    case "is_active":
      return <span className={`bge ${row.is_active ? "g" : "x"}`}>{row.is_active ? "Aktif" : "Nonaktif"}</span>;
  }
}

export function BarangMatrixTable({ rows, bolehKelola }: { rows: BarangMatrixRow[]; bolehKelola: boolean }) {
  const [visibleColumns, setVisibleColumns] = useState<AccurateMatrixColumn[]>(ALL_COLUMNS);
  const selectedColumns = useMemo(
    () => ACCURATE_MATRIX_COLUMNS.filter((column) => visibleColumns.includes(column.key)),
    [visibleColumns],
  );

  const toggleColumn = (column: AccurateMatrixColumn) => {
    setVisibleColumns((current) => current.includes(column)
      ? current.filter((value) => value !== column)
      : [...current, column]);
  };

  return (
    <div className="crm-sec" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
      <details style={{ padding: "12px 14px", borderBottom: ".5px solid var(--bd)", background: "#f8fafc" }}>
        <summary style={{ cursor: "pointer", color: "var(--sb)", fontSize: 11.5, fontWeight: 700 }}>
          Atur kolom matriks · {visibleColumns.length}/{ACCURATE_MATRIX_COLUMNS.length} kolom tampil
        </summary>
        <div style={{ display: "flex", gap: 6, marginTop: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5 }} onClick={() => setVisibleColumns(ALL_COLUMNS)}>
            Pilih semua
          </button>
          <button type="button" className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5 }} onClick={() => setVisibleColumns(COMPACT_COLUMNS)}>
            Tampilan ringkas
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "7px 12px" }}>
          {ACCURATE_MATRIX_COLUMNS.map((column) => (
            <label key={column.key} style={{ display: "flex", alignItems: "center", gap: 6, color: "#475569", fontSize: 10.5 }}>
              <input
                type="checkbox"
                checked={visibleColumns.includes(column.key)}
                onChange={() => toggleColumn(column.key)}
              />
              {column.label}
            </label>
          ))}
        </div>
      </details>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 440 + selectedColumns.reduce((total, column) => total + columnWidth[column.key], 0) }}>
          <thead>
            <tr>
              <th style={stickyHeader(0, 42)}>No.</th>
              <th style={stickyHeader(42, 220)}>Nama</th>
              <th style={stickyHeader(262, 112)}>Kode</th>
              {selectedColumns.map((column) => (
                <th key={column.key} style={{ width: columnWidth[column.key], minWidth: columnWidth[column.key] }}>{column.label}</th>
              ))}
              <th style={{ width: 120, minWidth: 120 }}>Tindakan</th>
              {bolehKelola && <th style={{ width: 130, minWidth: 130 }}>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td style={stickyCell(0, 42, { color: "var(--tm)" })}>{index + 1}</td>
                <td style={stickyCell(42, 220, { fontWeight: 600 })}>
                  {bolehKelola ? (
                    <Link
                      href={`/pos/sku/${row.id}`}
                      title={`Buka ${row.name}`}
                      style={{ color: "#1d4ed8", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                      <i className="ti ti-chevron-right" aria-hidden="true" style={{ flexShrink: 0 }} />
                    </Link>
                  ) : row.name}
                </td>
                <td style={stickyCell(262, 112, { color: "var(--tm)" })}>{row.code || "—"}</td>
                {selectedColumns.map((column) => (
                  <td key={column.key} style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>
                    <MatrixValue row={row} column={column.key} />
                  </td>
                ))}
                <td>
                  {row.tindakan_kategori
                    ? <span className={`bge ${kategoriWajibConsent(row.tindakan_kategori) ? "r" : "b"}`}>{row.tindakan_kategori}</span>
                    : <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>}
                </td>
                {bolehKelola && (
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Link href={`/pos/sku/${row.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Edit</Link>
                      <form action={toggleBarang}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="aktif" value={row.is_active ? "1" : "0"} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          {row.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3 + selectedColumns.length + 1 + (bolehKelola ? 1 : 0)} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada barang di filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stickyHeader(left: number, width: number): React.CSSProperties {
  return {
    position: "sticky", left, zIndex: 3, width, minWidth: width,
    background: "#f8fafc", color: "var(--sb)", boxShadow: "1px 0 0 var(--bd)",
  };
}

function stickyCell(left: number, width: number, style: React.CSSProperties): React.CSSProperties {
  return {
    position: "sticky", left, zIndex: 2, width, minWidth: width,
    background: "#fff", boxShadow: "1px 0 0 var(--bd)", fontSize: 10.5,
    ...style,
  };
}
