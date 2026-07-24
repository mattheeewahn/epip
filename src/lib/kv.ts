/**
 * Vercel KV 클라이언트 설정
 * 
 * TTL 기반 임시 저장소로만 사용 (영구 저장 없음)
 * - 메시지 큐: TTL 5분 (300초)
 * - 키 교환 요청: TTL 60초
 * - Tor 출구 노드 캐시: TTL 1시간 (3600초)
 * 
 * Requirements: 7.2, 7.3
 */

import { kv } from '@vercel/kv';
import type { QueuedMessage, HandshakeRequest } from '@/types/server';

/** 기본 TTL 값 (초) */
export const TTL = {
  /** 메시지 큐 TTL: 5분 */
  MESSAGE: 300,
  /** 키 교환 요청 TTL: 60초 */
  HANDSHAKE: 60,
  /** Tor 출구 노드 캐시 TTL: 1시간 */
  TOR_EXIT_NODES: 3600,
} as const;

/** KV 키 프리픽스 */
export const KEY_PREFIX = {
  /** 메시지 큐: msg:{recipientId}:{messageId} */
  MESSAGE: 'msg',
  /** 키 교환: hs:{toId}:{fromId} */
  HANDSHAKE: 'hs',
  /** Tor 출구 노드 캐시 */
  TOR_NODES: 'tor:exit-nodes',
} as const;

/**
 * 메시지를 KV에 저장 (TTL 5분)
 * 서버는 암호문만 보관하며, 복호화 키에 접근 불가
 */
export async function enqueueMessage(message: QueuedMessage): Promise<void> {
  const key = `${KEY_PREFIX.MESSAGE}:${message.recipientId}:${message.id}`;
  await kv.set(key, JSON.stringify(message), { ex: TTL.MESSAGE });
}

/**
 * 수신자의 대기 메시지 조회 및 삭제
 * 조회 후 즉시 삭제하여 서버 체류 시간 최소화
 */
export async function dequeueMessages(recipientId: string): Promise<QueuedMessage[]> {
  const pattern = `${KEY_PREFIX.MESSAGE}:${recipientId}:*`;
  const keys = await kv.keys(pattern);

  if (keys.length === 0) {
    return [];
  }

  const messages: QueuedMessage[] = [];

  for (const key of keys) {
    const raw = await kv.get<string>(key);
    if (raw) {
      try {
        const message: QueuedMessage = typeof raw === 'string' ? JSON.parse(raw) : raw;
        messages.push(message);
      } catch {
        // 파싱 실패 시 무시 (손상된 데이터)
      }
      // 조회 후 즉시 삭제
      await kv.del(key);
    }
  }

  return messages;
}

/**
 * 키 교환 요청 저장 (TTL 60초)
 */
export async function storeHandshake(request: HandshakeRequest): Promise<void> {
  const key = `${KEY_PREFIX.HANDSHAKE}:${request.toId}:${request.fromId}`;
  await kv.set(key, JSON.stringify(request), { ex: TTL.HANDSHAKE });
}

/**
 * 키 교환 요청 조회 및 삭제
 */
export async function retrieveHandshake(toId: string, fromId: string): Promise<HandshakeRequest | null> {
  const key = `${KEY_PREFIX.HANDSHAKE}:${toId}:${fromId}`;
  const raw = await kv.get<string>(key);

  if (!raw) {
    return null;
  }

  // 조회 후 즉시 삭제 (일회용)
  await kv.del(key);

  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * 특정 수신자의 모든 대기 메시지 삭제
 * 대화방 나가기, 패닉 삭제 등에 사용
 */
export async function purgeMessages(recipientId: string): Promise<void> {
  const pattern = `${KEY_PREFIX.MESSAGE}:${recipientId}:*`;
  const keys = await kv.keys(pattern);

  if (keys.length > 0) {
    await Promise.all(keys.map((key) => kv.del(key)));
  }
}

/** Vercel KV 클라이언트 re-export */
export { kv };
