import { NextResponse, type NextRequest } from "next/server";

// 1. Strict Content Security Policy with a per-request nonce. Next.js reads the nonce from the
//    request's CSP header and puts it on its own <script> tags; nothing else may run, so injected
//    markup can't execute script. Styles allow inline attributes (layout uses style={…}).
// 2. Cheap auth gate: no session cookie → login. Full validation (expiry, idle timeout, disabled
//    user) happens server-side in getCtx().

const PUBLIC = ["/login", "/api/v1", "/api/health"];

function csp(nonce: string) {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets Next's nonce'd bootstrap load its chunks; dev needs eval for React refresh
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "media-src 'self' blob:", // QR scanner camera preview
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.COOKIE_SECURE === "false" ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // API routes and file downloads set their own headers; the CSP is for HTML pages
  if (pathname.startsWith("/api/")) {
    if (PUBLIC.some((p) => pathname.startsWith(p)) || req.cookies.get("itdocs_session")) return NextResponse.next();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!PUBLIC.some((p) => pathname.startsWith(p)) && !req.cookies.get("itdocs_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
