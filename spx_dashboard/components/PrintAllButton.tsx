import Link from "next/link";

// "Print all" opens the combined print view (/print), which stacks every live
// tool into one document and fires a single print dialog covering all of them.
export function PrintAllButton() {
  return (
    <Link href="/print" className="print-all-btn">
      Print all
    </Link>
  );
}
