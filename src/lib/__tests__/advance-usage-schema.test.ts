import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ADVANCE_USAGE_SELECTS } from "@/lib/advance-usage";

// Mocked clients accept any column; pin every selected column to the stored schema snapshot instead.
const snapshot = JSON.parse(readFileSync("docs/evidence/2026-10-22-a01/schema-snapshot.json", "utf8")) as
  Record<string, { columns: { name: string }[] }>;
const columns = (table: string) => new Set(snapshot[table]?.columns.map(column => column.name));

it.each(Object.entries(ADVANCE_USAGE_SELECTS))("selects only existing columns from %s and its embeds", (table, select) => {
  const embeds = [...select.matchAll(/(\w+)\(([^)]*)\)/g)];
  for (const [, embedded, fields] of embeds) {
    for (const field of fields.split(",")) expect(columns(embedded), `${embedded}.${field}`).toContain(field);
  }
  for (const field of select.replace(/\w+\([^)]*\)/g, "").split(",").filter(Boolean)) {
    expect(columns(table), `${table}.${field}`).toContain(field);
  }
});
