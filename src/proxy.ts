import { NextResponse, type NextRequest } from "next/server";

const AUTH_HEADER = 'Basic realm="Walkman Restoration Scout", charset="UTF-8"';

export function proxy(request: NextRequest) {
  const expectedUser = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  if (!expectedUser || !expectedPassword) return NextResponse.next();

  const authorization = request.headers.get("authorization") || "";
  const [scheme, encoded] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() === "basic" && encoded) {
    const credentials = decodeBasicAuth(encoded);
    const separatorIndex = credentials.indexOf(":");
    const user = separatorIndex >= 0 ? credentials.slice(0, separatorIndex) : "";
    const password = separatorIndex >= 0 ? credentials.slice(separatorIndex + 1) : "";

    if (user === expectedUser && password === expectedPassword) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": AUTH_HEADER
    }
  });
}

function decodeBasicAuth(value: string): string {
  try {
    return atob(value);
  } catch {
    return "";
  }
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)"]
};
