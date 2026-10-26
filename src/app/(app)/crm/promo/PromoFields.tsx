import { NumberInput } from "@/components/NumberInput";
import type {PromoRow} from "@/lib/promo";
import type {MultiSelectItem,MultiSelectCategory} from "@/components/SearchableMultiSelect";
import {PromoTargets} from "./PromoTargets";
export function PromoFields({userId,items,branches,categories,today,promo,itemIds,scope}:{userId:string;items:MultiSelectItem[];branches:MultiSelectItem[];categories:MultiSelectCategory[];today?:string;promo?:PromoRow;itemIds?:string[];scope?:string}) {
 return <>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Nama promo *</label>
            <input className="fi" maxLength={120} name="name" defaultValue={promo?.name ?? ""} required placeholder="mis. Diskon Lebaran Royal Canin" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="flab">Teks saran untuk kasir *</label>
            <input className="fi" name="suggest" defaultValue={promo?.rule?.suggest ?? ""} required placeholder="mis. Beli 2 Royal Canin diskon 10% item kedua" />
          </div>
          <div>
            <label className="flab">Tipe</label>
            <select className="fi" name="promo_type" defaultValue={promo?.promo_type ?? "diskon_produk"}>
              <option value="diskon_produk">Diskon Produk</option>
              <option value="bundling">Bundling</option>
              <option value="tebus_murah">Tebus Murah</option>
            </select>
          </div>
          <div>
            <label className="flab">Jenis diskon</label>
            <select className="fi" name="discount_type" defaultValue={promo?.discount_type ?? ""}>
              <option value="">—</option>
              <option value="percent">Persen</option>
              <option value="nominal">Nominal</option>
            </select>
          </div>
          <div>
            <label className="flab">Cara hitung diskon nominal</label>
            <select className="fi" name="discount_mode" defaultValue={promo?.rule?.discount_mode ?? "per_unit"}>
              <option value="per_unit">Per satuan (aturan lama)</option>
              <option value="package_total">Total per paket minimum</option>
            </select>
            <div style={{fontSize:9.5,color:"var(--td)",marginTop:3}}>Total per paket: pilih tepat satu barang, isi min. qty dan nominal. Potongan sekali; centang kelipatan untuk tiap paket lengkap. Maks. qty membatasi jumlah yang dihitung.</div>
          </div>
          <div>
            <label className="flab">Nilai diskon</label>
            <NumberInput className="fi" name="discount_value" defaultValue={promo?.discount_value ?? ""} type="number" min={0} step="any" placeholder="0" />
            <div style={{fontSize:9.5,color:"var(--td)",marginTop:3}}>Makna nominal mengikuti cara hitung yang dipilih. Promo lama tetap per satuan.</div>
          </div>
          <div>
            <label className="flab">Min. subtotal</label>
            <NumberInput className="fi" name="min_subtotal" defaultValue={promo?.rule?.min_subtotal ?? ""} type="number" min={0} step="any" placeholder="0" />
          </div>

          {/* ── Aturan qty ──────────────────────────────────────────────── */}
          <div style={{ gridColumn: "1 / -1", borderTop: ".5px solid var(--bd)", paddingTop: 10, marginTop: 2 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700 }}><i className="ti ti-adjustments" /> Aturan jumlah beli</div>
            <div style={{ fontSize: 9.5, color: "var(--td)" }}>
              Kosongkan semua kalau promo berlaku berapa pun jumlah belinya.
            </div>
          </div>
          <div>
            <label className="flab">Min. qty</label>
            <NumberInput className="fi" name="min_qty" defaultValue={promo?.min_qty ?? ""} type="number" min={1} step="any" placeholder="mis. 2" />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Beli kurang dari ini, promo tidak jalan.</div>
          </div>
          <div>
            <label className="flab">Maks. qty</label>
            <NumberInput className="fi" name="max_qty" defaultValue={promo?.max_qty ?? ""} type="number" min={1} step="any" placeholder="tanpa batas" />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Batas jumlah yang dapat potongan.</div>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 17 }}>
              <input type="checkbox" name="kelipatan" value="1" defaultChecked={promo?.kelipatan} /> Berlaku kelipatan
            </label>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Dicentang: min 2, beli 5 → yang dapat potongan 4, sisa 1 harga normal.
              Tidak dicentang: syarat terpenuhi, seluruh qty dapat.
            </div>
          </div>

          {promo?.rule?.unit&&<div style={{gridColumn:"1 / -1",padding:10,border:"1px solid var(--bd)",borderRadius:7}}>
            <strong>Target impor Excel: {items.find(item=>item.id===itemIds?.[0])?.name??"Barang terpilih"} / {promo.rule.unit}</strong>
          </div>}
          <PromoTargets userId={userId} items={items} branches={branches} categories={categories} initialItemIds={itemIds} initialBranchIds={promo?.branch_ids ?? []} scope={scope} lockItems={!!promo?.rule?.unit}/>

          {/* ── Potong otomatis ─────────────────────────────────────────── */}
          <div style={{ gridColumn: "1 / -1", background: "#f8fafc", border: ".5px solid var(--bd)", borderRadius: 7, padding: "9px 11px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700 }}>
              <input type="checkbox" name="auto_apply" value="1" defaultChecked={promo?.auto_apply} /> Potong otomatis di kasir
            </label>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Dicentang: potongan langsung masuk keranjang, kasir tidak perlu mengetik apa pun —
              butuh jenis & nilai diskon terisi. Tidak dicentang: promo cuma muncul sebagai pengingat di layar kasir.
            </div>
          </div>
          <div>
            <label className="flab">Berlaku dari</label>
            <input className="fi" name="valid_from" type="date" defaultValue={promo ? promo.valid_from ?? "" : today} />
          </div>
          <div>
            <label className="flab">Berlaku s/d</label>
            <input className="fi" name="valid_until" defaultValue={promo?.valid_until ?? ""} type="date" />
          </div>
 </>;
}
