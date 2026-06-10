import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { getActiveIdeasCount, getGeneratedAtLabel } from "@/lib/themes";

// The post-login landing: choose which tool to open. SPX Monitor is the
// existing S&P 500 dashboard; X Themes is the daily idea briefing from X.
export default function HomePage() {
  const ideas = getActiveIdeasCount();
  const asOf = getGeneratedAtLabel();

  return (
    <div className="landing">
      <header className="landing-head">
        <div className="landing-brand">
          <span className="login-dot" aria-hidden="true" />
          Mendo Monitor
        </div>
        <LogoutButton />
      </header>

      <p className="landing-tagline">
        An AI-beneficiary &amp; software tracker within the S&amp;P 500, plus a
        daily briefing of investment ideas surfaced from X.
      </p>

      <div className="landing-grid">
        <Link href="/spx" className="landing-card">
          <div className="landing-card-title">SPX Monitor</div>
          <p className="landing-card-desc">
            An AI-beneficiary &amp; software tracker within the S&amp;P 500.
            Browse categories, sort any column, toggle Compounders only, and
            export the underlying Excel.
          </p>
          <span className="landing-card-cta">Open SPX Monitor →</span>
        </Link>

        <Link href="/themes" className="landing-card">
          <div className="landing-card-title">X Themes</div>
          <p className="landing-card-desc">
            A daily, curated briefing of investment ideas surfaced from X about
            your themes — ranked by conviction and grounded in real posts.
          </p>
          <span className="landing-card-cta">
            {ideas > 0 ? `Open X Themes · ${ideas} ideas →` : "Open X Themes →"}
          </span>
        </Link>
      </div>

      {asOf && <p className="landing-foot">X Themes as of {asOf}</p>}
    </div>
  );
}
