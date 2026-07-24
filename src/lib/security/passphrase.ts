/**
 * 패스프레이즈 가드 모듈 (Passphrase Guard)
 *
 * 2단계 패스프레이즈 인증:
 * - Level 1: 앱 전체 접근 패스프레이즈 (Argon2id 검증)
 * - Level 2: 대화방 전용 패스프레이즈
 *
 * 실패 시 보안 정책:
 * - Level 1: 3회 실패 → 패닉 삭제 실행
 * - Level 2: 5회 실패 → 대화방 영구 잠금
 *
 * 패스프레이즈는 절대 평문 저장하지 않으며, 검증 후 즉시 메모리에서 제거한다.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 */

import { hashPassphrase, verifyPassphrase, clearFromMemory } from '@/lib/crypto/argon2';
import { execute as executePanic } from '@/lib/security/panic';

/** 패스프레이즈 레벨 */
export type PassphraseLevel = 'app' | 'room';

/** 앱 패스프레이즈 저장 정보 (해시+솔트만 저장) */
export interface StoredPassphrase {
  hash: string;
  salt: string;
}

/** 대화방 패스프레이즈 상태 */
export interface RoomPassphraseState {
  stored: StoredPassphrase;
  failCount: number;
  locked: boolean;
}

/** 패스프레이즈 검증 결과 */
export interface VerifyResult {
  success: boolean;
  remainingAttempts: number;
  locked: boolean;
  panicTriggered: boolean;
}

/** Level 1 최대 실패 횟수 */
const MAX_APP_FAILURES = 3;

/** Level 2 최대 실패 횟수 */
const MAX_ROOM_FAILURES = 5;

/** 앱 패스프레이즈 해시 정보 */
let appPassphrase: StoredPassphrase | null = null;

/** 앱 패스프레이즈 실패 카운트 */
let appFailCount = 0;

/** 대화방별 패스프레이즈 상태 */
const roomPassphrases: Map<string, RoomPassphraseState> = new Map();

/**
 * 앱 패스프레이즈를 설정한다.
 *
 * Argon2id로 해싱하여 저장한다. 평문은 저장하지 않는다.
 *
 * @param passphrase - 설정할 패스프레이즈
 */
export async function setAppPassphrase(passphrase: string): Promise<void> {
  const result = await hashPassphrase(passphrase);
  appPassphrase = {
    hash: result.hash,
    salt: result.salt,
  };
  appFailCount = 0;

  // 패스프레이즈 평문을 메모리에서 제거
  clearFromMemory(passphrase);
}

/**
 * 앱 패스프레이즈를 검증한다 (Level 1).
 *
 * 3회 실패 시 패닉 삭제를 자동 실행한다.
 *
 * @param passphrase - 검증할 패스프레이즈
 * @returns 검증 결과
 */
export async function verifyAppPassphrase(passphrase: string): Promise<VerifyResult> {
  if (!appPassphrase) {
    return {
      success: false,
      remainingAttempts: 0,
      locked: true,
      panicTriggered: false,
    };
  }

  const isValid = await verifyPassphrase(passphrase, appPassphrase.hash, appPassphrase.salt);

  if (isValid) {
    appFailCount = 0;
    return {
      success: true,
      remainingAttempts: MAX_APP_FAILURES,
      locked: false,
      panicTriggered: false,
    };
  }

  // 실패
  appFailCount++;

  if (appFailCount >= MAX_APP_FAILURES) {
    // 3회 실패: 패닉 삭제 실행
    await executePanic();
    return {
      success: false,
      remainingAttempts: 0,
      locked: true,
      panicTriggered: true,
    };
  }

  return {
    success: false,
    remainingAttempts: MAX_APP_FAILURES - appFailCount,
    locked: false,
    panicTriggered: false,
  };
}

/**
 * 대화방 패스프레이즈를 설정한다 (Level 2).
 *
 * @param roomId - 대화방 식별자
 * @param passphrase - 설정할 패스프레이즈
 */
export async function setRoomPassphrase(roomId: string, passphrase: string): Promise<void> {
  const result = await hashPassphrase(passphrase);

  roomPassphrases.set(roomId, {
    stored: {
      hash: result.hash,
      salt: result.salt,
    },
    failCount: 0,
    locked: false,
  });

  // 패스프레이즈 평문을 메모리에서 제거
  clearFromMemory(passphrase);
}

/**
 * 대화방 패스프레이즈를 검증한다 (Level 2).
 *
 * 5회 실패 시 대화방을 영구 잠금한다.
 *
 * @param roomId - 대화방 식별자
 * @param passphrase - 검증할 패스프레이즈
 * @returns 검증 결과
 */
export async function verifyRoomPassphrase(
  roomId: string,
  passphrase: string
): Promise<VerifyResult> {
  const roomState = roomPassphrases.get(roomId);

  if (!roomState) {
    return {
      success: false,
      remainingAttempts: 0,
      locked: false,
      panicTriggered: false,
    };
  }

  // 이미 잠긴 대화방
  if (roomState.locked) {
    return {
      success: false,
      remainingAttempts: 0,
      locked: true,
      panicTriggered: false,
    };
  }

  const isValid = await verifyPassphrase(
    passphrase,
    roomState.stored.hash,
    roomState.stored.salt
  );

  if (isValid) {
    roomState.failCount = 0;
    return {
      success: true,
      remainingAttempts: MAX_ROOM_FAILURES,
      locked: false,
      panicTriggered: false,
    };
  }

  // 실패
  roomState.failCount++;

  if (roomState.failCount >= MAX_ROOM_FAILURES) {
    // 5회 실패: 대화방 영구 잠금
    roomState.locked = true;
    return {
      success: false,
      remainingAttempts: 0,
      locked: true,
      panicTriggered: false,
    };
  }

  return {
    success: false,
    remainingAttempts: MAX_ROOM_FAILURES - roomState.failCount,
    locked: false,
    panicTriggered: false,
  };
}

/**
 * 앱 패스프레이즈가 설정되어 있는지 확인한다.
 */
export function isAppPassphraseSet(): boolean {
  return appPassphrase !== null;
}

/**
 * 대화방 패스프레이즈가 설정되어 있는지 확인한다.
 *
 * @param roomId - 대화방 식별자
 */
export function isRoomPassphraseSet(roomId: string): boolean {
  return roomPassphrases.has(roomId);
}

/**
 * 대화방이 잠겨 있는지 확인한다.
 *
 * @param roomId - 대화방 식별자
 */
export function isRoomLocked(roomId: string): boolean {
  const state = roomPassphrases.get(roomId);
  return state?.locked ?? false;
}

/**
 * 앱 패스프레이즈 남은 시도 횟수를 반환한다.
 */
export function getAppRemainingAttempts(): number {
  return MAX_APP_FAILURES - appFailCount;
}

/**
 * 대화방 패스프레이즈 남은 시도 횟수를 반환한다.
 *
 * @param roomId - 대화방 식별자
 */
export function getRoomRemainingAttempts(roomId: string): number {
  const state = roomPassphrases.get(roomId);
  if (!state) return 0;
  if (state.locked) return 0;
  return MAX_ROOM_FAILURES - state.failCount;
}

/**
 * 모듈 상태를 초기화한다 (테스트용).
 */
export function resetPassphraseGuard(): void {
  appPassphrase = null;
  appFailCount = 0;
  roomPassphrases.clear();
}
