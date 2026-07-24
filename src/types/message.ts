/**
 * 메시지 관련 인터페이스
 * Requirements: 2.1, 2.2
 */

/** 메시지 전송 상태 */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

/** 개별 메시지 */
export interface Message {
  id: string;
  senderId: string;
  /** 복호화된 평문 (메모리 전용) */
  content: Uint8Array;
  timestamp: number;
  /** 자동삭제 시각 */
  expiresAt: number;
  /** 답장 대상 메시지 해시 */
  replyTo?: string;
  status: MessageStatus;
}
