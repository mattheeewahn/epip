/**
 * 익명 인증 모듈
 *
 * UUID v4 기반 고유 식별자를 생성하며, 개인 식별 정보를 수집하지 않는다.
 * 일회용 패스프레이즈 기반 인증을 제공하고,
 * 5회 연속 실패 시 세션 종료 + 300초 재접속 차단을 수행한다.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

/** 최대 연속 실패 횟수 */
const MAX_CONSECUTIVE_FAILURES = 5;

/** 차단 시간 (ms) */
const BLOCK_DURATION_MS = 300_000; // 300초

/** 인증 상태 */
export interface AuthState {
  /** UUID v4 식별자 */
  userId: string;
  /** 연속 인증 실패 횟수 */
  consecutiveFailures: number;
  /** 인증 완료 여부 */
  authenticated: boolean;
  /** 차단 만료 시각 (ms), null이면 차단 아님 */
  blockedUntil: number | null;
}

/** 인증 결과 */
export interface AuthResult {
  success: boolean;
  error?: string;
  blocked?: boolean;
  blockRemainingMs?: number;
}

/**
 * 새 인증 상태를 생성한다.
 * UUID v4 기반 고유 식별자를 할당한다.
 * 개인 식별 정보(이메일, 전화번호 등)는 수집하지 않는다.
 */
export function createAuthState(): AuthState {
  return {
    userId: crypto.randomUUID(),
    consecutiveFailures: 0,
    authenticated: false,
    blockedUntil: null,
  };
}

/**
 * 현재 차단 상태인지 확인한다.
 */
export function isBlocked(state: AuthState): boolean {
  if (state.blockedUntil === null) {
    return false;
  }
  return Date.now() < state.blockedUntil;
}

/**
 * 일회용 패스프레이즈로 인증을 시도한다.
 *
 * - 차단 중이면 인증 거부
 * - 패스프레이즈가 일치하면 인증 성공, 실패 카운터 초기화
 * - 5회 연속 실패 시 세션 종료 + 300초 차단
 *
 * @param state - 현재 인증 상태
 * @param inputPassphrase - 사용자 입력 패스프레이즈
 * @param storedHash - 저장된 패스프레이즈 해시
 * @param verifyFn - 해시 비교 함수 (Argon2id 검증)
 */
export async function authenticate(
  state: AuthState,
  inputPassphrase: string,
  storedHash: string,
  verifyFn: (input: string, hash: string) => Promise<boolean>
): Promise<AuthResult> {
  // 차단 상태 확인
  if (isBlocked(state)) {
    const remainingMs = state.blockedUntil! - Date.now();
    return {
      success: false,
      error: '재접속이 차단되었습니다.',
      blocked: true,
      blockRemainingMs: remainingMs,
    };
  }

  // 패스프레이즈 검증
  const isValid = await verifyFn(inputPassphrase, storedHash);

  if (isValid) {
    state.consecutiveFailures = 0;
    state.authenticated = true;
    return { success: true };
  }

  // 실패 처리
  state.consecutiveFailures += 1;

  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    // 5회 연속 실패: 세션 종료 + 300초 차단
    state.authenticated = false;
    state.blockedUntil = Date.now() + BLOCK_DURATION_MS;
    return {
      success: false,
      error: '5회 연속 실패로 세션이 종료되었습니다. 300초 후 재접속 가능합니다.',
      blocked: true,
      blockRemainingMs: BLOCK_DURATION_MS,
    };
  }

  return {
    success: false,
    error: `인증 실패 (${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
  };
}

/**
 * 인증 상태를 초기화한다 (세션 종료 시).
 */
export function resetAuth(state: AuthState): void {
  state.consecutiveFailures = 0;
  state.authenticated = false;
}

/**
 * 차단 남은 시간(ms)을 반환한다.
 */
export function getBlockRemainingMs(state: AuthState): number {
  if (state.blockedUntil === null) {
    return 0;
  }
  const remaining = state.blockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}
