import { NextResponse } from "next/server";
import { getPortfolioPositions } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const positions = await getPortfolioPositions();
  return NextResponse.json(positions);
}
