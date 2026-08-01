-- Anabul kembar per pemilik: gabungkan data lama + kunci supaya tidak terulang.
--
-- Temuan 2026-08-01: 10 dari 44 anabul adalah duplikat (Michi 5×, Iju 4×, Bruno 2×),
-- semuanya di satu pemilik yang dipakai uji coba berulang selama ~3 minggu.
-- Penyebab: layar registrasi klinik punya jalur "pilih anabul existing" lewat no. HP,
-- tapi kalau staff mengetik nama baru jalur itu dilewati tanpa peringatan apa pun.
-- Akibatnya riwayat medis satu hewan terpecah ke beberapa kartu — dokter membuka
-- kartu Michi dan tidak menemukan riwayat vaksin yang tersimpan di Michi yang lain.
--
-- Prinsip: NOL data hilang. Duplikat tidak dihapus, hanya ditandai 'Digabung';
-- semua kunjungan/penjualan/follow-up dipindah ke kartu induk.

-- ── 1. Tentukan kartu induk per (pemilik, nama) ─────────────────────────────
-- Induk = yang paling awal dibuat: kunjungan tertua kemungkinan besar menempel
-- ke sana, jadi paling sedikit baris yang perlu dipindah.
-- Tabel bantu sengaja BUKAN temporary: perilaku temp table berbeda tergantung
-- migrasi dijalankan di dalam transaksi atau tidak — ini deterministik.
create table _pet_merge as
with ranked as (
  select id,
         row_number() over w as rn,
         first_value(id) over w as keeper_id
  from pets
  window w as (partition by customer_id, lower(btrim(name)) order by created_at, id)
)
select id as dup_id, keeper_id from ranked where rn > 1;

-- ── 2. Lengkapi kolom kosong di kartu induk dari duplikatnya ────────────────
-- Nilai induk yang SUDAH terisi tidak pernah ditimpa (induk = sumber kebenaran).
-- Yang diambil: nilai non-kosong PERTAMA menurut urutan pembuatan.
-- Catatan: kalau duplikat berbeda isi (mis. satu 'Kucing' satu 'Anjing'), yang
-- menang adalah milik induk. Konflik semacam ini dilaporkan ke tim untuk dicek
-- manual — migrasi tidak boleh menebak jenis hewan.
create table _pet_fill as
select d.keeper_id,
       (array_remove(array_agg(p.species        order by p.created_at), null))[1] as species,
       (array_remove(array_agg(p.breed          order by p.created_at), null))[1] as breed,
       (array_remove(array_agg(p.gender         order by p.created_at), null))[1] as gender,
       (array_remove(array_agg(p.dob            order by p.created_at), null))[1] as dob,
       (array_remove(array_agg(p.weight         order by p.created_at), null))[1] as weight,
       (array_remove(array_agg(p.warna          order by p.created_at), null))[1] as warna,
       (array_remove(array_agg(p.sterilisasi    order by p.created_at), null))[1] as sterilisasi,
       (array_remove(array_agg(p.golongan_darah order by p.created_at), null))[1] as golongan_darah,
       (array_remove(array_agg(p.microchip      order by p.created_at), null))[1] as microchip,
       (array_remove(array_agg(p.alergi         order by p.created_at), null))[1] as alergi,
       (array_remove(array_agg(p.kondisi_khusus order by p.created_at), null))[1] as kondisi_khusus,
       (array_remove(array_agg(p.photo_url      order by p.created_at), null))[1] as photo_url
from _pet_merge d
join pets p on p.id = d.dup_id
group by d.keeper_id;

update pets k set
  species        = coalesce(k.species,        f.species),
  breed          = coalesce(k.breed,          f.breed),
  gender         = coalesce(k.gender,         f.gender),
  dob            = coalesce(k.dob,            f.dob),
  weight         = coalesce(k.weight,         f.weight),
  warna          = coalesce(k.warna,          f.warna),
  sterilisasi    = coalesce(k.sterilisasi,    f.sterilisasi),
  golongan_darah = coalesce(k.golongan_darah, f.golongan_darah),
  microchip      = coalesce(k.microchip,      f.microchip),
  alergi         = coalesce(k.alergi,         f.alergi),
  kondisi_khusus = coalesce(k.kondisi_khusus, f.kondisi_khusus),
  photo_url      = coalesce(k.photo_url,      f.photo_url)
from _pet_fill f
where k.id = f.keeper_id;

-- ── 3. Pindahkan semua riwayat ke kartu induk ──────────────────────────────
-- Tiga tabel ini satu-satunya yang menunjuk pets (dicek lewat foreign key).
update visits     v set pet_id = d.keeper_id from _pet_merge d where v.pet_id = d.dup_id;
update sales      s set pet_id = d.keeper_id from _pet_merge d where s.pet_id = d.dup_id;
update follow_ups f set pet_id = d.keeper_id from _pet_merge d where f.pet_id = d.dup_id;

-- ── 4. Duplikat ditandai, bukan dihapus ────────────────────────────────────
-- 'Digabung' sengaja dibedakan dari 'Tidak Aktif'/'RIP' supaya jelas ini hasil
-- pembersihan, bukan hewan yang benar-benar nonaktif — dan bisa dibalik.
update pets p set status = 'Digabung' from _pet_merge d where p.id = d.dup_id;

drop table _pet_fill;
drop table _pet_merge;

-- ── 5. Kunci di database, bukan cuma di aplikasi ───────────────────────────
-- Satu pemilik tidak boleh punya dua anabul AKTIF dengan nama sama (beda huruf
-- besar/kecil & spasi ikut dianggap sama). Dibatasi ke status 'Aktif' supaya
-- kartu yang sudah digabung/RIP tidak memblokir pendaftaran nama itu lagi.
-- Kalau suatu saat ada pemilik dengan dua hewan bernama persis sama, staff
-- memberi pembeda di namanya — jauh lebih murah daripada riwayat medis tertukar.
create unique index pets_nama_unik_per_pemilik
  on pets (customer_id, lower(btrim(name)))
  where status = 'Aktif';

comment on index pets_nama_unik_per_pemilik is
  'Cegah anabul kembar per pemilik. Pesan ramah untuk staff dirakit di server action registrasi & tambah anabul.';
