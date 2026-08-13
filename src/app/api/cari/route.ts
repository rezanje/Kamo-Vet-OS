// Pencarian global: satu titik untuk mencari data di seluruh aplikasi.
//
// Tiap sumber dibatasi hak akses peran yang sedang login — hasil yang mengantar
// ke halaman terlarang bikin orang mengira sistemnya rusak. RLS Supabase tetap
// jadi lapis terakhir; ini menyaring lebih dulu supaya hasilnya masuk akal.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath, type AturanTersimpan } from "@/lib/akses";
import { amankanKueri, type HasilData } from "@/lib/cari-global";

const BATAS = 5; // per jenis — daftar panjang bikin orang malah tidak membaca

export async function GET(req: Request) {
  const kueri = amankanKueri(new URL(req.url).searchParams.get("q") ?? "");
  if (kueri.length < 2) return NextResponse.json({ data: [] });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ data: [] }, { status: 401 });

  const [{ data: profile }, { data: aturanRows }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("role_modules").select("role, module_id"),
  ]);
  const role = profile?.role ?? "STAFF";
  const aturan = (aturanRows ?? []) as AturanTersimpan;
  const boleh = (path: string) => bolehBukaPath(role, path, aturan);

  const pola = `%${kueri}%`;
  const hasil: HasilData[] = [];

  const tugas: Promise<void>[] = [];

  if (boleh("/pos/sku")) {
    tugas.push((async () => {
      const { data } = await supabase
        .from("items").select("id, code, name, unit, sell_price, item_type")
        .or(`name.ilike.${pola},code.ilike.${pola}`)
        .eq("is_active", true).limit(BATAS);
      for (const r of data ?? []) {
        hasil.push({
          jenis: "barang", judul: r.name as string,
          keterangan: `${r.code} · ${r.item_type} · ${rp(Number(r.sell_price))}/${r.unit}`,
          href: `/pos/sku?cari=${encodeURIComponent(r.code as string)}`,
        });
      }
    })());
  }

  if (boleh("/crm/pelanggan")) {
    tugas.push((async () => {
      const { data } = await supabase
        .from("customers").select("id, name, phone, tier")
        .or(`name.ilike.${pola},phone.ilike.${pola}`).limit(BATAS);
      for (const r of data ?? []) {
        hasil.push({
          jenis: "pelanggan", judul: r.name as string,
          keterangan: `${r.phone ?? "—"} · ${r.tier ?? "—"}`,
          href: `/crm/pelanggan?cari=${encodeURIComponent(r.name as string)}`,
        });
      }
    })());

    // Hewan tidak punya halaman daftar sendiri; yang dibuka pemiliknya, karena di
    // situlah riwayat hewannya berada.
    tugas.push((async () => {
      const { data } = await supabase
        .from("pets").select("id, name, species, breed, customers(name)")
        .ilike("name", pola).limit(BATAS);
      for (const r of data ?? []) {
        const rel = r.customers as { name: string } | { name: string }[] | null;
        const pemilik = (Array.isArray(rel) ? rel[0] : rel)?.name ?? "—";
        hasil.push({
          jenis: "hewan", judul: r.name as string,
          keterangan: `${r.species ?? "—"}${r.breed ? ` ${r.breed}` : ""} · pemilik ${pemilik}`,
          href: `/crm/pelanggan?cari=${encodeURIComponent(pemilik)}`,
        });
      }
    })());
  }

  if (boleh("/pembelian")) {
    tugas.push((async () => {
      const { data } = await supabase
        .from("suppliers").select("id, nama, kontak, telp")
        .or(`nama.ilike.${pola},kontak.ilike.${pola}`).limit(BATAS);
      for (const r of data ?? []) {
        hasil.push({
          jenis: "pemasok", judul: r.nama as string,
          keterangan: [r.kontak, r.telp].filter(Boolean).join(" · ") || "—",
          href: "/pembelian?tab=supplier",
        });
      }
    })());
  }

  if (boleh("/hris/karyawan")) {
    tugas.push((async () => {
      const { data } = await supabase
        .from("employees").select("id, nik, nama, jabatan, status")
        .or(`nama.ilike.${pola},nik.ilike.${pola}`).limit(BATAS);
      for (const r of data ?? []) {
        hasil.push({
          jenis: "karyawan", judul: r.nama as string,
          keterangan: [r.nik, r.jabatan, r.status].filter(Boolean).join(" · "),
          href: `/hris/karyawan?cari=${encodeURIComponent(r.nama as string)}`,
        });
      }
    })());
  }

  // Nomor nota & struk: yang diketik kasir biasanya potongan nomornya.
  if (boleh("/klinik/antrian")) {
    tugas.push((async () => {
      const { data } = await supabase
        .from("invoices").select("invoice_no, total, paid_status, visit_id, visits(pets(name))")
        .ilike("invoice_no", pola).is("voided_at", null).limit(BATAS);
      for (const r of data ?? []) {
        const vRel = r.visits as unknown as
          { pets: { name: string } | { name: string }[] | null } | { pets: { name: string }[] }[] | null;
        const v = Array.isArray(vRel) ? vRel[0] : vRel;
        const petRel = v?.pets ?? null;
        const hewan = (Array.isArray(petRel) ? petRel[0] : petRel)?.name ?? "—";
        hasil.push({
          jenis: "nota-klinik", judul: r.invoice_no as string,
          keterangan: `${hewan} · ${rp(Number(r.total))} · ${r.paid_status}`,
          href: `/klinik/pembayaran/${r.visit_id}`,
        });
      }
    })());
  }

  if (boleh("/pos/transaksi")) {
    tugas.push((async () => {
      const { data } = await supabase
        .from("sales").select("id, no_struk, total, metode_bayar")
        .ilike("no_struk", pola).limit(BATAS);
      for (const r of data ?? []) {
        hasil.push({
          jenis: "struk-kasir", judul: r.no_struk as string,
          keterangan: `${rp(Number(r.total))} · ${r.metode_bayar ?? "—"}`,
          href: `/pos/struk/${r.id}`,
        });
      }
    })());
  }

  await Promise.all(tugas);
  return NextResponse.json({ data: hasil });
}

const rp = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
