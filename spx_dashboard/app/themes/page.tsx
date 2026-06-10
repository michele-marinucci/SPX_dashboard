import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Sparkline } from "@/components/Sparkline";
import { cx } from "@/lib/format";
import {
  Direction,
  getActiveIdeasByTier,
  getActiveIdeasCount,
  getGeneratedAtLabel,
  getThemeLabel,
  IdeaSource,
  ThemeIdea,
  Tier,
  TIER_ORDER,
} from "@/lib/themes";

// Static copy for the three tier sections. Mirrors the buckets the pipeline
// assigns: priority > credible > discovery.
const TIER_META: Record<Tier, { title: string; blurb: string }> = {
  priority: {
    title: "Priority",
    blurb: "From the accounts you trust most (your curated handles).",
  },
  credible: {
    title: "Credible",
    blurb:
      "Company execs & well-known managers — inferred from profile, so eyeball the role.",
  },
  discovery: {
    title: "Discovery",
    blurb: "Unvetted — surfaced from the wider firehose. Treat with caution.",
  },
};

const DIR_LABEL: Record<Direction, string> = {
  long: "Long",
  short: "Short",
  watch: "Watch",
};

// Static "how it works" explainer, styled like the SPX How-To banner.
function HowItWorks() {
  return (
    <section className="howto" aria-label="How X Themes works">
      <p className="howto-lead">
        <strong>X Themes</strong> scouts X (Twitter) every morning for
        actionable investment ideas about your themes. Every idea is{" "}
        <strong>grounded</strong> in at least one real post, sorted into three
        tiers by how much the source can be trusted, and{" "}
        <strong>ranked by a derived score</strong> (source trust × distinct
        trusted accounts × how many days it keeps recurring). It is a bounded,
        ranked feed — not a timeline.
      </p>
      <div className="howto-grid">
        <div className="howto-card">
          <div className="howto-ic tier-priority">
            <span className="tier-dot" />
          </div>
          <div className="howto-ct">
            <b>Priority</b>
            <span>From the accounts you trust most (your curated handles).</span>
          </div>
        </div>
        <div className="howto-card">
          <div className="howto-ic tier-credible">
            <span className="tier-dot" />
          </div>
          <div className="howto-ct">
            <b>Credible</b>
            <span>
              Company execs & well-known managers, inferred from profile — check
              the role shown on each card.
            </span>
          </div>
        </div>
        <div className="howto-card">
          <div className="howto-ic tier-discovery">
            <span className="tier-dot" />
          </div>
          <div className="howto-ct">
            <b>Discovery</b>
            <span>Unvetted accounts from the wider firehose; treat with caution.</span>
          </div>
        </div>
        <div className="howto-card">
          <div className="howto-ic">↗</div>
          <div className="howto-ct">
            <b>On each card</b>
            <span>
              Direction, one-line thesis, conviction & score, source handles
              linking to the cited post(s), and a YTD price spark.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceLink({ s }: { s: IdeaSource }) {
  return (
    <a
      className={cx("idea-src", `tier-${s.tier}`)}
      href={s.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`View the source post on X (${s.tier})`}
    >
      <span className="idea-src-dot" aria-hidden="true" />
      <span className="idea-src-handle">@{s.handle}</span>
      {/* Role is the credible-tier eyeball check; show it whenever present. */}
      {s.role && <span className="idea-src-role">{s.role}</span>}
    </a>
  );
}

function IdeaCard({ idea }: { idea: ThemeIdea }) {
  const hasChart = !!idea.prices?.series?.length;
  return (
    <article className="idea-card">
      <div className="idea-head">
        <span className="idea-ticker">{idea.ticker}</span>
        <span className={cx("dir-badge", `dir-${idea.direction}`)}>
          {DIR_LABEL[idea.direction]}
        </span>
        {idea.on_watchlist && (
          <span className="idea-watch" title="On your watchlist">
            watchlist
          </span>
        )}
        <span
          className={cx("conv-badge", `conv-${idea.conviction}`)}
          title="Derived from source weight, distinct trusted handles, and recurrence"
        >
          {idea.conviction} conviction
        </span>
        <span className="idea-score" title="Ranking score">
          {Math.round(idea.score)}
        </span>
      </div>

      {idea.thesis && <p className="idea-thesis">{idea.thesis}</p>}
      {idea.catalyst && (
        <p className="idea-catalyst">
          <span className="idea-catalyst-tag">Catalyst</span>
          {idea.catalyst}
        </p>
      )}

      {hasChart && (
        <div className="idea-chart">
          <Sparkline values={idea.prices!.series} width={160} height={34} />
          <span className="idea-chart-cap">
            YTD{idea.prices?.as_of ? ` · as of ${idea.prices.as_of}` : ""}
          </span>
        </div>
      )}

      <div className="idea-sources">
        {idea.sources.map((s) => (
          <SourceLink key={`${s.handle}-${s.url}`} s={s} />
        ))}
      </div>

      <div className="idea-foot">
        {idea.theme_keys.map((k) => (
          <span key={k} className="idea-theme-chip">
            {getThemeLabel(k)}
          </span>
        ))}
        <span className="idea-recur">
          {idea.seen_count > 1 ? `recurring ${idea.seen_count}d` : "new today"}
        </span>
      </div>
    </article>
  );
}

function TierSection({ tier, ideas }: { tier: Tier; ideas: ThemeIdea[] }) {
  const meta = TIER_META[tier];
  return (
    <section className="section">
      <div className="tier-head">
        <h2 className="section-title">
          {meta.title}
          <span className={cx("tier-pill", `tier-${tier}`)}>{ideas.length}</span>
        </h2>
        <p className="tier-blurb">{meta.blurb}</p>
      </div>
      {ideas.length === 0 ? (
        <p className="muted">Nothing in this tier today.</p>
      ) : (
        <div className="idea-grid">
          {ideas.map((idea) => (
            <IdeaCard key={`${idea.ticker}-${idea.direction}`} idea={idea} />
          ))}
        </div>
      )}
    </section>
  );
}

// Standalone view — no sidebar, no Export. Just a back link + sign out.
export default function ThemesPage() {
  const byTier = getActiveIdeasByTier();
  const total = getActiveIdeasCount();
  const asOf = getGeneratedAtLabel();

  return (
    <div className="solo">
      <header className="solo-header">
        <Link href="/" className="back-link">
          ← All views
        </Link>
        <LogoutButton />
      </header>

      <div className="solo-title">
        <h1>X Themes</h1>
        <p className="subtitle">
          Daily idea briefing from X · {asOf ? `as of ${asOf}` : "awaiting first run"}
        </p>
      </div>

      <HowItWorks />

      {total === 0 ? (
        <section className="section">
          <p className="muted">
            No grounded ideas yet. The daily scout surfaces ideas from X each
            morning; check back after the next run.
          </p>
        </section>
      ) : (
        TIER_ORDER.map((tier) => (
          <TierSection key={tier} tier={tier} ideas={byTier[tier]} />
        ))
      )}
    </div>
  );
}
