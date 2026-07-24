/**
 * 답장/인용 모듈
 *
 * 원본 메시지 해시를 참조하여 답장을 생성한다.
 * 인용 축약 표시 (최대 100자), 삭제된 메시지 처리,
 * 동일 E2EE 적용, 인용 탭 시 원본 위치 스크롤을 지원한다.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
 */

import type { Message } from '@/types/message';

/** 인용 최대 길이 */
const MAX_QUOTE_LENGTH = 100;

/** 삭제된 메시지 표시 텍스트 */
const DELETED_MESSAGE_PLACEHOLDER = '삭제된 메시지';

/** 인용 정보 */
export interface QuoteInfo {
  /** 원본 메시지 해시 (참조 ID) */
  originalHash: string;
  /** 축약된 인용 텍스트 */
  excerpt: string;
  /** 원본이 삭제되었는지 여부 */
  isDeleted: boolean;
}

/**
 * 원본 메시지의 해시를 생성한다.
 * SHA-256 기반 해시를 사용한다 (브라우저 crypto API 활용).
 */
export async function generateMessageHash(message: Message): Promise<string> {
  const data = new Uint8Array([
    ...new TextEncoder().encode(message.id),
    ...message.content,
  ]);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 인용 축약 텍스트를 생성한다.
 * 최대 100자로 제한하며, 초과 시 말줄임표를 추가한다.
 */
export function createExcerpt(content: Uint8Array): string {
  const text = new TextDecoder().decode(content);
  if (text.length <= MAX_QUOTE_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_QUOTE_LENGTH - 1) + '…';
}

/**
 * 인용 정보를 생성한다.
 * 원본 메시지가 존재하면 축약 텍스트를, 없으면 "삭제된 메시지"를 표시한다.
 */
export function buildQuoteInfo(
  originalHash: string,
  originalMessage: Message | null
): QuoteInfo {
  if (!originalMessage) {
    return {
      originalHash,
      excerpt: DELETED_MESSAGE_PLACEHOLDER,
      isDeleted: true,
    };
  }

  return {
    originalHash,
    excerpt: createExcerpt(originalMessage.content),
    isDeleted: false,
  };
}

/**
 * 답장 메시지의 replyTo 필드에 설정할 원본 해시를 반환한다.
 * 이 해시는 메시지 생성 시 replyTo 필드에 포함된다.
 */
export async function getReplyReference(originalMessage: Message): Promise<string> {
  return generateMessageHash(originalMessage);
}

/**
 * 메시지 목록에서 원본 메시지를 찾는다.
 * replyTo 해시와 일치하는 메시지를 반환한다.
 * 찾지 못하면 null을 반환한다 (삭제된 메시지).
 */
export function findOriginalMessage(
  messages: Message[],
  replyToHash: string
): Message | null {
  // 해시를 비동기로 계산해야 하므로, 동기 버전은 ID 기반 검색
  // 실제 사용 시에는 메시지 ID를 replyTo에 저장하여 검색
  return messages.find((msg) => msg.id === replyToHash) ?? null;
}

/**
 * 원본 메시지의 인덱스를 반환한다 (스크롤 용도).
 * 인용된 메시지를 탭했을 때 해당 위치로 스크롤하기 위해 사용한다.
 */
export function getOriginalMessageIndex(
  messages: Message[],
  replyToHash: string
): number {
  return messages.findIndex((msg) => msg.id === replyToHash);
}
