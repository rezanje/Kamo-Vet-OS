// C1: absen mandiri — pesan, path foto, tombol di /me, dan server action (unggah selfie → absen_mandiri()).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pathFotoAbsen, pesanAbsen, pesanSuksesAbsen, tombolAbsen, ukuranKompres } from "../absensi-mandiri";

describe("helper absen mandiri", () => {
  it("path foto mengikuti pola bucket", () => {
    expect(pathFotoAbsen("e1", "2026-11-20", "masuk", "u1")).toBe("e1/2026-11-20/in-u1.jpg");
    expect(pathFotoAbsen("e1", "2026-11-20", "pulang", "u1")).toBe("e1/2026-11-20/out-u1.jpg");
  });
  it("kompres: sisi terpanjang ≤ 960, tidak diperbesar", () => {
    expect(ukuranKompres(3000, 4000)).toEqual({ lebar: 720, tinggi: 960 });
    expect(ukuranKompres(640, 480)).toEqual({ lebar: 640, tinggi: 480 });
  });
  it("pesan database ditampilkan tanpa kode; fungsi belum terpasang = sedang diperbarui", () => {
    expect(pesanAbsen({ message: "ABSEN_DI_LUAR_RADIUS: kamu 850 m dari Cabang A, batasnya 200 m." }))
      .toBe("Kamu 850 m dari Cabang A, batasnya 200 m.");
    expect(pesanAbsen({ code: "PGRST202", message: "Could not find the function public.absen_mandiri" })).toContain("sedang diperbarui");
    expect(pesanAbsen({ message: "boom" })).toContain("Absen gagal tersimpan");
  });
  it("pesan sukses menyebut telat & tanpa jadwal", () => {
    const p = pesanSuksesAbsen({ jenis: "masuk", tanggal: "2026-11-20", jam: "08:20", shift: "Pagi", telat_menit: 20, pulang_cepat_menit: null, tanpa_jadwal: false, cabang: "Cabang A", jarak_m: 50 });
    expect(p).toContain("08:20");
    expect(p).toContain("Telat 20 menit");
    expect(pesanSuksesAbsen({ jenis: "masuk", tanggal: "2026-11-20", jam: "09:00", shift: null, telat_menit: null, pulang_cepat_menit: null, tanpa_jadwal: true, cabang: null, jarak_m: null }))
      .toContain("tidak punya jadwal");
  });
  it("tombol: masuk → pulang → selesai; shift malam kemarin yang masih terbuka = pulang", () => {
    const now = new Date("2026-11-20T10:00:00+07:00").getTime();
    expect(tombolAbsen([], "2026-11-20", now).aksi).toBe("masuk");
    expect(tombolAbsen([{ tanggal: "2026-11-20", jam_masuk: "08:00:00", jam_pulang: null }], "2026-11-20", now).aksi).toBe("pulang");
    expect(tombolAbsen([{ tanggal: "2026-11-20", jam_masuk: "08:00:00", jam_pulang: "09:00:00" }], "2026-11-20", now).aksi).toBeNull();
    const pagi = new Date("2026-11-21T05:30:00+07:00").getTime();
    const malam = { tanggal: "2026-11-20", jam_masuk: "21:55:00", jam_pulang: null, waktu_masuk: "2026-11-20T14:55:00Z" };
    expect(tombolAbsen([malam], "2026-11-21", pagi)).toMatchObject({ aksi: "pulang", terbuka: malam });
    // lupa pulang lebih dari 20 jam: tidak ditawari pulang lagi (ajukan koreksi), boleh absen masuk hari ini
    expect(tombolAbsen([{ tanggal: "2026-11-19", jam_masuk: "08:00:00", jam_pulang: null }], "2026-11-20", now).aksi).toBe("masuk");
  });
});

// ── server action ──
const st = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  emp: { id: "e1", nama: "A", nik: null, jabatan: null, branch_id: null } as Record<string, unknown> | null,
  upload: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/employee", () => ({ getMyEmployee: async () => st.emp }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-11-20" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: st.user } }) },
  storage: { from: (bucket: string) => ({ upload: (...a: unknown[]) => st.upload(bucket, ...a) }) },
  rpc: (...a: unknown[]) => st.rpc(...a),
}) }));

import { absenMandiri, ajukanKoreksiAbsen } from "@/app/me/actions";

const form = (isi: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
};
const jpg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], "selfie.jpg", { type: "image/jpeg" });

beforeEach(() => {
  st.user = { id: "u1" };
  st.emp = { id: "e1", nama: "A", nik: null, jabatan: null, branch_id: null };
  st.upload.mockReset().mockResolvedValue({ error: null });
  st.rpc.mockReset().mockResolvedValue({ data: { jenis: "masuk", tanggal: "2026-11-20", jam: "07:55", shift: "Pagi", telat_menit: 0, pulang_cepat_menit: null, tanpa_jadwal: false, cabang: "Cabang A", jarak_m: 80 }, error: null });
});

describe("absenMandiri (server action)", () => {
  it("unggah selfie ke folder karyawan sendiri lalu panggil absen_mandiri tanpa jam dari aplikasi", async () => {
    await expect(absenMandiri(form({ jenis: "masuk", lat: "-6.2", lng: "106.8", foto: jpg(), jam: "06:00" }))).rejects.toThrow("REDIRECT:/me?success=in");
    const [bucket, path, , opsi] = st.upload.mock.calls[0];
    expect(bucket).toBe("absensi-foto");
    expect(path).toMatch(/^e1\/2026-11-20\/in-[0-9a-f-]{36}\.jpg$/);
    expect(opsi).toMatchObject({ upsert: false, contentType: "image/jpeg" });
    expect(st.rpc).toHaveBeenCalledWith("absen_mandiri", { p_jenis: "masuk", p_lat: -6.2, p_lng: 106.8, p_foto: path });
    expect(JSON.stringify(st.rpc.mock.calls[0][1])).not.toContain("06:00");
  });
  it("tanpa foto: ditolak sebelum unggah/absen", async () => {
    await expect(absenMandiri(form({ jenis: "masuk" }))).rejects.toThrow("Foto%20selfie%20wajib");
    expect(st.upload).not.toHaveBeenCalled();
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("format bukan JPEG ditolak", async () => {
    await expect(absenMandiri(form({ jenis: "pulang", foto: new File(["x"], "a.png", { type: "image/png" }) }))).rejects.toThrow("Format%20foto");
  });
  it("lokasi kosong dikirim null; penolakan database ditampilkan apa adanya", async () => {
    st.rpc.mockResolvedValue({ data: null, error: { message: "ABSEN_LOKASI_KOSONG: lokasi HP tidak terbaca. Izinkan akses lokasi di browser, lalu coba lagi." } });
    await expect(absenMandiri(form({ jenis: "pulang", foto: jpg() }))).rejects.toThrow(encodeURIComponent("Lokasi HP tidak terbaca"));
    expect(st.rpc.mock.calls[0][1]).toMatchObject({ p_jenis: "pulang", p_lat: null, p_lng: null });
    expect(st.upload.mock.calls[0][1]).toMatch(/\/out-/);
  });
  it("bucket/fungsi belum terpasang: pesan 'sedang diperbarui'", async () => {
    st.upload.mockResolvedValue({ error: { message: "Bucket not found" } });
    await expect(absenMandiri(form({ jenis: "masuk", foto: jpg() }))).rejects.toThrow("sedang%20diperbarui");
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("akun tanpa data karyawan ditolak", async () => {
    st.emp = null;
    await expect(absenMandiri(form({ jenis: "masuk", foto: jpg() }))).rejects.toThrow("belum%20tertaut");
  });
});

describe("ajukanKoreksiAbsen (server action)", () => {
  it("meneruskan isian ke ajukan_koreksi_absen", async () => {
    st.rpc.mockResolvedValue({ data: "k1", error: null });
    await expect(ajukanKoreksiAbsen(form({ tanggal: "2026-11-19", jam_masuk: "08:00", jam_pulang: "", kategori: "lupa_absen", alasan: "HP mati" })))
      .rejects.toThrow("success=koreksi");
    expect(st.rpc).toHaveBeenCalledWith("ajukan_koreksi_absen", { p_tanggal: "2026-11-19", p_jam_masuk: "08:00", p_jam_pulang: null, p_kategori: "lupa_absen", p_alasan: "HP mati" });
  });
  it("tanpa jam sama sekali ditolak di aplikasi", async () => {
    await expect(ajukanKoreksiAbsen(form({ tanggal: "2026-11-19", kategori: "lupa_absen", alasan: "HP mati" }))).rejects.toThrow("Isi%20jam");
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("penolakan database diteruskan", async () => {
    st.rpc.mockResolvedValue({ data: null, error: { message: "KOREKSI_DOBEL: masih ada koreksi tanggal ini yang menunggu persetujuan." } });
    await expect(ajukanKoreksiAbsen(form({ tanggal: "2026-11-19", jam_masuk: "08:00", kategori: "lupa_absen", alasan: "HP mati" })))
      .rejects.toThrow(encodeURIComponent("Masih ada koreksi"));
  });
});
