"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace(from);
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Login failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/meritage-logo.png" alt="Meritage" className="login-logo" />
        <div className="login-product">
          <span className="login-product-name">Mendo Hub</span>
          <span className="login-internal mono">INTERNAL</span>
        </div>
        <h1 className="login-heading">Sign in</h1>
        <p className="login-tagline">Private dashboard — authorized access only.</p>

        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-label mono" htmlFor="login-password">
            PASSWORD
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Access password"
            autoFocus
            autoComplete="current-password"
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading || !password}>
            {loading ? "Checking…" : "Enter workspace"}
          </button>
        </form>
        <p className="login-foot mono">SERVER-SIDE AUTH · NOINDEX</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
