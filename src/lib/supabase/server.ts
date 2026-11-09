import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { ALL_BRANCHES, BRANCH_HEADER } from "@/lib/operational-context";

export async function createClient() {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const branchId = requestHeaders.get(BRANCH_HEADER);

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: branchId && branchId !== ALL_BRANCHES ? { [BRANCH_HEADER]: branchId } : {} },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore, middleware refreshes the session.
          }
        },
      },
    },
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Klien TANPA header cabang operasional + cabang aktif dari header yang sudah divalidasi middleware (null = Semua
 * cabang / tanpa konteks cabang). Untuk pembaca yang menyaring cabang sendiri lewat parameter RPC, mis. daftar rekam
 * medis: cabang aktif + riwayat impor tanpa cabang. RLS pemanggil tetap berlaku penuh: tanpa header, pengguna hanya
 * melihat cabang yang memang diizinkan untuknya (sama dengan "Semua cabang" bagi yang berhak), tidak lebih.
 */
export async function createClientLintasCabang() {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const header = requestHeaders.get(BRANCH_HEADER);
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore, middleware refreshes the session.
          }
        },
      },
    },
  );
  return { client, cabangAktif: header && UUID.test(header) ? header : null };
}
