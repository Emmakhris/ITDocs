import { NextResponse, type NextRequest } from "next/server";

// Cheap gate: no session cookie → login. Full validation (expiry, idle timeout, disabled user) happens server-side in getCtx().
const PUBLIC = ["/login", "/api/v1"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("itdocs_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
