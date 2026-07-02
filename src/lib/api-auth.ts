import { NextResponse, type NextRequest } from "next/server";

export function assertApiWriteAccess(request: NextRequest): NextResponse | null {
  const configured = process.env.API_WRITE_TOKEN || process.env.API_READ_TOKEN;
  if (!configured) return null;

  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token === configured) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function readApiHeaders(): HeadersInit {
  const token = process.env.API_READ_TOKEN || process.env.API_WRITE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
