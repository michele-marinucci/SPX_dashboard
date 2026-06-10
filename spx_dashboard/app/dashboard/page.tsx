import { EquitiesApp } from "@/components/EquitiesApp";
import { seedCompanies } from "@/lib/equities/seed";

export const dynamic = "force-dynamic";

// Equities Dashboard — the team's Excel "Detailed Dashboard" Summary tab,
// online. The committed workbook parse is the first paint; the client swaps
// in the shared Supabase model and live Yahoo prices on mount.
export default function DashboardPage() {
  return <EquitiesApp initial={seedCompanies()} />;
}
