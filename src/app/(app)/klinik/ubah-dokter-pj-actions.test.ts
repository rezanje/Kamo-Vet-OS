import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "pengguna" } as { id: string } | null,
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as { message: string } | null },
  throwRpc: false,
  revalidated: [] as string[],
  throwRevalidate: false,
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { if (state.throwRevalidate) throw new Error("cache"); state.revalidated.push(p); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpc.push({ fn, args });
      if (state.throwRpc) throw new Error("fetch failed");
      return state.reply;
    },
  }),
}));

import { ubahDokterPJ } from "./ubah-dokter-pj-actions";

const V = "ec2c52be-f540-4553-acae-3f901fb6dd0c";
const D = "e1e52780-d9af-4849-8dba-8ae29640ffc1";
const input = (over: Partial<Parameters<typeof ubahDokterPJ>[0]> = {}) => ({
  visitId: V, doctorId: D, reason: "Dokter PJ dan pemberi obat dr. Aini", requestKey: "kunci-permintaan-0001", ikutBaris: true, konfirmasiFinal: false, ...over,
});
const sukses = {
  ok: true, idempotent: false, visit_id: V, dokter_lama_nama: "DRH. ILHAM", dokter_baru_nama: "DRH LUTHFIAH RUSYDA AINI", baris_diganti: 3,
  baris_tetap_tertagih: 0, baris_tetap_racikan: 0, baris_tetap_lain: 3, baris_tetap_tak_valid: 0, tagihan_belum_lunas_ikut: 0, tagihan_lunas_tak_berubah: 0, tagihan_lunas_digeser: 0,
};

beforeEach(() => {
  state.user = { id: "pengguna" }; state.rpc = []; state.reply = { data: sukses, error: null }; state.throwRpc = false; state.revalidated = []; state.throwRevalidate = false;
});

describe("ubahDokterPJ (aksi server)", () => {
  it("berhasil: memanggil RPC dengan argumen persis, mengembalikan ringkasan dan menyegarkan layar terkait", async () => {
    const hasil = await ubahDokterPJ(input());
    expect(hasil.ok).toBe(true);
    expect(state.rpc).toEqual([{ fn: "clinic_change_visit_doctor", args: {
      p_visit_id: V, p_new_doctor_id: D, p_reason: "Dokter PJ dan pemberi obat dr. Aini", p_request_key: "kunci-permintaan-0001", p_follow_lines: true, p_ack_final: false } }]);
    if (hasil.ok) {
      expect(hasil).toMatchObject({ dokterBaruNama: "DRH LUTHFIAH RUSYDA AINI", barisDiganti: 3, barisTetapLain: 3, idempotent: false });
      expect(hasil.pesan).toContain("dari DRH. ILHAM ke DRH LUTHFIAH RUSYDA AINI");
    }
    expect(state.revalidated).toEqual(expect.arrayContaining(["/klinik/rawat-inap", "/klinik/rekam-medis", "/laporan/penjual", "/laporan/visit", "/penjualan/komisi"]));
  });

  it("centang dimatikan dan konfirmasi Owner diteruskan apa adanya", async () => {
    await ubahDokterPJ(input({ ikutBaris: false, konfirmasiFinal: true }));
    expect(state.rpc[0].args).toMatchObject({ p_follow_lines: false, p_ack_final: true });
  });

  it("alasan dirapikan sebelum dikirim", async () => {
    await ubahDokterPJ(input({ reason: "   alasan rapi   " }));
    expect(state.rpc[0].args.p_reason).toBe("alasan rapi");
  });

  it.each([
    ["kunjungan bukan uuid", { visitId: "bukan-uuid" }, "INPUT"],
    ["dokter bukan uuid", { doctorId: "abc" }, "PILIHAN"],
    ["dokter kosong", { doctorId: "" }, "PILIHAN"],
    ["alasan 4 huruf", { reason: "abcd" }, "ALASAN"],
    ["alasan kosong", { reason: "" }, "ALASAN"],
    ["alasan > 500 huruf", { reason: "a".repeat(501) }, "ALASAN"],
    ["kunci terlalu pendek", { requestKey: "abc" }, "INPUT"],
    ["kunci terlalu panjang", { requestKey: "k".repeat(101) }, "INPUT"],
  ])("ditolak sebelum menyentuh database: %s (objek penolakan, bukan lemparan)", async (_label, over, kode) => {
    const hasil = await ubahDokterPJ(input(over as never));
    expect(hasil).toMatchObject({ ok: false, kode });
    expect(state.rpc).toEqual([]);
    expect(state.revalidated).toEqual([]);
  });

  it("sesi berakhir: penolakan AUTH tanpa memanggil RPC", async () => {
    state.user = null;
    expect(await ubahDokterPJ(input())).toMatchObject({ ok: false, kode: "AUTH" });
    expect(state.rpc).toEqual([]);
  });

  it.each([
    ["UBAH_DOKTER_DENIED: ubah dokter PJ hanya dapat dilakukan Owner atau peran yang diberi izin Ubah dokter PJ di Akses Grup", "DENIED", false],
    ["UBAH_DOKTER_CABANG: kunjungan ini di cabang yang tidak dapat Anda akses", "CABANG", false],
    ["UBAH_DOKTER_PILIHAN: dokter baru tidak bertugas di cabang kunjungan ini", "PILIHAN", false],
    ["UBAH_DOKTER_SAMA: dokter baru sama dengan dokter PJ saat ini", "SAMA", false],
    ["UBAH_DOKTER_FINAL: tagihan lunas kunjungan ini mengikuti dokter kunjungan; komisi bulan pelunasan akan berpindah. Centang konfirmasi Owner untuk melanjutkan", "FINAL", true],
    ["UBAH_DOKTER_FINAL: tagihan kunjungan ini sudah lunas dan komisinya mengikuti dokter kunjungan; hanya Owner yang dapat mengubah dokternya", "FINAL", false],
    ["UBAH_DOKTER_PAYROLL: slip gaji bulan pelunasan sudah disahkan untuk dokter lama atau baru; dokter tidak dapat diubah", "PAYROLL", false],
  ])("penolakan database dikembalikan sebagai kalimat: %s", async (message, kode, perluKonfirmasi) => {
    state.reply = { data: null, error: { message } };
    const hasil = await ubahDokterPJ(input());
    expect(hasil).toMatchObject({ ok: false, kode });
    if (!hasil.ok) {
      expect(hasil.pesan).not.toMatch(/UBAH_DOKTER_/);
      expect(!!hasil.perluKonfirmasi).toBe(perluKonfirmasi);
    }
    expect(state.revalidated).toEqual([]);
  });

  it("galat tak dikenal / jaringan putus / jawaban aneh: tidak pernah melempar dan tidak pernah menyatakan berhasil", async () => {
    state.reply = { data: null, error: { message: "boom: sesuatu yang tidak dikenal" } };
    expect(await ubahDokterPJ(input())).toMatchObject({ ok: false, kode: "TIDAK_TERKONFIRMASI" });
    state.reply = { data: { ok: true }, error: null };
    expect(await ubahDokterPJ(input())).toMatchObject({ ok: false, kode: "TIDAK_TERKONFIRMASI" });
    state.reply = { data: null, error: null };
    expect(await ubahDokterPJ(input())).toMatchObject({ ok: false, kode: "TIDAK_TERKONFIRMASI" });
    state.throwRpc = true;
    await expect(ubahDokterPJ(input())).resolves.toMatchObject({ ok: false, kode: "TIDAK_TERKONFIRMASI" });
    expect(state.revalidated).toEqual([]);
  });

  it("kegagalan penyegaran cache tidak mengubah hasil: data sudah tersimpan di database", async () => {
    state.throwRevalidate = true;
    expect((await ubahDokterPJ(input())).ok).toBe(true);
  });

  it("permintaan ulang yang sama (idempoten) dilaporkan tanpa dianggap perubahan baru", async () => {
    state.reply = { data: { ...sukses, idempotent: true }, error: null };
    const hasil = await ubahDokterPJ(input());
    expect(hasil.ok && hasil.idempotent).toBe(true);
  });
});
