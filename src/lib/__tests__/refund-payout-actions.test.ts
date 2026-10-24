import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:s.rpc})}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error(decodeURIComponent(url));}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {buatReturJual} from '@/app/(app)/penjualan/retur/actions';
const sale='10000000-0000-4000-8000-000000000001',request='20000000-0000-4000-8000-000000000002';
const form=(method='Transfer')=>{const f=new FormData();for(const [key,value] of Object.entries({sale_id:sale,source_ref:'STR.FICTION',request_key:'stable',refund_method:method,refund_bank:'Fictional bank',refund_account:'00012345',refund_name:'Fictional recipient',tanggal:'2026-10-23',items:'[{"source_line_id":"line","item_id":"item","qty":1,"satuan":"pcs","kondisi":"baik"}]'}))f.set(key,value);return f;};
beforeEach(()=>{s.rpc.mockReset();});
it('acknowledges a pending request with explicit no-posting wording, never return success',async()=>{
 s.rpc.mockResolvedValue({data:{refund_request_id:request,status:'pending',quoted_total:50000,source_ref:'STR.FICTION'},error:null});
 await expect(buatReturJual(form())).rejects.toThrow('belum diposting');
 expect(s.rpc).toHaveBeenCalledExactlyOnceWith('post_sales_return_with_payout',{p_source:sale,p_request_key:'stable',p_header:expect.objectContaining({refund_method:'Transfer',destination:{bank:'Fictional bank',account:'00012345',name:'Fictional recipient'}}),p_items:expect.any(Array)});
});
it('confirms cash only with a valid completed return receipt',async()=>{
 s.rpc.mockResolvedValue({data:{refund_request_id:request,status:'selesai',document_id:'30000000-0000-4000-8000-000000000003',document_no:'RJ.FICTION'},error:null});
 await expect(buatReturJual(form('Tunai'))).rejects.toThrow('request_done=stable');
});
it.each([null,{status:'pending'},{status:'selesai',document_no:'fake'}])('does not acknowledge malformed payout response %j',async data=>{
 s.rpc.mockResolvedValue({data,error:null});await expect(buatReturJual(form())).rejects.toThrow('belum terkonfirmasi');
});
it('recovers by key without validating/returning the items again',async()=>{
 s.rpc.mockResolvedValue({data:{refund_request_id:request,status:'pending',quoted_total:50000},error:null});const f=form();f.set('tindakan','periksa');f.set('items','invalid');
 await expect(buatReturJual(f)).rejects.toThrow('belum diposting');expect(s.rpc).toHaveBeenCalledExactlyOnceWith('get_sales_refund_result',{p_request_key:'stable'});
});
it('treats a missing transport envelope as uncertain rather than throwing a destructuring error',async()=>{s.rpc.mockResolvedValue(undefined);await expect(buatReturJual(form())).rejects.toThrow(/belum terkonfirmasi/);});
it('acknowledges a verified unpaid cancellation during receipt-only recovery without another posting',async()=>{
 s.rpc.mockResolvedValue({data:{refund_request_id:request,status:'batal',quoted_total:50000},error:null});const f=form();f.set('tindakan','periksa');
 const message=await buatReturJual(f).then(()=>'',e=>e.message);
 expect(message).toContain('dibatalkan');expect(message).toContain('request_done=stable');expect(message).not.toContain('belum terkonfirmasi');expect(s.rpc).toHaveBeenCalledExactlyOnceWith('get_sales_refund_result',{p_request_key:'stable'});
});
