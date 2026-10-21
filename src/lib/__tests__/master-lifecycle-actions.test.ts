import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({guard:vi.fn(),rpc:vi.fn(),redirect:vi.fn(),revalidate:vi.fn()}));
vi.mock("@/lib/master-guard",()=>({assertMasterAdmin:mocks.guard}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
import { changeMasterLifecycle } from "../../app/(app)/master-data/actions";
const id="11111111-1111-4111-8111-111111111111";
function form(extra:Record<string,string>={}){const data=new FormData();for(const[k,v]of Object.entries({entity:"items",id,revision:"4",action:"trash",reason:" salah entri ",filters:"cari=kucing&hal=2&view=inactive",...extra}))data.set(k,v);return data;}
beforeEach(()=>{vi.resetAllMocks();mocks.guard.mockResolvedValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:{id,revision:5},error:null});mocks.redirect.mockImplementation((url:string)=>{throw new Error(`REDIRECT:${url}`)});});
it("rejects malformed input before authorization or database access",async()=>{expect(await changeMasterLifecycle(form({action:"delete"}))).toHaveProperty("error");expect(mocks.guard).not.toHaveBeenCalled();});
it("uses the current master authorization and one atomic RPC, never a delete",async()=>{await expect(changeMasterLifecycle(form())).rejects.toThrow("REDIRECT:/pos/sku?view=inactive&cari=kucing&hal=2&success=");expect(mocks.guard).toHaveBeenCalledWith("/pos/sku?view=inactive&cari=kucing&hal=2","master data");expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("change_master_data_lifecycle",{p_entity:"items",p_id:id,p_action:"trash",p_expected_revision:4,p_reason:"salah entri"});expect(mocks.revalidate).toHaveBeenCalledWith("/hris/karyawan");});
it("returns reference/stale errors without redirect or successful invalidation",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:"Gunakan Nonaktifkan"}});expect(await changeMasterLifecycle(form())).toEqual({error:"Gunakan Nonaktifkan"});expect(mocks.redirect).not.toHaveBeenCalled();expect(mocks.revalidate).not.toHaveBeenCalled();});
it("does not claim success for an empty database response",async()=>{mocks.rpc.mockResolvedValue({data:null,error:null});expect((await changeMasterLifecycle(form())).error).toContain("belum terkonfirmasi");expect(mocks.redirect).not.toHaveBeenCalled();});
it("denies a current unauthorized/inactive user before calling RPC",async()=>{mocks.guard.mockRejectedValue(new Error("DENIED"));await expect(changeMasterLifecycle(form())).rejects.toThrow("DENIED");expect(mocks.rpc).not.toHaveBeenCalled();});
it("describes inactive restore and preserves the supplier tab",async()=>{await expect(changeMasterLifecycle(form({entity:"suppliers",action:"restore",filters:"view=trash"}))).rejects.toThrow("REDIRECT:/pembelian?tab=supplier&view=trash&success=");const url=decodeURIComponent(mocks.redirect.mock.calls[0][0]);expect(url).toContain("status Nonaktif");});
