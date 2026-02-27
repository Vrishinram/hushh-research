import { NextRequest, NextResponse } from "next/server";

import { getPythonApiUrl } from "@/app/api/_utils/backend";
import { validateFirebaseToken } from "@/lib/auth/validate";
import { isDevelopment } from "@/lib/config";

export const dynamic = "force-dynamic";

const PYTHON_API_URL = getPythonApiUrl();

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { userId?: string };
    const authHeader = request.headers.get("Authorization");

    if (!authHeader && !isDevelopment()) {
      return NextResponse.json(
        { error: "Authorization required", code: "AUTH_REQUIRED" },
        { status: 401 }
      );
    }

    if (authHeader) {
      const validation = await validateFirebaseToken(authHeader);
      if (!validation.valid && !isDevelopment()) {
        return NextResponse.json(
          { error: `Authentication failed: ${validation.error}`, code: "AUTH_INVALID" },
          { status: 401 }
        );
      }
    }

    const response = await fetch(`${PYTHON_API_URL}/db/vault/bootstrap-state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        ...(body.userId ? { userId: body.userId } : {}),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error || payload?.detail || "Backend error" },
        { status: response.status }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[API] Vault bootstrap-state error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
