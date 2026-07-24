/**
 * 그룹 채팅 관련 인터페이스
 * Requirements: 2.1, 2.2
 */

import type { Message } from './message';

/** 그룹 멤버 */
export interface GroupMember {
  id: string;
  senderKey: Uint8Array;
  joinedAt: number;
}

/** 그룹 채팅 */
export interface GroupChat {
  id: string;
  members: GroupMember[];
  /** memberId → sender key */
  senderKeys: Map<string, Uint8Array>;
  messages: Message[];
  maxMembers: 50;
}
