import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PESAN, asalAplikasi, bacaTokenPemulihan, cekEmail, cekPassword, hashPemulihan, pesanGagalKirim, pesanGagalSimpan,
} from "@/lib/lupa-password";

const sb = vi.hoisted(() => ({
  opsi: [] as unknown[],
  resetPasswordForEmail: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  hdr: new Map<string, string>(),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => sb.hdr.get(k) ?? null }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, opsi: unknown) => {
    sb.opsi.push(opsi);
    return { auth: { resetPasswordForEmail: sb.resetPasswordForEmail, setSession: sb.setSession, updateUser: sb.updateUser, signOut: sb.signOut } };
  },
}));
import { mintaLinkReset, simpanPasswordBaru } from "@/app/login/lupa-password/actions";

function form(isi: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  sb.opsi = [];
  sb.hdr = new Map([["x-forwarded-host", "kamo-vet-os.vercel.app"], ["x-forwarded-proto", "https"]]);
  sb.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  sb.setSession.mockResolvedValue({ data: { session: { access_token: "a" } }, error: null });
  sb.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  sb.signOut.mockResolvedValue({ error: null });
});

describe("aturan murni", () => {
  it("email: format & domain yang tidak bisa menerima email", () => {
    expect(cekEmail("dokter@gmail.com")).toBeNull();
    expect(cekEmail("bukan-email")).toBe(PESAN.emailTidakValid);
    expect(cekEmail("")).toBe(PESAN.emailTidakValid);
    expect(cekEmail("kasir@vetos.local")).toBe(PESAN.emailBukanAsli);
    expect(cekEmail("a@coba.test")).toBe(PESAN.emailBukanAsli);
  });

  it("password: panjang 8–72 dan ulangan harus sama", () => {
    expect(cekPassword("rahasia12", "rahasia12")).toBeNull();
    expect(cekPassword("pendek", "pendek")).toBe(PESAN.passwordPanjang);
    expect(cekPassword("x".repeat(73), "x".repeat(73))).toBe(PESAN.passwordPanjang);
    expect(cekPassword("rahasia12", "rahasia13")).toBe(PESAN.passwordBeda);
  });

  it("alamat aplikasi: https untuk domain, http hanya untuk lokal, host aneh ditolak", () => {
    expect(asalAplikasi("kamo-vet-os.vercel.app", "https")).toBe("https://kamo-vet-os.vercel.app");
    expect(asalAplikasi("kamo-vet-os.vercel.app", "http")).toBe("https://kamo-vet-os.vercel.app");
    expect(asalAplikasi("localhost:3000", "http")).toBe("http://localhost:3000");
    expect(asalAplikasi("localhost:3000", null)).toBe("http://localhost:3000");
    expect(asalAplikasi("evil.com/x?", "https")).toBeNull();
    expect(asalAplikasi(null, "https")).toBeNull();
  });

  it("token dari bagian # link email", () => {
    expect(bacaTokenPemulihan("#access_token=A&refresh_token=R&type=recovery&expires_in=3600"))
      .toEqual({ status: "ok", accessToken: "A", refreshToken: "R" });
    expect(bacaTokenPemulihan("#access_token=A&refresh_token=R&type=signup")).toEqual({ status: "kosong" });
    expect(bacaTokenPemulihan("")).toEqual({ status: "kosong" });
    expect(bacaTokenPemulihan("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"))
      .toEqual({ status: "galat", message: PESAN.linkTidakBerlaku });
  });

  it("hanya bagian # pemulihan yang diteruskan dari /login", () => {
    expect(hashPemulihan("#access_token=A&refresh_token=R&type=recovery")).toBe(true);
    expect(hashPemulihan("#error=access_denied&error_code=otp_expired")).toBe(true);
    expect(hashPemulihan("#tab=2")).toBe(false);
    expect(hashPemulihan("")).toBe(false);
  });

  it("pesan galat Supabase diterjemahkan tanpa membocorkan detail", () => {
    expect(pesanGagalKirim({ status: 429, code: "over_email_send_rate_limit" })).toBe(PESAN.terlaluSering);
    expect(pesanGagalKirim({ status: 500, message: "Error sending recovery email" })).toBe(PESAN.gagalKirim);
    expect(pesanGagalSimpan({ code: "same_password", status: 422 })).toBe(PESAN.passwordSama);
    expect(pesanGagalSimpan({ code: "weak_password", status: 422 })).toBe(PESAN.passwordLemah);
    expect(pesanGagalSimpan({ status: 401 })).toBe(PESAN.linkTidakBerlaku);
    expect(pesanGagalSimpan({ status: 500, message: "PRIVATE" })).toBe(PESAN.gagalSimpan);
  });
});

describe("minta link (halaman lupa password)", () => {
  it("mengirim link ke halaman password baru dengan alur yang bisa dibuka di perangkat lain", async () => {
    const res = await mintaLinkReset(null, form({ email: "  Dokter@Gmail.com " }));
    expect(res).toEqual({ ok: true, message: PESAN.terkirim });
    expect(sb.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("dokter@gmail.com", { redirectTo: "https://kamo-vet-os.vercel.app/login/password-baru" });
    expect(sb.opsi[0]).toMatchObject({ auth: { flowType: "implicit", persistSession: false } });
  });

  it("email asli tak terdaftar mendapat jawaban yang sama (tidak bisa dipakai menebak akun)", async () => {
    // Supabase menjawab sukses juga untuk email yang tidak terdaftar.
    expect(await mintaLinkReset(null, form({ email: "siapa@contoh.com" }))).toEqual({ ok: true, message: PESAN.terkirim });
  });

  it.each([["bukan-email", PESAN.emailTidakValid], ["kasir@vetos.local", PESAN.emailBukanAsli]])("menolak %s tanpa memanggil Supabase", async (email, pesan) => {
    expect(await mintaLinkReset(null, form({ email }))).toEqual({ ok: false, message: pesan });
    expect(sb.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("terlalu sering / gagal kirim / host aneh", async () => {
    sb.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { status: 429, code: "over_email_send_rate_limit" } });
    expect(await mintaLinkReset(null, form({ email: "a@b.com" }))).toEqual({ ok: false, message: PESAN.terlaluSering });
    sb.resetPasswordForEmail.mockRejectedValueOnce(new Error("network"));
    expect(await mintaLinkReset(null, form({ email: "a@b.com" }))).toEqual({ ok: false, message: PESAN.gagalKirim });
    sb.hdr = new Map([["host", "evil.com/x"]]);
    expect(await mintaLinkReset(null, form({ email: "a@b.com" }))).toEqual({ ok: false, message: PESAN.gagalKirim });
    expect(sb.resetPasswordForEmail).toHaveBeenCalledTimes(2);
  });
});

describe("simpan password baru (dari link email)", () => {
  const isi = { access_token: "A", refresh_token: "R", password: "rahasia-baru", password_konfirmasi: "rahasia-baru" };

  it("memasang sesi pemulihan, menyimpan password, lalu mengeluarkan semua perangkat", async () => {
    expect(await simpanPasswordBaru(null, form(isi))).toMatchObject({ ok: true });
    expect(sb.setSession).toHaveBeenCalledWith({ access_token: "A", refresh_token: "R" });
    expect(sb.updateUser).toHaveBeenCalledWith({ password: "rahasia-baru" });
    expect(sb.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("tetap berhasil bila langkah keluar-semua-perangkat gagal", async () => {
    sb.signOut.mockRejectedValueOnce(new Error("network"));
    expect(await simpanPasswordBaru(null, form(isi))).toMatchObject({ ok: true });
  });

  it("link kedaluwarsa / sudah dipakai", async () => {
    sb.setSession.mockResolvedValueOnce({ data: { session: null }, error: { status: 400, code: "refresh_token_already_used" } });
    expect(await simpanPasswordBaru(null, form(isi))).toEqual({ ok: false, message: PESAN.linkTidakBerlaku });
    expect(sb.updateUser).not.toHaveBeenCalled();
    expect(await simpanPasswordBaru(null, form({ ...isi, access_token: "" }))).toEqual({ ok: false, message: PESAN.linkTidakBerlaku });
  });

  it("validasi password sebelum menyentuh Supabase", async () => {
    expect(await simpanPasswordBaru(null, form({ ...isi, password_konfirmasi: "lain-lagi1" }))).toEqual({ ok: false, message: PESAN.passwordBeda });
    expect(await simpanPasswordBaru(null, form({ ...isi, password: "pendek", password_konfirmasi: "pendek" }))).toEqual({ ok: false, message: PESAN.passwordPanjang });
    expect(sb.setSession).not.toHaveBeenCalled();
  });

  it("password sama dengan yang lama", async () => {
    sb.updateUser.mockResolvedValueOnce({ data: null, error: { status: 422, code: "same_password" } });
    expect(await simpanPasswordBaru(null, form(isi))).toEqual({ ok: false, message: PESAN.passwordSama });
    expect(sb.signOut).not.toHaveBeenCalled();
  });
});
