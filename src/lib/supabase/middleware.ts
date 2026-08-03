import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { bolehBukaPath, tujuanSaatDiblokir } from "@/lib/akses";

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

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Sidebar disembunyikan per peran di (app)/layout.tsx, tapi itu cuma UI —
  // halaman admin tetap bisa dibuka langsung lewat URL kalau tidak diblok di sini.
  //
  // Aturannya satu tempat di `lib/akses.ts` dan dipakai sidebar juga, supaya yang
  // kelihatan di menu dan yang benar-benar boleh dibuka tidak pernah beda.
  if (user) {
    const path = request.nextUrl.pathname;
    const isInternal = path.startsWith("/_next") || path.startsWith("/api");
    if (!isInternal) {
      const [{ data: profile }, { data: aturan }] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
        supabase.from("role_modules").select("role, module_id"),
      ]);
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
