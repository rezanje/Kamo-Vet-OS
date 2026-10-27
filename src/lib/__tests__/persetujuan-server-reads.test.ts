import { expect, it } from "vitest";
import { cekPersetujuan } from "../persetujuan-server";

function fixture(options: {
  ruleError?: boolean; ruleShort?: boolean; noRule?: boolean;
  requestError?: boolean; approved?: boolean; updateMissing?: boolean;
} = {}) {
  let inserts = 0;
  const rule = { id: "rule", jenis: "kas-keluar", min_nilai: 100, penyetuju_role: "OWNER", is_active: true };
  const request = { id: "request", status: "disetujui", catatan: null };
  const client = { from(table: string) {
    let updating = false;
    const q = {
      select: () => updating ? Promise.resolve({ data: options.updateMissing ? [] : [{ id: request.id }], error: null }) : q,
      eq: () => q, in: () => q, order: () => q,
      range: async () => ({ data: options.ruleShort ? [] : options.noRule ? [] : [rule], count: options.noRule ? 0 : 1,
        error: options.ruleError ? { message: "fixture read failure" } : null }),
      limit: async () => ({ data: options.approved ? [request] : [], error: options.requestError ? { message: "fixture read failure" } : null }),
      update: () => { updating = true; return q; },
      insert: async () => { inserts++; return { error: null }; },
    };
    if (!['approval_rules', 'approval_requests'].includes(table)) throw Error('Unexpected table');
    return q;
  } };
  const check = () => cekPersetujuan(client, { jenis: "kas-keluar", refId: "fixture", nilai: 200 });
  return { check, insertCount: () => inserts };
}

it.each([{ ruleError: true }, { ruleShort: true }])("holds payment when approval rules cannot be verified: %j", async options => {
  const { check, insertCount } = fixture(options);
  await expect(check()).resolves.toMatchObject({ boleh: false, pesan: expect.stringContaining("Aturan persetujuan belum dapat diverifikasi") });
  expect(insertCount()).toBe(0);
});

it("allows a transaction only after a complete read confirms no matching rule", async () => {
  await expect(fixture({ noRule: true }).check()).resolves.toEqual({ boleh: true });
});

it("creates a pending request and holds the transaction when a rule applies", async () => {
  const { check, insertCount } = fixture();
  await expect(check()).resolves.toMatchObject({ boleh: false });
  expect(insertCount()).toBe(1);
});

it("holds payment if the existing approval request cannot be read", async () => {
  const { check, insertCount } = fixture({ requestError: true });
  await expect(check()).resolves.toMatchObject({ boleh: false, pesan: expect.stringContaining("Pengajuan persetujuan belum dapat diverifikasi") });
  expect(insertCount()).toBe(0);
});

it("holds payment if an approved request cannot be marked used", async () => {
  await expect(fixture({ approved: true, updateMissing: true }).check())
    .resolves.toMatchObject({ boleh: false, pesan: expect.stringContaining("belum dapat dipakai") });
  await expect(fixture({ approved: true }).check()).resolves.toEqual({ boleh: true });
});
