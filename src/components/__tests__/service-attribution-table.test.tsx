import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {ServiceAttributionTable} from "../ServiceAttributionTable";
it("shows two saved performers once with exact source link and visible unresolved incentive status",()=>{
 const html=renderToStaticMarkup(<ServiceAttributionTable rows={[{tanggal:"2026-10-23",sumber:"kasir",employeeId:null,branchId:"b",itemId:"i",kategoriIds:[],qty:1,omzet:100,laba:100,
 sourceLineId:"line-7",sourceDocumentId:"sale-2",sourceDocumentNumber:"FICT-2",sourceDocumentHref:"/penjualan/sale-2",commissionPending:true,
 servicePerformers:{doctor_id:"d",staff_id:"g",doctor_name:"Recorded doctor",staff_name:"Recorded groomer"}}]}/>);
 expect(html).toContain('href="/penjualan/sale-2"');expect(html).toContain("line-7");expect(html).toContain("Recorded doctor");expect(html).toContain("Recorded groomer");
 expect(html).toContain("belum dihitung otomatis");expect(html.match(/<tbody><tr/g)).toHaveLength(1);expect(html).not.toContain("cashier-as-performer");
});
it("does not label a current-visit payment route as the exact historical clinical invoice",()=>{
 const html=renderToStaticMarkup(<ServiceAttributionTable rows={[{tanggal:"2026-10-23",sumber:"klinik",employeeId:"d",branchId:"b",itemId:null,kategoriIds:[],qty:1,omzet:100,laba:100,sourceDocumentNumber:"OLD-PAID-A",sourceDocumentHref:"/klinik/pembayaran/visit",sourceLineId:"old-line",servicePerformers:{doctor_id:"d",staff_id:null,doctor_name:"Saved doctor"}}]}/>);
 expect(html).toContain("OLD-PAID-A");expect(html).not.toContain('>OLD-PAID-A</a>');expect(html).toContain('href="/klinik/pembayaran/visit">Pembayaran kunjungan saat ini</a>');
});
