// Exercises the per-instance in-memory fallback (the path taken when Supabase
// isn't configured). Env is cleared before importing the module so it captures
// the disabled state and never touches the network.
import { beforeAll, describe, expect, it } from "vitest";

let throttle: typeof import("./loginThrottle");

beforeAll(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  throttle = await import("./loginThrottle");
});

describe("loginThrottle (in-memory fallback)", () => {
  it("a fresh IP is not throttled", async () => {
    expect(await throttle.tooManyFailures("10.0.0.1")).toBe(false);
  });

  it("blocks only once MAX_FAILURES is reached", async () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < throttle.MAX_FAILURES - 1; i++) {
      await throttle.recordFailure(ip);
      expect(await throttle.tooManyFailures(ip)).toBe(false);
    }
    await throttle.recordFailure(ip); // the MAX-th failure
    expect(await throttle.tooManyFailures(ip)).toBe(true);
  });

  it("clearFailures resets an IP after a successful login", async () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < throttle.MAX_FAILURES; i++) await throttle.recordFailure(ip);
    expect(await throttle.tooManyFailures(ip)).toBe(true);
    await throttle.clearFailures(ip);
    expect(await throttle.tooManyFailures(ip)).toBe(false);
  });

  it("tracks IPs independently", async () => {
    const a = "10.0.0.4";
    const b = "10.0.0.5";
    for (let i = 0; i < throttle.MAX_FAILURES; i++) await throttle.recordFailure(a);
    expect(await throttle.tooManyFailures(a)).toBe(true);
    expect(await throttle.tooManyFailures(b)).toBe(false);
  });
});
