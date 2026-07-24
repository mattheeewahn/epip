export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { kv, KEY_PREFIX, TTL } from "@/lib/kv";

/**
 * Tor 접속 검증 API
 * - Tor 출구 노드 목록 확인
 * - 비Tor 접속 차단 및 경고 메시지 반환
 * - VPN 전용 접속 시 별도 경고
 * - 실제 IP 주소를 서버에 기록하지 않음
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6
 */

/** 알려진 VPN 서비스 IP 대역 (예시, 실제 운영 시 확장 필요) */
const KNOWN_VPN_RANGES = [
  "10.",
  "172.16.",
  "192.168.",
];

/** Tor 출구 노드 목록 조회 (1시간 캐시) */
async function getTorExitNodes(): Promise<string[]> {
  // KV 캐시에서 먼저 조회
  const cached = await kv.get<string[]>(KEY_PREFIX.TOR_NODES);
  if (cached) {
    return cached;
  }

  // 캐시 미스: Tor Project 공개 API에서 출구 노드 목록 가져오기
  try {
    const response = await fetch(
      "https://check.torproject.org/torbulkexitlist",
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      return [];
    }

    const text = await response.text();
    const nodes = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    // 1시간 TTL로 캐시
    await kv.set(KEY_PREFIX.TOR_NODES, nodes, { ex: TTL.TOR_EXIT_NODES });

    return nodes;
  } catch {
    return [];
  }
}

/** IP가 알려진 VPN 대역에 속하는지 확인 */
function isKnownVpnIp(ip: string): boolean {
  return KNOWN_VPN_RANGES.some((range) => ip.startsWith(range));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 클라이언트 IP 추출 (로그에 기록하지 않음 - Req 20.6)
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // IP 주소를 서버에 기록하지 않음 (no console.log, no persistence)

  if (clientIp === "unknown") {
    return NextResponse.json(
      {
        isTor: false,
        allowed: false,
        message: "접속 IP를 확인할 수 없습니다. Tor 브라우저를 사용하세요.",
      },
      { status: 403 }
    );
  }

  const torExitNodes = await getTorExitNodes();
  const isTorExit = torExitNodes.includes(clientIp);

  if (isTorExit) {
    return NextResponse.json({
      isTor: true,
      allowed: true,
      message: "Tor 네트워크 접속이 확인되었습니다.",
    });
  }

  // VPN 전용 접속 감지 (Req 20.4)
  if (isKnownVpnIp(clientIp)) {
    return NextResponse.json(
      {
        isTor: false,
        isVpn: true,
        allowed: false,
        message: "VPN만으로는 충분하지 않습니다. Tor를 사용하세요.",
      },
      { status: 403 }
    );
  }

  // 비Tor 접속 차단 (Req 20.2)
  return NextResponse.json(
    {
      isTor: false,
      allowed: false,
      message: "Tor 브라우저를 사용하세요. 일반 브라우저 접속은 허용되지 않습니다.",
    },
    { status: 403 }
  );
}
