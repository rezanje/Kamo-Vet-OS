import { describe,expect,it } from 'vitest';
import { reportPresetHref,readReportPresets,saveReportPreset,reportPresetKey } from '../report-presets';
describe('private report configurations',()=>{
 it('preserves repeated branch, doctor, detail and period filters but excludes paging/acknowledgements',()=>{
  const href=reportPresetHref('/laporan/margin-racikan','dokter=doc-a&cabang=a&cabang=b&dari=2026-10-01&sampai=2026-10-31&rincian=bahan&halaman=5&draft_done=secret&error=no');
  expect(href).toBe('/laporan/margin-racikan?dokter=doc-a&cabang=a&cabang=b&dari=2026-10-01&sampai=2026-10-31&rincian=bahan');
 });
 it('rejects external, executable, download and non-report destinations',()=>{
  for(const path of ['https://bad.test/laporan/promo','//bad.test','javascript:alert(1)','/laporan/promo/unduh','/pengaturan/reset','/laporan/../pengaturan','/laporan/%2e%2e/promo']) expect(()=>reportPresetHref(path,'')).toThrow();
 });
 it('isolates user keys and round-trips only bounded valid saved filters',()=>{
  expect(reportPresetKey('one')).not.toBe(reportPresetKey('two'));
  const saved=saveReportPreset([], {id:'one',name:'Vaksin bulanan',href:'/laporan/promo?dari=2026-10-01&sampai=2026-10-31',savedAt:'2026-10-23T00:00:00Z'});
  expect(readReportPresets(JSON.stringify(saved))).toEqual(saved);
  expect(()=>readReportPresets('{')).toThrow();
  expect(()=>readReportPresets('[{"id":"x","name":"x","href":"https://evil.test","savedAt":"today"}]')).toThrow();
  expect(()=>saveReportPreset(saved,{...saved[0],id:'two',name:'   '})).toThrow();
 });
 it('updates the named configuration without dropping other reports',()=>{
  const first={id:'a',name:'A',href:'/laporan/promo',savedAt:'2026-10-23T00:00:00Z'};
  const second={...first,id:'b',name:'B',href:'/laporan/pembelian'};
  const saved=saveReportPreset(saveReportPreset([],first),second);
  const updated=saveReportPreset(saved,{...first,href:'/laporan/promo?dari=2026-11-01'});
  expect(updated).toHaveLength(2);expect(updated.find(x=>x.id==='b')).toEqual(second);
  expect(updated.find(x=>x.id==='a')?.href).toContain('2026-11');
 });
});

it('preserves canonical column selections but rejects repeated column parameters',()=>{
 const columns=encodeURIComponent('{"t12345678-1":[2]}');
 expect(reportPresetHref('/laporan/promo',`periode=2026-11&kolom=${columns}`)).toContain('kolom=');
 expect(()=>reportPresetHref('/laporan/promo',`kolom=${columns}&kolom=${columns}`)).toThrow();
});
