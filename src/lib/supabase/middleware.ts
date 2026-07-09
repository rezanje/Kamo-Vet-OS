import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // STAFF cuma boleh masuk dunia kasir (petshop/klinik) & dashboard pribadi —
  // sidebar disembunyikan di (app)/layout.tsx tapi itu cuma UI; halaman admin
  // (Dashboard, Keuangan, HRIS, dll) tetap bisa diakses langsung lewat URL kalau
  // nggak diblok di sini juga.
  const STAFF_ALLOWED = ["/me", "/kasir", "/klinik", "/mulai", "/login", "/auth"];
  if (user) {
    const path = request.nextUrl.pathname;
    const isInternal = path.startsWith("/_next") || path.startsWith("/api");
    if (!isInternal && !STAFF_ALLOWED.some((p) => path === p || path.startsWith(p + "/"))) {
      const { data: profile } = await supabase
        .from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (profile?.role === "STAFF") {
        const url = request.nextUrl.clone();
        url.pathname = "/mulai";
        return NextResponse.redirect(url);
      }
    }
  }

  // IMPORTANT: return supabaseResponse unchanged (keeps cookies in sync).
  return supabaseResponse;
}
