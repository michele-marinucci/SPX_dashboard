import Link from "next/link";

// Placeholder shown for tools that are announced on the landing page but not
// built yet (Equities Dashboard, Diligence Tracker). Renders inside the same
// `.solo` wrapper the X Themes view uses, so it matches the rest of the app.
export function WorkInProgress({ title }: { title: string }) {
  return (
    <div className="solo">
      <Link href="/" className="back-link">
        ← All views
      </Link>

      <div className="solo-header">
        <div className="solo-title">
          <h1>{title}</h1>
        </div>
      </div>

      <div className="wip">
        <div className="wip-icon" aria-hidden="true">
          🚧
        </div>
        <div className="wip-title">Work in progress</div>
        <p className="wip-note">This view isn’t ready yet — check back soon.</p>
      </div>
    </div>
  );
}
