import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { ExportPptButton } from "@/components/ExportPptButton";
import { TodayDate } from "@/components/TodayDate";
import { getGeneratedAtLabel, getTweetCount } from "@/lib/tweets";

// The post-login launcher (Ledger "hub"): one ledger row per tool. Four are
// live (SPX Monitor, Twitter Monitor, Diligence Tracker, Morning News); the
// rest are WIP.
export default function HomePage() {
  const tweets = getTweetCount();
  const asOf = getGeneratedAtLabel();

  return (
    <div className="hub">
      <div className="hub-top">
        <img src="/meritage-logo.png" alt="Meritage" className="hub-logo" />
        <div className="hub-right">
          <ExportPptButton />
          <LogoutButton />
        </div>
      </div>

      <div className="hub-head">
        <h1>Mendo Hub</h1>
        <TodayDate />
      </div>

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
            Track AI beneficiaries and software names in the S&amp;P 500. Sort
            any column, toggle Compounders, and export the underlying data.
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
            A daily summary of tweets from your followed accounts, organized by
            theme with portfolio mentions and recurring topics.
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
            <span className="v">MON/WED/FRI</span>
          </div>
        </div>
        <div className="cta">
          Open
          <span className="arr" aria-hidden="true">
            →
          </span>
        </div>
      </Link>

      <Link href="/diligence" className="hub-row live">
        <div className="hub-idx">03</div>
        <div>
          <div className="rname">
            <span className="livedot" aria-hidden="true" />
            Diligence Tracker
          </div>
          <p className="rdesc">
            Every position&apos;s Microsoft List in one place. Open a name&apos;s
            tracker, add or remove links, and share across the team.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="k">STATUS</span>
            <span className="v on">LIVE</span>
          </div>
          <div className="stat">
            <span className="k">SOURCE</span>
            <span className="v">MICROSOFT LISTS</span>
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

      <Link href="/morning-news" className="hub-row live">
        <div className="hub-idx">04</div>
        <div>
          <div className="rname">
            <span className="livedot" aria-hidden="true" />
            Morning News Summary
          </div>
          <p className="rdesc">
            A pre-market digest of overnight headlines and the news that moves
            your names. Summarized fresh each morning.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="k">STATUS</span>
            <span className="v on">LIVE</span>
          </div>
          <div className="stat">
            <span className="k">CADENCE</span>
            <span className="v">PRE-MARKET</span>
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

      <Link href="/dashboard" className="hub-row live">
        <div className="hub-idx">05</div>
        <div>
          <div className="rname">
            <span className="livedot" aria-hidden="true" />
            Equities Dashboard
          </div>
          <p className="rdesc">
            The detailed dashboard, live. Valuation, IRRs, and the IRR decomp
            across the book, with shared analyst model updates.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="k">STATUS</span>
            <span className="v on">LIVE</span>
          </div>
          <div className="stat">
            <span className="k">PRICES</span>
            <span className="v">PRIOR CLOSE</span>
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
        <div className="hub-idx">06</div>
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
        <div className="hub-idx">07</div>
        <div>
          <div className="rname">Insider Selling</div>
          <p className="rdesc">
            Track insider sell transactions across the universe. See who is
            selling, how much, and when.
          </p>
        </div>
        <div>
          <span className="wiptag">Work in progress</span>
        </div>
        <div className="prev">Preview →</div>
      </Link>

      <div className="hub-foot">
        <span>{asOf ? `TWITTER MONITOR AS OF ${asOf}` : "TWITTER MONITOR"}</span>
        <span>7 MODULES · 5 LIVE</span>
      </div>
    </div>
  );
}
