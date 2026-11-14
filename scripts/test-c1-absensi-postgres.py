#!/usr/bin/env python3
"""C1 (meeting 12 Nov 2026) tahap 1 + selfie wajib: absen mandiri lewat server, foto, koreksi absen
(migrasi 20261118640000_c1_absensi_mandiri_selfie.sql).

Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL, no network.
The storage schema is the fixture's shim table; RLS is switched on for it here so the bucket policies are exercised.

  python3 -I scripts/test-c1-absensi-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures -> candidate -> behaviour checks.
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED).
"""
import argparse, importlib.util, json, os, sys, uuid
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
CANDIDATE = ROOT / "supabase/migrations/20261118640000_c1_absensi_mandiri_selfie.sql"
RESULTS = []

U = lambda n: f"c1000000-0000-4000-8000-{n:012d}"
OWNER, ADMIN_A, ADMIN_B, FINANCE, S1, S2, S3, S4, S5, S6, S7, S8 = (U(i) for i in range(1, 13))
E = lambda n: f"c1eeeeee-0000-4000-8000-{n:012d}"
E1, E2, E3, E4, E5, E6, E7, E_ADMIN, E8 = (E(i) for i in range(1, 10))
CAB_A, CAB_B, CAB_C = U(101), U(102), U(103)
SH_PAGI, SH_MALAM, SH_LIBUR, SH_PAGI_B = U(201), U(202), U(203), U(204)
LAT_A, LNG_A = -6.2, 106.8          # Cabang A, radius 200 m
LAT_B, LNG_B = -6.3, 106.9          # Cabang B, radius 200 m
NEAR_A = (LAT_A + 0.0009, LNG_A)    # ±100 m dari A
FAR_A = (LAT_A + 0.009, LNG_A)      # ±1 km dari A
D = "2026-11-20"                    # Jumat
D_KEMARIN, D_BESOK, D_LUSA = "2026-11-19", "2026-11-21", "2026-11-22"


def q(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def check(name, ok, detail=None, kind="feature"):
    RESULTS.append(dict(case=name, kind=kind, status="PASS" if ok else "FAIL", detail=detail))
    print(RESULTS[-1]["status"], name, json.dumps(detail, default=str)[:300], flush=True)


class _HoldBack:
    """Shared fixture bootstrap, every migration except the candidate."""
    def __init__(self, db): self.db = db
    def sql(self, source):
        if source == "begin;\n" + CANDIDATE.read_text() + "\ncommit;": return ""
        return self.db.sql(source)


class H:
    def __init__(self, db): self.db = db
    def sql(self, s): return self.db.sql(s)

    def val(self, s, user=None, role="authenticated"):
        if user is None and role == "authenticated": out = self.db.sql(s)
        else:
            out = self.db.sql(f"begin;\nset local role {role};\n"
                              + (f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                                 f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role=role)))},true);\n"
                                 f"select set_config('request.jwt.claim.role',{q(role)},true);\n" if user else "")
                              + s + "\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def err(self, s, user=None, role="authenticated"):
        try: self.val(s, user, role); return None
        except RuntimeError as e: return str(e)


def set_now(h, wib):
    """Pin the server clock used by the attendance functions (test seam private.absen_sekarang)."""
    h.sql("create or replace function private.absen_sekarang() returns timestamptz language sql stable set search_path='' "
          f"as $$ select {q(wib + '+07')}::timestamptz $$;")


def foto(h, user, emp, tgl, kind, upload=True):
    path = f"{emp}/{tgl}/{kind}-{uuid.uuid4()}.jpg"
    if upload:
        try: h.val(f"insert into storage.objects(bucket_id,name) values('absensi-foto',{q(path)});", user)
        except RuntimeError: pass  # baseline: policy unggah belum ada
    return path


def absen(h, user, jenis, pos, path):
    lat, lng = pos if pos else (None, None)
    try:
        return None, json.loads(h.val(f"select public.absen_mandiri({q(jenis)},{q(lat)}::float8,{q(lng)}::float8,{q(path)});", user))
    except RuntimeError as e: return str(e), None


def att(h, emp, tgl):
    out = h.val("select coalesce((select to_jsonb(a) from public.attendance a where employee_id=" + q(emp) + " and tanggal=" + q(tgl) + "),'null')")
    return json.loads(out)


def nrows(h, emp): return int(h.val(f"select count(*) from public.attendance where employee_id={q(emp)}"))


def prep(h):
    users = [(OWNER, "OWNER"), (ADMIN_A, "ADMIN"), (ADMIN_B, "ADMIN"), (FINANCE, "FINANCE")] + [(u, "STAFF") for u in (S1, S2, S3, S4, S5, S6, S7, S8)]
    h.sql("insert into auth.users(id,raw_user_meta_data) values " + ",".join(f"({q(u)},'{{\"full_name\":\"Uji C1\"}}'::jsonb)" for u, _ in users) + ";")
    h.sql("".join(f"update public.profiles set role={q(r)},is_active=true where id={q(u)};" for u, r in users))
    h.sql("delete from public.role_capabilities; insert into public.role_capabilities(role,all_branches,create_accounts) values"
          " ('OWNER',true,true),('ADMIN',false,false),('FINANCE',true,false),('STAFF',false,false),('DOCTOR',false,false);")
    h.sql(f"insert into public.branches(id,code,name,type,is_active) values ({q(CAB_A)},'C1-A','Cabang Uji A','KLINIK',true),"
          f"({q(CAB_B)},'C1-B','Cabang Uji B','BOTH',true),({q(CAB_C)},'C1-C','Cabang Uji C','PETSHOP',true);"
          f"update public.branches set lat={LAT_A},lng={LNG_A},radius_m=200 where id={q(CAB_A)};"
          f"update public.branches set lat={LAT_B},lng={LNG_B},radius_m=200 where id={q(CAB_B)};")
    h.sql(f"insert into public.user_branches(user_id,branch_id) values ({q(ADMIN_A)},{q(CAB_A)}),({q(ADMIN_B)},{q(CAB_B)});")
    emps = [(E1, S1, CAB_A, "Aktif"), (E2, S2, CAB_B, "Aktif"), (E3, S3, CAB_B, "Aktif"), (E4, S4, CAB_A, "Aktif"),
            (E5, S5, CAB_A, "Aktif"), (E6, S6, None, "Aktif"), (E7, S7, CAB_A, "Nonaktif"), (E_ADMIN, ADMIN_A, CAB_A, "Aktif"),
            (E8, S8, CAB_C, "Aktif")]
    h.sql("insert into public.employees(id,nama,profile_id,branch_id,status) values "
          + ",".join(f"({q(e)},'Karyawan Uji {i}',{q(p)},{q(b)},{q(s)})" for i, (e, p, b, s) in enumerate(emps, 1)) + ";")
    # Penugasan: E3 cabang utama (data lama) = B, tapi penugasan berjalan hanya A; penugasan B sudah berakhir.
    h.sql("delete from public.employee_branch_assignments where employee_id in (" + ",".join(q(e) for e, *_ in emps) + ");"
          "insert into public.employee_branch_assignments(employee_id,branch_id,role,effective_date) values "
          + ",".join(f"({q(e)},{q(b)},'PRIMARY','2026-01-01')" for e, _, b, _ in emps if b and e != E3)
          + f",({q(E3)},{q(CAB_A)},'SECONDARY','2026-01-01'),({q(E3)},{q(CAB_B)},'PRIMARY','2026-01-01');"
          f"update public.employee_branch_assignments set end_date='2026-10-31',ended_at=now(),ended_by={q(OWNER)},ended_reason='pindah cabang uji'"
          f" where employee_id={q(E3)} and branch_id={q(CAB_B)};")
    h.sql(f"insert into public.work_shifts(id,nama,jam_masuk,jam_pulang,is_libur,branch_id) values"
          f" ({q(SH_PAGI)},'Pagi','08:00','17:00',false,null),({q(SH_MALAM)},'Malam','22:00','06:00',false,{q(CAB_A)}),"
          f" ({q(SH_LIBUR)},'Libur',null,null,true,null),({q(SH_PAGI_B)},'Pagi B','08:00','17:00',false,{q(CAB_B)});")
    sched = [(E1, D, SH_PAGI), (E1, D_LUSA, SH_PAGI), (E2, D, SH_PAGI), (E3, D, SH_PAGI), (E4, D, SH_MALAM), (E4, D_BESOK, SH_LIBUR),
             (E5, D, SH_MALAM), (E8, D, SH_PAGI), (E_ADMIN, D, SH_PAGI)]
    h.sql("insert into public.employee_schedules(employee_id,tanggal,shift_id) values " + ",".join(f"({q(e)},{q(t)},{q(s)})" for e, t, s in sched) + ";")
    # Storage Supabase asli: RLS menyala dan role authenticated boleh SELECT/INSERT (dibatasi policy). Shim uji tidak.
    h.sql("alter table storage.objects enable row level security; grant select, insert on storage.objects to authenticated;")


def run(h):
    st = {}  # dibagi antar bagian (path foto pertama)

    def bagian_0():  # server time, geofence, foto, masuk
        sig = h.val("select pg_get_function_identity_arguments(to_regprocedure('public.absen_mandiri(text,double precision,double precision,text)'))")
        check("RPC tidak menerima jam dari aplikasi (argumen: jenis, lat, lng, foto)", bool(sig) and "time" not in sig and "date" not in sig, sig)
        set_now(h, f"{D} 07:55:12")
        e, _ = absen(h, S1, "masuk", NEAR_A, None)
        check("tanpa foto selfie: ditolak", bool(e) and "ABSEN_FOTO" in e and nrows(h, E1) == 0, e)
        e, _ = absen(h, S1, "masuk", NEAR_A, foto(h, S1, E1, D, "in", upload=False))
        check("path foto belum terunggah: ditolak", bool(e) and "ABSEN_FOTO" in e, e)
        e, _ = absen(h, S1, "masuk", NEAR_A, foto(h, S1, E1, D, "out"))
        check("foto 'out' dipakai untuk absen masuk: ditolak", bool(e) and "ABSEN_FOTO" in e, e)
        e = h.err(f"insert into storage.objects(bucket_id,name) values('absensi-foto',{q(f'{E2}/{D}/in-{uuid.uuid4()}.jpg')});", S1)
        own = h.err(f"insert into storage.objects(bucket_id,name) values('absensi-foto',{q(f'{E1}/{D}/in-{uuid.uuid4()}.jpg')});", S1)
        check("storage: staf bisa mengunggah ke foldernya sendiri, tidak ke folder karyawan lain", own is None and bool(e) and "row-level security" in e, own or e)
        e = h.err(f"insert into storage.objects(bucket_id,name) values('absensi-foto',{q(f'{E1}/{D}/selfie.png')});", S1)
        check("storage: nama file di luar pola ditolak (pola sah diterima)", own is None and bool(e) and "row-level security" in e, e)
        e, _ = absen(h, S1, "masuk", FAR_A, foto(h, S1, E1, D, "in"))
        check("di luar radius: ditolak dengan jarak & batas, tidak ada baris", bool(e) and "ABSEN_DI_LUAR_RADIUS" in e and " m dari Cabang Uji A" in e and "200 m" in e and nrows(h, E1) == 0, e)
        e, _ = absen(h, S1, "masuk", None, foto(h, S1, E1, D, "in"))
        check("lokasi HP kosong di cabang bertitik: ditolak", bool(e) and "ABSEN_LOKASI_KOSONG" in e, e)
        p_in = st["p_in"] = foto(h, S1, E1, D, "in")
        e, r = absen(h, S1, "masuk", NEAR_A, p_in)
        a = att(h, E1, D)
        check("absen masuk di dalam radius: tercatat jam server, cabang A, shift Pagi, sumber mandiri, foto",
              e is None and a and a["jam_masuk"] == "07:55:12" and a["sumber"] == "mandiri" and a["branch_id"] == CAB_A
              and a["shift_id"] == SH_PAGI and a["foto_masuk"] == p_in and 80 <= (a["jarak_masuk_m"] or 0) <= 120
              and a["verifikasi_status"] == "belum" and a["tanpa_jadwal"] is False and a["waktu_masuk"].startswith("2026-11-20T00:55:12"), e or a)
        check("hasil RPC: tanggal, jam, shift, telat 0", r and r["tanggal"] == D and r["jam"] == "07:55" and r["shift"] == "Pagi" and r["telat_menit"] == 0, r)
        set_now(h, f"{D} 08:30:00")
        e, _ = absen(h, S1, "masuk", NEAR_A, foto(h, S1, E1, D, "in"))
        check("absen masuk kedua: ditolak, jam pertama tidak tertimpa", bool(e) and "ABSEN_SUDAH_MASUK" in e and "07:55" in e and att(h, E1, D)["jam_masuk"] == "07:55:12", e)
        set_now(h, f"{D} 16:30:00")
        p_out = foto(h, S1, E1, D, "out")
        e, r = absen(h, S1, "pulang", NEAR_A, p_out)
        a = att(h, E1, D)
        check("absen pulang lebih awal: tercatat, pulang cepat 30 menit dari shift", e is None and a["jam_pulang"] == "16:30:00" and r["pulang_cepat_menit"] == 30 and a["foto_pulang"], e or r)
        e, _ = absen(h, S1, "pulang", NEAR_A, p_out)
        check("foto yang sudah dipakai: ditolak", bool(e) and "ABSEN_FOTO" in e and "sudah dipakai" in e, e)
        e, _ = absen(h, S1, "pulang", NEAR_A, foto(h, S1, E1, D, "out"))
        check("absen pulang kedua: ditolak", bool(e) and "ABSEN_SUDAH_PULANG" in e and att(h, E1, D)["jam_pulang"] == "16:30:00", e)
        set_now(h, f"{D_LUSA} 08:20:00")
        e, r = absen(h, S1, "masuk", NEAR_A, foto(h, S1, E1, D_LUSA, "in"))
        check("telat dihitung dari shift orang itu: masuk 08:20 shift 08:00 = 20 menit", e is None and r["telat_menit"] == 20, e or r)


    def bagian_1():  # cabang dari penugasan/jadwal, bukan cabang utama
        set_now(h, f"{D} 07:50:00")
        e, _ = absen(h, S3, "masuk", (LAT_B, LNG_B), foto(h, S3, E3, D, "in"))
        check("cabang utama lama (B) tidak dipakai bila penugasan B sudah berakhir: ditolak", bool(e) and "ABSEN_DI_LUAR_RADIUS" in e, e)
        e, r = absen(h, S3, "masuk", NEAR_A, foto(h, S3, E3, D, "in"))
        check("cabang = penugasan berjalan (A): diterima", e is None and att(h, E3, D)["branch_id"] == CAB_A, e or r)
        h.sql(f"update public.employee_schedules set shift_id={q(SH_PAGI_B)} where employee_id={q(E2)} and tanggal={q(D)};")
        e, r = absen(h, S2, "masuk", NEAR_A, foto(h, S2, E2, D, "in"))
        check("shift milik cabang B: absen di A ditolak (cabang dari jadwal)", bool(e) and "Cabang Uji B" in e, e)
        e, r = absen(h, S2, "masuk", (LAT_B + 0.0005, LNG_B), foto(h, S2, E2, D, "in"))
        check("shift milik cabang B: absen di B diterima", e is None and att(h, E2, D)["branch_id"] == CAB_B, e or r)
        e, r = absen(h, S8, "masuk", None, foto(h, S8, E8, D, "in"))
        check("cabang tanpa titik koordinat: pengecekan lokasi mati (aturan lama)", e is None and r["lokasi"] == "tanpa_titik" and att(h, E8, D)["branch_id"] == CAB_C, e or r)


    def bagian_2():  # shift malam
        set_now(h, f"{D} 21:50:00")
        e, r = absen(h, S4, "masuk", NEAR_A, foto(h, S4, E4, D, "in"))
        check("shift malam: absen masuk 21:50 masuk ke tanggal mulai shift", e is None and r["tanggal"] == D and r["telat_menit"] == 0, e or r)
        set_now(h, f"{D_BESOK} 06:10:00")
        e, r = absen(h, S4, "pulang", NEAR_A, foto(h, S4, E4, D_BESOK, "out"))
        a = att(h, E4, D)
        check("shift malam: absen pulang 06:10 besoknya menutup baris kemarin, tidak membuat baris baru",
              e is None and a["jam_pulang"] == "06:10:00" and r["tanggal"] == D and r["pulang_cepat_menit"] == 0 and nrows(h, E4) == 1, e or r)
        set_now(h, f"{D_BESOK} 00:30:00")
        e, r = absen(h, S5, "masuk", NEAR_A, foto(h, S5, E5, D_BESOK, "in"))
        check("shift malam: masuk 00:30 (telat lewat tengah malam) tetap milik shift kemarin, telat 150 menit",
              e is None and r["tanggal"] == D and r["telat_menit"] == 150 and att(h, E5, D_BESOK) is None, e or r)
        e, _ = absen(h, S5, "masuk", NEAR_A, foto(h, S5, E5, D_BESOK, "in"))
        check("masih tercatat masuk (shift malam belum pulang): absen masuk lagi ditolak", bool(e) and "ABSEN_SUDAH_MASUK" in e, e)


    def bagian_3():  # tanpa jadwal / libur / status HR / nonaktif / belum masuk
        set_now(h, f"{D} 09:00:00")
        e, r = absen(h, S6, "masuk", None, foto(h, S6, E6, D, "in"))
        check("tanpa jadwal & tanpa cabang: boleh, ditandai tanpa_jadwal", e is None and r["tanpa_jadwal"] is True and att(h, E6, D)["tanpa_jadwal"] is True, e or r)
        set_now(h, f"{D_BESOK} 10:00:00")
        e, r = absen(h, S4, "masuk", NEAR_A, foto(h, S4, E4, D_BESOK, "in"))
        check("jadwal libur: boleh, ditandai tanpa_jadwal", e is None and r["tanggal"] == D_BESOK and r["tanpa_jadwal"] is True, e or r)
        e, _ = absen(h, S7, "masuk", NEAR_A, foto(h, S7, E7, D_BESOK, "in"))
        check("karyawan nonaktif: ditolak", bool(e) and "ABSEN_KARYAWAN" in e, e)
        e, _ = absen(h, S1, "pulang", NEAR_A, foto(h, S1, E1, D_BESOK, "out"))
        check("absen pulang tanpa absen masuk: ditolak", bool(e) and "ABSEN_BELUM_MASUK" in e, e)
        h.sql(f"insert into public.attendance(employee_id,tanggal,status) values ({q(E3)},{q(D_BESOK)},'Izin');")
        e, _ = absen(h, S3, "masuk", NEAR_A, foto(h, S3, E3, D_BESOK, "in"))
        check("tercatat Izin oleh HR: absen masuk ditolak", bool(e) and "ABSEN_STATUS_HR" in e, e)
        e = h.err(f"select public.absen_mandiri('masuk',null,null,null);", None, "anon")
        check("anon tidak bisa memanggil absen_mandiri", bool(e) and "permission denied" in e, e)


    def bagian_4():  # staf tidak bisa menulis attendance langsung
        e = h.err(f"insert into public.attendance(employee_id,tanggal,jam_masuk,status) values ({q(E1)},'2026-11-25','07:00','Hadir');", S1)
        check("staf INSERT attendance langsung: ditolak RLS", bool(e) and "row-level security" in e, e)
        h.val(f"update public.attendance set jam_masuk='06:00' where employee_id={q(E1)} and tanggal={q(D)};", S1)
        check("staf UPDATE attendance langsung: tidak mengubah apa pun", att(h, E1, D)["jam_masuk"] == "07:55:12")
        check("staf masih bisa membaca absennya sendiri", h.val(f"select count(*) from public.attendance where employee_id={q(E1)};", S1) == "2")
        check("staf tidak bisa membaca absen orang lain", h.val(f"select count(*) from public.attendance where employee_id={q(E2)};", S1) == "0", kind="regression")


    def bagian_5():  # catat manual HR tetap jalan
        p_in = st.get("p_in")
        e = h.err(f"insert into public.attendance(employee_id,tanggal,jam_masuk,jam_pulang,status,sumber,foto_masuk,waktu_masuk) values"
                  f" ({q(E1)},'2026-11-10','08:05','17:00','Hadir','mandiri','palsu.jpg',now())"
                  f" on conflict (employee_id,tanggal) do update set jam_masuk=excluded.jam_masuk,jam_pulang=excluded.jam_pulang,status=excluded.status;", ADMIN_A)
        a = att(h, E1, "2026-11-10")
        check("ADMIN cabang A mencatat manual (upsert): tersimpan, sumber dipaksa manual, kolom bukti tidak bisa diisi",
              e is None and a and a["jam_masuk"] == "08:05:00" and a["sumber"] == "manual" and a["foto_masuk"] is None and a["waktu_masuk"] is None, e or a)
        h.val(f"update public.attendance set jam_masuk='07:00', foto_masuk=null, sumber='mandiri' where employee_id={q(E1)} and tanggal={q(D)};", ADMIN_A)
        a = att(h, E1, D)
        check("ADMIN mengubah jam baris mandiri: jam berubah, sumber jadi manual, foto & waktu asli tetap",
              a["jam_masuk"] == "07:00:00" and a["sumber"] == "manual" and a["foto_masuk"] == p_in and a["waktu_masuk"] is not None, a)
        e = h.err(f"insert into public.attendance(employee_id,tanggal,status) values ({q(E1)},'2026-11-11','Sakit');", ADMIN_B)
        check("ADMIN cabang lain tidak bisa mencatat karyawan cabang A", bool(e) and "row-level security" in e, e, kind="regression")
        e = h.err(f"insert into public.attendance(employee_id,tanggal,status) values ({q(E2)},'2026-11-11','Sakit');", OWNER)
        check("OWNER mencatat manual: tersimpan", e is None and att(h, E2, "2026-11-11")["status"] == "Sakit", e, kind="regression")


    def bagian_6():  # foto: siapa boleh melihat
        p_in = st.get("p_in")
        see = lambda u: int(h.val(f"select count(*) from storage.objects where bucket_id='absensi-foto' and name={q(p_in)};", u))
        check("foto: ADMIN pengelola cabang & OWNER bisa melihat", see(ADMIN_A) == 1 and see(OWNER) == 1)
        check("foto: ADMIN cabang lain, FINANCE, dan staf lain tidak bisa melihat (foto ada)", see(ADMIN_A) == 1 and see(ADMIN_B) == 0 and see(FINANCE) == 0 and see(S2) == 0)
        check("foto: karyawan pemilik bisa melihat fotonya sendiri", see(S1) == 1)
        e = h.err(f"update storage.objects set name=name||'x' where name={q(p_in)};", S1)
        left = int(h.val(f"select count(*) from storage.objects where name={q(p_in)}"))
        check("foto: tidak bisa diubah/dihapus klien (bukti)", left == 1, e)


    def bagian_7():  # koreksi absen
        set_now(h, f"{D} 12:00:00")
        def ajukan(user, tgl, jm, jp, kat="lupa_absen", alasan="Lupa absen, HP mati"):
            try: return None, h.val(f"select public.ajukan_koreksi_absen({q(tgl)}::date,{q(jm)}::time,{q(jp)}::time,{q(kat)},{q(alasan)});", user)
            except RuntimeError as ex: return str(ex), None
        def putuskan(user, kid, setuju, cat=None):
            try: return None, json.loads(h.val(f"select public.putuskan_koreksi_absen({q(kid)}::uuid,{str(setuju).lower()},{q(cat)});", user))
            except RuntimeError as ex: return str(ex), None
        e, k1 = ajukan(S1, D_KEMARIN, "08:00", "17:00")
        check("staf mengajukan koreksi (lupa absen kemarin): Menunggu", e is None and h.val(f"select status from public.attendance_corrections where id={q(k1)}") == "Menunggu", e)
        e, _ = ajukan(S1, D_KEMARIN, "08:00", "17:00")
        check("koreksi kedua untuk tanggal yang sama saat masih menunggu: ditolak", bool(e) and "KOREKSI_DOBEL" in e, e)
        e, _ = ajukan(S1, D_BESOK, "08:00", None)
        check("koreksi tanggal depan: ditolak", bool(e) and "KOREKSI_TANGGAL" in e, e)
        e, _ = ajukan(S1, "2026-11-01", None, "17:00")
        check("koreksi hanya jam pulang padahal belum ada absen masuk: ditolak", bool(e) and "KOREKSI_JAM" in e, e)
        e, _ = ajukan(S1, D_KEMARIN, "08:00", None, alasan="x")
        check("alasan terlalu pendek: ditolak", bool(e) and "KOREKSI_ALASAN" in e, e)
        e = h.err(f"insert into public.attendance_corrections(employee_id,tanggal,jam_masuk,kategori,alasan) values ({q(E1)},'2026-11-05','08:00','lainnya','langsung');", S1)
        check("staf tidak bisa menulis tabel koreksi langsung", bool(e) and "permission denied" in e, e)
        check("staf lain tidak melihat koreksi orang lain", h.val("select count(*) from public.attendance_corrections;", S2) == "0"
              and h.val("select count(*) from public.attendance_corrections;", S1) == "1")
        e, _ = putuskan(S2, k1, True)
        check("staf tidak bisa memutuskan koreksi", bool(e) and "KOREKSI_AKSES" in e, e)
        e, _ = putuskan(ADMIN_B, k1, True)
        check("ADMIN cabang lain tidak bisa memutuskan", bool(e) and "KOREKSI_AKSES" in e, e)
        e, r = putuskan(ADMIN_A, k1, True, "ok, sudah dicek CCTV")
        a = att(h, E1, D_KEMARIN)
        k = json.loads(h.val(f"select to_jsonb(c) from public.attendance_corrections c where id={q(k1)}"))
        check("ADMIN pengelola menyetujui: absen tertulis sumber koreksi + penyetuju + id koreksi",
              e is None and a and a["jam_masuk"] == "08:00:00" and a["jam_pulang"] == "17:00:00" and a["sumber"] == "koreksi"
              and a["disetujui_oleh"] == ADMIN_A and a["koreksi_id"] == k1 and a["status"] == "Hadir", e or a)
        check("pengajuan jadi Disetujui dengan penyetuju, waktu, catatan, tautan absen",
              k["status"] == "Disetujui" and k["approved_by"] == ADMIN_A and k["approved_at"] and k["catatan_penyetuju"] == "ok, sudah dicek CCTV" and k["attendance_id"] == a["id"], k)
        e, _ = putuskan(ADMIN_A, k1, False)
        check("memutuskan ulang: ditolak", bool(e) and "KOREKSI_SUDAH_DIPUTUSKAN" in e, e)
        e, k2 = ajukan(S1, D, None, "17:05", "foto_gagal", "Kamera tidak mau terbuka")
        e2, r = putuskan(ADMIN_A, k2, True)
        a = att(h, E1, D)
        check("koreksi jam pulang saja melengkapi baris yang ada (jam masuk tetap)", e is None and e2 is None and a["jam_pulang"] == "17:05:00" and a["jam_masuk"] == "07:00:00" and a["sumber"] == "koreksi", e or e2 or a)
        e, k3 = ajukan(S2, D_KEMARIN, "08:00", "17:00", "lokasi_gagal", "GPS tidak terbaca")
        e2, r = putuskan(ADMIN_B, k3, False, "tidak ada bukti")
        check("koreksi ditolak: tidak ada absen tertulis", e is None and e2 is None and r["status"] == "Ditolak" and att(h, E2, D_KEMARIN) is None, e or e2 or r)
        e, k4 = ajukan(ADMIN_A, D_KEMARIN, "08:00", "17:00")
        e2, _ = putuskan(ADMIN_A, k4, True)
        check("ADMIN tidak bisa menyetujui koreksi miliknya sendiri", e is None and bool(e2) and "KOREKSI_DIRI_SENDIRI" in e2, e or e2)
        e2, r = putuskan(OWNER, k4, True)
        check("OWNER bisa menyetujui koreksi ADMIN", e2 is None and r["status"] == "Disetujui", e2 or r)
        n = int(h.val("select count(*) from public.activity_log where entity='attendance_corrections' or row_entity='attendance_corrections'"))
        check("Log Aktifitas mencatat pengajuan & keputusan koreksi", n >= 6, n)
        n = int(h.val(f"select count(*) from public.activity_log where row_entity='attendance' and actor_id={q(S1)}"))
        check("Log Aktifitas mencatat absen mandiri atas nama staf", n >= 2, n)


    for i, f in enumerate([bagian_0, bagian_1, bagian_2, bagian_3, bagian_4, bagian_5, bagian_6, bagian_7]):
        try: f()
        except Exception as ex: check(f"bagian {i} berjalan tuntas", False, str(ex)[:300])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); a = ap.parse_args()
    with NativePostgres(a.pg_bin) as db:
        fixture.DisposablePostgres.bootstrap(_HoldBack(db))
        h = H(db); prep(h)
        if not a.baseline: h.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        else: h.sql("insert into storage.buckets(id,name,public) select 'absensi-foto','absensi-foto',false;")
        try: run(h)
        except Exception as e: check("battery", False, str(e)[:300])
    feature = [r for r in RESULTS if r["kind"] == "feature"]
    if a.baseline:
        red = [r for r in feature if r["status"] == "FAIL"]
        print(f"BASELINE: {len(red)}/{len(feature)} feature cases RED without the candidate.", flush=True)
        ok = len(red) == len(feature)
    else:
        ok = all(r["status"] == "PASS" for r in RESULTS)
        print(f"{sum(r['status'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json: a.json.write_text(json.dumps(dict(candidate=CANDIDATE.name, baseline=a.baseline, ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
