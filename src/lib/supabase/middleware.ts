import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { bolehBukaPath, tujuanSaatDiblokir } from "@/lib/akses";

function loginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  // 303 avoids replaying an expired/deleted-account form into the login action.
  if (request.method !== "GET") {
    url.searchParams.set("error", "Sesi kamu berakhir. Masuk lagi, lalu ulangi simpan.");
  }
  return NextResponse.redirect(url, { status: 303 });
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Verify signatures and expiry with Supabase's cached public signing keys.
  // Keep this directly after createServerClient so session refresh cookies sync.
  const { data, error } = await supabase.auth.getClaims();
  const userId = error ? null : data?.claims.sub;

  // Halaman booking sengaja terbuka tanpa login — pemilik hewan memesan jadwal
  // dari luar sistem. Yang boleh dilakukannya dipagari RLS (migrasi 0105):
  // hanya menulis booking baru, tidak bisa membaca data siapa pun.
  const publik = request.nextUrl.pathname.startsWith("/booking");

  if (
    !userId &&
    !publik &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    return loginRedirect(request);
  }

  // Sidebar disembunyikan per peran di (app)/layout.tsx, tapi itu cuma UI —
  // halaman admin tetap bisa dibuka langsung lewat URL kalau tidak diblok di sini.
  //
  // Aturannya satu tempat di `lib/akses.ts` dan dipakai sidebar juga, supaya yang
  // kelihatan di menu dan yang benar-benar boleh dibuka tidak pernah beda.
  if (userId) {
    const path = request.nextUrl.pathname;
    const isInternal = path.startsWith("/_next") || path.startsWith("/api");
    const isPublic = publik || path.startsWith("/login") || path.startsWith("/auth");
    if (!isInternal && !isPublic) {
      const [{ data: profile, error: profileError }, { data: aturan }] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
        supabase.from("role_modules").select("role, module_id"),
      ]);
      // Auth deletion cascades the profile; an unexpired JWT alone is not enough.
      if (profileError || !profile) return loginRedirect(request);
      const role = profile?.role ?? "";
      const tersimpan = (aturan ?? []) as { role: string; module_id: string }[];

      if (role && !bolehBukaPath(role, path, tersimpan)) {
        const url = request.nextUrl.clone();
        url.pathname = tujuanSaatDiblokir(role, tersimpan);
        return NextResponse.redirect(url);
      }
    }
  }

  // IMPORTANT: return supabaseResponse unchanged (keeps cookies in sync).
  return supabaseResponse;
}
