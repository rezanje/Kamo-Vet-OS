import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { PATH_PASSWORD_BARU, asalAplikasi, pesanGagalKirim } from "@/lib/lupa-password";

// Klien terpisah tanpa cookie: tidak menyentuh sesi siapa pun yang sedang login di browser ini.
// flowType "implicit" supaya link bisa dibuka di perangkat lain (alur PKCE menyimpan kunci di perangkat peminta).
export function klienPemulihan() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Minta Supabase mengirim email berisi link reset password. Selalu mengembalikan pesan untuk ditampilkan. */
export async function kirimLinkPemulihan(email: string): Promise<{ ok: boolean; message: string }> {
  const h = await headers();
  const asal = asalAplikasi(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
  if (!asal) return { ok: false, message: pesanGagalKirim({ status: 400 }) };
  try {
    const { error } = await klienPemulihan().auth.resetPasswordForEmail(email, { redirectTo: `${asal}${PATH_PASSWORD_BARU}` });
    // Kode & status saja di log server — tanpa alamat email.
    if (error) console.error("[lupa-password] kirim link gagal", error.code ?? "-", error.status ?? "-");
    return { ok: !error, message: pesanGagalKirim(error) };
  } catch {
    return { ok: false, message: pesanGagalKirim({ status: 500 }) };
  }
}
