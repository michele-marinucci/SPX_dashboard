// Unit tests for the pure derived-metric math. Every expectation below is
// computed by hand from the documented formulas (Excel RRI semantics, 365-day
// year fractions, NTM-blended decomposition), so a regression here means the
// site/Excel/PPT numbers drift from the workbook the team trusts.
import { describe, expect, it } from "vitest";
import { compute, displayYears } from "./calc";
import { Company, emptyModel } from "./types";

const DAY = 86_400_000;

// Fixed clock: 2026-07-02T00:00:00Z. Dec 31 2026 is 182 days out, so the
// current-year fraction n0 = 182/365.
const TODAY = new Date(Date.UTC(2026, 6, 2));
const N0 = (Date.UTC(2026, 11, 31) - TODAY.getTime()) / (365 * DAY);

function makeCompany(over: Partial<Company> = {}): Company {
  return {
    ticker: "TEST",
    bbg: "TEST US EQUITY",
    yahoo: "TEST",
    currency: "$",
    px_scale: 1,
    grp: "Software",
    grp_order: 0,
    row_order: 0,
    port: null,
    update_date: null,
    update_by: null,
    variant: "pe",
    cash_in_target: false,
    div_yield_mode: "dps",
    decomp: "standard",
    yield_input: null,
    adv_3m: null,
    perf: { m1: null, m3: null, m6: null },
    model: emptyModel(),
    is_index: false,
    best_pe: null,
    removed: false,
    ...over,
  };
}

// A fully populated model with simple round numbers (years 2026–2030).
function richCompany(over: Partial<Company> = {}): Company {
  const c = makeCompany(over);
  c.model = {
    ...emptyModel(),
    revs: { "2026": 1000, "2027": 1200, "2028": 1440, "2029": 1728, "2030": 2073.6 },
    gm: { "2026": 0.8, "2027": 0.8, "2028": 0.8, "2029": 0.8, "2030": 0.8 },
    mendo_eps: { "2026": 5, "2027": 6, "2028": 7.2, "2029": 8.64, "2030": 10.368 },
    adj_eps: { "2026": 5.5, "2027": 6.6, "2028": 7.92, "2029": 9.5, "2030": 11.4 },
    target_mult: { "2026": 25, "2027": 25, "2028": 25, "2029": 25 },
    dps: { "2026": 1, "2027": 1, "2028": 1, "2029": 1 },
    wadso: { "2026": 100, "2027": 100, "2028": 100, "2029": 100, "2030": 100 },
    ncps: { "2026": 2, "2027": 2, "2028": 2, "2029": 2 },
    net_debt: { "2026": -200, "2027": -200, "2028": -200, "2029": -200 },
    shares: 100,
    cash: -500,
    debt: 300,
    min_int: 10,
  };
  return c;
}

describe("displayYears", () => {
  it("returns a 5-year window starting at the current UTC year", () => {
    expect(displayYears(TODAY)).toEqual([2026, 2027, 2028, 2029, 2030]);
  });
});

describe("compute — price, EV, multiples", () => {
  it("applies px_scale to the raw price", () => {
    const d = compute(richCompany({ px_scale: 0.01 }), 15000, TODAY);
    expect(d.price).toBe(150);
  });

  it("EV = shares×px + cash + debt + min_int (cash signed)", () => {
    const d = compute(richCompany(), 150, TODAY);
    expect(d.ev).toBe(100 * 150 - 500 + 300 + 10); // 14810
  });

  it("EV/GP divides EV by GM% × revenue per year", () => {
    const d = compute(richCompany(), 150, TODAY);
    expect(d.evGp[2026]).toBeCloseTo(14810 / (0.8 * 1000), 10);
    expect(d.evGp[2030]).toBeCloseTo(14810 / (0.8 * 2073.6), 10);
  });

  it("Mendo P/E is price over Mendo EPS, null for eps ≤ 0", () => {
    const c = richCompany();
    c.model.mendo_eps["2027"] = 0;
    const d = compute(c, 150, TODAY);
    expect(d.mendoPe[2026]).toBeCloseTo(150 / 5, 10);
    expect(d.mendoPe[2027]).toBeNull();
  });

  it("returns null EV (and EV/GP) when price or shares are missing", () => {
    const noPrice = compute(richCompany(), null, TODAY);
    expect(noPrice.ev).toBeNull();
    expect(noPrice.evGp[2026]).toBeNull();
    const c = richCompany();
    c.model.shares = null;
    expect(compute(c, 150, TODAY).ev).toBeNull();
  });
});

describe("compute — target price variants", () => {
  it("pe: target multiple × NTM Mendo EPS (+ ncps only when flagged)", () => {
    const plain = compute(richCompany(), 150, TODAY);
    expect(plain.targetPx[2026]).toBeCloseTo(25 * 6, 10); // NTM = 2027 eps
    const cash = compute(richCompany({ cash_in_target: true }), 150, TODAY);
    expect(cash.targetPx[2026]).toBeCloseTo(25 * 6 + 2, 10);
  });

  it("gp_ev: (mult × NTM GP − net_debt[y]) / wadso[y]", () => {
    const d = compute(richCompany({ variant: "gp_ev" }), 150, TODAY);
    // NTM GP = 0.8 × 1200 = 960; (25×960 − (−200)) / 100
    expect(d.targetPx[2026]).toBeCloseTo((25 * 960 + 200) / 100, 10);
  });

  it("gp_ps: mult × NTM GP / NTM wadso + ncps[y]", () => {
    const d = compute(richCompany({ variant: "gp_ps" }), 150, TODAY);
    expect(d.targetPx[2026]).toBeCloseTo((25 * 960) / 100 + 2, 10);
  });

  it("rev_ps: mult × NTM revenue / NTM wadso + ncps[y]", () => {
    const d = compute(richCompany({ variant: "rev_ps" }), 150, TODAY);
    expect(d.targetPx[2026]).toBeCloseTo((25 * 1200) / 100 + 2, 10);
  });

  it("is null when the year has no target multiple", () => {
    const d = compute(richCompany(), 150, TODAY);
    // 2029 target exists but 2029's NTM eps (2030) does too — drop the mult.
    const c = richCompany();
    delete c.model.target_mult["2028"];
    const d2 = compute(c, 150, TODAY);
    expect(d.targetPx[2028]).not.toBeNull();
    expect(d2.targetPx[2028]).toBeNull();
    expect(d2.irr[2028]).toBeNull();
    expect(d2.mom[2028]).toBeNull();
  });
});

describe("compute — IRR and MoM", () => {
  it("IRR matches RRI(yearFrac, price, target + pro-rata dividends)", () => {
    const d = compute(richCompany(), 150, TODAY);
    // y0 horizon: tp = 150 (25 × 6); divs = DPS[2026] × n0.
    const tp = 150;
    const fv = tp + 1 * N0;
    const expected = Math.pow(fv / 150, 1 / N0) - 1;
    expect(d.irr[2026]).toBeCloseTo(expected, 12);
  });

  it("later years accumulate full dividends on top of the pro-rata year", () => {
    const d = compute(richCompany(), 150, TODAY);
    // 2028: tp = 25 × eps(2029) = 216; divs = 1×n0 + 1 + 1. The horizon is
    // (Dec-31-2028 − today)/365, which crosses the 2028 leap day — so it is
    // NOT exactly n0+2.
    const horizon = (Date.UTC(2028, 11, 31) - TODAY.getTime()) / (365 * DAY);
    const fv = 216 + N0 + 2;
    expect(d.irr[2028]).toBeCloseTo(Math.pow(fv / 150, 1 / horizon) - 1, 12);
    // MoM uses the full (not pro-rata) current-year dividend.
    expect(d.mom[2028]).toBeCloseTo((216 + 3) / 150, 12);
  });

  it("IRR is null for non-positive price or target", () => {
    const d = compute(richCompany(), 0, TODAY);
    expect(d.irr[2026]).toBeNull();
  });
});

describe("compute — decomposition", () => {
  it("standard: margin = NI CAGR − Revs CAGR; multiple = return − EPS+Divs", () => {
    const d = compute(richCompany(), 150, TODAY);
    const dc = d.decomp;
    // Constant wadso → NI CAGR = EPS CAGR; constant GM → margin ≈ eps−revs drift.
    expect(dc.revs).not.toBeNull();
    expect(dc.ni).not.toBeNull();
    expect(dc.margin).toBeCloseTo(dc.ni! - dc.revs!, 12);
    // EPS+Divs = EPS CAGR + div yield (avg of DPS 2027/2028 over price).
    const divYield = (1 + 1) / 2 / 150;
    const horizon = 2 + N0;
    const blendEps = N0 * 5 + (1 - N0) * 6;
    const epsCagr = Math.pow(8.64 / blendEps, 1 / horizon) - 1;
    expect(dc.epsDivs).toBeCloseTo(epsCagr + divYield, 12);
    expect(dc.ret).toBe(d.irr[2028]);
    expect(dc.multiple).toBeCloseTo(dc.ret! - dc.epsDivs!, 12);
    // Yield is the residual between EPS+Divs and NI CAGR.
    expect(dc.yld).toBeCloseTo(dc.epsDivs! - dc.ni!, 12);
  });

  it("simple: yield comes from yield_input and EPS+Divs = revs CAGR + yield", () => {
    const d = compute(richCompany({ decomp: "simple", yield_input: 0.02 }), 150, TODAY);
    expect(d.decomp.yld).toBe(0.02);
    expect(d.decomp.epsDivs).toBeCloseTo(d.decomp.revs! + 0.02, 12);
  });

  it("none: leaves the decomposition blank except revs and return", () => {
    const d = compute(richCompany({ decomp: "none" }), 150, TODAY);
    expect(d.decomp.margin).toBeNull();
    expect(d.decomp.multiple).toBeNull();
    expect(d.decomp.epsDivs).toBeNull();
  });

  it("mult_first: multiple is the blended-P/E → target-mult CAGR", () => {
    const d = compute(richCompany({ decomp: "mult_first" }), 150, TODAY);
    const horizon = 2 + N0;
    const peBlend = N0 * (150 / 5) + (1 - N0) * (150 / 6);
    const expected = Math.pow(25 / peBlend, 1 / horizon) - 1;
    expect(d.decomp.multiple).toBeCloseTo(expected, 12);
    expect(d.decomp.epsDivs).toBeCloseTo(d.decomp.ret! - expected, 12);
  });
});

describe("compute — 3-year CAGRs", () => {
  it("gpCagr and mepsCagr are simple 3-year RRIs from y0", () => {
    const d = compute(richCompany(), 150, TODAY);
    expect(d.gpCagr).toBeCloseTo(Math.pow((0.8 * 1728) / (0.8 * 1000), 1 / 3) - 1, 12);
    expect(d.mepsCagr).toBeCloseTo(Math.pow(8.64 / 5, 1 / 3) - 1, 12);
  });

  it("an empty model yields all-null output without throwing", () => {
    const d = compute(makeCompany(), 150, TODAY);
    expect(d.ev).toBeNull();
    expect(d.targetPx[2026]).toBeNull();
    expect(d.gpCagr).toBeNull();
    expect(d.decomp.revs).toBeNull();
  });
});
