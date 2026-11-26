// THROWAWAY hosted evidence harness (not committed). Runs the real loaders against hosted READ-ONLY through the management SQL shim.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { erros, shimClient, stats } from "/opt/data/kamo-cost-missing-evidence/ship-laporan-tahap4/harness/shim";
import { bacaRekamMedisAnamnesa } from "@/lib/laporan-anamnesa";
import { loadHistoricalInventory } from "@/lib/inventory-historical";

type Kasus = { jenis: "anamnesa" | "historis"; tag: string; dari?: string; sampai?: string; cabang?: string; tanggal?: string; cabangIds?: string[]; user?: string };
const cases = JSON.parse(process.env.LP_CASES ?? "[]") as Kasus[];
const label = process.env.LP_LABEL ?? "x";
const out = process.env.LP_OUT ?? "/tmp";

for (const c of cases) {
  it(`${c.jenis} ${c.tag}`, async () => {
    stats.statements = 0; stats.wallMs = 0; stats.maxMs = 0; stats.log = []; erros.length = 0;
    const t0 = Date.now();
    const supabase = shimClient(c.user || process.env.LP_USER || undefined, process.env.LP_TIMEOUT ?? "8s");
    let hasil: unknown = null; let galat: string | null = null; let kode: string | null = null;
    try {
      if (c.jenis === "anamnesa") hasil = (await bacaRekamMedisAnamnesa(supabase as never, { dari: c.dari!, sampai: c.sampai!, cabang: c.cabang ?? "" })).data;
      else hasil = await loadHistoricalInventory(supabase as never, { tanggal: c.tanggal, cabang: c.cabangIds });
    } catch (e) { galat = e instanceof Error ? e.message : String(e); kode = (e as { status?: number; code?: string }).status?.toString() ?? (e as { code?: string }).code ?? null; }
    const json = JSON.stringify(hasil);
    const ms = Date.now() - t0;
    const perTabel: Record<string, { n: number; ms: number }> = {};
    for (const l of stats.log) { const e = perTabel[l.table] ??= { n: 0, ms: 0 }; e.n++; e.ms += l.ms; }
    const baris = c.jenis === "anamnesa" ? (hasil as unknown[] | null)?.length ?? null : (hasil as { rows?: unknown[] } | null)?.rows?.length ?? null;
    writeFileSync(`${out}/res-${label}-${c.tag}.json`, JSON.stringify({
      label, ...c, ms, statements: stats.statements, maxStatementMs: stats.maxMs, sumStatementMs: stats.wallMs, perTabel, log: stats.log,
      erros: erros.slice(), galat, kode, baris, bytes: json.length, sidik: createHash("sha256").update(json).digest("hex"),
      ringkas: c.jenis === "historis" && hasil ? { total: (hasil as { total?: unknown }).total ?? null, fifo: (hasil as { fifoCurrent?: { total?: unknown; ledgerTotal?: unknown; difference?: unknown } }).fifoCurrent ?? null } : null,
    }));
    expect(true).toBe(true);
  }, 900_000);
}
