/**
 * 사용자 세션 인터페이스
 * Requirements: 2.1, 7.1
 */

import type { KeyPair } from './crypto';
import type { Conversation } from './conversation';

/** 현재 사용자 세션 (메모리 전용) */
export interface UserSession {
  /** UUID v4 */
  id: string;
  /** 장기 ID 키 */
  identityKeyPair: KeyPair;
  /** 일회용 프리키 */
  preKeys: KeyPair[];
  activeConversations: Map<string, Conversation>;
  createdAt: number;
  lastActivity: number;
}
