export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { storeHandshake, retrieveHandshake } from "@/lib/kv";
import type { HandshakeRequest } from "@/types/server";

/**
 * 키 교환 API
 * - X25519 공개 키 교환 중계
 * - TTL 60초 임시 저장
 *
 * Requirements: 2.1
 */

/** POST: 키 교환 요청 저장 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    const { fromId, toId, ephemeralPublicKey, identityPublicKey, preKeyId } = body;

    if (!fromId || !toId || !ephemeralPublicKey || !identityPublicKey || typeof preKeyId !== "number") {
      return NextResponse.json(
        { error: "Missing required fields: fromId, toId, ephemeralPublicKey, identityPublicKey, preKeyId" },
        { status: 400 }
      );
    }

    const handshake: HandshakeRequest = {
      fromId,
      toId,
      ephemeralPublicKey,
      identityPublicKey,
      preKeyId,
      ttl: 60,
    };

    await storeHandshake(handshake);

    return NextResponse.json(
      { success: true },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}

/** GET: 대기 중인 키 교환 요청 조회 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const toId = searchParams.get("toId");
  const fromId = searchParams.get("fromId");

  if (!toId || !fromId) {
    return NextResponse.json(
      { error: "Missing required parameters: toId, fromId" },
      { status: 400 }
    );
  }

  const handshake = await retrieveHandshake(toId, fromId);

  if (!handshake) {
    return NextResponse.json(
      { handshake: null },
      { status: 204 }
    );
  }

  return NextResponse.json({ handshake });
}
