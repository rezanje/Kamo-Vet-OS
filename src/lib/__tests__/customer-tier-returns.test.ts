import {expect,it,vi} from "vitest";
import {recomputeCustomerTier} from "../customer-tier";
it("uses authoritative global recomputation without reading branch-filtered history in JavaScript",async()=>{
 const rpc=vi.fn().mockResolvedValue({data:true,error:null});const from=vi.fn(()=>{throw Error("branch-scoped read forbidden");});
 expect(await recomputeCustomerTier({rpc,from} as never,"customer")).toBe(true);
 expect(rpc).toHaveBeenCalledWith("refresh_customer_spending",{p_customer:"customer"});expect(from).not.toHaveBeenCalled();
});
it.each([{data:null,error:{message:"unavailable"}},{data:null,error:null},{data:false,error:null}])("keeps finalized transaction acknowledgement available on derived failure %j",async result=>{
 expect(await recomputeCustomerTier({rpc:vi.fn().mockResolvedValue(result)} as never,"customer")).toBe(false);
});
it("contains a transport exception after financial commit",async()=>{
 expect(await recomputeCustomerTier({rpc:vi.fn().mockRejectedValue(Error("transport"))} as never,"customer")).toBe(false);
});
it("skips anonymous customers without a request",async()=>{const rpc=vi.fn();expect(await recomputeCustomerTier({rpc} as never,"")).toBe(true);expect(rpc).not.toHaveBeenCalled();});
