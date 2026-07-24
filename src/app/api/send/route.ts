export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { enqueueMessage } from "@/lib/kv";
import type { QueuedMessage } from "@/types/server";

/**
 * 메시지 전송 API
 * - POST 요청으로 암호화된 메시지 수신
 * - Vercel KV에 TTL 5분으로 저장
 * - 발신자/수신자 연결 정보를 로그에 기록하지 않음
 *
 * Requirements: 7.2, 7.3, 4.1, 4.2
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    const { recipientId, payload, paddedSize } = body;

    if (!recipientId || !payload || typeof paddedSize !== "number") {
      return NextResponse.json(
        { error: "Missing required fields: recipientId, payload, paddedSize" },
        { status: 400 }
      );
    }

    const message: QueuedMessage = {
      id: crypto.randomUUID(),
      recipientId,
      payload,
      paddedSize,
      createdAt: Date.now(),
      ttl: 300,
    };

    await enqueueMessage(message);

    // 발신자/수신자 연결 정보를 로그에 기록하지 않음 (Req 4.2)
    return NextResponse.json(
      { success: true, messageId: message.id },
      { status: 202 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
