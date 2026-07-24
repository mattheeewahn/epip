/**
 * 세션 관리 모듈
 *
 * - 30분 미활동 시 세션 종료 + 로컬 데이터 삭제
 * - 탭 닫기 시 세션 키/메시지 캐시 메모리 제거 (beforeunload)
 * - 세션 토큰 메모리 전용 저장 (쿠키 미사용)
 * - 이전 세션 데이터 접근 불가 보장
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

/** 세션 미활동 타임아웃: 30분 (ms) */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** 세션 데이터 (메모리 전용 - 쿠키 미사용) */
export interface SessionData {
  /** 세션 토큰 (메모리 전용) */
  token: string;
  /** 세션 시작 시각 */
  createdAt: number;
  /** 마지막 활동 시각 */
  lastActivity: number;
  /** 세션 활성 여부 */
  active: boolean;
}

/** 세션 종료 이유 */
export type SessionEndReason = 'inactivity' | 'tab_close' | 'manual' | 'auth_failure';

/** 세션 종료 콜백 */
export type OnSessionEndCallback = (reason: SessionEndReason) => void;

/** 미활동 타이머 */
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

/** 현재 세션 (메모리 전용) */
let currentSession: SessionData | null = null;

/** 세션 종료 콜백 */
let onSessionEnd: OnSessionEndCallback | null = null;

/**
 * 새 세션을 생성한다.
 * 세션 토큰은 메모리에만 저장한다 (쿠키 미사용).
 * 이전 세션 데이터는 접근 불가 상태가 된다.
 */
export function createSession(callback?: OnSessionEndCallback): SessionData {
  // 이전 세션 완전 파기
  destroySession('manual');

  const session: SessionData = {
    token: crypto.randomUUID(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    active: true,
  };

  currentSession = session;
  onSessionEnd = callback ?? null;

  // 미활동 타이머 시작
  resetInactivityTimer();

  return session;
}

/**
 * 사용자 활동을 기록하고 미활동 타이머를 리셋한다.
 */
export function recordActivity(): void {
  if (!currentSession || !currentSession.active) {
    return;
  }
  currentSession.lastActivity = Date.now();
  resetInactivityTimer();
}

/**
 * 현재 세션이 유효한지 확인한다.
 */
export function isSessionValid(): boolean {
  if (!currentSession || !currentSession.active) {
    return false;
  }
  const elapsed = Date.now() - currentSession.lastActivity;
  return elapsed < INACTIVITY_TIMEOUT_MS;
}

/**
 * 현재 세션 토큰을 반환한다.
 * 세션이 없거나 만료되었으면 null을 반환한다.
 */
export function getSessionToken(): string | null {
  if (!isSessionValid()) {
    return null;
  }
  return currentSession!.token;
}

/**
 * 세션을 파기한다.
 * 세션 키, 메시지 캐시, 토큰을 메모리에서 제거한다.
 */
export function destroySession(reason: SessionEndReason): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  if (currentSession && currentSession.active) {
    currentSession.active = false;
    currentSession.token = '';

    if (onSessionEnd) {
      onSessionEnd(reason);
    }
  }

  currentSession = null;
  onSessionEnd = null;
}

/**
 * beforeunload 이벤트 핸들러를 등록한다.
 * 탭 닫기 시 세션 키와 메시지 캐시를 즉시 메모리에서 제거한다.
 */
export function registerBeforeUnload(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('beforeunload', handleBeforeUnload);
}

/**
 * beforeunload 핸들러를 해제한다.
 */
export function unregisterBeforeUnload(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.removeEventListener('beforeunload', handleBeforeUnload);
}

/**
 * 미활동 타이머를 리셋한다.
 */
function resetInactivityTimer(): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  inactivityTimer = setTimeout(() => {
    destroySession('inactivity');
  }, INACTIVITY_TIMEOUT_MS);
}

/**
 * beforeunload 이벤트 핸들러.
 * 탭 닫기 시 세션 데이터를 즉시 파기한다.
 */
function handleBeforeUnload(): void {
  destroySession('tab_close');
}

/**
 * 현재 세션 데이터를 반환한다 (읽기 전용, 테스트 용도).
 */
export function getCurrentSession(): SessionData | null {
  return currentSession;
}
