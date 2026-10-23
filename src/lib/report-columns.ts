export type ReportColumnSelection = Record<string, number[]>;
export type ReportColumnTable = { key: string; labels: string[]; table: HTMLTableElement };

/** URL contract: header fingerprint + duplicate occurrence -> hidden zero-based indices. */
export function normalizeReportColumns(raw: string | null): string {
  if (raw === null || raw === "") return "";
  if (raw.length > 3000) throw new Error("Pilihan kolom terlalu panjang.");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Pilihan kolom tidak valid.");
  const keys = Object.keys(parsed).sort();
  if (keys.length > 20) throw new Error("Terlalu banyak tabel.");
  const result: ReportColumnSelection = {};
  for (const key of keys) {
    if (!/^t[0-9a-f]{8}-(?:[1-9]|1[0-9]|20)$/.test(key)) throw new Error("Tabel tidak valid.");
    const indices: unknown = (parsed as Record<string, unknown>)[key];
    if (!Array.isArray(indices) || indices.length > 100 || indices.some(index => !Number.isInteger(index) || index < 0 || index > 99)) {
      throw new Error("Nomor kolom tidak valid.");
    }
    if (indices.length) result[key] = [...new Set(indices as number[])].sort((a, b) => a - b);
  }
  const canonical = Object.keys(result).length ? JSON.stringify(result) : "";
  if (canonical.length > 3000) throw new Error("Pilihan kolom terlalu panjang.");
  return canonical;
}

function headerFingerprint(labels: string[]): string {
  const signature = JSON.stringify(labels);
  let hash = 2166136261;
  for (let i = 0; i < signature.length; i++) hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
  return `t${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Only rectangular, single-header tables are safe for generic column selection. */
export function inspectReportTables(root: HTMLElement): { tables: ReportColumnTable[]; unsupported: number } {
  const all = [...root.querySelectorAll<HTMLTableElement>("table")];
  const tables: ReportColumnTable[] = [];
  const occurrences = new Map<string, number>();
  let unsupported = Math.max(0, all.length - 20);
  for (const table of all.slice(0, 20)) {
    const header = table.tHead;
    const cells = header?.rows.length === 1 ? [...header.rows[0].cells] : [];
    const width = cells.length;
    const rectangular = width > 0 && width <= 100 && cells.every(cell => cell.tagName === "TH" && cell.colSpan === 1 && cell.rowSpan === 1)
      && !table.querySelector("table,colgroup,col") && !table.parentElement?.closest("table")
      && [...table.rows].every(row => [...row.cells].every(cell => cell.rowSpan === 1) && [...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0) === width);
    if (!rectangular) { unsupported++; continue; }
    const labels = cells.map(cell => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
    const fingerprint = headerFingerprint(labels);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    tables.push({ key: `${fingerprint}-${occurrence}`, labels, table });
  }
  return { tables, unsupported };
}

/** Validate every choice before touching the DOM; the owner restores it before reuse. */
export function applyReportColumns(tables: ReportColumnTable[], selection: ReportColumnSelection): () => void {
  const canonical = normalizeReportColumns(JSON.stringify(selection));
  const choices: ReportColumnSelection = canonical ? JSON.parse(canonical) : {};
  for (const [key, hidden] of Object.entries(choices)) {
    const table = tables.find(table => table.key === key);
    if (!table || hidden.length >= table.labels.length || hidden.some(index => index >= table.labels.length)) {
      throw new Error("Pilihan kolom tidak cocok dengan tabel ini.");
    }
  }
  const restores: (() => void)[] = [];
  for (const { key, table } of tables) {
    const hidden = new Set(choices[key] ?? []);
    if (!hidden.size) continue;
    for (const row of [...table.rows]) {
      let index = 0;
      for (const cell of [...row.cells]) {
        const span = cell.colSpan;
        let remaining = 0;
        for (let offset = 0; offset < span; offset++) if (!hidden.has(index + offset)) remaining++;
        index += span;
        if (remaining === span) continue;
        const attributes = ["hidden", "style", "colspan", "data-report-column-hidden"].map(name => [name, cell.getAttribute(name)] as const);
        restores.push(() => {
          for (const [name, value] of attributes) {
            if (value === null) cell.removeAttribute(name);
            else cell.setAttribute(name, value);
          }
        });
        if (remaining === 0) {
          cell.hidden = true;
          cell.style.setProperty("display", "none", "important");
          cell.setAttribute("data-report-column-hidden", "true");
        } else cell.colSpan = remaining;
      }
    }
  }
  return () => { restores.forEach(restore => restore()); };
}
