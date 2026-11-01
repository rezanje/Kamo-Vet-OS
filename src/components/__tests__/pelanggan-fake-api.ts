import { vi } from "vitest";
import { BATAS_HASIL_PELANGGAN, filterCariPelanggan } from "@/lib/pelanggan-cari";

/**
 * Menjalankan filter PostgREST `or=(...)` buatan filterCariPelanggan di memori,
 * dengan arti yang sama seperti di database: `ilike` (tak peka huruf, * = apa saja)
 * dan `match` (regex Postgres; `\D` = bukan angka).
 */
export function cocokFilterPelanggan(filter: string, row: { name: string; phone: string }): boolean {
  return filter.split(",").some((syarat) => {
    const [kolom, op, ...sisa] = syarat.split(".");
    const nilai = sisa.join(".").replace(/^"(.*)"$/, "$1");
    const isi = String(row[kolom as "name" | "phone"] ?? "");
    if (op === "ilike") {
      const pola = nilai.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      return new RegExp(`^${pola}$`, "is").test(isi);
    }
    if (op === "match") return new RegExp(nilai).test(isi);
    throw new Error(`operator tidak dikenal: ${syarat}`);
  });
}

/** fetch palsu untuk /api/pelanggan: cari & muat-per-id dari daftar contoh. */
export function pasangApiPelangganPalsu<T extends { id: string; name: string; phone: string }>(rows: T[]) {
  const fetchPalsu = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const id = url.searchParams.get("id");
    let data: unknown;
    if (id !== null) data = rows.find((row) => row.id === id) ?? null;
    else {
      const filter = filterCariPelanggan(url.searchParams.get("q") ?? "");
      data = filter ? rows.filter((row) => cocokFilterPelanggan(filter, row))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, BATAS_HASIL_PELANGGAN)
        .map(({ id, name, phone }) => ({ id, name, phone })) : [];
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchPalsu);
  return fetchPalsu;
}
