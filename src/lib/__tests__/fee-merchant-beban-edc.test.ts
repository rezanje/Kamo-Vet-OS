import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { KODE_SISTEM } from "@/lib/coa-sistem";

// Anisa 25 Nov 2026: fee merchant POS masuk ke 740018 Beban Admin EDC, bukan pendapatan lain-lain (810004).
const sql = readFileSync(new URL("../../../supabase/migrations/20261214100000_fee_merchant_beban_admin_edc.sql", import.meta.url), "utf8");

it("posts new merchant fees to 740018 and no longer to 810004", () => {
  expect(sql).toContain("jsonb_build_object(''code'',''810004'',''debit'',0,''credit'',new.merchant_fee_total)");
  expect(sql).toContain("jsonb_build_object(''code'',''740018'',''debit'',0,''credit'',new.merchant_fee_total)");
  expect(sql).toContain("position('''810004''' in pg_get_functiondef('public.pos_sale_record_payments()'");
});

it("refunds reverse the fee on the same account the original receipt used", () => {
  expect(sql.match(/filter\(where code in\(''810004'',''740018''\)\)/g)).toHaveLength(2);
  expect(sql.match(/then ''740018'' else ''810004'' end,''debit'',fee/g)).toHaveLength(2);
});

it("protects 740018 as a system account in app and database", () => {
  expect(KODE_SISTEM["740018"]).toMatch(/EDC/);
  expect(sql).toMatch(/coa_import_system_codes\(\)[\s\S]*'740018'\]::text\[\]/);
});

it("fails closed when an anchor is missing instead of silently skipping", () => {
  expect(sql).toContain("jangkar harus muncul % kali");
});
