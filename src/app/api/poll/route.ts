export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { dequeueMessages } from "@/lib/kv";

/**
 * 메시지 수신 API - 롱폴링
 * - GET 요청, 최대 25초 대기
 * - Vercel KV에서 대기 메시지 조회 후 반환
 * - Edge Runtime, 콜드 스타트 3초 이내
 *
 * Requirements: 5.2, 7.2, 7.4
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const recipientId = searchParams.get("recipientId");

  if (!recipientId) {
    return NextResponse.json(
      { error: "Missing required parameter: recipientId" },
      { status: 400 }
    );
  }

  const maxWaitSeconds = 25;
  const pollIntervalMs = 1000;
  const startTime = Date.now();

  // 롱폴링: 메시지가 도착할 때까지 최대 25초 대기
  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    const messages = await dequeueMessages(recipientId);

    if (messages.length > 0) {
      return NextResponse.json({
        messages,
        hasMore: false,
      });
    }

    // 1초 대기 후 재시도
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // 타임아웃: 빈 응답 반환
  return NextResponse.json({
    messages: [],
    hasMore: false,
  });
}
