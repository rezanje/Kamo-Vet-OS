import { describe, expect, it } from "vitest";
import vektor from "./fixtures/kunci-hp-indonesia.json";
import { kunciHpIndonesia } from "../kontak";
import {
  identitasPersisRekamMedis,
  klarifikasiIdentitasRekamMedis,
  kunciTeleponImporRekamMedis,
  pilahRiwayatTersimpan,
  type RekamMedisImporRow,
} from "../impor-rekam-medis";
import { kunciGandaRiwayat } from "../impor-rekam-medis-aliran";

// Temuan harness PR #328 (K3): 08.. dan +62.. untuk orang yang sama dianggap dua pemilik.
// Vektor ini juga dijalankan terhadap public.indonesian_phone_key() di harness PostgreSQL,
// jadi aplikasi dan database dijamin memakai aturan yang sama.
describe("kunci HP Indonesia", () => {
  it.each(vektor)("$masuk -> $kunci", ({ masuk, kunci }) => {
    expect(kunciHpIndonesia(masuk)).toBe(kunci);
  });

  it("dipakai pemindaian identitas impor", () => {
    expect(kunciTeleponImporRekamMedis("+62 800-0000-004")).toBe(kunciTeleponImporRekamMedis("0800-0000-004"));
  });

  it("dipakai pelacak riwayat ganda lintas potongan", () => {
    const dasar = { owner_name: "Pemilik Fiktif", patient_name: "Kucing", record_date: "2026-01-01" };
    expect(kunciGandaRiwayat({ ...dasar, phone: "+628000000004" })).toBe(kunciGandaRiwayat({ ...dasar, phone: "08000000004" }));
  });
});

function baris(ubah: Partial<RekamMedisImporRow> = {}): RekamMedisImporRow {
  return {
    source_key: "kunci", source_file: "F.xlsx", source_sheet: "01012026", record_no: null, record_date: "2026-01-01",
    patient_name: "Kucing Fiktif", owner_name: "Pemilik Fiktif", phone: "08000000004", address: null, species: null,
    breed: null, gender: null, dob: null, doctor: null, note: null, anamnesis: null, clinical_findings: null,
    diagnosis: null, therapy: null, warning: [], ...ubah,
  };
}

describe("identitas impor memakai kunci HP kanonik", () => {
  it("pemilik tersimpan dengan +62 dikenali persis untuk kartu bertulis 08", () => {
    const owners = [{ id: "p", name: "Pemilik Fiktif", phone: "+62 800-000-0004" }];
    expect(identitasPersisRekamMedis(baris(), owners, [])).toEqual({ customer_id: "p", pet_id: null });
  });

  it("HP sama dengan nama berbeda tetap ditanyakan, tidak digabung otomatis", () => {
    const owners = [{ id: "p", name: "Nama Lain", phone: "+628000000004" }];
    expect(identitasPersisRekamMedis(baris(), owners, [])).toBeNull();
    expect(klarifikasiIdentitasRekamMedis([baris()], owners, [])).toHaveLength(1);
  });
});

// Temuan harness PR #328 (K1b): jejak sumber yang sudah ada TIDAK boleh langsung dihitung
// "sudah ada" di aplikasi. Hanya database yang bisa membuktikan isinya identik, jadi barisnya
// tetap dikirim untuk diverifikasi -- tanpa pilihan identitas, karena tidak akan dibuat baru.
describe("pemilahan riwayat yang jejaknya sudah tercatat", () => {
  it("memisahkan jejak tercatat untuk diverifikasi, bukan menganggapnya sudah ada", () => {
    const rows = [baris({ source_key: "lama" }), baris({ source_key: "baru" })];
    const hasil = pilahRiwayatTersimpan(rows, ["lama"]);
    expect(hasil.baru.map((row) => row.source_key)).toEqual(["baru"]);
    expect(hasil.tercatat.map((row) => row.source_key)).toEqual(["lama"]);
    expect(hasil).not.toHaveProperty("sudah_ada");
  });
});
