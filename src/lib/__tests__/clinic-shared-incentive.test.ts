import { describe, expect, it } from "vitest";
import { hitungKomisi, mergeSharedIncentives } from "../komisi";

describe("shared clinic pool in commission/payroll", () => {
  it("retains sales for targets but excludes legacy rules for a sealed demo pool", () => {
    const result = hitungKomisi([{tanggal:"2026-10-12",sumber:"klinik",employeeId:"doctor",branchId:"branch",itemId:null,kategoriIds:[],qty:1,omzet:50000,laba:50000,fixedCommission:true}],
      [{id:"legacy",nama:"Legacy 10%",tipe:"persen",basis:"omzet",sumber:"klinik",persen:10,nominal:0,employeeId:null,branchId:null,categoryId:null,itemId:null,minOmzet:0,dari:null,sampai:null}]);
    const merged = mergeSharedIncentives(result,[{employeeId:"doctor",invoiceId:"invoice",amount:1250,basis:50000},{employeeId:"nurse",invoiceId:"invoice",amount:1250,basis:50000}]);
    expect(merged.reduce((sum,row)=>sum+row.komisi,0)).toBe(2500);
    expect(merged.find(row=>row.employeeId==="doctor")).toMatchObject({omzet:50000,komisi:1250});
    expect(merged.find(row=>row.employeeId==="nurse")?.rincian[0]).toMatchObject({nama:"Pool jasa DEMO",komisi:1250});
  });
  it("adds the posted clinic allocation to independent retail commission once", () => {
    const original = {employeeId:"doctor",omzet:20000,laba:10000,barisTanpaHpp:0,komisi:1000,rincian:[]};
    const allocation = {employeeId:"doctor",invoiceId:"invoice",amount:1250,basis:50000};
    const merged = mergeSharedIncentives([original],[allocation,allocation]);
    expect(merged[0].komisi).toBe(2250);
    expect(original.komisi).toBe(1000);
  });
});
