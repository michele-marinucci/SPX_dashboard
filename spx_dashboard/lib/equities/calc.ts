// Pure recomputation of every derived column of the Detailed Dashboard from
// the editable model inputs + a live price. Ports the Summary-tab formulas
// 1:1 (RRI-based IRRs, the NTM-blended decomp, per-row target-price
// variants), so the site shows the same numbers the workbook would — except
// they refresh whenever the price moves or an analyst edits the model.
//
// All year arguments are absolute calendar years; the visible window is
// [currentYear .. currentYear+4] and rolls forward automatically on Jan 1.

import { Company, EquityModel } from "./types";

const DAY = 86_400_000;

// Excel RRI(nper, pv, fv) = (fv/pv)^(1/nper) − 1.
function rri(nper: number, pv: number | null, fv: number | null): number | null {
  if (pv == null || fv == null || !isFinite(nper) || nper <= 0) return null;
  if (pv <= 0 || fv <= 0) return null;
  return Math.pow(fv / pv, 1 / nper) - 1;
}

function val(map: Record<string, number>, year: number): number | null {
  const v = map[String(year)];
  return typeof v === "number" && isFinite(v) ? v : null;
}

// Gross profit is always GM% × Revs (rows that hardcoded GP in the sheet had
// their GM% back-filled at seed time, so this reproduces both styles).
function gp(m: EquityModel, year: number): number | null {
  const g = val(m.gm, year);
  const r = val(m.revs, year);
  return g != null && r != null ? g * r : null;
}

export function displayYears(today: Date): number[] {
  const y = today.getUTCFullYear();
  return [y, y + 1, y + 2, y + 3, y + 4];
}

// Years to Dec-31 of `year`, as in the sheet's (date − TODAY())/365 row.
function yearFrac(year: number, today: Date): number {
  return (Date.UTC(year, 11, 31) - today.getTime()) / (365 * DAY);
}

export interface Decomp {
  revs: number | null;
  margin: number | null;
  ni: number | null;
  yld: number | null;
  epsDivs: number | null;
  multiple: number | null;
  ret: number | null;
}

export interface Derived {
  price: number | null;
  ev: number | null;
  evGp: Record<number, number | null>; // y0..y0+4
  mendoPe: Record<number, number | null>; // y0..y0+4
  targetPx: Record<number, number | null>; // y0..y0+3
  irr: Record<number, number | null>; // y0..y0+3
  mom: Record<number, number | null>; // y0..y0+3
  decomp: Decomp;
  gpCagr: number | null; // y0 → y0+3
  mepsCagr: number | null;
}

function targetPrice(c: Company, year: number): number | null {
  const m = c.model;
  const mult = val(m.target_mult, year);
  if (mult == null) return null;
  const cash = val(m.ncps, year) ?? 0;
  switch (c.variant) {
    case "pe": {
      const eps = val(m.mendo_eps, year + 1);
      if (eps == null) return null;
      return mult * eps + (c.cash_in_target ? cash : 0);
    }
    case "gp_ev": {
      const g = gp(m, year + 1);
      const nd = val(m.net_debt, year) ?? 0;
      const sh = val(m.wadso, year);
      if (g == null || sh == null || sh === 0) return null;
      return (mult * g - nd) / sh;
    }
    case "gp_ps": {
      const g = gp(m, year + 1);
      const sh = val(m.wadso, year + 1);
      if (g == null || sh == null || sh === 0) return null;
      return (mult * g) / sh + cash;
    }
    case "rev_ps": {
      const r = val(m.revs, year + 1);
      const sh = val(m.wadso, year + 1);
      if (r == null || sh == null || sh === 0) return null;
      return (mult * r) / sh + cash;
    }
  }
}

export function compute(c: Company, rawPrice: number | null, today: Date): Derived {
  const m = c.model;
  const px = rawPrice != null ? rawPrice * c.px_scale : null;
  const years = displayYears(today);
  const y0 = years[0];
  const y4 = years[4];
  const n0 = yearFrac(y0, today);

  // EV = shares × price + (cash + debt) + minority interest (cash is signed).
  const ev =
    px != null && m.shares != null
      ? m.shares * px + (m.cash ?? 0) + (m.debt ?? 0) + (m.min_int ?? 0)
      : null;

  const evGp: Record<number, number | null> = {};
  const mendoPe: Record<number, number | null> = {};
  for (let y = y0; y <= y4; y++) {
    const g = gp(m, y);
    evGp[y] = ev != null && g != null && g > 0 ? ev / g : null;
    const eps = val(m.mendo_eps, y);
    mendoPe[y] = px != null && eps != null && eps > 0 ? px / eps : null;
  }

  const targetPx: Record<number, number | null> = {};
  const irr: Record<number, number | null> = {};
  const mom: Record<number, number | null> = {};
  for (let k = 0; k <= 3; k++) {
    const y = y0 + k;
    const tp = targetPrice(c, y);
    targetPx[y] = tp;

    // Dividends: the current year contributes pro-rata (DPS × years left),
    // later years contribute in full — exactly as in the sheet's IRR row.
    let divsIrr = (val(m.dps, y0) ?? 0) * n0;
    let divsMom = val(m.dps, y0) ?? 0;
    for (let j = 1; j <= k; j++) {
      divsIrr += val(m.dps, y0 + j) ?? 0;
      divsMom += val(m.dps, y0 + j) ?? 0;
    }
    irr[y] = tp != null && px != null ? rri(yearFrac(y, today), px, tp + divsIrr) : null;
    mom[y] = tp != null && px != null && px !== 0 ? (tp + divsMom) / px : null;
  }

  // NTM → YE(y0+2) decomp. Starting points blend this year and next by time
  // remaining (n0), matching RRI(2+n0, n0·X(y0) + (1−n0)·X(y0+1), X(y0+3)).
  const blend = (map: Record<string, number>): number | null => {
    const a = val(map, y0);
    const b = val(map, y0 + 1);
    return a != null && b != null ? n0 * a + (1 - n0) * b : null;
  };
  const horizon = 2 + n0;

  const revsCagr = rri(horizon, blend(m.revs), val(m.revs, y0 + 3));
  const ret = irr[y0 + 2];

  let niCagr: number | null = null;
  let epsCagr: number | null = null;
  let divYield: number | null = null;
  let margin: number | null = null;
  let yld: number | null = null;
  let epsDivs: number | null = null;

  if (c.decomp === "simple") {
    yld = c.yield_input;
    epsDivs = revsCagr != null && yld != null ? revsCagr + yld : null;
  } else if (c.decomp !== "none") {
    const ni = (y: number) => {
      const e = val(m.mendo_eps, y);
      const w = val(m.wadso, y);
      return e != null && w != null ? e * w : null;
    };
    const niStart =
      ni(y0) != null && ni(y0 + 1) != null ? n0 * ni(y0)! + (1 - n0) * ni(y0 + 1)! : null;
    niCagr = rri(horizon, niStart, ni(y0 + 3));
    epsCagr = rri(horizon, blend(m.mendo_eps), val(m.mendo_eps, y0 + 3));
    margin = niCagr != null && revsCagr != null ? niCagr - revsCagr : null;

    if (px != null && px > 0) {
      if (c.div_yield_mode === "cashbuild") {
        const nc = val(m.ncps, y0 + 2);
        const n2 = yearFrac(y0 + 2, today);
        divYield = nc != null && n2 > 0 ? nc / px / n2 : null;
      } else {
        const d1 = val(m.dps, y0 + 1);
        const d2 = val(m.dps, y0 + 2);
        const ds = [d1, d2].filter((d): d is number => d != null);
        divYield = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length / px : 0;
      }
    }
    epsDivs = epsCagr != null && divYield != null ? epsCagr + divYield : null;
    yld = epsDivs != null && niCagr != null ? epsDivs - niCagr : null;
  }

  let multiple: number | null = null;
  if (c.decomp === "mult_first") {
    // Multiple = CAGR from today's NTM-blended Mendo P/E to the target
    // multiple at y0+2; EPS+Divs and Yield are then the residuals.
    const pe = (y: number) => {
      const e = val(m.mendo_eps, y);
      return px != null && e != null && e > 0 ? px / e : null;
    };
    const a = pe(y0);
    const b = pe(y0 + 1);
    const peBlend = a != null && b != null ? n0 * a + (1 - n0) * b : null;
    multiple = rri(horizon, peBlend, val(m.target_mult, y0 + 2));
    epsDivs = ret != null && multiple != null ? ret - multiple : null;
    yld = epsDivs != null && niCagr != null ? epsDivs - niCagr : null;
  } else if (c.decomp !== "none") {
    multiple = ret != null && epsDivs != null ? ret - epsDivs : null;
  }

  return {
    price: px,
    ev,
    evGp,
    mendoPe,
    targetPx,
    irr,
    mom,
    decomp: { revs: revsCagr, margin, ni: niCagr, yld, epsDivs, multiple, ret },
    gpCagr: rri(3, gp(m, y0), gp(m, y0 + 3)),
    mepsCagr: rri(3, val(m.mendo_eps, y0), val(m.mendo_eps, y0 + 3)),
  };
}
