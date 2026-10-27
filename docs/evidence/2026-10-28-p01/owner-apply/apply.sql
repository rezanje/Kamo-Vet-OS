-- P01 APPLY — WRITES. Satu transaksi: isi migrasi 20261028130000_p01_correction_request_any_reader.sql apa adanya (sha256 7b2f8d08e05553421ff3eb42fb9e7e3e39ed9133b724a862ceffa609625a6134) + baris riwayat.
-- Galat apa pun (termasuk tunggu kunci > 5 dtk atau bukan role postgres) membatalkan semuanya.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'P01 apply must run as postgres (current role: %); nothing was applied', current_user;
  end if;
end $$;

-- P01 (keputusan default 28 Okt 2026): siapa pun yang bisa membuka dokumen pembelian
-- boleh mengajukan permintaan koreksi. Eksekutor koreksi tetap OWNER aktif.
--
-- Sebelumnya create_purchase_correction_request dan pembaca request mensyaratkan modul
-- Pembelian (purchase_module_access). Akibatnya FINANCE (bawaan tanpa modul Pembelian)
-- yang melihat faktur di layar Hutang tidak bisa mengajukan, dan STAFF/FINANCE yang
-- terlanjur mengajukan tidak bisa melihat status request miliknya.
--
-- Yang diubah: syarat modul diganti syarat "boleh membaca dokumen asal", sama persis
-- dengan RLS baca PO/faktur (akun aktif + akses cabang dokumen). Yang TIDAK diubah:
-- OWNER tetap tidak mengajukan, hanya OWNER aktif yang memproses, request tetap tidak
-- mengubah PO/faktur/pembayaran/stok/jurnal, dan hanya OWNER membaca request orang lain.
-- Idempoten: hanya create or replace function dengan tanda tangan yang sama.

create or replace function public.purchase_correction_request_visible(p_requested_by uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active is true)
    and (p_branch is null or public.user_can_access_branch(p_branch))
    and (p_requested_by = auth.uid()
      or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='OWNER' and p.is_active));
$$;
revoke all on function public.purchase_correction_request_visible(uuid,uuid) from public,anon,service_role;
grant execute on function public.purchase_correction_request_visible(uuid,uuid) to authenticated;

create or replace function public.create_purchase_correction_request(
  p_source_kind text, p_source_id uuid, p_request_key text, p_detail text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor_role text; branch uuid; label text; v_po uuid; v_invoice uuid; v_detail text := btrim(coalesce(p_detail, ''));
  prior public.purchase_correction_requests%rowtype; r public.purchase_correction_requests%rowtype;
begin
  select p.role::text into actor_role from public.profiles p where p.id=auth.uid() and p.is_active;
  if auth.uid() is null or actor_role is null then
    raise exception 'Akun aktif diperlukan untuk meminta koreksi' using errcode='42501';
  end if;
  if actor_role = 'OWNER' then
    raise exception 'Super Admin memakai kontrol koreksi pada dokumen; permintaan tidak diperlukan' using errcode='42501';
  end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{8,120}$' then
    raise exception 'Identitas permintaan tidak valid; muat ulang halaman' using errcode='22023';
  end if;
  if length(v_detail) not between 10 and 2000 then
    raise exception 'Tulis rincian koreksi 10 sampai 2.000 karakter' using errcode='22023';
  end if;

  if p_source_kind = 'purchase_order' then
    select o.id, o.branch_id, coalesce(o.no_po, 'PO tanpa nomor') into v_po, branch, label
      from public.purchase_orders o where o.id = p_source_id;
  elsif p_source_kind = 'purchase_invoice' then
    select i.id, coalesce(i.branch_id, o.branch_id), i.no_faktur into v_invoice, branch, label
      from public.purchase_invoices i left join public.purchase_orders o on o.id = i.po_id where i.id = p_source_id;
  else
    raise exception 'Jenis dokumen asal tidak dikenal' using errcode='22023';
  end if;
  -- "Bisa membuka dokumen" = lolos RLS baca dokumen asal: PO tanpa cabang terbuka; faktur
  -- selalu lewat user_can_access_branch (cabang faktur, atau cabang PO-nya), termasuk bila kosong.
  if (v_po is null and v_invoice is null)
     or (v_po is not null and branch is not null and not public.user_can_access_branch(branch))
     or (v_invoice is not null and not public.user_can_access_branch(branch)) then
    raise exception 'Dokumen asal tidak ditemukan atau tidak dapat diakses' using errcode='42501';
  end if;

  -- Klik ganda/kirim ulang form yang sama menghasilkan satu request.
  perform pg_advisory_xact_lock(hashtext('vetos:purchase-correction:' || auth.uid()::text || ':' || p_request_key)::bigint);
  select * into prior from public.purchase_correction_requests where requested_by=auth.uid() and request_key=p_request_key;
  if found then
    if prior.source_kind is distinct from p_source_kind or prior.po_id is distinct from v_po
       or prior.invoice_id is distinct from v_invoice or prior.detail is distinct from v_detail then
      raise exception 'Identitas permintaan sudah dipakai dengan isi berbeda; muat ulang halaman' using errcode='23505';
    end if;
    r := prior;
  else
    insert into public.purchase_correction_requests(source_kind, po_id, invoice_id, branch_id, source_label, detail, requested_by, request_key)
      values (p_source_kind, v_po, v_invoice, branch, left(label, 120), v_detail, auth.uid(), p_request_key)
      returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'source_kind', r.source_kind,
    'source_id', coalesce(r.po_id, r.invoice_id), 'created_at', r.created_at);
end$$;
revoke all on function public.create_purchase_correction_request(text,uuid,text,text) from public,anon,service_role;
grant execute on function public.create_purchase_correction_request(text,uuid,text,text) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('20261028130000', 'p01_correction_request_any_reader') on conflict (version) do nothing;
commit;
