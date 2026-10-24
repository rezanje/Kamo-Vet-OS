import {expect,it} from 'vitest';
import {reportFilterDefaults} from '../report-filter-defaults';
it('extracts authoritative rendered defaults, arrays and checked controls through nested filter markup',()=>{
 const query=reportFilterDefaults(<><div><input name="dari" defaultValue="2026-10-01"/><select name="dokter" defaultValue=""><option value="">Semua</option></select></div><select multiple name="cabang" defaultValue={['a','b']}/><input type="checkbox" name="unselected" value="no"/><input type="checkbox" name="selected" defaultChecked value="yes"/><input disabled name="disabled" value="no" readOnly/><button name="submit" value="no"/></>);
 expect(query).toBe('dari=2026-10-01&dokter=&cabang=a&cabang=b&selected=yes');
});
