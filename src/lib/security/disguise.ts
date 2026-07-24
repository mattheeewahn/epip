/**
 * 위장 모드 모듈 (Disguise Module)
 *
 * 기본 화면으로 실제 동작하는 계산기 UI를 표시하고,
 * 시크릿 코드(159*357=) 입력 시 메신저 모드로 전환한다.
 * 뒤로가기/홈 버튼 또는 3분 미활동 시 위장 화면으로 자동 복귀한다.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.6
 */

/** 모드 상태 */
export type DisguiseMode = 'disguise' | 'messenger';

/** 모드 변경 콜백 */
export type ModeChangeCallback = (mode: DisguiseMode) => void;

/** 시크릿 코드 */
const SECRET_CODE = '159*357=';

/** 자동 잠금 시간 (밀리초): 3분 */
const AUTO_LOCK_TIMEOUT_MS = 3 * 60 * 1000;

/** 현재 모드 */
let currentMode: DisguiseMode = 'disguise';

/** 계산기 입력 버퍼 */
let inputBuffer = '';

/** 자동 잠금 타이머 ID */
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

/** 마지막 활동 시각 */
let lastActivityTime = 0;

/** 모드 변경 리스너 */
const listeners: Set<ModeChangeCallback> = new Set();

/** popstate 리스너 등록 여부 */
let popstateRegistered = false;

/**
 * 모드 변경을 리스너에 알린다.
 */
function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(currentMode);
    } catch {
      // 리스너 오류 무시
    }
  }
}

/**
 * 현재 모드를 반환한다.
 */
export function getMode(): DisguiseMode {
  return currentMode;
}

/**
 * 시크릿 코드 검증 후 메신저 모드로 전환한다.
 *
 * 계산기에서 159*357= 을 입력하면 메신저 모드로 전환된다.
 * 전환 성공 시 자동 잠금 타이머를 시작한다.
 *
 * @param code - 입력된 코드 문자열
 * @returns 전환 성공 여부
 */
export function unlock(code: string): boolean {
  if (code === SECRET_CODE) {
    currentMode = 'messenger';
    inputBuffer = '';
    lastActivityTime = Date.now();
    startAutoLock();
    notifyListeners();
    return true;
  }
  return false;
}

/**
 * 메신저 모드에서 위장 모드로 복귀한다.
 *
 * 즉시 위장 화면(계산기)으로 전환되며 자동 잠금 타이머를 해제한다.
 */
export function lock(): void {
  if (currentMode === 'disguise') return;
  currentMode = 'disguise';
  inputBuffer = '';
  stopAutoLock();
  notifyListeners();
}

/**
 * 계산기 키 입력을 처리한다.
 *
 * 입력된 키를 버퍼에 축적하여 시크릿 코드와 매칭한다.
 * 매칭 성공 시 자동으로 메신저 모드로 전환된다.
 *
 * @param key - 입력된 키 ('0'-'9', '+', '-', '*', '/', '=', 'C')
 * @returns 시크릿 코드 매칭으로 인한 모드 전환 여부
 */
export function processCalculatorInput(key: string): boolean {
  if (key === 'C' || key === 'AC') {
    inputBuffer = '';
    return false;
  }

  inputBuffer += key;

  // 버퍼가 시크릿 코드보다 길어지면 앞부분 제거
  if (inputBuffer.length > SECRET_CODE.length) {
    inputBuffer = inputBuffer.slice(inputBuffer.length - SECRET_CODE.length);
  }

  // 시크릿 코드 매칭 확인
  if (inputBuffer === SECRET_CODE) {
    return unlock(inputBuffer);
  }

  return false;
}

/**
 * 계산기 연산을 수행한다.
 *
 * 실제 계산 기능을 제공하여 위장을 유지한다.
 *
 * @param expression - 수학 표현식 문자열
 * @returns 계산 결과 문자열
 */
export function calculate(expression: string): string {
  try {
    // 안전한 수학 표현식만 허용 (숫자, 연산자, 소수점, 괄호)
    const sanitized = expression.replace(/[^0-9+\-*/().]/g, '');
    if (!sanitized) return '0';

    // eval 대신 Function 사용으로 스코프 격리
    const result = new Function(`"use strict"; return (${sanitized})`)();

    if (typeof result !== 'number' || !isFinite(result)) {
      return 'Error';
    }

    return String(result);
  } catch {
    return 'Error';
  }
}

/**
 * 3분 미활동 자동 잠금 타이머를 시작한다.
 */
export function startAutoLock(): void {
  stopAutoLock();
  lastActivityTime = Date.now();

  autoLockTimer = setTimeout(() => {
    if (currentMode === 'messenger') {
      lock();
    }
  }, AUTO_LOCK_TIMEOUT_MS);
}

/**
 * 자동 잠금 타이머를 중지한다.
 */
function stopAutoLock(): void {
  if (autoLockTimer !== null) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

/**
 * 사용자 활동을 기록하고 자동 잠금 타이머를 리셋한다.
 *
 * 메신저 모드에서 사용자 활동이 감지될 때마다 호출하여
 * 3분 미활동 타이머를 재시작한다.
 */
export function recordActivity(): void {
  if (currentMode !== 'messenger') return;
  lastActivityTime = Date.now();
  startAutoLock();
}

/**
 * 마지막 활동 이후 경과 시간을 반환한다 (밀리초).
 */
export function getIdleTime(): number {
  if (lastActivityTime === 0) return 0;
  return Date.now() - lastActivityTime;
}

/**
 * 뒤로가기/홈 버튼 시 위장 복귀를 위한 브라우저 히스토리 리스너를 등록한다.
 */
export function registerPopstateHandler(): void {
  if (popstateRegistered) return;
  if (typeof window === 'undefined') return;

  window.addEventListener('popstate', handlePopstate);
  popstateRegistered = true;
}

/**
 * 브라우저 히스토리 리스너를 해제한다.
 */
export function unregisterPopstateHandler(): void {
  if (!popstateRegistered) return;
  if (typeof window === 'undefined') return;

  window.removeEventListener('popstate', handlePopstate);
  popstateRegistered = false;
}

/**
 * popstate 이벤트 핸들러: 메신저 모드에서 뒤로가기 시 위장 복귀
 */
function handlePopstate(): void {
  if (currentMode === 'messenger') {
    lock();
  }
}

/**
 * 모드 변경 리스너를 등록한다.
 *
 * @param callback - 모드 변경 시 호출할 함수
 * @returns 리스너 해제 함수
 */
export function onModeChange(callback: ModeChangeCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * 모듈 상태를 초기화한다 (테스트용).
 */
export function resetDisguise(): void {
  currentMode = 'disguise';
  inputBuffer = '';
  lastActivityTime = 0;
  stopAutoLock();
  listeners.clear();
  unregisterPopstateHandler();
}
