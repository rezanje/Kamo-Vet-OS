"use server";
import { submitStaffRequest, field } from "@/lib/hris-request-actions";
export async function ajukanLembur(f: FormData) {
  return submitStaffRequest("overtime", {
    tanggal: field(f, "tanggal"),
    jam: Number(field(f, "jam")),
    alasan: field(f, "alasan"),
  });
}
export async function ajukanKasbon(f: FormData) {
  return submitStaffRequest("cash", {
    jumlah: Number(field(f, "jumlah")),
    tenor_bulan: Number(field(f, "tenor_bulan") || 1),
    alasan: field(f, "alasan"),
  });
}
export async function ajukanReimburse(f: FormData) {
  return submitStaffRequest("reimburse", {
    tanggal: field(f, "tanggal"),
    kategori: field(f, "kategori"),
    jumlah: Number(field(f, "jumlah")),
    keterangan: field(f, "keterangan"),
  });
}
