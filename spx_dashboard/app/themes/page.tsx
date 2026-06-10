import { DashboardFrame } from "@/components/DashboardFrame";
import { ViewHeading } from "@/components/ViewHeading";
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
    blurb: "From the accounts you trust most.",
  },
  credible: {
    title: "Credible",
    blurb:
      "Company execs & well-known managers — inferred from profile, so eyeball the role.",
  },
  discovery: {
    title: "Discovery",
    blurb: "Unvetted — surfaced from the wider firehose.",
  },
};

const DIR_LABEL: Record<Direction, string> = {
  long: "Long",
  short: "Short",
  watch: "Watch",
};

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

      <div className="idea-chart">
        <Sparkline values={idea.prices?.series ?? []} width={160} height={34} />
        <span className="idea-chart-cap">
          YTD{idea.prices?.as_of ? ` · as of ${idea.prices.as_of}` : ""}
        </span>
      </div>

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
          {idea.seen_count > 1
            ? `recurring ${idea.seen_count}d`
            : "new today"}
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

export default function ThemesPage() {
  const byTier = getActiveIdeasByTier();
  const total = getActiveIdeasCount();
  const asOf = getGeneratedAtLabel();

  return (
    <DashboardFrame
      heading={
        <ViewHeading
          title="X Themes"
          meta="Daily idea briefing from X"
          trailing={asOf ? `As of ${asOf}` : "Awaiting first run"}
        />
      }
    >
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
    </DashboardFrame>
  );
}
