/**
 * 메시지 CRUD 모듈
 *
 * 메시지 생성, 전송, 수신, 표시를 관리한다.
 * 메시지 상태: sending → sent → delivered → read
 * 타이핑 인디케이터는 프라이버시 보호를 위해 비표시.
 *
 * Requirements: 2.2, 6.6
 */

import type { Message, MessageStatus } from '@/types/message';

/**
 * 새 메시지를 생성한다.
 * 메시지 ID는 crypto.randomUUID()로 생성한다.
 */
export function createMessage(
  senderId: string,
  content: Uint8Array,
  autoDestructSeconds: number,
  replyTo?: string
): Message {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    senderId,
    content,
    timestamp: now,
    expiresAt: now + autoDestructSeconds * 1000,
    replyTo,
    status: 'sending',
  };
}

/**
 * 메시지 상태를 업데이트한다.
 * 상태 전이: sending → sent → delivered → read
 * 잘못된 전이 시도는 무시한다.
 */
export function updateMessageStatus(message: Message, newStatus: MessageStatus): Message {
  const order: MessageStatus[] = ['sending', 'sent', 'delivered', 'read'];
  const currentIndex = order.indexOf(message.status);
  const newIndex = order.indexOf(newStatus);

  // 역방향 전이 방지
  if (newIndex <= currentIndex) {
    return message;
  }

  return { ...message, status: newStatus };
}

/**
 * 수신 메시지를 생성한다.
 * 수신 즉시 delivered 상태로 설정한다.
 */
export function receiveMessage(
  id: string,
  senderId: string,
  content: Uint8Array,
  timestamp: number,
  autoDestructSeconds: number,
  replyTo?: string
): Message {
  return {
    id,
    senderId,
    content,
    timestamp,
    expiresAt: timestamp + autoDestructSeconds * 1000,
    replyTo,
    status: 'delivered',
  };
}

/**
 * 메시지가 만료되었는지 확인한다.
 */
export function isMessageExpired(message: Message): boolean {
  return Date.now() >= message.expiresAt;
}

/**
 * 메시지 목록에서 만료된 메시지를 필터링한다.
 */
export function filterExpiredMessages(messages: Message[]): Message[] {
  return messages.filter((msg) => !isMessageExpired(msg));
}

/**
 * 메시지 내용을 텍스트로 디코딩한다 (표시 용도).
 */
export function decodeContent(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

/**
 * 텍스트를 메시지 내용(Uint8Array)으로 인코딩한다.
 */
export function encodeContent(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
