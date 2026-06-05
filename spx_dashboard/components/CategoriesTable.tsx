import Link from "next/link";
import { CategoriesTableData } from "@/lib/data";

// The universe map: parent groups → categories. Each category links through to
// its own page with the per-stock breakdown.
export function CategoriesTable({ data }: { data: CategoriesTableData }) {
  return (
    <div className="categories-grid">
      {data.groups.map((g) => (
        <section key={g.group} className="cat-group">
          <h3 className="cat-group-title">{g.group}</h3>
          <div className="cat-cards">
            {g.categories.map((c) => {
              const clickable = (c.stocks?.length ?? 0) > 0;
              const inner = (
                <>
                  <div className="cat-card-head">
                    <span className="cat-name">{c.category}</span>
                    <span className="cat-count">{c.members.length}</span>
                  </div>
                  {clickable && (
                    <span className="cat-cta">View stocks →</span>
                  )}
                </>
              );
              return clickable ? (
                <Link
                  key={c.category}
                  href={`/category/${c.slug}`}
                  className="cat-card cat-card-link"
                >
                  {inner}
                </Link>
              ) : (
                <div key={c.category} className="cat-card">
                  {inner}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
