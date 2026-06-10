import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { getActiveIdeasCount, getGeneratedAtLabel } from "@/lib/themes";

// The post-login launcher (Ledger "hub"): one ledger row per tool. Two are
// live (SPX Monitor, X Themes); three are flagged work-in-progress.
export default function HomePage() {
  const ideas = getActiveIdeasCount();
  const asOf = getGeneratedAtLabel();

  return (
    <div className="hub">
      <div className="hub-top">
        <div className="hub-brand">
          <span className="hub-brand-dot" aria-hidden="true" />
          <span className="sys">MENDO&nbsp;MONITOR</span>
        </div>
        <div className="hub-right">
          {asOf && <span className="hub-clock">X THEMES · {asOf}</span>}
          <LogoutButton />
        </div>
      </div>

      <h1>Mendo Monitor</h1>
      <p className="hub-tagline">
        An AI-beneficiary &amp; software tracker within the S&amp;P 500, plus a
        daily briefing of investment ideas surfaced from X.
      </p>

      <div className="colhead">
        <span>#</span>
        <span>TOOL</span>
        <span>DETAIL</span>
        <span className="r">ACTION</span>
      </div>

      <Link href="/spx" className="hub-row live">
        <div className="hub-idx">01</div>
        <div>
          <div className="rname">
            <span className="livedot" aria-hidden="true" />
            SPX Monitor
          </div>
          <p className="rdesc">
            AI-beneficiary &amp; software tracker within the S&amp;P 500 — sort
            any column, toggle Compounders, export the underlying data.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="k">STATUS</span>
            <span className="v on">LIVE</span>
          </div>
          <div className="stat">
            <span className="k">COVERAGE</span>
            <span className="v">S&amp;P 500</span>
          </div>
          <div className="stat">
            <span className="k">UPDATED</span>
            <span className="v">DAILY</span>
          </div>
        </div>
        <div className="cta">
          Open
          <span className="arr" aria-hidden="true">
            →
          </span>
        </div>
      </Link>

      <Link href="/themes" className="hub-row live">
        <div className="hub-idx">02</div>
        <div>
          <div className="rname">
            <span className="livedot" aria-hidden="true" />
            X Themes
          </div>
          <p className="rdesc">
            A daily, curated briefing of investment ideas surfaced from X about
            your themes — ranked by conviction and grounded in real posts.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="k">STATUS</span>
            <span className="v on">LIVE</span>
          </div>
          <div className="stat">
            <span className="k">IDEAS</span>
            <span className="v">{ideas}</span>
          </div>
          <div className="stat">
            <span className="k">UPDATED</span>
            <span className="v">{asOf ?? "—"}</span>
          </div>
        </div>
        <div className="cta">
          Open
          <span className="arr" aria-hidden="true">
            →
          </span>
        </div>
      </Link>

      <Link href="/dashboard" className="hub-row wip">
        <div className="hub-idx">03</div>
        <div>
          <div className="rname">Equities Dashboard</div>
          <p className="rdesc">
            A consolidated view of the equities book — positions, exposures, and
            performance in one place.
          </p>
        </div>
        <div>
          <span className="wiptag">Work in progress</span>
        </div>
        <div className="prev">Preview →</div>
      </Link>

      <Link href="/diligence" className="hub-row wip">
        <div className="hub-idx">04</div>
        <div>
          <div className="rname">Diligence Tracker</div>
          <p className="rdesc">
            Open questions, notes, and status as each idea moves through the
            process.
          </p>
        </div>
        <div>
          <span className="wiptag">Work in progress</span>
        </div>
        <div className="prev">Preview →</div>
      </Link>

      <Link href="/podcast" className="hub-row wip">
        <div className="hub-idx">05</div>
        <div>
          <div className="rname">Podcast Creator</div>
          <p className="rdesc">
            Turn research and ideas into a narrated audio briefing you can listen
            to on the go.
          </p>
        </div>
        <div>
          <span className="wiptag">Work in progress</span>
        </div>
        <div className="prev">Preview →</div>
      </Link>

      <div className="hub-foot">
        <span>{asOf ? `X THEMES AS OF ${asOf}` : "X THEMES"}</span>
        <span>5 MODULES · 2 LIVE</span>
      </div>
    </div>
  );
}
