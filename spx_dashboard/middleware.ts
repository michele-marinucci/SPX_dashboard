import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Server-side gate: every request for a protected route must carry a valid,
// signed session cookie. Because this runs in middleware (before the page is
// rendered), unauthenticated users never receive any dashboard markup or data.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await verifySessionToken(token);

  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Protect everything except the login page, the auth API, and static assets.
export const config = {
  matcher: [
    "/((?!login|api/login|api/logout|_next/static|_next/image|favicon.ico).*)",
  ],
};
