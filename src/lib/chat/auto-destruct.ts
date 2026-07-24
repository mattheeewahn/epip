/**
 * 자동삭제 엔진
 *
 * 모든 메시지에 자동삭제 타이머를 적용한다.
 * 타이머 만료 시 클라이언트 및 서버 양측에서 복구 불가능하게 삭제한다.
 * 대화방 나가기 시 즉시 전체 삭제한다.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import type { Message } from '@/types/message';

/** 자동삭제 타이머 옵션 (초 단위) */
export const AUTO_DESTRUCT_OPTIONS = [30, 60, 300, 1800, 3600] as const;

/** 기본 자동삭제 타이머: 5분 (300초) */
export const DEFAULT_AUTO_DESTRUCT_SECONDS = 300;

export type AutoDestructOption = (typeof AUTO_DESTRUCT_OPTIONS)[number];

/** 활성 타이머 레지스트리 */
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 삭제 콜백 타입 */
export type OnDestroyCallback = (messageId: string) => void;

/**
 * 메시지에 자동삭제 타이머를 설정한다.
 * 타이머 만료 시 onDestroy 콜백을 호출한다.
 */
export function scheduleAutoDestruct(
  message: Message,
  onDestroy: OnDestroyCallback
): void {
  // 이미 타이머가 있으면 기존 것 제거
  cancelAutoDestruct(message.id);

  const remainingMs = message.expiresAt - Date.now();

  if (remainingMs <= 0) {
    // 이미 만료됨 → 즉시 삭제
    onDestroy(message.id);
    return;
  }

  const timer = setTimeout(() => {
    activeTimers.delete(message.id);
    onDestroy(message.id);
  }, remainingMs);

  activeTimers.set(message.id, timer);
}

/**
 * 특정 메시지의 자동삭제 타이머를 취소한다.
 */
export function cancelAutoDestruct(messageId: string): void {
  const timer = activeTimers.get(messageId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(messageId);
  }
}

/**
 * 모든 활성 타이머를 취소한다.
 * 세션 종료 또는 패닉 삭제 시 사용한다.
 */
export function cancelAllTimers(): void {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}

/**
 * 대화방 나가기 시 모든 메시지를 즉시 삭제한다.
 * 활성 타이머도 모두 취소한다.
 *
 * @returns 삭제된 메시지 ID 목록
 */
export function destroyAllMessages(
  messages: Message[],
  onDestroy: OnDestroyCallback
): string[] {
  cancelAllTimers();
  const destroyedIds: string[] = [];
  for (const msg of messages) {
    onDestroy(msg.id);
    destroyedIds.push(msg.id);
  }
  return destroyedIds;
}

/**
 * 유효한 자동삭제 옵션인지 확인한다.
 */
export function isValidAutoDestructOption(seconds: number): seconds is AutoDestructOption {
  return (AUTO_DESTRUCT_OPTIONS as readonly number[]).includes(seconds);
}

/**
 * 메시지의 남은 수명(ms)을 반환한다.
 * 이미 만료된 경우 0을 반환한다.
 */
export function getRemainingLifetime(message: Message): number {
  const remaining = message.expiresAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * 현재 등록된 활성 타이머 수를 반환한다 (테스트 용도).
 */
export function getActiveTimerCount(): number {
  return activeTimers.size;
}
