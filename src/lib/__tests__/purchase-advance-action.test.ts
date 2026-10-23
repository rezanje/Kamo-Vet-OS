import {beforeEach,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn(),writes:[] as unknown[]}));
const db={rpc:fixture.rpc,auth:{getUser:async()=>({data:{user:{id:'fiction-owner'}}})},from(){const q={select(){return q},eq(){return q},insert(value:unknown){fixture.writes.push(value);return q},maybeSingle:async()=>({data:{id:'po',supplier_id:'supplier',branch_id:'branch'}}),then(resolve:(x:unknown)=>unknown){return Promise.resolve({data:[],error:null}).then(resolve)}};return q}};
vi.mock('@/lib/master-guard',()=>({assertRole:async()=>db}));
vi.mock('@/lib/no-dokumen',()=>({formatDokumen:async()=>({prefix:'UM.QA.',digit:5}),nomorBerikutnya:async()=>({nomor:'UM.QA.00001'})}));
vi.mock('@/lib/jurnal-guard',()=>({cekPeriode:async()=>null}));
vi.mock('@/lib/kas-akun',()=>({kodeAkunBayar:async()=> '1102'}));
vi.mock('@/lib/posting',()=>({postJournal:async()=>{}}));
vi.mock('@/lib/transaction-draft-ack',async()=>({...await import('../transaction-draft-ack'),assertDraftJournal:async()=>{}}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Object.assign(Error(url),{digest:'NEXT_REDIRECT'})}}));vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {bayarUangMuka,periksaUangMuka,batalkanUangMuka} from '@/app/(app)/pembelian/uang-muka/actions';
const data=()=>{const f=new FormData();Object.entries({supplier_id:'supplier',po_id:'po',jumlah:'200000',tanggal:'2026-10-22',draft_key:'stable-key',draft_scope:'purchase-advance'}).forEach(([k,v])=>f.set(k,v));return f};
beforeEach(()=>{fixture.rpc.mockReset();fixture.writes=[]});
it('posts one atomic advance and acknowledges only a complete durable receipt',async()=>{
 fixture.rpc.mockResolvedValue({data:{advance_id:'advance',journal_id:'journal',no_um:'UM.QA.00001'},error:null});
 await expect(bayarUangMuka(data())).rejects.toThrow('draft_done=stable-key');
 expect(fixture.writes).toEqual([]);expect(fixture.rpc).toHaveBeenCalledWith('pay_purchase_advance_atomic',expect.objectContaining({p_request_key:'stable-key',p_po_id:'po',p_jumlah:200000,p_supplier_id:'supplier'}));
});
it('does not leave a separately inserted advance or acknowledge a rejected cap/journal',async()=>{
 fixture.rpc.mockResolvedValue({data:null,error:{message:'Nominal melebihi sisa batas DP PO'}});
 await expect(bayarUangMuka(data())).rejects.toThrow('error=Nominal');expect(fixture.writes).toEqual([]);
});
it('never acknowledges a response without its journal receipt',async()=>{
 fixture.rpc.mockResolvedValue({data:{advance_id:'advance',no_um:'UM.QA.00001'},error:null});
 await expect(bayarUangMuka(data())).rejects.toThrow('belum%20terkonfirmasi');expect(fixture.writes).toEqual([]);
});
it.each(['','NaN','Infinity','1.25'])('rejects invalid or fractional whole-rupiah input %s before posting',async amount=>{
 const f=data();f.set('jumlah',amount);await expect(bayarUangMuka(f)).rejects.toThrow('error=');expect(fixture.rpc).not.toHaveBeenCalled();expect(fixture.writes).toEqual([]);
});
it('requires a retained request identity rather than generating a new retry key on the server',async()=>{const f=data();f.delete('draft_key');await expect(bayarUangMuka(f)).rejects.toThrow('error=');expect(fixture.writes).toEqual([])});

it('recovers the committed advance without replaying a payment and acknowledges the same key',async()=>{fixture.rpc.mockResolvedValue({data:{advance_id:'a',journal_id:'j',no_um:'UM.QA.00001'},error:null});await expect(periksaUangMuka(data())).rejects.toThrow('draft_done=stable-key');expect(fixture.rpc).toHaveBeenCalledOnce();expect(fixture.rpc).toHaveBeenCalledWith('get_purchase_advance_result',{p_request_key:'stable-key'});expect(fixture.writes).toEqual([])});
it('does not acknowledge or post when read-only recovery finds no receipt',async()=>{fixture.rpc.mockResolvedValue({data:null,error:null});await expect(periksaUangMuka(data())).rejects.toThrow('error=');expect(fixture.writes).toEqual([]);expect(fixture.rpc).toHaveBeenCalledOnce()});

it('cancels only through the atomic full-refund RPC',async()=>{fixture.rpc.mockResolvedValue({data:{advance_id:'a',journal_id:'j',no_um:'UM.QA.1'},error:null});const f=data();f.set('id','a');await expect(batalkanUangMuka(f)).rejects.toThrow('draft_done=stable-key');expect(fixture.rpc).toHaveBeenCalledWith('cancel_purchase_advance_atomic',{p_advance_id:'a'});expect(fixture.writes).toEqual([])});
it('does not acknowledge cancellation without the durable refund journal',async()=>{fixture.rpc.mockResolvedValue({data:{advance_id:'a'},error:null});const f=data();f.set('id','a');await expect(batalkanUangMuka(f)).rejects.toThrow('belum%20terkonfirmasi');expect(fixture.writes).toEqual([])});
