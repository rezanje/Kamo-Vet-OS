import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labelSource } from "../kartu-stok";

// Pekerjaan pesanan tindakan + koreksi racikan hidup di satu migrasi maju.
// Tanpa database di CI, invariannya diperiksa dari teks migrasi: jangkar eksak,
// urutan mutasi stok, sumber kartu stok, alasan wajib, dan ACL.
const NAMA = "20261030100000_tindakan_racikan_pesanan.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const potong = (awal: string, akhir: string) => SQL.slice(SQL.indexOf(awal), SQL.indexOf(akhir));

describe("urutan migrasi", () => {
  it("dipasang setelah migrasi pelaksana per baris dan tidak menyentuh migrasi lama", () => {
    const semua = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort();
    expect(semua).toContain(NAMA);
    expect(semua[semua.length - 1]).toBe(NAMA);
    expect(NAMA > "20261030090000_line_performers_all_items.sql").toBe(true);
    // Gaya tambal yang sama: jangkar eksak, gagal tertutup, lalu blok pemeriksaan akhir.
    expect(SQL).toContain("pg_get_functiondef");
    expect(SQL).toContain("jangkar harus muncul tepat sekali");
    expect(SQL).toContain("do $check$");
  });
});

describe("B/D — BMHP untuk tindakan persediaan di pohon TINDAKAN", () => {
  const guard = potong("do $patch$\ndeclare p record; definition text; signature regprocedure;\nbegin\n for p in select * from (values\n  ('public.guard_prescription_bmhp()'", "-- 3. Posting tagihan klinik");
  it("menerima jasa dan persediaan tindakan, menolak sisanya", () => {
    expect(guard).toContain("new.jenis is not distinct from ''jasa'' and v_type is not distinct from ''Jasa''");
    expect(guard).toContain("new.jenis is not distinct from ''obat'' and v_type is not distinct from ''Persediaan''");
    expect(guard).toContain("clinic_private.item_under_tindakan(new.item_id)");
    // Penolakan tetap ada untuk semua kombinasi lain, bukan dihapus.
    expect(guard).toContain("BMHP_INVALID: BMHP hanya untuk baris tindakan/jasa dari master");
    expect(guard).toContain("if new.item_id is null or not (");
  });
  it("penelusuran kategori berhenti di JASA dan dibatasi kedalamannya", () => {
    const helper = potong("create function clinic_private.item_under_tindakan", "revoke all on function clinic_private.item_under_tindakan");
    expect(helper).toContain("if v_name = 'TINDAKAN' then return true; end if;");
    expect(helper).toContain("if v_name = 'JASA' then return false; end if;");
    expect(helper).toContain("v_depth < 20");
    expect(helper).toContain("not (v_id = any(v_seen))");
  });
  it("hanya guard_prescription_bmhp yang membatasi jenis item", () => {
    const k02 = readFileSync("supabase/migrations/20261026100000_k02_procedure_bmhp.sql", "utf8");
    const invoiceGuard = k02.slice(k02.indexOf("create function public.guard_invoice_item_bmhp"), k02.indexOf("revoke all on function public.guard_invoice_item_bmhp"));
    expect(invoiceGuard).not.toContain("item_type");
  });
});

describe("C — pekerjaan pesanan saat posting tagihan klinik", () => {
  const helper = potong("create function clinic_private.job_order_complete", "revoke all on function clinic_private.job_order_complete");
  it("menerima hasil tindakan senilai biaya BMHP lalu mengeluarkannya lewat rutinitas persediaan", () => {
    expect(helper).toContain("public.stock_in_fifo(p_warehouse_id, p_item_id, p_qty, p_cost / p_qty,\n    'pesanan-selesai', p_ref, p_date, null)");
    expect(helper).toContain("public.stock_out_fifo(p_warehouse_id, p_item_id, p_qty, 'klinik', p_ref, p_date)");
    expect(helper.indexOf("stock_in_fifo")).toBeLessThan(helper.indexOf("stock_out_fifo"));
    expect(helper).toContain("return round(v_out.cost, 2);");
    expect(helper).toContain("COST_MISSING: biaya BMHP tindakan tidak tersedia");
    expect(helper).toContain("STOCK_SHORT: hasil tindakan tidak dapat dikeluarkan");
  });
  it("baris barang beresep mengeluarkan BMHP-nya dan baris tanpa BMHP tetap lewat jalur stok lama", () => {
    const post = potong("-- Baris barang beresep", "-- Koreksi tagihan: BMHP baris");
    expect(post).toContain("clinic_private.bmhp_issue(v_prescription_item_id, v_warehouse_id, v_invoice_no, v_tanggal)");
    expect(post).toContain("v_line_hpp := clinic_private.job_order_complete(v_warehouse_id, v_item_id, v_base_qty,");
    // Cabang lama dipertahankan di balik else, bukan dibuang: tindakan tanpa BMHP tetap butuh stok.
    expect(post).toContain("else\\n      select s.qty into v_stock_qty from public.stock s");
    expect(post).toContain("''klinik'', v_invoice_no);\\n      end if;");
  });
  it("mengunci stok BMHP untuk semua baris beresep, bukan hanya baris jasa", () => {
    expect(SQL).toContain("E'      where e.value ->> ''kind'' = ''jasa''\\n    ) x order by x.item_id',\n   E'    ) x order by x.item_id'");
  });
  it("koreksi tagihan tidak menggerakkan stok hasil tindakan dan membekukan jumlahnya", () => {
    expect(SQL).toContain("BMHP_INVALID: jumlah tindakan ber-BMHP tidak dapat diubah lewat koreksi");
    expect(SQL).toContain("jenis=''obat'' and item_id is not null and bmhp_components is null");
    // Snapshot BMHP yang dipertahankan dikenali lewat baris resepnya, apa pun jenis barisnya.
    expect(SQL).toContain("v_bmhp_map->nullif(v_line->>''prescription_item_id'','''')");
    expect(SQL).toContain("where nullif(x.value->>''prescription_item_id'', '''')::uuid = r.prescription_item_id");
  });
});

describe("F — koreksi dan pengembalian bahan racikan", () => {
  const adjust = potong("create function public.clinic_adjust_compound", "revoke all on function public.clinic_adjust_compound");
  it("hanya selisih jumlah yang menggerakkan stok, dengan sumber kartu stok koreksi", () => {
    expect(adjust).toContain("v_delta := v_target.target_qty - v_target.current_qty;");
    expect(adjust).toContain("if v_delta > 0 then");
    expect(adjust).toContain("elsif v_delta < 0 then");
    expect((adjust.match(/'racik-koreksi', p_recipe_id::text/g) ?? [])).toHaveLength(3);
    expect(adjust).toContain("source_ref");
  });
  it("menjaga compound_issues dan biaya racikan tetap konsisten", () => {
    expect(adjust).toContain("insert into public.compound_issues (recipe_id, ingredient_id, warehouse_id, item_id,");
    expect(adjust).toContain("on conflict (ingredient_id, stock_layer_id) do update");
    expect(adjust).toContain("delete from public.compound_issues where ingredient_id = v_ingredient_id;");
    expect(adjust).toContain("update public.compounding_recipes set total_price = round(v_total, 2)");
    expect(adjust).toContain("update public.prescription_items set harga = round(v_total, 2)");
    expect(adjust).toContain("select 1 from public.clinic_compound_sales s where s.recipe_id = p_recipe_id");
  });
  it("menolak tanpa alasan, resep resmi, racikan terserah, dan tagihan terbayar", () => {
    expect(adjust).toContain("REASON_REQUIRED: alasan perubahan komposisi wajib diisi");
    expect(adjust).toContain("RECIPE_LINKED: komposisi resep resmi tidak dapat diubah");
    expect(adjust).toContain("perform clinic_private.assert_compound_adjustable(p_recipe_id, v_recipe.medical_record_id);");
    const assert_ = potong("create function clinic_private.assert_compound_adjustable", "revoke all on function clinic_private.assert_compound_adjustable");
    expect(assert_).toContain("RECIPE_INVALID: racikan sudah diserahkan");
    expect(assert_).toContain("INVOICE_PAID: tagihan kunjungan sudah dibayar");
    expect(assert_).toContain("public.invoice_payments");
  });
  it("pengembalian bahan diturunkan dari definisi void yang sedang berjalan", () => {
    const derive = potong("-- Kembalikan bahan: semantik clinic_void_compound", "-- 5. Pemeriksaan akhir");
    expect(derive).toContain("pg_get_functiondef(signature)");
    expect(derive).toContain("definisi clinic_void_compound tidak seperti yang ditinjau");
    expect(derive).toContain("'public.clinic_return_compound(p_recipe_id uuid, p_reason text)'");
    expect(derive).toContain("E'''racik-kembali'', p_recipe_id::text'");
    expect(derive).toContain("REASON_REQUIRED: alasan pengembalian bahan wajib diisi");
    expect(derive).toContain("status = ''void''");
  });
  it("menyimpan alasan, pelaku dan waktunya pada tabel audit privat", () => {
    const tabel = potong("create table public.compound_adjustments", "create function clinic_private.compound_composition");
    expect(tabel).toContain("reason text not null check (btrim(reason) <> '' and length(reason) <= 500)");
    expect(tabel).toContain("actor_id uuid references public.profiles(id)");
    expect(tabel).toContain("created_at timestamptz not null default now()");
    expect(tabel).toContain("alter table public.compound_adjustments enable row level security;");
    expect(tabel).toContain("revoke all on public.compound_adjustments from public, anon, authenticated, service_role;");
  });
  it("ACL kedua RPC sama dengan clinic_void_compound", () => {
    for (const rpc of ["public.clinic_adjust_compound(uuid, jsonb, text)", "public.clinic_return_compound(uuid, text)"]) {
      expect(SQL).toContain(`revoke all on function ${rpc} from public, anon, service_role;`);
      expect(SQL).toContain(`grant execute on function ${rpc} to authenticated;`);
    }
  });
});

describe("H — label kartu stok", () => {
  it.each([
    ["klinik-bmhp", "BMHP Tindakan"],
    ["pesanan-selesai", "Penyelesaian Pesanan"],
    ["racik-koreksi", "Koreksi Racikan"],
    ["racik-kembali", "Pengembalian Racikan"],
    ["racik", "Racikan Obat"],
  ])("%s → %s", (source, label) => expect(labelSource(source)).toBe(label));
  it("sumber baru muat pada kolom source stock_moves/stock_layers (varchar 24)", () => {
    for (const source of ["klinik-bmhp", "pesanan-selesai", "racik-koreksi", "racik-kembali"]) {
      expect(source.length).toBeLessThanOrEqual(24);
    }
  });
});
