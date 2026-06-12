import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

// In-memory brute-force throttle: per-IP sliding window of failed attempts.
// Per-instance only on serverless, but still raises the cost of password
// guessing substantially for a single shared password.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();

function tooManyFailures(ip: string): boolean {
  const now = Date.now();
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

function recordFailure(ip: string) {
  const list = failures.get(ip) ?? [];
  list.push(Date.now());
  failures.set(ip, list);
}

// Constant-time-ish comparison to avoid trivial timing leaks.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected || !process.env.AUTH_SECRET) {
    return NextResponse.json(
      { error: "Server is not configured (SITE_PASSWORD / AUTH_SECRET)." },
      { status: 500 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (tooManyFailures(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // fall through to invalid
  }

  if (!password || !safeEqual(password, expected)) {
    recordFailure(ip);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
