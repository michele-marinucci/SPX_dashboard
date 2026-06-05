export function Commentary({ bullets }: { bullets: string[] }) {
  if (!bullets.length) return null;
  return (
    <ul className="commentary">
      {bullets.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  );
}
