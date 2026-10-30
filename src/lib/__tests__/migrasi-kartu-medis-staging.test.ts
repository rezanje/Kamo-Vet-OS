import { describe, expect, it } from "vitest";
import { bacaPaketStaging, gabungKet, jejakStaging, rencanaDariStaging, sha256Paket, stableKey } from "@/lib/migrasi-kartu-medis/staging-json";
import { muatRencanaBeku, terapkanRekonsiliasi } from "@/lib/migrasi-kartu-medis/rekonsiliasi-staging";

const SHA = "c".repeat(64);
const OPSI = { hariIni: "2026-10-31", tanggalMinimum: "1990-01-01", sha256Paket: "d".repeat(64) };
type F = Record<string, string | null>;
const kartu = (fileId: string, sheet: string, f: F = {}, status = "candidate_fields_complete_not_import_validated", hold: string[] = []) => ({
  stable_key: stableKey(fileId, sheet), source_file_id: fileId, filename: "Uji .xlsx", sheet, source_sha256: SHA, status, hold_reasons: hold,
  normalized_fields: {
    patient_name: "UJI KUCING", owner_name: "UJI PEMILIK", phone_raw: "081234567890", phone_canonical: "+6281234567890", record_no: "12",
    record_date: "2026-10-30", date_tab: "2026-10-30", date_card: "2026-10-30", doctor: "drh. Fiktif", note: "keluhan ", anamnesis: "  baris 1\nbaris 2  ",
    clinical_findings: "T: 38", diagnosis: "Dx", therapy: "R/ x\nT/ y", additional_notes: null, fur_color: null, dob_raw: null, gender: null, species: null, breed: null, address: null,
    ...f,
  },
});
const batch = (b: string, cards: unknown[]) => ({ schema_version: "staging-card-v1", batch: `${b}-uji`, cards });

describe("adapter paket staging JSON", () => {
  it("verifies stable_key = SHA256(fileID + U+001F + sheet) and rejects tampered keys or non-staging files", () => {
    const k = kartu("F1", "S1");
    expect(bacaPaketStaging([batch("03", [k])]).galat).toEqual([]);
    expect(bacaPaketStaging([batch("03", [{ ...k, stable_key: "e".repeat(64) }])]).galat.join()).toMatch(/stable_key/);
    expect(bacaPaketStaging([{ schema_version: "lain", batch: "03", cards: [] }]).galat.join()).toMatch(/staging-card-v1/);
  });
  it("maps ready cards to frozen payloads with clinical text untouched, a Drive-based key trimmed like the DB, and WIB midnight", () => {
    const r = rencanaDariStaging(bacaPaketStaging([batch("03", [kartu("F1", "30102026 ")])]).kartu, OPSI);
    const p = r.baris[0].payload!;
    expect(r.baris[0].status).toBe("siap");
    expect(p).toMatchObject({ source_key: "gdrive:F1::30102026", record_date: "2026-10-30T00:00:00+07:00", note: "keluhan ", anamnesis: "  baris 1\nbaris 2  ", therapy: "R/ x\nT/ y", phone: "081234567890", dob: null });
    expect(jejakStaging({ source_file_id: "F1", sheet: " a " })).toBe("gdrive:F1:: a");
  });
  it("applies the date delta by stable_key (never appends), and holds rows whose gate does not match", () => {
    const asal = kartu("F1", "S1");
    const lain = kartu("F2", "S2");
    const revisi = { ...asal, status: "held_review", hold_reasons: ["DATE_TAB_AMBIGUOUS_OR_UNPARSED"], normalized_fields: { ...asal.normalized_fields, record_date: null, date_tab: null } };
    const revisiBeda = { ...lain, source_sha256: "f".repeat(64), status: "held_review", hold_reasons: ["DATE_TAB_AMBIGUOUS_OR_UNPARSED"] };
    const targets = [
      { batch: "03", key: asal.stable_key, status: "held_review", reasons: "DATE_TAB_AMBIGUOUS_OR_UNPARSED", record_date: null, date_tab: null },
      { batch: "03", key: lain.stable_key, status: "held_review", reasons: "x", record_date: null, date_tab: null },
      { batch: "08", key: "a".repeat(64), status: "held_review", reasons: "x", record_date: null, date_tab: null },
    ];
    const p = bacaPaketStaging([batch("03", [asal, lain])], { targets, revisi: [batch("03", [revisi, revisiBeda])] });
    expect(p).toMatchObject({ galat: [], deltaDiterapkan: 1, deltaDiluarCakupan: 1, deltaDitahan: [lain.stable_key] });
    expect(p.kartu).toHaveLength(2);
    const r = rencanaDariStaging(p.kartu, OPSI);
    expect(r.hitungan).toMatchObject({ siap: 0, karantina: 2 });
    expect(r.baris.find((b) => b.local_record_id === lain.stable_key)!.alasan).toContain("staging.DELTA_GATE_MISMATCH");
  });
  it("never silently drops clinical 'Ket', never truncates, and never guesses phone/date", () => {
    const r = rencanaDariStaging(bacaPaketStaging([batch("05", [
      kartu("F1", "A", { additional_notes: "kontrol 1 minggu" }),
      kartu("F2", "B", { diagnosis: "x".repeat(10001) }),
      kartu("F3", "C", { gender: "jantan steril", fur_color: "oren", dob_raw: "4 bulan" }),
      kartu("F4", "D", { phone_raw: "81234567", phone_canonical: null }, "held_review", ["PHONE_PREFIX_MISSING_OR_INVALID_NO_GUESS", "DATE_TAB_CARD_CONFLICT"]),
      kartu("F5", "E", { note: null, anamnesis: null, clinical_findings: null, diagnosis: null, therapy: null }, "excluded_empty_clinical", ["EMPTY_CLINICAL_TABLE"]),
      kartu("F6", "F", {}, "held_review", ["CLINICAL_CELL_DATE_TYPED_REVIEW"]),
    ])]).kartu, OPSI);
    const per = (f: string) => r.baris.find((b) => b.local_record_id === stableKey(f, { F1: "A", F2: "B", F3: "C", F4: "D", F5: "E", F6: "F" }[f]!))!;
    expect(per("F1")).toMatchObject({ status: "karantina", alasan: ["riwayat.ket_tanpa_kolom"], payload: null });
    expect(per("F2").alasan).toContain("riwayat.diagnosis.terlalu_panjang");
    expect(per("F3")).toMatchObject({ status: "siap", peringatan: ["hewan.warna_bulu_tidak_dikirim", "hewan.dob_parsial_tidak_dikirim", "hewan.kelamin_terlalu_panjang_tidak_dikirim"] });
    expect(per("F3").payload!.gender).toBeNull();
    expect(per("F4")).toMatchObject({ status: "karantina", payload: null, tertunda: { kekurangan: ["hp_tidak_valid", "tanggal_bentrok"], isi: { phone: "81234567" } } });
    expect(per("F5")).toMatchObject({ status: "dikecualikan", tertunda: null });
    expect(per("F6")).toMatchObject({ status: "karantina", tertunda: null });
  });
  it("holds identical content under different keys and same-key collisions; plan fingerprint is stable and tamper-evident", () => {
    const r = rencanaDariStaging(bacaPaketStaging([batch("06", [kartu("F1", "S1"), kartu("F2", "S2")])]).kartu, OPSI);
    expect(r.baris.every((b) => b.status === "karantina" && b.alasan.includes("isi.ganda"))).toBe(true);
    const ok = rencanaDariStaging(bacaPaketStaging([batch("06", [kartu("F1", "S1")])]).kartu, OPSI);
    expect(muatRencanaBeku(JSON.parse(JSON.stringify(ok))).sidikRencana).toBe(ok.sidikRencana);
    const ubah = JSON.parse(JSON.stringify(ok)); ubah.baris[0].payload.diagnosis = "LAIN";
    expect(() => muatRencanaBeku(ubah)).toThrow(/berubah/);
    const rek = terapkanRekonsiliasi(ok, { sudahAdaJejakLama: [{ local_record_id: ok.baris[0].local_record_id, visit_id: "v", kunci: "k" }], tabrakanNamaBerkas: [], tanggalSama: [] });
    expect(rek.baris[0]).toMatchObject({ status: "dikecualikan", alasan: ["db.sudah_ada_jejak_lama"], payload: null });
    expect(rek.sidikRencana).not.toBe(ok.sidikRencana);
    expect(sha256Paket([{ nama: "b", bytes: new Uint8Array([1]) }, { nama: "a", bytes: new Uint8Array([2]) }]))
      .toBe(sha256Paket([{ nama: "a", bytes: new Uint8Array([2]) }, { nama: "b", bytes: new Uint8Array([1]) }]));
  });
  it("per-card Ket approval: appends 'Ket: <original>' once, keeps the doctor's note verbatim, releases ONLY the Ket hold", () => {
    expect(gabungKet("catatan dokter ", "kontrol 1 minggu")).toBe("catatan dokter \nKet: kontrol 1 minggu");
    expect(gabungKet(null, " a\nb ")).toBe("Ket:  a\nb ");
    expect(gabungKet("x\nKet: k", "k")).toBe("x\nKet: k");
    const a = kartu("F1", "A", { additional_notes: "kontrol 1 minggu" });
    const b = kartu("F2", "B", { additional_notes: "rawat inap", phone_raw: null, phone_canonical: null });
    const c = kartu("F3", "C", { additional_notes: "tidak disetujui" });
    const r = rencanaDariStaging(bacaPaketStaging([batch("07", [a, b, c])]).kartu, { ...OPSI, ketKeCatatan: [a.stable_key, b.stable_key] });
    const per = (x: { stable_key: string }) => r.baris.find((y) => y.local_record_id === x.stable_key)!;
    expect(per(a)).toMatchObject({ status: "siap", peringatan: ["riwayat.ket_digabung_ke_catatan"] });
    expect(per(a).payload!.note).toBe("keluhan \nKet: kontrol 1 minggu");
    expect(per(a).payload!.anamnesis).toBe("  baris 1\nbaris 2  ");
    expect(per(b)).toMatchObject({ status: "karantina", alasan: ["pemilik.phone.kosong"] });
    expect(per(c)).toMatchObject({ status: "karantina", alasan: ["riwayat.ket_tanpa_kolom"] });
    expect(r.opsi).toMatchObject({ ketKeCatatan: [a.stable_key, b.stable_key].sort() });
  });
});
