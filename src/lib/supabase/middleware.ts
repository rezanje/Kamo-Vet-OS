import { loadRoleCapabilities } from "@/lib/role-capabilities";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { bolehBukaPath, tujuanSaatDiblokir } from "@/lib/akses";
import { BRANCH_HEADER, MODE_HEADER, branchCookie, operationalMode, parseBranchContext } from "@/lib/operational-context";
import { resolveOperationalBranch } from "@/lib/operational-branch";
import { getOpenShift } from "@/lib/shift";
import { mulai } from "@/lib/u07-waktu";

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
      // Klinik-A: cabang operasional & shift hanya butuh userId + cookie, jadi dibaca
      // bersamaan dengan profil/aturan modul (dulu antre ±6 putaran tiap navigasi/Server
      // Action klinik). Semua pemeriksaan di bawah tetap berjalan dengan urutan yang sama.
      const mode = operationalMode(path);
      const context = mode ? parseBranchContext(request.cookies.get(branchCookie(mode))?.value, userId) : null;
      const branchP = mode && context ? mulai(resolveOperationalBranch(supabase, userId, mode, context.branchId)) : null;
      // Read without operational scope so a stale/tampered cookie cannot hide
      // another open shift and bypass the switching guard.
      const shiftP = mode && context ? mulai(getOpenShift(supabase, userId, mode)) : null;
      const [{ data: profile, error: profileError }, { data: aturan, error: rulesError }] = await Promise.all([
        supabase.from("profiles").select("role, is_active").eq("id", userId).maybeSingle(),
        supabase.from("role_modules").select("role, module_id"),
      ]);
      // Auth deletion cascades the profile; an unexpired JWT alone is not enough.
      if (profileError || rulesError || !profile || profile.is_active === false) return loginRedirect(request);
      const role = profile?.role ?? "";
      const tersimpan = (aturan ?? []) as { role: string; module_id: string }[];

      const accountPage = path === "/pengaturan/pengguna";
      const canCreateAccount = accountPage && (await loadRoleCapabilities(supabase, role)).create_accounts;
      if (role && !canCreateAccount && !bolehBukaPath(role, path, tersimpan)) {
        const url = request.nextUrl.clone();
        url.pathname = tujuanSaatDiblokir(role, tersimpan);
        return NextResponse.redirect(url);
      }

      if (mode) {
        const branch = branchP ? await branchP : null;
        const shift = branch && shiftP ? await shiftP : null;
        if (!branch || (shift && shift.branch_id !== branch.id)) {
          const url = request.nextUrl.clone();
          url.pathname = "/mulai/cabang";
          url.search = "";
          url.searchParams.set("mode", mode);
          if (request.method !== "GET") url.searchParams.set("error", "Pilih cabang aktif, lalu ulangi tindakan.");
          const response = NextResponse.redirect(url, { status: 303 });
          supabaseResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie));
          return response;
        }
        // Replace client-supplied headers. Context is always revalidated against
        // live account grants; cookies are convenience, never authorization.
        request.headers.set(BRANCH_HEADER, branch.id);
        request.headers.set(MODE_HEADER, mode);
      } else {
        request.headers.delete(BRANCH_HEADER);
        request.headers.delete(MODE_HEADER);
      }
    }
  }

  // Strip spoofed headers also on public/API requests.
  if (!userId || !operationalMode(request.nextUrl.pathname)) {
    request.headers.delete(BRANCH_HEADER);
    request.headers.delete(MODE_HEADER);
  }
  const response = NextResponse.next({ request: { headers: request.headers } });
  supabaseResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie));
  return response;
}
