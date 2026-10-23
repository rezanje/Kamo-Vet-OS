import {it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {bacaWorkbookSaldoAwal} from '@/lib/impor-saldo-accurate';
it('preserves original numeric XML source precision rather than a JS number approximation',async()=>{
 const w=new ExcelJS.Workbook();const s=w.addWorksheet('Saldo Awal');
 s.addRow(['Kode Barang','Kuantitas','Satuan','HPP']);s.addRow(['FICTION',3,'PCS',1.1]);
 const zip=await JSZip.loadAsync(await w.xlsx.writeBuffer());
 const xml=await zip.file('xl/worksheets/sheet1.xml')!.async('string');
 zip.file('xl/worksheets/sheet1.xml',xml.replace('<v>1.1</v>','<v>1.100000000000000123</v>'));
 const r=await bacaWorkbookSaldoAwal(new Uint8Array(await zip.generateAsync({type:'nodebuffer'})));
 expect(r.errors).toEqual([]);expect(r.rows[0]).toMatchObject({sourceQty:'3',sourceUnitCost:'1.100000000000000123'});
});
it('preserves localized textual decimals below a HALF_UP boundary, including cached formula text',async()=>{
 for(const cost of ['0,004999999999999999999',{formula:'"0,004999999999999999999"',result:'0,004999999999999999999'}]){
 const w=new ExcelJS.Workbook();const s=w.addWorksheet('Saldo Awal');s.addRow(['Kode Barang','Kuantitas','Satuan','HPP']);s.addRow(['FICTION','1','PCS',cost]);
 const r=await bacaWorkbookSaldoAwal(new Uint8Array(await w.xlsx.writeBuffer()));
 expect(r.errors).toEqual([]);expect(r.rows[0].sourceUnitCost).toBe('0.004999999999999999999');
 }
});
