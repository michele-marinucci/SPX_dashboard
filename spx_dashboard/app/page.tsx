import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { getGeneratedAtLabel, getTweetCount } from "@/lib/tweets";

// The post-login launcher (Ledger "hub"): one ledger row per tool. Three are
// live (SPX Monitor, Twitter Monitor, Diligence Tracker); the rest are WIP.
export default function HomePage() {
  const tweets = getTweetCount();
  const asOf = getGeneratedAtLabel();

  return (
    <div className="hub">
      <div className="hub-top">
        <div className="hub-brand">
          <span className="hub-brand-dot" aria-hidden="true" />
          <span className="sys">MENDO&nbsp;HUB</span>
        </div>
        <div className="hub-right">
          {asOf && <span className="hub-clock">TWITTER · {asOf}</span>}
          <LogoutButton />
        </div>
      </div>

      <h1>Mendo Hub</h1>

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
            Twitter Monitor
          </div>
          <p className="rdesc">
            A summary of the day&apos;s tweets from your followed accounts —
            organized by theme, with portfolio mentions and recurring topics.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="k">STATUS</span>
            <span className="v on">LIVE</span>
          </div>
          <div className="stat">
            <span className="k">TWEETS</span>
            <span className="v">{tweets}</span>
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

      <Link href="/diligence" className="hub-row live">
        <div className="hub-idx">04</div>
        <div>
          <div className="rname">
            <span className="livedot" aria-hidden="true" />
            Diligence Tracker
          </div>
          <p className="rdesc">
            Every position&apos;s Microsoft List in one place — click through to a
            name&apos;s tracker, add or remove links, shared across the team.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="k">STATUS</span>
            <span className="v on">LIVE</span>
          </div>
          <div className="stat">
            <span className="k">SOURCE</span>
            <span className="v">MS LISTS</span>
          </div>
          <div className="stat">
            <span className="k">ACCESS</span>
            <span className="v">SHARED</span>
          </div>
        </div>
        <div className="cta">
          Open
          <span className="arr" aria-hidden="true">
            →
          </span>
        </div>
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

      <Link href="/insider" className="hub-row wip">
        <div className="hub-idx">06</div>
        <div>
          <div className="rname">Insider Selling</div>
          <p className="rdesc">
            Track insider sell transactions across the universe — who&apos;s
            selling, how much, and when.
          </p>
        </div>
        <div>
          <span className="wiptag">Work in progress</span>
        </div>
        <div className="prev">Preview →</div>
      </Link>

      <Link href="/morning-news" className="hub-row wip">
        <div className="hub-idx">07</div>
        <div>
          <div className="rname">Morning News Summary</div>
          <p className="rdesc">
            A pre-market digest of overnight headlines and the news that moves
            your names, summarized each morning.
          </p>
        </div>
        <div>
          <span className="wiptag">Work in progress</span>
        </div>
        <div className="prev">Preview →</div>
      </Link>

      <div className="hub-foot">
        <span>{asOf ? `TWITTER MONITOR AS OF ${asOf}` : "TWITTER MONITOR"}</span>
        <span>7 MODULES · 3 LIVE</span>
      </div>
    </div>
  );
}
