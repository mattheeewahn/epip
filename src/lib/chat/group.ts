/**
 * 그룹 채팅 모듈
 *
 * 최대 50명 참여 가능한 그룹 채팅방을 관리한다.
 * 신규 참여자는 이전 메시지에 접근할 수 없다.
 * 50명 초과 시 참여 요청을 거부한다.
 *
 * Requirements: 16.1, 16.3, 16.6
 */

import type { GroupChat, GroupMember } from '@/types/group';
import type { Message } from '@/types/message';

/** 그룹 최대 인원 */
export const MAX_GROUP_MEMBERS = 50;

/** 그룹 생성 결과 */
export interface CreateGroupResult {
  success: boolean;
  group?: GroupChat;
  error?: string;
}

/** 멤버 추가 결과 */
export interface AddMemberResult {
  success: boolean;
  error?: string;
}

/**
 * 새 그룹 채팅방을 생성한다.
 * 생성자를 첫 번째 멤버로 추가한다.
 */
export function createGroup(creatorId: string, creatorSenderKey: Uint8Array): CreateGroupResult {
  const member: GroupMember = {
    id: creatorId,
    senderKey: creatorSenderKey,
    joinedAt: Date.now(),
  };

  const group: GroupChat = {
    id: crypto.randomUUID(),
    members: [member],
    senderKeys: new Map([[creatorId, creatorSenderKey]]),
    messages: [],
    maxMembers: 50,
  };

  return { success: true, group };
}

/**
 * 그룹에 새 멤버를 추가한다.
 * 50명 초과 시 거부한다.
 * 신규 참여자는 참여 시점 이전 메시지에 접근할 수 없다.
 */
export function addMember(
  group: GroupChat,
  memberId: string,
  senderKey: Uint8Array
): AddMemberResult {
  if (group.members.length >= MAX_GROUP_MEMBERS) {
    return {
      success: false,
      error: `그룹 인원 제한(${MAX_GROUP_MEMBERS}명)을 초과할 수 없습니다.`,
    };
  }

  // 이미 멤버인지 확인
  if (group.members.some((m) => m.id === memberId)) {
    return { success: false, error: '이미 그룹에 참여한 멤버입니다.' };
  }

  const newMember: GroupMember = {
    id: memberId,
    senderKey,
    joinedAt: Date.now(),
  };

  group.members.push(newMember);
  group.senderKeys.set(memberId, senderKey);

  return { success: true };
}

/**
 * 그룹에서 멤버를 제거한다.
 * 퇴장한 멤버의 Sender Key를 폐기한다.
 */
export function removeMember(group: GroupChat, memberId: string): boolean {
  const index = group.members.findIndex((m) => m.id === memberId);
  if (index === -1) {
    return false;
  }

  group.members.splice(index, 1);
  group.senderKeys.delete(memberId);
  return true;
}

/**
 * 멤버에게 표시할 메시지를 필터링한다.
 * 멤버 참여 시점 이후의 메시지만 반환한다.
 */
export function getVisibleMessages(group: GroupChat, memberId: string): Message[] {
  const member = group.members.find((m) => m.id === memberId);
  if (!member) {
    return [];
  }

  return group.messages.filter((msg) => msg.timestamp >= member.joinedAt);
}

/**
 * 그룹에 메시지를 추가한다.
 */
export function addMessage(group: GroupChat, message: Message): void {
  group.messages.push(message);
}

/**
 * 그룹의 현재 멤버 수를 반환한다.
 */
export function getMemberCount(group: GroupChat): number {
  return group.members.length;
}

/**
 * 그룹이 가득 찼는지 확인한다.
 */
export function isGroupFull(group: GroupChat): boolean {
  return group.members.length >= MAX_GROUP_MEMBERS;
}
