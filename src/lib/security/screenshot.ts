/**
 * 스크린샷 감지 모듈 (Screenshot Detection)
 *
 * 스크린샷 시도를 감지하고 상대방에게 알린다:
 * - PrintScreen/캡처 단축키 감지 → 5초 이내 상대방 알림
 * - CSS 보호 오버레이 적용 (user-select: none, -webkit-user-drag: none)
 * - 투명 워터마크 삽입 (수신자 ID)
 * - getDisplayMedia 감지 시 콘텐츠 블러 처리 + 경고
 * - 동일 세션 3회 이상 감지 시 전체 메시지 삭제 + 보안 위반 통보
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */

/** 스크린샷 감지 이벤트 타입 */
export type DetectionType = 'printscreen' | 'shortcut' | 'displaymedia';

/** 스크린샷 감지 이벤트 */
export interface ScreenshotEvent {
  type: DetectionType;
  timestamp: number;
  sessionDetectionCount: number;
}

/** 감지 이벤트 콜백 */
export type DetectionCallback = (event: ScreenshotEvent) => void;

/** 보안 위반 콜백 (3회 이상 감지 시) */
export type ViolationCallback = (totalDetections: number) => void;

/** 보안 위반 임계값 */
const VIOLATION_THRESHOLD = 3;

/** 알림 시간 제한 (밀리초) */
const NOTIFICATION_TIMEOUT_MS = 5_000;

/** 세션 내 감지 횟수 */
let detectionCount = 0;

/** 감지 이벤트 리스너 */
const detectionListeners: Set<DetectionCallback> = new Set();

/** 보안 위반 리스너 */
const violationListeners: Set<ViolationCallback> = new Set();

/** 키보드 리스너 등록 여부 */
let keyboardListenerActive = false;

/** displayMedia 모니터링 활성 여부 */
let displayMediaMonitorActive = false;

/**
 * 감지 이벤트를 처리한다.
 *
 * @param type - 감지 유형
 */
function handleDetection(type: DetectionType): void {
  detectionCount++;

  const event: ScreenshotEvent = {
    type,
    timestamp: Date.now(),
    sessionDetectionCount: detectionCount,
  };

  // 감지 이벤트 리스너 알림
  for (const listener of detectionListeners) {
    try {
      listener(event);
    } catch {
      // 리스너 오류 무시
    }
  }

  // 3회 이상 감지 시 보안 위반 통보
  if (detectionCount >= VIOLATION_THRESHOLD) {
    for (const listener of violationListeners) {
      try {
        listener(detectionCount);
      } catch {
        // 리스너 오류 무시
      }
    }
  }
}

/**
 * 키보드 이벤트에서 스크린샷 관련 단축키를 감지한다.
 */
function handleKeydown(event: KeyboardEvent): void {
  // PrintScreen 키
  if (event.key === 'PrintScreen') {
    event.preventDefault();
    handleDetection('printscreen');
    return;
  }

  // Windows: Win+Shift+S (Snipping Tool)
  if (event.key === 'S' && event.shiftKey && event.metaKey) {
    handleDetection('shortcut');
    return;
  }

  // macOS: Cmd+Shift+3 또는 Cmd+Shift+4
  if (event.metaKey && event.shiftKey && (event.key === '3' || event.key === '4')) {
    handleDetection('shortcut');
    return;
  }

  // macOS: Cmd+Shift+5 (스크린샷 도구)
  if (event.metaKey && event.shiftKey && event.key === '5') {
    handleDetection('shortcut');
    return;
  }
}

/**
 * 키보드 기반 스크린샷 감지를 시작한다.
 *
 * PrintScreen 키 및 OS별 캡처 단축키를 모니터링한다.
 */
export function startKeyboardDetection(): void {
  if (keyboardListenerActive) return;
  if (typeof window === 'undefined') return;

  window.addEventListener('keydown', handleKeydown, true);
  keyboardListenerActive = true;
}

/**
 * 키보드 기반 스크린샷 감지를 중지한다.
 */
export function stopKeyboardDetection(): void {
  if (!keyboardListenerActive) return;
  if (typeof window === 'undefined') return;

  window.removeEventListener('keydown', handleKeydown, true);
  keyboardListenerActive = false;
}

/**
 * getDisplayMedia API 사용을 감지한다.
 *
 * navigator.mediaDevices.getDisplayMedia를 래핑하여
 * 화면 녹화 시도를 감지하고 콘텐츠를 블러 처리한다.
 */
export function startDisplayMediaDetection(): void {
  if (displayMediaMonitorActive) return;
  if (typeof navigator === 'undefined') return;
  if (!navigator.mediaDevices?.getDisplayMedia) return;

  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(
    navigator.mediaDevices
  );

  navigator.mediaDevices.getDisplayMedia = async function (
    constraints?: DisplayMediaStreamOptions
  ): Promise<MediaStream> {
    // 감지 이벤트 발생
    handleDetection('displaymedia');

    // 콘텐츠 블러 처리
    applyBlur();

    // 원본 API 호출은 허용 (차단하면 에러 발생)
    return originalGetDisplayMedia(constraints);
  };

  displayMediaMonitorActive = true;
}

/**
 * 콘텐츠에 블러 처리를 적용한다.
 *
 * getDisplayMedia 감지 시 메시지 영역을 블러 처리하여 내용을 보호한다.
 */
function applyBlur(): void {
  if (typeof document === 'undefined') return;

  const chatArea = document.querySelector('[data-chat-content]');
  if (chatArea && chatArea instanceof HTMLElement) {
    chatArea.style.filter = 'blur(20px)';
    chatArea.style.transition = 'filter 0.1s';
  }
}

/**
 * 블러 처리를 해제한다.
 */
export function removeBlur(): void {
  if (typeof document === 'undefined') return;

  const chatArea = document.querySelector('[data-chat-content]');
  if (chatArea && chatArea instanceof HTMLElement) {
    chatArea.style.filter = '';
    chatArea.style.transition = '';
  }
}

/**
 * CSS 보호 오버레이 스타일을 생성한다.
 *
 * 텍스트 선택 및 드래그를 방지하는 CSS 속성을 반환한다.
 *
 * @returns CSS 속성 객체
 */
export function getProtectionStyles(): Record<string, string> {
  return {
    'user-select': 'none',
    '-webkit-user-select': 'none',
    '-moz-user-select': 'none',
    '-ms-user-select': 'none',
    '-webkit-user-drag': 'none',
    '-webkit-touch-callout': 'none',
  };
}

/**
 * CSS 보호 오버레이를 적용한다.
 *
 * 대상 요소에 텍스트 선택/드래그 방지 스타일을 적용한다.
 *
 * @param element - 보호할 HTML 요소
 */
export function applyProtectionOverlay(element: HTMLElement): void {
  const styles = getProtectionStyles();
  for (const [prop, value] of Object.entries(styles)) {
    element.style.setProperty(prop, value);
  }
}

/**
 * 투명 워터마크를 생성한다.
 *
 * 수신자 식별자를 기반으로 매우 낮은 불투명도의 워터마크 텍스트를 생성한다.
 * 스크린샷이 유출되었을 때 수신자를 식별할 수 있다.
 *
 * @param recipientId - 수신자 식별자
 * @returns 워터마크 CSS 스타일 속성
 */
export function generateWatermarkStyle(recipientId: string): Record<string, string> {
  // 수신자 ID를 반복하여 워터마크 패턴 생성
  const watermarkText = `${recipientId} `.repeat(20);

  return {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    'pointer-events': 'none',
    'z-index': '9999',
    opacity: '0.003',
    'font-size': '10px',
    'line-height': '20px',
    color: '#000000',
    'word-wrap': 'break-word',
    overflow: 'hidden',
    content: `"${watermarkText}"`,
  };
}

/**
 * 투명 워터마크 요소를 생성하여 반환한다.
 *
 * @param recipientId - 수신자 식별자
 * @returns 워터마크 HTMLElement
 */
export function createWatermarkElement(recipientId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const watermark = document.createElement('div');
  watermark.setAttribute('data-watermark', 'true');
  watermark.setAttribute('aria-hidden', 'true');

  const watermarkText = `${recipientId} `.repeat(50);
  watermark.textContent = watermarkText;

  const styles = generateWatermarkStyle(recipientId);
  for (const [prop, value] of Object.entries(styles)) {
    if (prop !== 'content') {
      watermark.style.setProperty(prop, value);
    }
  }

  return watermark;
}

/**
 * 알림 전송 시간 제한 내에 상대방에게 스크린샷 감지를 알린다.
 *
 * @returns 알림 시간 제한 (밀리초)
 */
export function getNotificationTimeout(): number {
  return NOTIFICATION_TIMEOUT_MS;
}

/**
 * 현재 세션의 감지 횟수를 반환한다.
 */
export function getDetectionCount(): number {
  return detectionCount;
}

/**
 * 보안 위반 임계값에 도달했는지 확인한다.
 */
export function isViolationThresholdReached(): boolean {
  return detectionCount >= VIOLATION_THRESHOLD;
}

/**
 * 감지 이벤트 리스너를 등록한다.
 *
 * @param callback - 감지 시 호출할 함수
 * @returns 리스너 해제 함수
 */
export function onDetection(callback: DetectionCallback): () => void {
  detectionListeners.add(callback);
  return () => {
    detectionListeners.delete(callback);
  };
}

/**
 * 보안 위반 리스너를 등록한다.
 *
 * 동일 세션 3회 이상 스크린샷 감지 시 호출된다.
 *
 * @param callback - 보안 위반 시 호출할 함수
 * @returns 리스너 해제 함수
 */
export function onViolation(callback: ViolationCallback): () => void {
  violationListeners.add(callback);
  return () => {
    violationListeners.delete(callback);
  };
}

/**
 * 스크린샷 감지를 초기화한다.
 *
 * 키보드 감지 및 displayMedia 감지를 모두 활성화한다.
 */
export function initScreenshotGuard(): void {
  startKeyboardDetection();
  startDisplayMediaDetection();
}

/**
 * 모듈 상태를 초기화한다 (테스트용).
 */
export function resetScreenshotDetection(): void {
  detectionCount = 0;
  detectionListeners.clear();
  violationListeners.clear();
  stopKeyboardDetection();
  displayMediaMonitorActive = false;
}
