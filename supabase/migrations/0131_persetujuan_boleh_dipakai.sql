-- Aturan tulis pengajuan persetujuan.
--
-- Yang memutuskan adalah peran penyetuju, tapi yang menandai pengajuan "terpakai"
-- adalah orang yang MEMBAYAR — biasanya bukan orang yang menyetujui. Tanpa izin itu,
-- persetujuan yang sudah keluar tidak pernah bisa dipakai dan pembayarannya mentok.

drop policy if exists approval_requests_update on approval_requests;

create policy approval_requests_update on approval_requests for update to authenticated
  using (
    -- Memutuskan: peran penyetuju (OWNER selalu boleh).
    exists (
      select 1 from profiles p where p.id = auth.uid()
        and (p.role = 'OWNER' or p.role::text = approval_requests.penyetuju_role)
    )
    -- Memakai persetujuan yang sudah keluar: siapa pun yang melanjutkan transaksinya.
    or approval_requests.status = 'disetujui'
  )
  with check (true);
