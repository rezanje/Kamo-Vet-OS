import { beforeEach, expect, it, vi } from "vitest";
import { catatPembelian } from "@/app/(app)/pos/inventaris-operasional/pembelian/actions";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  approval: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: mocks.from,
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/persetujuan-server", () => ({ cekPersetujuan: mocks.approval }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(url); },
}));

const ID = "11111111-1111-4111-8111-111111111111";
const saved = { purchase_id: ID, cash_entry_id: ID, no_bukti: "KK-01" };

function purchaseForm() {
  const form = new FormData();
  form.set("branch_id", ID);
  form.set("request_key", "retry-after-approval");
  form.set("item_id", ID);
  form.set("account_id", ID);
  form.set("qty", "2");
  form.set("nominal", "20000");
  form.set("lampiran", JSON.stringify([{ path: "pengeluaran/uji.pdf", nama: "uji.pdf" }]));
  return form;
}

beforeEach(() => vi.resetAllMocks());

it("mengembalikan pembelian tersimpan tanpa mengajukan ulang persetujuan yang telah dipakai", async () => {
  mocks.rpc.mockResolvedValue({ data: saved, error: null });

  await expect(catatPembelian(purchaseForm())).rejects.toThrow("success=");
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledWith("inventaris_operasional_beli", expect.objectContaining({
    p_request_key: "retry-after-approval",
  }));
  expect(mocks.approval).not.toHaveBeenCalled();
});

it("menahan pembelian baru jika database meminta persetujuan dan pengajuan masih menunggu", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "INVENTARIS_PERLU_PERSETUJUAN: perlu izin" } });
  mocks.from.mockReturnValue({
    select: () => ({ maybeSingle: async () => ({ data: { beban_code: "740001" }, error: null }) }),
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: ID } } });
  mocks.approval.mockResolvedValue({ boleh: false, pesan: "Menunggu persetujuan" });

  await expect(catatPembelian(purchaseForm())).rejects.toThrow("Menunggu+persetujuan");
  expect(mocks.approval).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    deferConsumption: true,
  }));
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
