import { expect, it } from "vitest";
import { bulkFillServicePerformers, servicePerformerNames, servicePerformerInput, serviceStaffSlots } from "../service-performers";
const staff = [{id:"d",nama:"Fictional vet",jabatan:"Dokter"},{id:"n",nama:"Fictional nurse",jabatan:"Asisten dokter"},{id:"g",nama:"Fictional groomer",jabatan:"Groomer"}];
it("reuses doctor classification without treating an assistant as a second doctor",()=>{
  expect(serviceStaffSlots(staff).doctors.map(row=>row.id)).toEqual(["d"]);
  expect(serviceStaffSlots(staff).staff.map(row=>row.id)).toEqual(["n","g"]);
});
it("fills every wholly unassigned row, services and goods alike, preserving explicit overrides and input objects",()=>{
  const rows=[{key:"one",jenis:"jasa",service_performers:null},{key:"two",jenis:"jasa",service_performers:{doctor_id:"other",staff_id:null}},{key:"three",jenis:"obat",service_performers:null}];
  const result=bulkFillServicePerformers(rows,{doctor_id:"d",staff_id:"g"});
  expect(result[0].service_performers).toEqual({doctor_id:"d",staff_id:"g"});
  expect(result[1]).toBe(rows[1]);
  expect(result[2].service_performers).toEqual({doctor_id:"d",staff_id:"g"});
  expect(rows[0].service_performers).toBeNull(); expect(rows[2].service_performers).toBeNull();
});
it("accepts a single role but rejects malformed values, duplicate people or arbitrary role arrays",()=>{
  expect(servicePerformerInput({doctor_id:"d",staff_id:null,doctor_name:"spoof"})).toEqual({doctor_id:"d",staff_id:null});
  expect(()=>servicePerformerInput({doctor_id:"d",staff_id:"d"})).toThrow();
  expect(()=>servicePerformerInput(["d","n"])).toThrow();
  expect(()=>servicePerformerInput({staff_id:{id:"n"}})).toThrow();
});
it("renders only recorded snapshot names, with honest unassigned and legacy labels",()=>{
  expect(servicePerformerNames({version:1,doctor_id:"d",doctor_name:"Historical vet",staff_id:"n",staff_name:"Historical nurse"})).toEqual(["Dokter: Historical vet","Pelaksana: Historical nurse"]);
  expect(servicePerformerNames(null)).toEqual(["Pelaksana per baris belum tercatat (data lama)"]);
  expect(servicePerformerNames({version:1,doctor_id:null,staff_id:null})).toEqual(["Pelaksana belum ditetapkan"]);
  expect(servicePerformerNames({version:1,doctor_id:"d",staff_id:null})).toEqual(["Nama dokter tidak tersedia"]);
});
