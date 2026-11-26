import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { ANAMNESA_RPC, bacaRekamMedisAnamnesa, bacaRekamMedisAnamnesaLama, jendelaAnamnesa, type RekamMedisAnamnesa } from "@/lib/laporan-anamnesa";
import { loadHistoricalInventory, PERSEDIAAN_BUKU_BESAR_RPC, PERSEDIAAN_LAPISAN_RPC } from "@/lib/inventory-historical";
import { hariIniWIB } from "@/lib/tanggal";
import { clientFixture, type Row } from "./fixtures/hpp-report-client";

// Laporan tahap 4 (migrasi 20261219100000): jalur baru (fungsi database) HARUS sama persis dengan jalur lama (halaman 500 + RLS) untuk
// Daftar Anamnesa & Penyakit dan Nilai Persediaan Historis. Fungsi database ditiru di memori mengikuti SQL-nya; kesetaraan SQL vs RLS
// dibuktikan di uji native PG17 (scripts/test-laporan-anamnesa-persediaan-postgres.py) dan di hosted. Data fiktif.
const sidik = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

// ---------------------------------------------------------------- Anamnesa
type Baris = RekamMedisAnamnesa;
const CAB = ["cab-a", "cab-b", "cab-c"];
function bikinRekam(n: number): Baris[] {
  const hasil: Baris[] = [];
  const dasar = Date.parse("2026-08-01T00:00:00+07:00");
  for (let i = 0; i < n; i++) {
    // tersebar ±120 hari; sebagian jatuh persis di tepi hari WIB (00:00:00 dan 23:59:59) supaya batas jendela terguji
    const hari = i % 120; const tepi = i % 9;
    const ms = dasar + hari * 86_400_000 + (tepi === 0 ? 0 : tepi === 1 ? 86_399_000 : tepi === 2 ? 86_399_500 : (i * 7_919) % 86_000_000);
    hasil.push({
      id: `mr-${String(i).padStart(5, "0")}`, diagnosis: i % 7 === 0 ? null : i % 7 === 1 ? "  Scabies " : `Dx ${i % 9}`,
      anamnesis: i % 5 === 0 ? null : `anamnesa ${i}`, gejala_klinis: i % 3 === 0 ? "" : `gejala ${i}`, follow_up: i % 11 === 0 ? "kontrol" : null,
      created_at: new Date(ms).toISOString().replace("Z", "+00:00"),
      visits: i % 17 === 0 ? null : {
        branch_id: i % 13 === 0 ? null : CAB[i % 3], dokter: i % 6 === 0 ? null : `drh ${i % 4}`,
        branches: i % 13 === 0 ? null : { name: `Cabang ${CAB[i % 3]}` },
        pets: { name: `Hewan ${i % 20}`, species: i % 3 === 0 ? null : "Kucing", breed: i % 4 === 0 ? null : "Domestik" },
        customers: { name: `Pemilik ${i % 20}` },
      },
    });
  }
  // kembar waktu: urutan harus id naik
  hasil[3].created_at = hasil[4].created_at = hasil[5].created_at = hasil[6].created_at;
  return hasil;
}

type ModeRpc = "ada" | "belum" | "timeout" | "izin" | "bentuk" | "hitungan" | "kembar";
/** Klien tiruan: `medical_records` (jalur lama: select/gte/lte/eq/order berantai/range) dan rpc laporan_anamnesa (tiruan SQL). */
function bikinKlien(rows: Baris[], opsi: { rpc?: ModeRpc } = {}) {
  const panggilan: Record<string, unknown>[] = [];
  const statement: { dari: string; sampai: string; range: [number, number] | null }[] = [];
  const dalamRentang = (m: Baris, dari: string, sampai: string, eksklusif: boolean) => {
    const t = Date.parse(m.created_at);
    return t >= Date.parse(dari) && (eksklusif ? t < Date.parse(sampai) : t <= Date.parse(sampai));
  };
  const urut = (a: Baris, b: Baris) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const visitDari = (m: Baris) => (Array.isArray(m.visits) ? m.visits[0] : m.visits) ?? null;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) },
    from(tabel: string) {
      if (tabel !== "medical_records") throw new Error("tabel tak terduga " + tabel);
      let dari = "", sampai = "", cabang = ""; let inner = false; const urutan: [string, boolean][] = [];
      const q: Record<string, unknown> = {
        select: (kolom: string) => { inner = kolom.includes("visits!inner"); return q; },
        gte: (_k: string, v: string) => { dari = v; return q; },
        lte: (_k: string, v: string) => { sampai = v; return q; },
        eq: (k: string, v: string) => { if (k === "visits.branch_id") cabang = v; return q; },
        order: (k: string, o?: { ascending?: boolean }) => { urutan.push([k, o?.ascending !== false]); return q; },
        range: async (a: number, z: number) => {
          statement.push({ dari, sampai, range: [a, z] });
          let cocok = rows.filter(m => dalamRentang(m, dari, sampai, false));
          if (inner) cocok = cocok.filter(m => visitDari(m) !== null);
          if (cabang) cocok = cocok.filter(m => visitDari(m)?.branch_id === cabang);
          // urutan seperti PostgREST: created_at turun lalu id naik
          expect(urutan).toEqual([["created_at", false], ["id", true]]);
          cocok.sort(urut);
          return { data: cocok.slice(a, z + 1), count: cocok.length, error: null };
        },
      };
      return q;
    },
    ...(opsi.rpc === "belum" ? { rpc: async (nama: string) => { panggilan.push({ nama }); return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${nama} in the schema cache` } }; } } : {}),
    ...(opsi.rpc && opsi.rpc !== "belum" ? {
      rpc: async (nama: string, args: { p_from: string; p_to: string; p_branch_id: string | null; p_to_eksklusif: boolean }) => {
        panggilan.push({ nama, ...args });
        if (opsi.rpc === "timeout") return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
        if (opsi.rpc === "izin") return { data: null, error: { code: "42501", message: "ADMIN_ONLINE_FUNCTION_DENIED" } };
        if (opsi.rpc === "bentuk") return { data: [1, 2, 3], error: null };
        const cocok = rows.filter(m => dalamRentang(m, args.p_from, args.p_to, args.p_to_eksklusif)
          && (!args.p_branch_id || visitDari(m)?.branch_id === args.p_branch_id)).sort(urut);
        const kirim = opsi.rpc === "kembar" ? [...cocok, ...cocok.slice(0, 1)] : cocok;
        return { data: { n: opsi.rpc === "hitungan" ? cocok.length + 1 : kirim.length, rows: kirim }, error: null };
      },
    } : {}),
  };
  return { client, panggilan, statement };
}

const PERIODE: [string, string][] = [
  ["2026-11-01", "2026-11-01"], ["2026-09-01", "2026-09-30"], ["2026-08-01", "2026-09-01"], ["2026-08-01", "2026-09-02"],
  ["2026-08-15", "2026-10-20"], ["2026-08-01", "2026-11-30"], ["2026-12-01", "2026-12-31"], ["2026-10-31", "2026-10-31"],
];
const hariMs = 86_400_000;
const selisihHari = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / hariMs;

describe("Anamnesa: jalur baru == jalur lama", () => {
  const rows = bikinRekam(1500);
  it("jendela 31 hari menutup rentang tanpa celah/tumpang tindih", () => {
    for (const [dari, sampai] of PERIODE) {
      const j = jendelaAnamnesa(dari, sampai);
      expect(j[0].dari).toBe(dari);
      expect(j[j.length - 1].sampai).toBe(sampai);
      for (const w of j) expect(selisihHari(w.dari, w.sampai) + 1).toBeLessThanOrEqual(31);
      for (let i = 1; i < j.length; i++) expect(selisihHari(j[i - 1].sampai, j[i].dari)).toBe(1);
      expect(j.reduce((s, w) => s + selisihHari(w.dari, w.sampai) + 1, 0)).toBe(selisihHari(dari, sampai) + 1);
    }
  });

  for (const [dari, sampai] of PERIODE) {
    for (const cabang of ["", "cab-b", "cab-zzz"]) {
      it(`${dari}..${sampai} cabang=${cabang || "semua"}: baris, urutan dan sidik sama; query dibatasi`, async () => {
        const lama = bikinKlien(rows);
        const baru = bikinKlien(rows, { rpc: "ada" });
        const hasilLama = await bacaRekamMedisAnamnesaLama(lama.client as never, { dari, sampai, cabang });
        const hasilBaru = await bacaRekamMedisAnamnesa(baru.client as never, { dari, sampai, cabang });
        expect(hasilBaru.error).toBeNull();
        expect(hasilBaru.data).toEqual(hasilLama.data);
        expect(sidik(hasilBaru.data)).toBe(sidik(hasilLama.data));
        const j = jendelaAnamnesa(dari, sampai);
        expect(baru.panggilan).toHaveLength(j.length);
        expect(baru.statement).toHaveLength(0);   // tidak ada pembacaan tabel
        expect(baru.panggilan.every(p => p.nama === ANAMNESA_RPC && p.p_branch_id === (cabang || null))).toBe(true);
        // jendela terakhir inklusif sampai 23:59:59 WIB; jendela sebelumnya eksklusif di awal jendela berikutnya
        expect(baru.panggilan.map(p => p.p_to_eksklusif)).toEqual(j.map((_, i) => i < j.length - 1));
      });
    }
  }

  it("rentang besar benar-benar berisi data dan melewati banyak jendela (uji tidak kosong)", async () => {
    const baru = bikinKlien(rows, { rpc: "ada" });
    const hasil = await bacaRekamMedisAnamnesa(baru.client as never, { dari: "2026-08-01", sampai: "2026-11-30", cabang: "" });
    const lama = await bacaRekamMedisAnamnesaLama(bikinKlien(rows).client as never, { dari: "2026-08-01", sampai: "2026-11-30", cabang: "" });
    expect(hasil.data.length).toBeGreaterThan(1000);
    expect(hasil.data).toEqual(lama.data);
    expect(baru.panggilan.length).toBeGreaterThanOrEqual(4);
    expect(new Set(hasil.data.map(r => r.id)).size).toBe(hasil.data.length);
    const t = hasil.data.map(r => Date.parse(r.created_at));
    expect([...t].sort((a, b) => b - a)).toEqual(t);
    // baris tepat pada tepi hari WIB (awal dan 23:59:59) ikut tepat satu kali
    expect(hasil.data.some(r => (Date.parse(r.created_at) + 7 * 3_600_000) % hariMs === 0)).toBe(true);
    expect(hasil.data.some(r => (Date.parse(r.created_at) + 7 * 3_600_000) % hariMs === 86_399_000)).toBe(true);
  });

  it("fungsi belum ada di database: pembaca lama dipakai, hasil sama", async () => {
    const belum = bikinKlien(rows, { rpc: "belum" });
    const hasil = await bacaRekamMedisAnamnesa(belum.client as never, { dari: "2026-09-01", sampai: "2026-10-20", cabang: "" });
    const lama = await bacaRekamMedisAnamnesaLama(bikinKlien(rows).client as never, { dari: "2026-09-01", sampai: "2026-10-20", cabang: "" });
    expect(hasil.data).toEqual(lama.data);
    expect(belum.statement.length).toBeGreaterThan(0);
  });

  it("batas waktu pernyataan (57014), jawaban bukan objek, dan klien tanpa rpc: pembaca lama dipakai", async () => {
    const lama = await bacaRekamMedisAnamnesaLama(bikinKlien(rows).client as never, { dari: "2026-09-01", sampai: "2026-10-20", cabang: "" });
    for (const mode of ["timeout", "bentuk"] as const) {
      const k = bikinKlien(rows, { rpc: mode });
      const hasil = await bacaRekamMedisAnamnesa(k.client as never, { dari: "2026-09-01", sampai: "2026-10-20", cabang: "" });
      expect(hasil.data).toEqual(lama.data);
      expect(k.statement.length).toBeGreaterThan(0);
    }
    const tanpaRpc = bikinKlien(rows);
    expect((await bacaRekamMedisAnamnesa(tanpaRpc.client as never, { dari: "2026-09-01", sampai: "2026-10-20", cabang: "" })).data).toEqual(lama.data);
  });

  it("galat izin (42501) dilempar dengan kode, tidak diam-diam jatuh ke jalur lama; hitungan/identitas tak cocok ditolak", async () => {
    const izin = bikinKlien(rows, { rpc: "izin" });
    await expect(bacaRekamMedisAnamnesa(izin.client as never, { dari: "2026-09-01", sampai: "2026-09-10", cabang: "" })).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("Data laporan gagal dibaca") });
    expect(izin.statement).toHaveLength(0);
    await expect(bacaRekamMedisAnamnesa(bikinKlien(rows, { rpc: "hitungan" }).client as never, { dari: "2026-09-01", sampai: "2026-09-10", cabang: "" })).rejects.toThrow("hitungan rekam medis tidak cocok");
    await expect(bacaRekamMedisAnamnesa(bikinKlien(rows, { rpc: "kembar" }).client as never, { dari: "2026-09-01", sampai: "2026-09-10", cabang: "" })).rejects.toThrow("identitas baris laporan");
  });

  it("tanggal bukan YYYY-MM-DD, terbalik, atau rentang tak masuk akal: pembaca lama (rpc tidak dipanggil)", async () => {
    for (const [dari, sampai] of [["2026-9-1", "2026-10-1"], ["2026-10-20", "2026-09-01"], ["", "2026-10-01"], ["0001-01-01", "9999-12-31"]] as const) {
      const k = bikinKlien(rows, { rpc: "ada" });
      const hasil = await bacaRekamMedisAnamnesa(k.client as never, { dari, sampai, cabang: "" });
      expect(k.panggilan).toHaveLength(0);
      const lama = await bacaRekamMedisAnamnesaLama(bikinKlien(rows).client as never, { dari, sampai, cabang: "" });
      expect(hasil.data).toEqual(lama.data);
    }
  });
});

// ---------------------------------------------------------------- Nilai Persediaan Historis
type Tabel = Record<string, Row[]>;
const EXACT = Decimal.clone({ precision: 80 });
/** Tiruan SQL fungsi laporan_persediaan_* (hak baca = semua baris yang diberikan; RLS dibuktikan di native/hosted). */
function rpcTiruan(tables: Tabel, opsi: { tanpaAkun?: boolean } = {}) {
  const panggilan: { nama: string; args: Record<string, unknown> }[] = [];
  const fungsi = (nama: string, args: Record<string, unknown>) => {
    if (nama === PERSEDIAAN_LAPISAN_RPC || nama === PERSEDIAAN_BUKU_BESAR_RPC) panggilan.push({ nama, args });
    if (nama === PERSEDIAAN_LAPISAN_RPC) {
      const ids = args.p_branch_ids as string[];
      const gudang = (tables.warehouses ?? []).filter(w => ids.includes(String(w.branch_id)));
      const per: Record<string, { nilai: string; minus: number }> = {};
      let negatif = 0;
      for (const id of new Set(ids)) {
        const g = gudang.filter(w => w.branch_id === id).map(w => w.id);
        const lay = (tables.stock_layers ?? []).filter(l => g.includes(l.warehouse_id) && new EXACT(String(l.qty_left)).gt(0));
        negatif += lay.filter(l => new EXACT(String(l.unit_cost)).isNegative()).length;
        per[id] = { nilai: lay.reduce((s, l) => s.plus(new EXACT(String(l.qty_left)).times(String(l.unit_cost))), new EXACT(0)).toFixed(), minus: (tables.stock ?? []).filter(s => g.includes(s.warehouse_id) && Number(s.qty) < 0).length };
      }
      return { data: { per_cabang: per, biaya_negatif: negatif }, error: null };
    }
    if (nama === PERSEDIAAN_BUKU_BESAR_RPC) {
      if (opsi.tanpaAkun) return { data: { akun_ada: false }, error: null };
      const akun = (tables.coa_accounts ?? []).find(a => a.code === "170001")!.id;
      const ids = args.p_branch_ids as string[];
      const garis = (tables.journal_lines ?? []).filter(l => l.account_id === akun && String((l.journal_entries as Row).tanggal) <= String(args.p_as_of)
        && ((ids.includes(String((l.journal_entries as Row).branch_id))) || (args.p_tak_teralokasi === true && (l.journal_entries as Row).branch_id === null)));
      const per: Record<string, string> = {}; let tak = new EXACT(0);
      for (const l of garis) {
        const nilai = new EXACT(String(l.debit)).minus(String(l.credit)); const b = (l.journal_entries as Row).branch_id as string | null;
        if (b === null) tak = tak.plus(nilai); else per[b] = new EXACT(per[b] ?? 0).plus(nilai).toFixed();
      }
      return { data: { akun_ada: true, per_cabang: per, tak_teralokasi: tak.toFixed(), negatif: garis.filter(l => new EXACT(String(l.debit)).isNegative() || new EXACT(String(l.credit)).isNegative()).length }, error: null };
    }
    return null;
  };
  return { fungsi, panggilan };
}
function klienDenganRpc(tables: Tabel, tiruan: ReturnType<typeof rpcTiruan> | null, ekstra?: (nama: string) => unknown) {
  const dasar = clientFixture({ tables });
  const klien = { ...dasar.client, rpc: (nama: string, args: Record<string, unknown>) => {
    const khusus = ekstra?.(nama); if (khusus) return Promise.resolve(khusus);
    const hasil = tiruan?.fungsi(nama, args); if (hasil) return Promise.resolve(hasil);
    return (dasar.client.rpc as (n: string, a: unknown) => unknown)(nama, args);
  } };
  return { client: klien as never, records: dasar.records };
}
const hari = hariIniWIB();
function fifoTabel(): Tabel {
  return {
    inventory_costing_settings: [{ id: true, method: "fifo", activated_at: null }],
    branches: [{ id: "b1", name: "Satu" }, { id: "b2", name: "Dua" }, { id: "b3", name: "Tiga" }],
    warehouses: [{ id: "w1", branch_id: "b1", code: "W1", name: "G1" }, { id: "w1b", branch_id: "b1", code: "W1B", name: "G1B" }, { id: "w2", branch_id: "b2", code: "W2", name: "G2" }],
    stock_layers: [
      { id: "l1", warehouse_id: "w1", item_id: "i", qty_left: "3", unit_cost: "50.125" }, { id: "l2", warehouse_id: "w1b", item_id: "j", qty_left: "2.5", unit_cost: "10.0625" },
      { id: "l3", warehouse_id: "w2", item_id: "i", qty_left: "4", unit_cost: "25" }, { id: "l4", warehouse_id: "w2", item_id: "j", qty_left: "0", unit_cost: "999" },
      { id: "l5", warehouse_id: "w2", item_id: "k", qty_left: "0.0001", unit_cost: "123456789012345.123456" },
    ],
    stock: [{ id: "s1", warehouse_id: "w2", item_id: "k", qty: -2 }, { id: "s2", warehouse_id: "w1", item_id: "i", qty: 3 }, { id: "s3", warehouse_id: "w1b", item_id: "j", qty: -1 }, { id: "s4", warehouse_id: "w1b", item_id: "i", qty: -4 }],
    coa_accounts: [{ id: "a1301", code: "170001" }],
    journal_lines: [
      { id: "g1", account_id: "a1301", debit: "171.5", credit: "0", journal_entries: { tanggal: hari, branch_id: "b1" } },
      { id: "g2", account_id: "a1301", debit: "150.0001", credit: "30", journal_entries: { tanggal: hari, branch_id: "b2" } },
      { id: "g3", account_id: "a1301", debit: "7", credit: "0", journal_entries: { tanggal: hari, branch_id: null } },
      { id: "g4", account_id: "a1301", debit: "0", credit: "2.25", journal_entries: { tanggal: "2026-01-01", branch_id: "b1" } },
      { id: "g5", account_id: "other", debit: "1000", credit: "0", journal_entries: { tanggal: hari, branch_id: "b1" } },
      { id: "g6", account_id: "a1301", debit: "9", credit: "1", journal_entries: { tanggal: hari, branch_id: "b3" } },
    ],
  };
}
const KASUS: { tanggal?: string; cabang?: string[] }[] = [{}, { tanggal: hari }, { cabang: ["b1"] }, { cabang: ["b2", "b1"] }, { cabang: ["b3"] }, { tanggal: "2026-01-02" }];

describe("Nilai Persediaan Historis: jalur baru == jalur lama", () => {
  for (const [i, kasus] of KASUS.entries()) {
    it(`FIFO, kasus ${i} ${JSON.stringify(kasus)}: hasil lengkap identik (sidik); pembacaan halaman tidak dipakai`, async () => {
      const tabel = fifoTabel();
      const lama = klienDenganRpc(tabel, null);
      const tiruan = rpcTiruan(tabel);
      const baru = klienDenganRpc(tabel, tiruan);
      const hasilLama = await loadHistoricalInventory(lama.client, kasus);
      const hasilBaru = await loadHistoricalInventory(baru.client, kasus);
      expect(hasilBaru).toEqual(hasilLama);
      expect(sidik(hasilBaru)).toBe(sidik(hasilLama));
      const hariIni = (kasus.tanggal ?? hari) === hari;
      if (hariIni) {
        expect(hasilBaru.fifoCurrent).not.toBeNull();
        expect(tiruan.panggilan.map(p => p.nama)).toEqual([PERSEDIAAN_LAPISAN_RPC, PERSEDIAAN_BUKU_BESAR_RPC]);
        for (const tabelBaca of ["stock_layers", "stock", "journal_lines", "coa_accounts"]) expect(baru.records.some(r => r.table === tabelBaca)).toBe(false);
        // cabang tanpa gudang (b3): pembaca lama memang tidak membaca lapisan sama sekali
        expect(lama.records.some(r => r.table === "stock_layers")).toBe(kasus.cabang?.join() !== "b3");
      } else {
        expect(tiruan.panggilan).toHaveLength(0);
        expect(hasilBaru.fifoCurrent).toBeNull();
      }
    });
  }

  it("rata-rata bergerak: saldo buku besar lewat fungsi == pembaca lama (jurnal per cabang + tanpa cabang)", async () => {
    const tabel: Tabel = {
      inventory_costing_settings: [{ id: true, method: "moving_average", activated_at: "2026-10-22T03:00:00Z" }],
      branches: [{ id: "b1", name: "Satu" }, { id: "b2", name: "Dua" }],
      warehouses: [{ id: "w1", branch_id: "b1", code: "W1", name: "Gudang lama" }, { id: "w2", branch_id: "b2", code: "W2", name: "Gudang cabang" }],
      items: [{ id: "i", code: "SKU", name: "Obat", unit: "ml" }],
      inventory_cost_events: [
        { id: 1, warehouse_id: "w1", item_id: "i", tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "5", value_delta: "500", qty_after: "5", value_after: "500", average_after: "100" },
        { id: 2, warehouse_id: "w2", item_id: "i", tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "2", value_delta: "60", qty_after: "2", value_after: "60", average_after: "30" },
      ],
      coa_accounts: [{ id: "a1301", code: "170001" }],
      journal_lines: [
        { id: "l1", account_id: "a1301", debit: "400", credit: "100", journal_entries: { tanggal: "2026-10-22", branch_id: "b1" } },
        { id: "l2", account_id: "a1301", debit: "90", credit: "0", journal_entries: { tanggal: "2026-10-23", branch_id: "b2" } },
        { id: "l3", account_id: "a1301", debit: "7", credit: "0", journal_entries: { tanggal: "2026-10-23", branch_id: null } },
        { id: "l4", account_id: "a1301", debit: "100", credit: "0", journal_entries: { tanggal: "2026-10-24", branch_id: "b1" } },
      ],
    };
    for (const kasus of [{ tanggal: "2026-10-23" }, { tanggal: "2026-10-23", cabang: ["b1"] }, { tanggal: "2026-10-22" }, { tanggal: "2026-10-30" }]) {
      const tiruan = rpcTiruan(tabel);
      const lama = await loadHistoricalInventory(klienDenganRpc(tabel, null).client, kasus);
      const baruKlien = klienDenganRpc(tabel, tiruan);
      const baru = await loadHistoricalInventory(baruKlien.client, kasus);
      expect(baru).toEqual(lama);
      expect(sidik(baru)).toBe(sidik(lama));
      expect(baru.canViewLedger).toBe(true);
      expect(tiruan.panggilan.map(p => p.nama)).toEqual([PERSEDIAAN_BUKU_BESAR_RPC]);
      expect(baruKlien.records.some(r => r.table === "journal_lines")).toBe(false);
    }
  });

  it("akun 170001 tidak ada: fungsi {akun_ada:false} == pembaca lama (ledger null)", async () => {
    const tabel = { ...fifoTabel(), coa_accounts: [] as Row[] };
    const lama = await loadHistoricalInventory(klienDenganRpc(tabel, null).client, {});
    const baru = await loadHistoricalInventory(klienDenganRpc(tabel, rpcTiruan(tabel, { tanpaAkun: true })).client, {});
    expect(baru).toEqual(lama);
    expect(baru.fifoCurrent?.ledgerMissing).toBe(true);
  });

  it("fungsi belum ada atau melewati batas waktu: pembaca lama dipakai, hasil sama; izin ditolak dilempar", async () => {
    const tabel = fifoTabel();
    const lama = await loadHistoricalInventory(klienDenganRpc(tabel, null).client, {});
    const batas = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const hasil = await loadHistoricalInventory(klienDenganRpc(tabel, null, nama => (nama.startsWith("laporan_persediaan") ? batas : null)).client, {});
    expect(hasil).toEqual(lama);
    const izin = { data: null, error: { code: "42501", message: "ADMIN_ONLINE_FUNCTION_DENIED" } };
    await expect(loadHistoricalInventory(klienDenganRpc(tabel, null, nama => (nama.startsWith("laporan_persediaan") ? izin : null)).client, {})).rejects.toMatchObject({ code: "42501" });
    const bentukSalah = { data: [1], error: null };
    expect(await loadHistoricalInventory(klienDenganRpc(tabel, null, nama => (nama.startsWith("laporan_persediaan") ? bentukSalah : null)).client, {})).toEqual(lama);
  });

  it("nilai negatif di sumber: kedua jalur menolak laporan dengan pesan yang sama", async () => {
    const lapisan = { ...fifoTabel(), stock_layers: [...fifoTabel().stock_layers, { id: "lx", warehouse_id: "w1", item_id: "z", qty_left: "1", unit_cost: "-5" }] };
    await expect(loadHistoricalInventory(klienDenganRpc(lapisan, null).client, {})).rejects.toThrow("Biaya lapisan stok negatif");
    await expect(loadHistoricalInventory(klienDenganRpc(lapisan, rpcTiruan(lapisan)).client, {})).rejects.toThrow("Biaya lapisan stok negatif");
    const jurnal = { ...fifoTabel(), journal_lines: [...fifoTabel().journal_lines, { id: "gx", account_id: "a1301", debit: "-3", credit: "0", journal_entries: { tanggal: hari, branch_id: "b1" } }] };
    await expect(loadHistoricalInventory(klienDenganRpc(jurnal, null).client, {})).rejects.toThrow("Nilai jurnal persediaan negatif");
    await expect(loadHistoricalInventory(klienDenganRpc(jurnal, rpcTiruan(jurnal)).client, {})).rejects.toThrow("Nilai jurnal persediaan negatif");
  });

  it("angka uang tetap eksak: nilai lapisan besar dan pecahan tidak dibulatkan", async () => {
    const tabel = fifoTabel();
    const baru = await loadHistoricalInventory(klienDenganRpc(tabel, rpcTiruan(tabel)).client, {});
    const b2 = baru.fifoCurrent!.summary.find(s => s.id === "b2")!;
    expect(b2.layerValue).toBe("12345679001.2345123456");   // 4 x 25 + 0,0001 x 123456789012345,123456
    expect(baru.fifoCurrent!.summary.find(s => s.id === "b1")!.layerValue).toBe("175.53125");   // 3 x 50,125 + 2,5 x 10,0625
    expect(baru.fifoCurrent!.summary.find(s => s.id === "b1")!.ledgerValue).toBe("169.25");     // 171,5 - 2,25
  });
});
