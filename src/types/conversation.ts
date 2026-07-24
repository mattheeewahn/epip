/**
 * 대화 관련 인터페이스
 * Requirements: 2.1, 2.2
 */

import type { RatchetState } from './crypto';
import type { Message } from './message';

/** 1:1 대화 */
export interface Conversation {
  peerId: string;
  ratchetState: RatchetState;
  messages: Message[];
  /** 자동삭제 타이머 (초 단위) */
  autoDestructTimer: number;
  /** 키 검증 완료 여부 */
  verified: boolean;
  /** 60자리 안전번호 */
  safetyNumber: string;
  readReceiptEnabled: boolean;
}
