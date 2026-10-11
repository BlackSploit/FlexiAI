import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness for the container HEALTHCHECK and Dokploy. No dependencies, no secrets. */
export function GET() {
  return NextResponse.json({ ok: true });
}
