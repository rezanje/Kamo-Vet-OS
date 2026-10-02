import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({writes:[] as unknown[],conflict:false,allowed:true}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error(url);}}));
vi.mock('@/lib/master-guard',()=>({assertRole:async()=>({from:()=>({insert:async(rows:unknown)=>{if(state.conflict)return {error:{code:'23505'}};state.writes.push(rows);return {error:null};},upsert:()=>{throw new Error('unexpected upsert');},delete:()=>{throw new Error('unexpected delete');}})})}));
vi.mock('@/lib/jadwal-scope',()=>({scopeJadwal:async()=>{if(!state.allowed)throw new Error('Cabang tidak diizinkan.');return {cabang:'b1',awal:'2026-09-28',akhir:'2026-10-04',employees:['e1'],shifts:[{id:'s1',is_active:true}],existing:{},user:{id:'admin'}};}}));
import { imporJadwal } from '../../app/(app)/hris/jadwal/actions';
const row={employee_id:'e1',tanggal:'2026-10-01',shift_id:'s1',branch_id:'b1'};
function form(rows:unknown){const f=new FormData();Object.entries({cabang:'b1',bulan:'2026-10',minggu:'2026-10-01',rows:JSON.stringify(rows),konfirmasi:'1'}).forEach(([k,v])=>f.set(k,v));return f;}
beforeEach(()=>{state.writes=[];state.conflict=false;state.allowed=true;});
it('server rejects a forged cross-branch row even with confirmed preview',async()=>{await expect(imporJadwal(form([row,{...row,employee_id:'other',branch_id:'b2'}]))).rejects.toThrow('error=');expect(state.writes).toEqual([]);});
it('server rejects unauthorized branch before writing',async()=>{state.allowed=false;await expect(imporJadwal(form([row]))).rejects.toThrow('error=');expect(state.writes).toEqual([]);});
it('imports cross-month week rows in one insert with server actor',async()=>{await expect(imporJadwal(form([row,{...row,tanggal:'2026-09-30'}]))).rejects.toThrow('success=2');expect(state.writes).toEqual([[{employee_id:'e1',tanggal:'2026-10-01',shift_id:'s1',created_by:'admin'},{employee_id:'e1',tanggal:'2026-09-30',shift_id:'s1',created_by:'admin'}]]);});
it('concurrent unique conflict reports failure without attempting overwrite',async()=>{state.conflict=true;await expect(imporJadwal(form([row]))).rejects.toThrow('error=');expect(state.writes).toEqual([]);});
it('does not save without preview confirmation',async()=>{const f=form([row]);f.delete('konfirmasi');await expect(imporJadwal(f)).rejects.toThrow('error=');expect(state.writes).toEqual([]);});
