import{expect,it}from 'vitest';
import{loadCompoundReport}from '../hpp-reports-server';
import{compoundTable,compoundIngredientsTable}from '../hpp-reports-export';
import{clientFixture}from './fixtures/hpp-report-client';
const tables={
 invoice_items:[{id:'line',compound_recipe_id:'recipe',qty:1,harga:200,diskon_persen:0,hpp:50,deskripsi:'Invoice compound label',invoices:{id:'invoice',visit_id:'visit',invoice_no:'INV-ORIGINAL',created_at:'2026-10-04T05:00:00Z',paid_status:'Lunas',voided_at:null,visits:{branch_id:'b1',dokter:'Doctor',doctor_id:'doctor'}}}],
 compounding_recipes:[{id:'recipe',recipe_name:'Recipe snapshot',status:'handed_over'}],
 clinic_compound_sales:[{request_key:'binding',recipe_id:'recipe',visit_id:'visit',sale_item_id:'parent',sale_name:'Frozen parent label',sale_unit:'racikan'}],
 compounding_ingredients:[{id:'ingredient',recipe_id:'recipe',item_id:'material',ingredient_name:'Material',quantity:3,unit:'ml'}],
};
const filters={cabang:'b1',dari:'2026-10-04',sampai:'2026-10-04'};
it('retains the stored selling parent and exact invoice identity without inferring a current master binding',async()=>{
 const{client,records}=clientFixture({tables});const report=await loadCompoundReport(client,filters);
 expect(report.rows[0]).toMatchObject({saleItemId:'parent',saleItemName:'Frozen parent label'});
 const row=compoundTable(report).rows[0];expect(row.href).toBe('/klinik/pembayaran/visit/invoice?invoice_id=invoice');
 expect(row.cellLinks?.[4]).toMatchObject({href:'/pos/sku/parent'});expect(row.cellLinks?.[5]).toMatchObject({href:'/klinik/racik/recipe'});
 const material=compoundIngredientsTable(report).rows[0];expect(material.cellLinks?.[8]).toMatchObject({href:'/pos/sku/material'});
 expect(records.some(r=>r.table==='stock'||r.table==='stock_layers')).toBe(false);
 expect(report.summary.cost).toBe(50);
});
it('does not match a missing parent by equal names or current formula data',async()=>{
 const{client}=clientFixture({tables:{...tables,clinic_compound_sales:[]}});const report=await loadCompoundReport(client,filters);
 expect(report.rows[0].saleItemId).toBeNull();expect(compoundTable(report).rows[0].cellLinks?.[4]).toBeUndefined();
 expect(compoundTable(report).rows[0].cellLinks?.[5]?.href).toBe('/klinik/racik/recipe');
});
it('rejects a stored parent binding from a different visit instead of opening an unrelated parent',async()=>{
 const{client}=clientFixture({tables:{...tables,clinic_compound_sales:[{...tables.clinic_compound_sales[0],visit_id:'foreign'}]}});
 await expect(loadCompoundReport(client,filters)).rejects.toThrow('induk racikan');
});
it('refuses an unknown binding read and retains financial role/branch gates',async()=>{
 await expect(loadCompoundReport(clientFixture({tables,errorTable:'clinic_compound_sales'}).client,filters)).rejects.toThrow('Data laporan gagal dibaca');
 for(const role of['STAFF','DOCTOR','ADMIN'])await expect(loadCompoundReport(clientFixture({tables,role}).client,filters)).rejects.toMatchObject({status:403});
 await expect(loadCompoundReport(clientFixture({tables,deniedBranch:'b1'}).client,filters)).rejects.toMatchObject({status:403});
});
