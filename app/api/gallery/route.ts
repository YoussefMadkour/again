import { NextResponse } from "next/server";
import { galleryCards } from "@/lib/gallery";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The home carousel's memories, fetched again when you come back home. */
export async function GET() {
  const cards = await galleryCards(getStore()).catch(() => []);
  return NextResponse.json({ cards }, { headers: { "Cache-Control": "no-store" } });
}
