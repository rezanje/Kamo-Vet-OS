import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "STAFF",
  user: "u" as string | null,
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  error: null as null | { message: string; code: string },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user ? { id: state.user } : null },
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpc.push({ name, args });
      return { error: state.error };
    },
    from: (t: string) => {
      if (t === "profiles")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { role: state.role },
                error: null,
              }),
            }),
          }),
        };
      const q: Record<string, unknown> = {
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: { id: "other" }, error: null }).then(r),
        maybeSingle: async () => ({ data: { id: "other" }, error: null }),
      };
      for (const m of ["select", "insert", "update", "eq", "in"])
        q[m] = () => q;
      return q;
    },
  }),
}));
import { ajukanCutiPribadi } from "../../app/me/actions";
import {
  ajukanLembur,
  ajukanKasbon,
  ajukanReimburse,
} from "../../app/me/pengajuan";
import {
  setujuiLembur,
  tolakReimburse,
  setujuiKasbon,
} from "../../app/(app)/hris/pengajuan/actions";
import { updateLeaveStatus } from "../../app/(app)/hris/cuti/actions";
const form = () => {
  const f = new FormData();
  Object.entries({
    employee_id: "forged",
    status: "Disetujui",
    jenis: "Cuti",
    tanggal_mulai: "2026-10-08",
    tanggal_selesai: "2026-10-08",
    tanggal: "2026-10-01",
    jam: "2",
    alasan: "Alasan fiksi",
    keterangan: "Pengeluaran fiksi",
    jumlah: "100",
    tenor_bulan: "2",
    kategori: "Transport",
    catatan: "Keputusan fiksi",
    id: "request",
    account_id: "account",
  }).forEach(([k, v]) => f.set(k, v));
  return f;
};
beforeEach(() => {
  state.role = "STAFF";
  state.user = "u";
  state.error = null;
  state.rpc = [];
});
it("own leave does not accept forged employee or status", async () => {
  await expect(ajukanCutiPribadi(form())).rejects.toThrow("success=");
  expect(state.rpc[0].name).toBe("hris_submit_staff_request");
  expect(state.rpc[0].args.p_employee).toBeNull();
  expect(state.rpc[0].args.p_payload).not.toHaveProperty("employee_id");
  expect(state.rpc[0].args.p_payload).not.toHaveProperty("status");
});
it.each([
  ["overtime", ajukanLembur],
  ["cash", ajukanKasbon],
  ["reimburse", ajukanReimburse],
] as const)(
  "%s submission uses server-owned identity and pending status",
  async (kind, action) => {
    await expect(action(form())).rejects.toThrow("success=");
    expect(state.rpc[0].args.p_kind).toBe(kind);
    expect(state.rpc[0].args.p_employee).toBeNull();
    expect(state.rpc[0].args.p_payload).not.toHaveProperty("status");
  },
);
it("anonymous request is denied before submission", async () => {
  state.user = null;
  await expect(ajukanKasbon(form())).rejects.toThrow("/login");
  expect(state.rpc).toEqual([]);
});
it("staff cannot approve leave by sending Disetujui", async () => {
  await expect(updateLeaveStatus(form())).rejects.toThrow("error=");
  expect(state.rpc).toEqual([]);
});
it("branch HR uses locked request decision and independent rejection", async () => {
  state.role = "ADMIN";
  await expect(setujuiLembur(form())).rejects.toThrow("success=");
  await expect(tolakReimburse(form())).rejects.toThrow("success=");
  expect(state.rpc.map((x) => [x.args.p_kind, x.args.p_approve])).toEqual([
    ["overtime", true],
    ["reimburse", false],
  ]);
});
it("cash approval calls one atomic disbursement instead of raw update and best-effort journal", async () => {
  state.role = "OWNER";
  await expect(setujuiKasbon(form())).rejects.toThrow("success=");
  expect(state.rpc).toEqual([
    {
      name: "hris_decide_staff_request",
      args: {
        p_kind: "cash",
        p_id: "request",
        p_approve: true,
        p_reason: "Keputusan fiksi",
        p_tenor: 2,
        p_account: "account",
      },
    },
  ]);
});
it("database denial is reported without a success redirect", async () => {
  state.error = { code: "P0001", message: "HRIS: Periode gaji sudah final" };
  await expect(ajukanLembur(form())).rejects.toThrow("error=Periode");
});
