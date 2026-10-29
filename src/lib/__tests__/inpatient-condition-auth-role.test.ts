import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 20261031095000 mengganti pembaca peran sesi lama (request.jwt.claim.role, tidak lagi
// dikirim PostgREST) dengan auth.role(). Definisi ulang fungsi ubah kondisi rawat inap
// dari migrasi mana pun tidak boleh membawa pembaca lama itu kembali.
const LAMA = "request.jwt.claim.role'";

describe("ubah kondisi rawat inap memakai auth.role()", () => {
  const redefinisi = readdirSync("supabase/migrations")
    .filter(name => name.endsWith(".sql"))
    .filter(name => name > "20261031095000_inpatient_condition_claims_auth.sql" || name === "20261030110000_k08_inpatient_redischarge_days.sql")
    .map(name => ({ name, sql: readFileSync(`supabase/migrations/${name}`, "utf8") }))
    .filter(({ sql }) => /create\s+or\s+replace\s+function\s+public\.clinic_change_inpatient_condition/i.test(sql));

  it("migrasi K08 ikut diperiksa", () => {
    expect(redefinisi.map(({ name }) => name)).toContain("20261030110000_k08_inpatient_redischarge_days.sql");
  });

  it.each(redefinisi.map(({ name, sql }) => [name, sql]))("%s", (_name, sql) => {
    expect(sql).not.toContain(LAMA);
    expect(sql).toContain("coalesce(auth.role(), '')");
  });
});
