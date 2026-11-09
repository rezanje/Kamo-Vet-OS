import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// COST_MISSING detail (Andri 4 Nov 2026). The migration only rewrites the TEXT of the BMHP rejection; the safety condition
// itself must stay exactly as K02 defined it. Without a database in CI the invariants are read from the migration text.
const NAMA = "20261107180000_cost_missing_bmhp_detail.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const K02 = readFileSync("supabase/migrations/20261026100000_k02_procedure_bmhp.sql", "utf8");

describe("COST_MISSING BMHP detail migration", () => {
  it("patches clinic_private.bmhp_issue with an exact anchor and fails closed on drift", () => {
    expect(SQL).toContain("pg_get_functiondef");
    expect(SQL).toContain("clinic_private.bmhp_issue(uuid,uuid,text,date)");
    expect(SQL).toContain("COST_MISSING_DRIFT");
    expect(SQL).toContain("<> 1 then");
    // the anchor exists exactly once in the original function body
    const anchor = "message = format('COST_MISSING: %s', v_item.name);";
    const body = K02.slice(K02.indexOf("create function clinic_private.bmhp_issue"), K02.indexOf("create function clinic_private.bmhp_edit_plan"));
    expect(body.split(anchor).length - 1).toBe(1);
  });

  it("keeps the rejection condition untouched and only appends stock, need, unit and cause", () => {
    expect(SQL).not.toMatch(/v_out\.cost\s*<=\s*0/); // condition lives in K02 only; not re-implemented here
    expect(SQL).toContain("[stok=%s;butuh=%s;satuan=%s;sebab=%s]");
    expect(SQL).toContain("case when v_out.shortfall > 0 then ''lapisan'' else ''harga0'' end");
    expect(SQL).not.toMatch(/\bupdate\s+public\./i);
    expect(SQL).not.toMatch(/\binsert\s+into\b/i);
  });

  it("does not widen privileges", () => {
    expect(SQL).toContain("revoke all on function clinic_private.bmhp_issue(uuid, uuid, text, date) from public, anon, authenticated, service_role;");
    expect(SQL).not.toMatch(/grant\s+execute/i);
  });

  it("is numbered above the hosted maximum (20261107160000), unique, and no leftover mention of the retired number", () => {
    expect(existsSync(`supabase/migrations/${NAMA}`)).toBe(true);
    const versi = NAMA.slice(0, 14);
    expect(Number(versi)).toBeGreaterThan(20261107160000);
    const sama = readdirSync("supabase/migrations").filter((f) => f.startsWith(`${versi}_`) || f.startsWith(`${versi}.`));
    expect(sama).toEqual([NAMA]);
    const lama = ["20261106", "810000"].join(""); // built in two parts so this file itself never carries the retired number
    expect(readdirSync("supabase/migrations").some((f) => f.includes(lama))).toBe(false);
    expect(SQL).not.toContain(lama);
    expect(readFileSync("src/lib/__tests__/cost-missing-bmhp-migration.test.ts", "utf8")).not.toContain(lama);
  });
});
