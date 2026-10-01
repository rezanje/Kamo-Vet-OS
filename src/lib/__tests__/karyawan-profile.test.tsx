import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(()=>({allowed:true,role:'OWNER',branches:[{id:'b1',name:'Cabang 1'}],assignments:[{employee_id:'e1',branch_id:'b1',effective_date:'2026-01-01'}],queries:[] as string[]}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error(`redirect:${url}`);},notFound:()=>{throw new Error('notFound');}}));
vi.mock('@/lib/master-guard',()=>({bolehKelolaMaster:async()=>state.allowed,assertRole:async()=>{if(!state.allowed)throw new Error('redirect:/hris');return {};}}));
vi.mock('@/lib/jadwal-scope',()=>({aksesCabangHRIS:async()=>({role:state.role,branches:state.branches})}));
vi.mock('@/components/SubmitButton',()=>({SubmitButton:({children}:{children:React.ReactNode})=><button>{children}</button>}));
vi.mock('../supabase/server',()=>({createClient:async()=>({from:(table:string)=>{
 state.queries.push(table);
 const data:Record<string,unknown>={employees:{id:'e1',nama:'Fiktif',nik:'E001',gaji_pokok:100,status:'Aktif',branch_id:'b1'},employee_import_details:null,salary_components:[],employee_salary_components:[],branches:[{id:'b1',name:'Cabang 1'}],employee_branch_assignments:state.assignments,attendance:[{tanggal:'2026-10-01',status:'Hadir',jam_masuk:'08:00',jam_pulang:'16:00'}],payrolls:[{periode:'2026-09',total:123456,status:'final'}]};
 const result={data:data[table]??[],error:null};
 const q:Record<string,unknown>={then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({...result,data:table==='employees'?[data.employees]:result.data}).then(resolve)};
 for(const method of ['select','eq','order','limit','lte','in','or'])q[method]=()=>q;
 q.maybeSingle=async()=>result;return q;
}})}));
import Profile from '../../app/(app)/hris/karyawan/[id]/page';
beforeEach(()=>{state.allowed=true;state.role='OWNER';state.branches=[{id:'b1',name:'Cabang 1'}];state.assignments=[{employee_id:'e1',branch_id:'b1',effective_date:'2026-01-01'}];state.queries=[];});
it('staff denied before employee salary queries',async()=>{state.allowed=false;await expect(Profile({params:Promise.resolve({id:'e1'}),searchParams:Promise.resolve({})})).rejects.toThrow('redirect:');expect(state.queries).toEqual([]);});
it('attendance tab displays only employee history',async()=>{const html=renderToStaticMarkup(await Profile({params:Promise.resolve({id:'e1'}),searchParams:Promise.resolve({tab:'absensi'})}));expect(html).toContain('08:00');expect(html).toContain('16:00');expect(html).toContain('2026-10-01');});
it('pay history tab displays settled period and total',async()=>{const html=renderToStaticMarkup(await Profile({params:Promise.resolve({id:'e1'}),searchParams:Promise.resolve({tab:'gaji'})}));expect(html).toContain('2026-09');expect(html).toContain('123.456');expect(html).toContain('final');});
it('other branch admin denied before salary detail and history queries',async()=>{state.role='ADMIN';state.branches=[{id:'other',name:'Other'}];await expect(Profile({params:Promise.resolve({id:'e1'}),searchParams:Promise.resolve({tab:'gaji'})})).rejects.toThrow('redirect:');expect(state.queries).not.toContain('payrolls');expect(state.queries).not.toContain('employee_import_details');});
it('staff employee list does not render other employee salary',async()=>{
 state.allowed=false;
 const {default:List}=await import('../../app/(app)/hris/karyawan/page');
 const html=renderToStaticMarkup(await List({searchParams:Promise.resolve({})}));
 expect(html).not.toContain('Rp 100');
});
it.each(['penggajian/page','penggajian/slip/page','komponen-gaji/page'])('staff denied on salary route %s before data access',async(route)=>{
 state.allowed=false;
 const pages = {
  'penggajian/page':()=>import('../../app/(app)/hris/penggajian/page'),
  'penggajian/slip/page':()=>import('../../app/(app)/hris/penggajian/slip/page'),
  'komponen-gaji/page':()=>import('../../app/(app)/hris/komponen-gaji/page'),
 };
 const {default:Page}=await pages[route as keyof typeof pages]();
 await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow('redirect:');
 expect(state.queries).toEqual([]);
});

it.each(['hidden','future','multiple'])('admin cannot query sensitive history with %s assignments',async(mode)=>{
 state.role='ADMIN';
 state.assignments=mode==='hidden'?[]:mode==='future'?[{employee_id:'e1',branch_id:'b1',effective_date:'2099-01-01'}]:[{employee_id:'e1',branch_id:'b1',effective_date:'2026-01-01'},{employee_id:'e1',branch_id:'other',effective_date:'2026-01-01'}];
 await expect(Profile({params:Promise.resolve({id:'e1'}),searchParams:Promise.resolve({tab:'gaji'})})).rejects.toThrow('redirect:');expect(state.queries).not.toContain('payrolls');
});
