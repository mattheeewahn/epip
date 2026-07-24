/**
 * HTTP 롱폴링 클라이언트
 *
 * Tor 브라우저 환경에서 WebSocket 대신 사용하는 HTTP 롱폴링 통신 모듈.
 * - POST /api/send: 암호화된 페이로드 전송
 * - GET /api/poll: 메시지 수신 대기 (최대 25초 타임아웃)
 * - Tor 회로 변경 시 재인증 없이 연결 복구
 *
 * Requirements: 5.2, 5.5, 7.4
 */

/** 메시지 전송 결과 */
export interface SendResult {
  success: boolean;
  messageId: string;
}

/** 폴링 결과 */
export interface PollResult {
  messages: IncomingMessage[];
  hasMore: boolean;
}

/** 수신 메시지 */
export interface IncomingMessage {
  id: string;
  senderId: string;
  payload: Uint8Array; // 암호화된 상태
  timestamp: number;
}

/** 기본 롱폴링 타임아웃 (초) */
const DEFAULT_POLL_TIMEOUT = 25;

/** 네트워크 오류 시 재시도 대기 시간 (ms) */
const RETRY_DELAY_MS = 2000;

/** 최대 재시도 횟수 */
const MAX_RETRIES = 3;

/**
 * base64 인코딩 (Uint8Array → string)
 */
function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}

/**
 * base64 디코딩 (string → Uint8Array)
 */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 지정 시간(ms)만큼 대기
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 암호화된 페이로드를 서버에 전송
 *
 * POST /api/send로 base64 인코딩된 암호문을 전송한다.
 * Tor 회로 변경으로 인한 네트워크 오류 시 재인증 없이 재시도한다.
 */
export async function send(
  recipientId: string,
  payload: Uint8Array,
  sessionToken: string
): Promise<SendResult> {
  const body = JSON.stringify({
    recipientId,
    payload: toBase64(payload),
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`Send failed: ${response.status}`);
      }

      const result = (await response.json()) as { messageId: string };
      return { success: true, messageId: result.messageId };
    } catch {
      // 재시도 가능한 네트워크 오류인 경우 대기 후 재시도
      // Tor 회로 변경 시 재인증 없이 동일 세션 토큰으로 연결 복구
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  return { success: false, messageId: '' };
}

/**
 * 서버에서 대기 중인 메시지를 폴링
 *
 * GET /api/poll로 최대 25초간 대기하며 새 메시지를 수신한다.
 * AbortController를 사용하여 타임아웃을 제어한다.
 * Tor 회로 변경 시 재인증 없이 재시도한다.
 */
export async function poll(
  myId: string,
  sessionToken: string,
  timeout: number = DEFAULT_POLL_TIMEOUT
): Promise<PollResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const url = `/api/poll?id=${encodeURIComponent(myId)}&timeout=${timeout}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      messages: Array<{
        id: string;
        senderId: string;
        payload: string; // base64
        timestamp: number;
      }>;
      hasMore: boolean;
    };

    const messages: IncomingMessage[] = data.messages.map((msg) => ({
      id: msg.id,
      senderId: msg.senderId,
      payload: fromBase64(msg.payload),
      timestamp: msg.timestamp,
    }));

    return { messages, hasMore: data.hasMore };
  } catch (error) {
    clearTimeout(timeoutId);

    // AbortController에 의한 타임아웃은 정상 동작 (빈 결과 반환)
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { messages: [], hasMore: false };
    }

    // 네트워크 오류 (Tor 회로 변경 등) - 빈 결과 반환, 다음 폴링에서 복구
    return { messages: [], hasMore: false };
  }
}

/**
 * 연속 폴링 루프
 *
 * 메시지가 수신될 때마다 콜백을 호출하며, stopPolling()이 호출될 때까지 계속 폴링한다.
 * Tor 회로 변경으로 인한 네트워크 오류 시 재인증 없이 자동 복구한다.
 */
let pollingActive = false;
let pollingTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function startPolling(
  myId: string,
  sessionToken: string,
  onMessage: (message: IncomingMessage) => void
): void {
  if (pollingActive) {
    return; // 이미 폴링 중이면 중복 시작 방지
  }

  pollingActive = true;

  const schedulePoll = (): void => {
    if (!pollingActive) return;

    pollingTimeoutId = setTimeout(async () => {
      if (!pollingActive) return;

      try {
        const result = await poll(myId, sessionToken);

        if (!pollingActive) return;

        for (const message of result.messages) {
          onMessage(message);
        }

        // 더 많은 메시지가 있으면 즉시 다시 폴링, 아니면 다음 라운드 스케줄
        schedulePoll();
      } catch {
        // 네트워크 오류 시 잠시 대기 후 재시도 (재인증 불필요)
        if (pollingActive) {
          pollingTimeoutId = setTimeout(schedulePoll, RETRY_DELAY_MS);
        }
      }
    }, 0);
  };

  schedulePoll();
}

/**
 * 폴링 루프 중지
 */
export function stopPolling(): void {
  pollingActive = false;
  if (pollingTimeoutId !== null) {
    clearTimeout(pollingTimeoutId);
    pollingTimeoutId = null;
  }
}
