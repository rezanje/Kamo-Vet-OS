import { PreservedForm } from "@/components/LocalTransactionDraft";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { allowedBranchIds, canUseBranch } from "@/lib/branch-access";
import { bolehTransaksiKas } from "@/lib/master-guard";
import { BarisJualForm, type ItemJual } from "../../BarisJualForm";
import { CabangGudang, type CabangOpsi, type GudangOpsi } from "./CabangGudang";
import { loadItemUnits } from "@/lib/satuan";
import { readCompleteList } from "@/lib/checked-list";
import { buatFakturLangsung } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

type CatalogItem = { id: string; code: string; name: string; unit: string; sell_price: number };

/**
 * Faktur Penjualan baru tanpa lewat halaman pesanan (permintaan Andri).
 * Cabang yang bisa dipilih hanya cabang penempatan pengguna; database memeriksa ulang.
 */
export default async function FakturJualBaruPage({ searchParams }: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const boleh = await bolehTransaksiKas();
  const today = hariIniWIB();

  const [{ data: custData }, { data: cabData }, { data: gudangData }, itemData, allowed] = await Promise.all([
    supabase.from("customers").select("id, name, phone").order("name").limit(500),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("warehouses").select("id, name, branch_id").eq("is_active", true).order("name"),
    readCompleteList<CatalogItem>((from, to) => supabase.from("items")
      .select("id, code, name, unit, sell_price", { count: "exact" })
      .eq("is_active", true).order("name").order("id").range(from, to), "Daftar barang faktur", { maxRows: null }),
    user ? allowedBranchIds(supabase, user.id) : Promise.resolve([] as string[]),
  ]);

  const pelanggan = (custData ?? []) as { id: string; name: string; phone: string }[];
  const cabang = ((cabData ?? []) as CabangOpsi[]).filter((b) => canUseBranch(allowed, b.id));
  const gudang = ((gudangData ?? []) as GudangOpsi[]).filter((g) => !!g.branch_id && canUseBranch(allowed, g.branch_id));
  const unitMap = await loadItemUnits(supabase);
  const items = (itemData as ItemJual[]).map((it) => ({ ...it, units: unitMap.get(it.id) ?? [] }));

  return (
    <MasterPage
      back="/penjualan/faktur" icon="ti-receipt-2" title="FAKTUR PENJUALAN BARU"
      desc="Terbitkan faktur reseller tanpa mengetik pesanan dulu"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={boleh}
      readOnlyNote="Hanya OWNER/ADMIN/FINANCE yang bisa menerbitkan faktur penjualan."
    >
      {boleh && cabang.length === 0 && (
        <div className="crm-sec"><p>Belum ada cabang yang bisa kamu akses. Minta admin menambahkan penempatan cabangmu dulu.</p></div>
      )}
      {boleh && cabang.length > 0 && (
        <div className="crm-sec">
          <SecHeader num="01" title="FAKTUR LANGSUNG"
            desc="Barang langsung tercatat keluar gudang dan tertagih: pesanan, pengiriman, dan faktur dibuat sekaligus." />
          <PreservedForm action={buatFakturLangsung}>
            <input type="hidden" name="request_key" value={crypto.randomUUID()} />
            <div className="frow">
              <div>
                <label className="flab" htmlFor="faktur-customer">Pelanggan *</label>
                <select className="fi" id="faktur-customer" name="customer_id" defaultValue="" required>
                  <option value="">— pilih pelanggan —</option>
                  {pelanggan.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                </select>
              </div>
              <CabangGudang cabang={cabang} gudang={gudang} />
              <div>
                <label className="flab" htmlFor="faktur-tanggal">Tanggal faktur</label>
                <input className="fi" id="faktur-tanggal" type="date" name="tanggal" defaultValue={today} max={today} />
              </div>
              <div>
                <label className="flab" htmlFor="faktur-tempo">Jatuh tempo</label>
                <input className="fi" id="faktur-tempo" type="date" name="jatuh_tempo" defaultValue={today} />
              </div>
              <div>
                <label className="flab" htmlFor="faktur-catatan">Catatan</label>
                <input className="fi" id="faktur-catatan" name="catatan" placeholder="opsional" maxLength={1000} />
              </div>
            </div>

            <BarisJualForm userId={user?.id ?? ""} scope="invoice-direct" items={items} listId="fj-items" />

            <p style={{ fontSize: 11, color: "var(--tm)" }}>
              Stok dipotong dari gudang yang dipilih dan HPP diakui saat barang keluar; piutang dan pendapatan diakui di faktur.
              Diskon per baris dan perubahan qty/harga setelah faktur terbit dilakukan lewat Aksi → Edit pada faktur.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menerbitkan…" style={{ background: "var(--posb)" }}>
                Terbitkan faktur
              </SubmitButton>
            </div>
          </PreservedForm>
        </div>
      )}
    </MasterPage>
  );
}
