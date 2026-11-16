import { NextResponse } from "next/server";
import { merchantKeyCount } from "@/lib/data";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) return NextResponse.json({ count: 0 });
  return NextResponse.json({ count: merchantKeyCount(key) });
}
