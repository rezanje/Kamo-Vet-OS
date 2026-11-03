import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getUser: vi.fn(), signup: vi.fn(), update: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signUp: db.signup } }) }));
const client = () => ({ rpc: db.rpc, from: db.from, auth: { getUser: db.getUser } });
vi.mock("@/lib/master-guard", () => ({
  assertRole: async () => client(), assertMasterAdmin: async () => client(), assertHrisManager: async () => client(),
  assertAccountCreator: async () => client(), klienMasterAdmin: async () => client(), bolehKelolaPayroll: async () => false,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
import { roleActionRefusal, roleRpcFailure } from "../role-action-access";
import { buatTransfer, pulihkanTransfer } from "@/app/(app)/kas-bank/transfer/actions";
import { prosesRekonsiliasi, pulihkanRekonsiliasi } from "@/app/(app)/keuangan/rekonsiliasi/actions";
import { editKaryawan } from "@/app/(app)/hris/karyawan/actions";
import { assignUser, unassignUser } from "@/app/(app)/perusahaan/cabang/actions";
import { buatPengguna, togglePengguna, simpanEditPengguna } from "@/app/(app)/pengaturan/pengguna/actions";

const id = "efa40000-0000-4000-8000-000000000001";
const decode = (e: unknown) => decodeURIComponent(String((e as Error).message).replaceAll("+", " "));
const raw = /ROLE_[A-Z_]+|BANK_SCOPE|EMPLOYEE_SCOPE|PEOPLE_ACCOUNT|could not obtain|42501|55P03|40001/;
const denied = { code: "42501", message: "ROLE_ACTION_DENIED: tindakan tidak diizinkan" };
const busy = { code: "40001", message: "PEOPLE_ACCOUNT_BUSY: akun sedang dipakai proses lain, ulangi" };
const lock = { code: "55P03", message: 'could not obtain lock on relation "profiles"' };
const bank = { code: "42501", message: "BANK_SCOPE_DENIED: all_branches" };
const emp = { code: "42501", message: "EMPLOYEE_SCOPE_DENIED: cabang karyawan di luar cakupan akun" };

beforeEach(() => {
  vi.clearAllMocks(); db.rpc.mockReset(); db.rpc.mockResolvedValue({ data: true, error: null });
  db.getUser.mockResolvedValue({ data: { user: { id: "actor" } } });
  db.signup.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  db.update.mockReturnValue({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id }, error: null }) }) }) });
  db.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "employee", role: "ADMIN", profile_id: null, status: "Aktif" } }) }), in: () => ({ eq: async () => ({ data: [{ id: "branch" }] }) }) }),
    update: db.update,
  });
});

it.each([
  [{ code: "P0001", message: "ROLE_REVISION_CONFLICT" }, "rejected", /Muat ulang/],
  [{ code: "P0001", message: "ROLE_OWNER_REQUIRED" }, "rejected", /pemilik/i],
  [lock, "retry", /coba lagi/i],
  [busy, "retry", /coba lagi/i],
  [{ code: "40P01", message: "deadlock detected" }, "retry", /coba lagi/i],
  [denied, "rejected", /tidak diizinkan/],
  [bank, "rejected", /cakupan/],
  [emp, "rejected", /cakupan/],
] as const)("classifies %j as a deterministic %s result in Indonesian", (error, outcome, text) => {
  const result = roleRpcFailure(error);
  expect(result).toMatchObject({ ok: false, outcome });
  expect(result!.message).toMatch(text);
  expect(result!.message).not.toMatch(raw);
});
it("never classifies unknown/network errors as deterministic", () => {
  for (const error of [{ message: "fetch failed" }, { code: "XX000", message: "boom" }, null, undefined, "x", {}]) expect(roleRpcFailure(error)).toBeNull();
});
it("keeps the retry message distinct from every rejection message", () => {
  const messages = new Set([lock, busy, denied, bank, emp, { message: "ROLE_REVISION_CONFLICT" }, { message: "ROLE_OWNER_REQUIRED" }].map(e => roleRpcFailure(e)!.message));
  expect(messages.size).toBe(6);
  expect(roleRpcFailure(lock)!.message).toBe(roleRpcFailure(busy)!.message);
});
it("roleActionRefusal returns null only for authoritative true; otherwise a message, never a thrown masked error", async () => {
  expect(await roleActionRefusal({ rpc: async () => ({ data: true, error: null }) }, "x")).toBeNull();
  expect(await roleActionRefusal({ rpc: async () => ({ data: false, error: null }) }, "x")).toMatchObject({ outcome: "rejected", message: expect.stringContaining("tidak diizinkan") });
  expect(await roleActionRefusal({ rpc: async () => ({ data: null, error: lock }) }, "x")).toMatchObject({ outcome: "retry" });
  for (const bad of [async () => { throw new Error("socket"); }, async () => ({ data: "true", error: null }), async () => null]) {
    const r = await roleActionRefusal({ rpc: bad as never }, "x");
    expect(r).toMatchObject({ ok: false });
    expect(r!.message).toMatch(/belum dapat diperiksa/);
  }
});

it("transfer: ROLE_ACTION_DENIED / lock busy / read failure reach the form as redirect errors with clear Indonesian, before any posting", async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ tanggal: "2026-10-20", from_account_id: "a", to_account_id: "b", jumlah: "100", biaya_admin: "0", draft_key: "key", draft_scope: "bank-transfer-create" })) form.set(k, v);
  db.rpc.mockResolvedValueOnce({ data: false, error: null });
  const denial = await buatTransfer(form).catch(e => e);
  expect(String(denial.message)).toContain("/kas-bank/transfer?error="); expect(decode(denial)).toMatch(/tidak diizinkan/); expect(decode(denial)).not.toMatch(raw);
  db.rpc.mockResolvedValueOnce({ data: null, error: lock });
  expect(decode(await buatTransfer(form).catch(e => e))).toMatch(/coba lagi/i);
  expect(db.rpc.mock.calls.filter(c => c[0] === "mutate_cash_transfer")).toHaveLength(0);
  db.rpc.mockResolvedValueOnce({ data: null, error: lock });
  expect(decode(await pulihkanTransfer(form).catch(e => e))).toMatch(/coba lagi/i);
});
it("transfer: BANK_SCOPE_DENIED and ROLE_ACTION_DENIED from the RPC are mapped, lock busy keeps its message", async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ tanggal: "2026-10-20", from_account_id: "a", to_account_id: "b", jumlah: "100", biaya_admin: "0", draft_key: "key", draft_scope: "bank-transfer-create" })) form.set(k, v);
  for (const [error, text] of [[bank, /cakupan/], [denied, /tidak diizinkan/], [lock, /sedang diproses/]] as const) {
    db.rpc.mockReset(); db.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error });
    const e = decode(await buatTransfer(form).catch(x => x)); expect(e).toMatch(text); expect(e).not.toMatch(raw);
  }
});
it("reconciliation: denial, 40001 and scope denials are mapped; unknown stays the existing text", async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ draft_key: "k", draft_scope: "bank-reconciliation-create", account_id: id, tanggal: "2026-01-01", saldo_bank: "1", biaya_adm: "0", bunga: "0" })) form.set(k, v);
  db.rpc.mockResolvedValueOnce({ data: false, error: null });
  const denial = decode(await prosesRekonsiliasi(form).catch(e => e)); expect(denial).toContain("/keuangan/rekonsiliasi?error="); expect(denial).toMatch(/tidak diizinkan/);
  for (const [error, text] of [[{ code: "40001", message: "could not serialize access" }, /Pembukuan sedang dipakai/], [busy, /Pembukuan sedang dipakai|coba lagi/i], [bank, /cakupan/], [denied, /tidak diizinkan/]] as const) {
    db.rpc.mockReset(); db.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error });
    const e = decode(await prosesRekonsiliasi(form).catch(x => x)); expect(e).toMatch(text); expect(e).not.toMatch(raw);
  }
  db.rpc.mockReset(); db.rpc.mockResolvedValueOnce({ data: null, error: lock });
  const recovery = new FormData(); recovery.set("draft_key", "k"); recovery.set("draft_scope", "bank-reconciliation-create");
  expect(decode(await pulihkanRekonsiliasi(recovery).catch(e => e))).toMatch(/coba lagi/i);
});
it("employee edit: policy denial, scope denial and lock busy are three distinct Indonesian outcomes; other errors keep the generic text", async () => {
  const form = new FormData(); form.set("id", id); form.set("nama", "Employee"); form.set("status", "Aktif");
  db.rpc.mockResolvedValue({ data: false, error: null });
  const policy = decode(await editKaryawan(form).catch(e => e)); expect(policy).toContain(`/hris/karyawan/${id}?edit=1&error=`); expect(policy).toMatch(/tidak diizinkan/);
  expect(db.from).not.toHaveBeenCalled();
  db.rpc.mockResolvedValue({ data: true, error: null });
  const results: string[] = [];
  for (const error of [emp, lock, { code: "XX000", message: "boom" }]) {
    db.update.mockReturnValue({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error }) }) }) });
    results.push(decode(await editKaryawan(form).catch(e => e)));
  }
  expect(results[0]).toMatch(/cakupan/); expect(results[1]).toMatch(/coba lagi/i); expect(results[2]).toContain("Data karyawan gagal diperbarui");
  expect(new Set(results).size).toBe(3); for (const r of results.slice(0, 2)) expect(r).not.toMatch(raw);
});
it("branch assignment shows mapped Indonesian text, never the raw database message", async () => {
  const form = new FormData(); form.set("user_id", "u"); form.set("branch_id", "b");
  db.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "ADMIN" } }) }) }) });
  for (const action of [assignUser, unassignUser]) {
    for (const [error, text] of [[busy, /coba lagi/i], [denied, /tidak diizinkan/], [emp, /cakupan/], [{ code: "XX000", message: "relation public.user_branches boom" }, /Penugasan cabang gagal/]] as const) {
      db.rpc.mockResolvedValue({ data: null, error });
      const e = decode(await action(form).catch(x => x)); expect(e).toContain("/perusahaan/cabang?error="); expect(e).toMatch(text); expect(e).not.toMatch(raw); expect(e).not.toContain("boom");
    }
  }
});
it("account create/toggle/edit map busy vs denied and never call a busy 40001 an edit conflict", async () => {
  const create = new FormData();
  for (const [k, v] of Object.entries({ full_name: "P", email: "x@fiction.invalid", password: "fictional-only", role: "STAFF", employee_id: "employee" })) create.set(k, v);
  create.append("branch_ids", "branch");
  db.rpc.mockResolvedValue({ data: null, error: denied });
  const refused = decode(await buatPengguna(create).catch(e => e)); expect(refused).toMatch(/tidak diizinkan/); expect(db.signup).not.toHaveBeenCalled();
  const toggle = new FormData(); toggle.set("id", "target"); toggle.set("aktif", "1");
  db.rpc.mockResolvedValue({ data: null, error: busy });
  const busyMsg = decode(await togglePengguna(toggle).catch(e => e)); expect(busyMsg).toMatch(/coba lagi/i); expect(busyMsg).not.toMatch(raw);
  db.rpc.mockResolvedValue({ data: null, error: denied });
  expect(decode(await togglePengguna(toggle).catch(e => e))).toMatch(/tidak diizinkan/);
  db.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
  expect(decode(await togglePengguna(toggle).catch(e => e))).toContain("Status akun gagal disimpan");
  const edit = new FormData();
  for (const [k, v] of Object.entries({ profile_id: id, full_name: "Name", role: "STAFF", expected_version: "v1", request_id: id })) edit.set(k, v);
  db.rpc.mockResolvedValue({ data: null, error: busy });
  const editBusy = await simpanEditPengguna(edit); expect(editBusy.message).toMatch(/coba lagi/i); expect(editBusy.message).not.toMatch(/sudah berubah/);
  db.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "ACCOUNT_EDIT_CONFLICT: version" } });
  expect((await simpanEditPengguna(edit)).message).toMatch(/sudah berubah/);
  db.rpc.mockResolvedValue({ data: null, error: denied });
  expect((await simpanEditPengguna(edit)).message).toMatch(/tidak diizinkan/);
});
it("account creation: when configuration fails AFTER Auth signup the message says the login exists, not to recreate it, and what to do; busy is retryable", async () => {
  const create = new FormData();
  for (const [k, v] of Object.entries({ full_name: "P", email: "Person@Fiction.Invalid", password: "fictional-only", role: "STAFF", employee_id: "employee" })) create.set(k, v);
  create.append("branch_ids", "branch");
  for (const error of [busy, { message: "conflict" }, denied]) {
    db.rpc.mockReset(); db.rpc.mockImplementation(async (name: string) => ({ data: null, error: name === "configure_employee_account" ? error : null }));
    db.signup.mockClear();
    const msg = decode(await buatPengguna(create).catch(e => e));
    expect(db.signup).toHaveBeenCalledOnce();
    expect(msg).toContain("person@fiction.invalid"); expect(msg).toMatch(/sudah terbentuk/); expect(msg).toMatch(/belum (selesai|dikonfigurasi|diatur)/);
    expect(msg).toMatch(/jangan (membuat|mendaftarkan) ulang/i); expect(msg).toMatch(/Tautkan|Edit|Super Admin/);
    expect(msg).not.toMatch(raw);
  }
  db.rpc.mockReset(); db.rpc.mockImplementation(async (name: string) => ({ data: null, error: name === "configure_employee_account" ? busy : null }));
  expect(decode(await buatPengguna(create).catch(e => e))).toMatch(/beberapa detik/);
});
