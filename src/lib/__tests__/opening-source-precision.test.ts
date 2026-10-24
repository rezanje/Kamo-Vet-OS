import {it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {bacaWorkbookSaldoAwal} from '@/lib/impor-saldo-accurate';
import {resolveSaldoAwalRows} from '@/lib/impor-saldo-accurate';
it('preserves original numeric XML source precision rather than a JS number approximation',async()=>{
 const w=new ExcelJS.Workbook();const s=w.addWorksheet('Saldo Awal');
 s.addRow(['Kode Barang','Kuantitas','Satuan','HPP']);s.addRow(['FICTION',3,'PCS',1.1]);
 const zip=await JSZip.loadAsync(await w.xlsx.writeBuffer());
 const xml=await zip.file('xl/worksheets/sheet1.xml')!.async('string');
 zip.file('xl/worksheets/sheet1.xml',xml.replace('<v>1.1</v>','<v>1.100000000000000123</v>'));
 const r=await bacaWorkbookSaldoAwal(new Uint8Array(await zip.generateAsync({type:'nodebuffer'})));
 expect(r.errors).toEqual([]);expect(r.rows[0]).toMatchObject({sourceQty:'3',sourceUnitCost:'1.100000000000000123'});
});
it.each([['1.25','0.33333333','1.25','0.33333333'],['0.125','1.234,56789','0.125','1234.56789'],['1,25','1,234.56789','1.25','1234.56789'],['1.25e-6','0,005','1.25e-6','0.005']])('reads unambiguous source decimal text %s / %s without stripping its decimal point',async(qty,cost,sourceQty,sourceUnitCost)=>{
 const w=new ExcelJS.Workbook();const s=w.addWorksheet('Saldo Awal');s.addRow(['Kode Barang','Kuantitas','Satuan','HPP']);s.addRow(['FICTION',qty,'PCS',cost]);
 const r=await bacaWorkbookSaldoAwal(new Uint8Array(await w.xlsx.writeBuffer()));
 expect(r.errors).toEqual([]);expect(r.rows[0]).toMatchObject({qty:Number(sourceQty),unitCost:Number(sourceUnitCost),sourceQty,sourceUnitCost});
});
it('keeps exact quantity and source value through decimal conversion without Number multiplication',()=>{
 const row={row:2,itemCode:'F',qty:1,sourceQty:'1.000000000000000001',unit:'BOX',unitCost:0.01,sourceUnitCost:'0.01',batchNo:null,expDate:null,branchName:null,warehouseName:null,asOf:null};
 const master=new Map([['f',{id:'fiction',code:'F',unit:'PCS',itemType:'Persediaan',trackExpiry:false,units:[{unit:'BOX',factor:0.1}]}]]);
 const resolved=resolveSaldoAwalRows([row],master,'wh');
 expect(resolved[0]).toMatchObject({status:'valid',baseQtyExact:'0.1000000000000000001',valueExact:'0.01000000000000000001'});
 expect(resolved[0].sourceValues?.[0].qty).toBe('1.000000000000000001');
});
it('adds duplicate decimal quantities exactly while retaining every original source value',()=>{
 const rows=[0.1,0.2].map((qty,i)=>({row:i+2,itemCode:'F',qty,sourceQty:String(qty),unit:'PCS',unitCost:1,sourceUnitCost:'1',batchNo:null,expDate:null,branchName:null,warehouseName:null,asOf:null}));
 const master=new Map([['f',{id:'fiction',code:'F',unit:'PCS',itemType:'Persediaan',trackExpiry:false,units:[]}]]);
 const resolved=resolveSaldoAwalRows(rows,master,'wh');expect(resolved).toHaveLength(1);
 expect(resolved[0]).toMatchObject({baseQty:0.3,baseQtyExact:'0.3',valueExact:'0.3'});expect(resolved[0].sourceValues).toHaveLength(2);
});
it.each([['1.234','1234'],['1.234.567','1234567'],['0.00000000000000000001','0.00000000000000000001']])('retains the established grouping contract while preserving decimal %s',async(text,expected)=>{
 const w=new ExcelJS.Workbook();const s=w.addWorksheet('Saldo Awal');s.addRow(['Kode Barang','Kuantitas','Satuan','HPP']);s.addRow(['FICTION',text,'PCS',1]);
 const r=await bacaWorkbookSaldoAwal(new Uint8Array(await w.xlsx.writeBuffer()));expect(r.errors).toEqual([]);expect(r.rows[0].sourceQty).toBe(expected);
});
it('never silently treats a positive source number below the supported numeric range as zero stock',async()=>{
 const w=new ExcelJS.Workbook();const s=w.addWorksheet('Saldo Awal');s.addRow(['Kode Barang','Kuantitas Saldo Awal','Satuan','HPP']);s.addRow(['FICTION','1e-400','PCS',1]);
 const r=await bacaWorkbookSaldoAwal(new Uint8Array(await w.xlsx.writeBuffer()));expect(r.rows).toHaveLength(1);expect(r.errors.join(' ')).toContain('tidak dianggap stok nol');
});
it('preserves localized textual decimals below a HALF_UP boundary, including cached formula text',async()=>{
 for(const cost of ['0,004999999999999999999',{formula:'"0,004999999999999999999"',result:'0,004999999999999999999'}]){
 const w=new ExcelJS.Workbook();const s=w.addWorksheet('Saldo Awal');s.addRow(['Kode Barang','Kuantitas','Satuan','HPP']);s.addRow(['FICTION','1','PCS',cost]);
 const r=await bacaWorkbookSaldoAwal(new Uint8Array(await w.xlsx.writeBuffer()));
 expect(r.errors).toEqual([]);expect(r.rows[0].sourceUnitCost).toBe('0.004999999999999999999');
 }
});
