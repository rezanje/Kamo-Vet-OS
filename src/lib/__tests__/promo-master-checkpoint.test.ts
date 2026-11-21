import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261104150000_promo_atribusi_klinik_dan_impor_daftar.sql", "utf8");

it("the independently usable import checkpoint does not install untrusted billing attribution", () => {
  expect(sql).toContain("create or replace function public.import_promo_master");
  expect(sql).not.toContain("alter table public.invoice_items");
  expect(sql).not.toContain("alter table public.invoices");
  expect(sql).not.toContain("pg_get_functiondef");
  expect(sql).not.toContain("clinic_post_invoice");
});

it("keeps OWNER/ADMIN manager guard, modern null branch payload, and narrow execute ACL", () => {
  expect(sql).toContain("perform public.assert_promo_manager();");
  expect(sql).toContain("coalesce(nullif(v_entry -> 'branch_ids', 'null'::jsonb), '[]'::jsonb)");
  expect(sql).toContain("revoke all on function public.import_promo_master(jsonb) from public, anon, service_role;");
  expect(sql).toContain("grant execute on function public.import_promo_master(jsonb) to authenticated;");
});
