import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/master-guard", () => ({ klienMasterAdmin: guard }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-10-05" }));
import { simpanPenugasanCabang } from "../../app/(app)/hris/karyawan/actions";
const employee="a1000000-0000-4000-8000-000000000001",a="a2000000-0000-4000-8000-000000000001",b="a2000000-0000-4000-8000-000000000002";
const form=()=>{const f=new FormData();f.set("employee_id",employee);f.append("branch_ids",a);f.append("branch_ids",b);return f;};
beforeEach(()=>{rpc.mockReset().mockResolvedValue({data:2,error:null});guard.mockReset().mockResolvedValue({rpc});});
describe("atomic employee assignment action",()=>{
 it("sends all selected branches to exactly one guarded RPC",async()=>{
  await expect(simpanPenugasanCabang(null,form())).resolves.toMatchObject({ok:true});
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("assign_employee_secondary_branches",{p_employee_id:employee,p_branch_ids:[a,b],p_effective_date:"2026-10-05"});
 });
 it("does not write invalid selections",async()=>{const f=form();f.append("branch_ids","bad");await expect(simpanPenugasanCabang(null,f)).resolves.toMatchObject({ok:false});expect(rpc).not.toHaveBeenCalled();});
 it("reports a failed atomic operation without success or leaking database details",async()=>{
  rpc.mockResolvedValue({error:{message:"private database detail"},data:null});
  const hasil=await simpanPenugasanCabang(null,form());
  expect(hasil).toMatchObject({ok:false});
  expect(hasil!.pesan).not.toContain("private database detail");
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it("never writes if the admin guard denies access",async()=>{guard.mockResolvedValue(null);await expect(simpanPenugasanCabang(null,form())).resolves.toMatchObject({ok:false});expect(rpc).not.toHaveBeenCalled();});
 // Keluhan "loading lama": aksi ini tidak boleh lagi melempar redirect ke daftar
 // karyawan, karena itulah yang memaksa seluruh direktori dirender ulang.
 it("returns a message instead of redirecting to the full employee list",async()=>{
  const hasil=await simpanPenugasanCabang(null,form());
  expect(hasil!.pesan).toContain("2 cabang");
 });
});
