-- Faktur dari PO tetap bisa dibuat walau barang penerimaannya sudah dipindah (DC → klinik) atau terpakai,
-- SELAMA harga faktur sama dengan harga PO dan faktur tanpa PPN.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Kasus 13–16 Nov: PO-20261102-DC-0004 diterima di DC VET CMGG lalu dibagi ke klinik lewat Pemindahan Barang.
-- Faktur PO ditolak "Stok PO sudah terpakai atau asal biaya tidak lengkap" karena aturan lama mewajibkan seluruh
-- qty faktur masih utuh di lapisan stok penerimaan (untuk menilai ulang lapisan ke harga faktur).
--
-- Bila harga faktur = harga PO dan PPN = 0, nilai baru lapisan = nilai lama: tidak ada nilai stok yang perlu diubah,
-- jurnal faktur hanya Dr Barang diterima belum ditagih / Cr Hutang (selisih 170001 = 0). Barang yang sudah keluar
-- sudah tercatat (HPP / pindahan) pada nilai yang sama, jadi menolak faktur tidak melindungi apa pun.
--   * Lapisan yang masih ada tetap dialokasikan persis seperti dulu (urutan, pemecahan, bukti).
--   * Kekurangan qty (sudah dipindah/terpakai) dibiarkan; lapisan penerimaan yang sudah habis (qty_left = 0) dengan
--     biaya PO ikut dicatat sebagai bukti teralokasi, supaya faktur yang seluruh barangnya sudah keluar tetap punya
--     bukti asal nilai (pembatalan faktur tetap memakai aturan lama: ditolak bila lapisan berubah setelah faktur).
--   * Harga faktur berbeda dari PO (atau ber-PPN) dan barang sudah keluar → tetap DITOLAK, kini dengan pesan yang jelas.
--     Membebankan selisih ke HPP adalah keputusan keuangan terpisah.
-- Tidak ada fungsi yang ditulis ulang: tambalan berjangkar (tepat satu kecocokan atau migrasi berhenti) pada definisi
-- yang berjalan. Tidak ada baris data yang diubah.
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('vetos:faktur-po-stok-dipindah',0));

create function pg_temp.patch_once(p_def text, p_old text, p_new text, p_label text) returns text
language plpgsql as $$
declare n integer;
begin
 if p_old is null or length(p_old)=0 then raise exception 'FAKTUR_PO_STOK_DIPINDAH_ANCHOR_EMPTY %',p_label; end if;
 n:=(length(p_def)-length(replace(p_def,p_old,'')))/length(p_old);
 if n<>1 then raise exception 'FAKTUR_PO_STOK_DIPINDAH_ANCHOR % ditemukan % kali (seharusnya 1); migrasi dihentikan',p_label,n; end if;
 return replace(p_def,p_old,p_new);
end $$;

do $patch$
declare v text;
begin
 v:=pg_get_functiondef('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure);
 v:=pg_temp.patch_once(v,
  $a$x.harga/x.expected_faktor*dpp/total_value new_cost from jsonb_to_recordset(trusted)x(qty numeric,harga numeric,expected_harga_po numeric,expected_faktor numeric,po_item_id uuid) join public.purchase_order_items i on i.id=x.po_item_id group by$a$,
  $b$x.harga/x.expected_faktor*dpp/total_value new_cost,bool_and(x.harga=x.expected_harga_po) same_price from jsonb_to_recordset(trusted)x(qty numeric,harga numeric,expected_harga_po numeric,expected_faktor numeric,po_item_id uuid) join public.purchase_order_items i on i.id=x.po_item_id group by$b$,
  'same price flag');
 v:=pg_temp.patch_once(v,
  $a$  if remaining>0 then raise exception 'Stok PO sudah terpakai atau asal biaya tidak lengkap. Rekonsiliasi sebelum faktur';end if;$a$,
  $b$  if remaining>0 and not (r.same_price and ppn=0 and dpp=total_value) then raise exception 'Sebagian barang PO ini sudah dipindah atau terpakai, jadi harga faktur harus sama dengan harga PO (tanpa PPN). Samakan harga faktur dengan PO, atau minta keuangan merekonsiliasi selisihnya';end if;
  -- Harga faktur = harga PO tanpa PPN: barang yang sudah keluar sudah bernilai sama, tidak ada nilai stok yang diubah.
  if remaining>0 then
   allocated:=allocated||array(select l.id from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po and l.unit_cost=r.old_cost and l.qty_left=0
    and not (l.id=any(allocated))
    and not exists(select 1 from public.purchase_invoice_layer_proofs proof join public.purchase_invoices inv on inv.id=proof.invoice_id where proof.layer_id=l.id and proof.allocated and inv.voided_at is null)
    order by l.tanggal,l.created_at,l.id);
  end if;$b$,
  'consumed stock at PO price');
 execute v;
end $patch$;
