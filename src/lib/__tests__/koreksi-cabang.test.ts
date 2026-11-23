// Koreksi Kas & Jurnal manual boleh ganti cabang (permintaan Anisa, 20 Nov 2026).
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("@/lib/master-guard", () => ({ assertRole: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { koreksiKasEntry } from "@/app/(app)/kas-bank/kas/actions";
import { koreksiJurnal } from "@/app/(app)/keuangan/jurnal/actions";
import { rekeningUntukCabang } from "@/app/(app)/kas-bank/kas/KasCorrectionForm";

const ASAL = "11111111-1111-4111-8111-111111111111";
const BARU = "22222222-2222-4222-8222-222222222222";
const ok = { reversal_journal_id: "rev", replacement_journal_id: "rep" };

function kasForm(extra: Record<string, string>) {
  const f = new FormData();
  Object.entries({ jenis: "Keluar", id: "cash", revision: "0", draft_key: "k", draft_scope: "s", tanggal: "2026-11-13",
    account_id: "acc", lawan_code: "720004", jumlah: "189312.5", keterangan: "internet", reason: "salah cabang", ...extra })
    .forEach(([k, v]) => f.set(k, v));
  return f;
}
function jurnalForm(extra: Record<string, string>) {
  const f = new FormData();
  Object.entries({ entryId: "e", revision: "0", draft_key: "k", draft_scope: "s", tanggal: "2026-11-13", deskripsi: "x", reason: "salah cabang", lines: "[]", ...extra })
    .forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => fixture.rpc.mockReset());

it("kas: cabang baru dikirim ke database dan sukses bila terpasang", async () => {
  fixture.rpc.mockResolvedValue({ data: { ...ok, branch_id: BARU }, error: null });
  await expect(koreksiKasEntry(kasForm({ branch_id: BARU, branch_asal: ASAL }))).rejects.toThrow("success=edit");
  expect(fixture.rpc).toHaveBeenCalledWith("revise_cash_entry", expect.objectContaining({ p_header: expect.objectContaining({ branch_id: BARU }) }));
});

it("kas: '' berarti pindah ke Pusat", async () => {
  fixture.rpc.mockResolvedValue({ data: { ...ok, branch_id: null }, error: null });
  await expect(koreksiKasEntry(kasForm({ branch_id: "", branch_asal: ASAL }))).rejects.toThrow("success=edit");
  expect(fixture.rpc.mock.calls[0][1].p_header.branch_id).toBe("");
});

it("kas: tidak lapor sukses bila database belum mengganti cabang", async () => {
  fixture.rpc.mockResolvedValue({ data: ok, error: null });
  await expect(koreksiKasEntry(kasForm({ branch_id: BARU, branch_asal: ASAL }))).rejects.toThrow("error=");
});

it("kas: form tanpa pilihan cabang tetap memakai cabang asli", async () => {
  fixture.rpc.mockResolvedValue({ data: ok, error: null });
  await expect(koreksiKasEntry(kasForm({}))).rejects.toThrow("success=edit");
  expect(fixture.rpc.mock.calls[0][1].p_header).not.toHaveProperty("branch_id");
});

it("jurnal: cabang baru dikirim dan dicek hasilnya", async () => {
  fixture.rpc.mockResolvedValue({ data: { ...ok, branch_id: BARU }, error: null });
  await expect(koreksiJurnal(jurnalForm({ branchId: BARU, branchAsal: ASAL }))).rejects.toThrow("success=1");
  expect(fixture.rpc).toHaveBeenCalledWith("revise_manual_journal", expect.objectContaining({ p_header: { tanggal: "2026-11-13", deskripsi: "x", branch_id: BARU } }));
  fixture.rpc.mockResolvedValue({ data: ok, error: null });
  await expect(koreksiJurnal(jurnalForm({ branchId: BARU, branchAsal: ASAL }))).rejects.toThrow("error=");
});

it("rekening milik cabang lain tidak ditawarkan", () => {
  const rek = [{ id: "a", nama: "Kas Blu BCA", coa_code: "1", branch_id: null }, { id: "b", nama: "Kas Toko CMS", coa_code: "2", branch_id: BARU }, { id: "c", nama: "Kas Toko BTKM", coa_code: "3", branch_id: ASAL }];
  expect(rekeningUntukCabang(rek, BARU).map((r) => r.id)).toEqual(["a", "b"]);
  expect(rekeningUntukCabang(rek, "").map((r) => r.id)).toEqual(["a"]);
});
