import { CategoriesTableData } from "@/lib/data";

// The universe map: parent groups → categories → member tickers.
export function CategoriesTable({ data }: { data: CategoriesTableData }) {
  return (
    <div className="categories-grid">
      {data.groups.map((g) => (
        <section key={g.group} className="cat-group">
          <h3 className="cat-group-title">{g.group}</h3>
          <div className="cat-cards">
            {g.categories.map((c) => (
              <div key={c.category} className="cat-card">
                <div className="cat-card-head">
                  <span className="cat-name">{c.category}</span>
                  <span className="cat-count">{c.members.length}</span>
                </div>
                <ul className="cat-members">
                  {c.members.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
