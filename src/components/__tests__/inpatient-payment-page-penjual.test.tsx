import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ staffError: false, staffBranch: null as string | null | undefined, role: "STAFF" }));
vi.mock("@/lib/clinic-payment", () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [] }), loadClinicPackages: async () => [] }));
vi.mock("@/lib/dp-minimal", () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock("@/lib/service-performers-server", () => ({
  loadServiceStaff: async (_db: unknown, branchId: string | null) => {
    h.staffBranch = branchId;
    if (h.staffError) throw new Error("gagal baca karyawan");
    return [{ id: "doc-1", nama: "drh. Fiktif", jabatan: "Dokter Hewan" }];
  },
  loadBranchGroomingPolicy: async () => ({ applies: false, doctorRequired: false }),
}));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier", () => ({
  InpatientCashier: (props: { serviceStaff?: unknown[]; visitDoctorId?: string | null; canChangePerformers?: boolean }) =>
    <div data-staff={JSON.stringify(props.serviceStaff ?? null)} data-doctor={props.visitDoctorId ?? ""} data-change={String(props.canChangePerformers)}>Kasir</div>,
}));
import { InpatientPaymentPage } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientPaymentPage";
const client = () => ({
  rpc: async () => ({ data: { snapshot: "snap", rows: [], history: [], receipts: [], applications: [], tax_settings: { mode_pkp: false, ppn_rate: 0 }, quote: { accounts: [], remaining: 0, pending: 0, subtotal: 0, tax: 0 } }, error: null }),
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: h.role, full_name: "Kasir" }, error: null }) }; return q; },
});
const patient = { photo: null, name: "P", species: "Kucing", owner: "O", phone: "", address: "", dokter: "D", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "01/11/2026" };
const run = async () => renderToStaticMarkup(await InpatientPaymentPage({ db: client() as never, visitId: "v", recordId: "s", branchId: "branch-1", userId: "u", query: {}, patient, visitDoctorId: "doc-1" } as never));
beforeEach(() => { h.staffError = false; h.staffBranch = undefined; h.role = "STAFF"; });
it("kasir ranap menerima daftar tenaga penjual cabang dan dokter PJ kunjungan", async () => {
  const html = await run();
  expect(h.staffBranch).toBe("branch-1");
  expect(html).toContain("drh. Fiktif");
  expect(html).toContain('data-doctor="doc-1"');
});
it("daftar tenaga penjual gagal dibaca: gagal tertutup, bukan kasir tanpa pemilih", async () => {
  h.staffError = true;
  const html = await run();
  expect(html).toContain("belum dapat diverifikasi");
  expect(html).not.toContain("Kasir</div>");
});
it.each([["STAFF", "true"], ["ADMIN", "true"], ["OWNER", "true"], ["FINANCE", "true"], ["DOCTOR", "false"]])("peran %s: hak mengganti pelaksana baris pending = %s", async (role, expected) => {
  h.role = role;
  expect(await run()).toContain(`data-change="${expected}"`);
});
