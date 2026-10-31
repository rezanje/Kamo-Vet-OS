import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ inserted: [] as { table: string; value: Record<string, unknown> }[], accountType: "ASET" as "ASET" | "LIABILITAS" }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/master-guard", () => ({ assertMasterAdmin: async () => ({
  from(table: string) {
    const query = {
      select() { return query; }, eq() { return query; },
      async maybeSingle() {
        if (table === "branches") return { data: { id: "cms", type: "PETSHOP", is_active: true }, error: null };
        if (table === "coa_accounts") return { data: { code: "110006", name: "Kas Toko CMS", type: state.accountType, is_active: true, is_header: false }, error: null };
        throw Error(`Unexpected lookup: ${table}`);
      },
      async insert(value: Record<string, unknown>) { state.inserted.push({ table, value }); return { error: null }; },
    };
    return query;
  },
}) }));
import { hubungkanKasCabang } from "@/app/(app)/kas-bank/rekening/actions";

beforeEach(() => { state.inserted = []; state.accountType = "ASET"; });

function form() {
  const value = new FormData();
  value.set("branch_id", "cms"); value.set("coa_code", "110006");
  return value;
}

it("links an existing COA cash detail without creating an account or posting an opening balance", async () => {
  await expect(hubungkanKasCabang(form())).rejects.toThrow("success");
  expect(state.inserted).toEqual([{ table: "cash_accounts", value: {
    nama: "Kas Toko CMS", jenis: "Kas", coa_code: "110006", branch_id: "cms", is_active: true,
  } }]);
});

it("does not link a non-asset account", async () => {
  state.accountType = "LIABILITAS";
  await expect(hubungkanKasCabang(form())).rejects.toThrow("Akun%20kas");
  expect(state.inserted).toEqual([]);
});
