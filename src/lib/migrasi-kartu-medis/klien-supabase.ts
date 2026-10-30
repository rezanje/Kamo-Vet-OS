/**
 * Klien migrasi jaringan: login OWNER biasa (email + kata sandi lewat Supabase Auth, kunci publik anon), sehingga setiap
 * panggilan berjalan sebagai user `authenticated` dengan RLS dan pemeriksaan role yang sama dengan aplikasi.
 * Tidak ada service-role, tidak ada SQL mentah, tidak ada token yang dicetak.
 *
 * Kredensial hanya dibaca dari environment (diisi pemilik lewat pengaturan environment, bukan chat):
 *   KAMO_OWNER_EMAIL, KAMO_OWNER_PASSWORD, KAMO_SUPABASE_ANON_KEY (atau NEXT_PUBLIC_SUPABASE_ANON_KEY),
 *   KAMO_SUPABASE_URL (opsional; bawaan proyek produksi).
 * Target diverifikasi dua kali: host URL = proyek yang dikonfirmasi, dan `iss` token login = auth proyek itu.
 */
import { createClient } from "@supabase/supabase-js";
import { GagalTertutup, type KlienMigrasi, type KonteksJaringan } from "./klien";

export const PROYEK_PRODUKSI = "koaglxcyjqfmgfzxszkj";
const HEADER_CABANG = "x-kamo-operational-branch";

export type OpsiLogin = {
  url: string;
  anonKey: string;
  email: string;
  password: string;
  konteks: KonteksJaringan;
  /** Ref proyek yang dikonfirmasi operator; wajib sama dengan host URL dan penerbit token. */
  proyek: string;
  /** Hanya untuk tes (fetch palsu). */
  fetch?: typeof fetch;
};

/** Ambil opsi login dari environment tanpa pernah mengembalikan/mencetak nilainya pada pesan galat. */
export function opsiDariEnv(env: Record<string, string | undefined>, konteks: KonteksJaringan, proyek: string): OpsiLogin {
  const url = env.KAMO_SUPABASE_URL || `https://${PROYEK_PRODUKSI}.supabase.co`;
  const anonKey = env.KAMO_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const email = env.KAMO_OWNER_EMAIL || "";
  const password = env.KAMO_OWNER_PASSWORD || "";
  const hilang = [
    !anonKey && "KAMO_SUPABASE_ANON_KEY", !email && "KAMO_OWNER_EMAIL", !password && "KAMO_OWNER_PASSWORD",
  ].filter(Boolean);
  if (hilang.length) throw new GagalTertutup(`Variabel environment belum diisi: ${hilang.join(", ")}.`);
  return { url, anonKey, email, password, konteks, proyek };
}

/** Penerbit (`iss`) JWT tanpa verifikasi tanda tangan — hanya untuk mencocokkan target, bukan untuk otorisasi. */
export function penerbitToken(token: string): string | null {
  try {
    const bagian = token.split(".")[1];
    const json = JSON.parse(Buffer.from(bagian.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { iss?: unknown };
    return typeof json.iss === "string" ? json.iss : null;
  } catch {
    return null;
  }
}

export function pastikanTarget(url: string, proyek: string) {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error();
    host = u.host;
  } catch {
    throw new GagalTertutup("URL Supabase tidak valid.");
  }
  if (!/^[a-z0-9]{20}$/.test(proyek) || host !== `${proyek}.supabase.co`) {
    throw new GagalTertutup("Target proyek tidak cocok dengan konfirmasi operator.");
  }
}

export async function masukOwner(opsi: OpsiLogin): Promise<KlienMigrasi & { keluar(): Promise<void> }> {
  pastikanTarget(opsi.url, opsi.proyek);
  const headers: Record<string, string> = opsi.konteks.mode === "cabang" ? { [HEADER_CABANG]: opsi.konteks.cabangId } : {};
  const supabase = createClient(opsi.url, opsi.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    global: { headers, ...(opsi.fetch ? { fetch: opsi.fetch } : {}) },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: opsi.email, password: opsi.password });
  if (error || !data.session) throw new GagalTertutup("Login OWNER gagal (periksa email/kata sandi di environment).");
  const iss = penerbitToken(data.session.access_token);
  if (iss !== `https://${opsi.proyek}.supabase.co/auth/v1`) {
    await supabase.auth.signOut().catch(() => undefined);
    throw new GagalTertutup("Token login bukan dari proyek target.");
  }
  const jawab = (r: { data: unknown; error: { message: string; code?: string } | null }) => ({
    data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null,
  });
  return {
    konteks: opsi.konteks,
    idPengguna: async () => {
      const { data: u, error: e } = await supabase.auth.getUser();
      return e ? null : u.user?.id ?? null;
    },
    rpc: async (nama, args) => jawab(await supabase.rpc(nama, args)),
    pilih: async (tabel, kolom, ids) => jawab(await supabase.from(tabel).select(kolom).in("id", ids)),
    buatPemilik: async (kartu) => jawab(await supabase.from("customers").insert(kartu).select("id")),
    kunjunganHewan: async (petIds) => jawab(await supabase.from("visits").select("id,pet_id,created_at,branch_id,legacy_source_key").in("pet_id", petIds)),
    keluar: async () => { await supabase.auth.signOut().catch(() => undefined); },
  };
}
