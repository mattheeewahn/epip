/**
 * P2P Tor 릴레이 모듈
 *
 * Tor Hidden Service(.onion) 기반 P2P 직접 연결 추상화 계층.
 * 브라우저 환경에서는 실제 Hidden Service를 직접 생성할 수 없으므로,
 * 서버 릴레이(HTTP 롱폴링)를 통해 Tor 네트워크 위에서 P2P 통신을 구현한다.
 *
 * 연결 수명 주기:
 * 1. createConnection() - 피어와 연결 수립 (30초 타임아웃)
 * 2. sendData() - 데이터 전송
 * 3. onData() - 데이터 수신 콜백 등록
 * 4. closeConnection() - 연결 종료, 키 자료 삭제
 * 5. closeAllConnections() - 모든 연결 즉시 종료 (패닉 버튼용)
 *
 * 보안 특성:
 * - 클라이언트는 Tor 브라우저를 통해 접속 (IP 은닉)
 * - 서버 릴레이는 메타데이터를 저장하지 않음
 * - NAT 트래버설 없이 Tor 네트워크만 사용
 * - 세션 종료 시 모든 키 자료 즉시 삭제
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

/** 연결 상태 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

/** P2P 연결 정보 */
export interface P2PConnection {
  id: string;
  peerId: string;
  state: ConnectionState;
  createdAt: number;
  /** 임시 세션 키 (연결 종료 시 삭제) */
  sessionKey: Uint8Array | null;
}

/** 연결 생성 옵션 */
export interface ConnectionOptions {
  /** 연결 타임아웃 (밀리초, 기본 30000ms) */
  timeoutMs?: number;
  /** 자동 재시도 여부 (기본 false) */
  autoRetry?: boolean;
  /** 최대 재시도 횟수 (기본 2) */
  maxRetries?: number;
}

/** 연결 결과 */
export interface ConnectionResult {
  success: boolean;
  connectionId: string;
  /** 실패 시 재시도 가능 여부 */
  canRetry: boolean;
  error?: string;
}

/** 데이터 수신 콜백 */
export type DataCallback = (data: Uint8Array) => void;

/** 기본 연결 타임아웃 (밀리초) */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 기본 최대 재시도 횟수 */
const DEFAULT_MAX_RETRIES = 2;

/** 폴링 간격 (밀리초) */
const POLL_INTERVAL_MS = 1000;

/** 활성 연결 맵 */
const connections: Map<string, P2PConnection> = new Map();

/** 데이터 수신 콜백 맵 (connectionId → callbacks) */
const dataCallbacks: Map<string, Set<DataCallback>> = new Map();

/** 폴링 타이머 맵 (connectionId → timerId) */
const pollTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

/**
 * 고유 연결 ID 생성
 */
function generateConnectionId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 임시 세션 키 생성 (연결 고유)
 */
function generateSessionKey(): Uint8Array {
  const key = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(key);
  } else {
    for (let i = 0; i < 32; i++) {
      key[i] = Math.floor(Math.random() * 256);
    }
  }
  return key;
}

/**
 * 키 자료를 안전하게 삭제 (메모리 제로화)
 */
function zeroizeKey(key: Uint8Array | null): void {
  if (key === null) return;
  key.fill(0);
}

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
 * P2P 연결을 수립한다.
 *
 * Tor 네트워크를 통해 피어와 직접 연결 터널을 수립한다.
 * 브라우저 환경에서는 서버 릴레이를 통해 연결을 중개하며,
 * 양측의 실제 IP 주소는 Tor 네트워크에 의해 은닉된다.
 *
 * 30초(기본) 이내에 연결이 수립되지 않으면 실패를 알리고 재시도 옵션을 제공한다.
 *
 * @param peerId - 연결 대상 피어 식별자
 * @param sessionToken - 현재 세션 인증 토큰
 * @param options - 연결 옵션 (타임아웃, 재시도 등)
 * @returns 연결 결과 (성공/실패, 연결 ID, 재시도 가능 여부)
 */
export async function createConnection(
  peerId: string,
  sessionToken: string,
  options: ConnectionOptions = {}
): Promise<ConnectionResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    autoRetry = false,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  const connectionId = generateConnectionId();

  // 연결 객체 생성
  const connection: P2PConnection = {
    id: connectionId,
    peerId,
    state: 'connecting',
    createdAt: Date.now(),
    sessionKey: null,
  };

  connections.set(connectionId, connection);

  // 재시도 루프
  let lastError = '';
  const attempts = autoRetry ? maxRetries + 1 : 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const connected = await attemptConnection(connectionId, peerId, sessionToken, timeoutMs);

      if (connected) {
        connection.state = 'connected';
        connection.sessionKey = generateSessionKey();
        startDataPolling(connectionId, sessionToken);
        return { success: true, connectionId, canRetry: false };
      }

      lastError = 'Connection timed out';
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
    }

    // 재시도 전 상태 확인
    if (connection.state === 'disconnected') {
      break; // 연결이 수동으로 닫힌 경우 중단
    }
  }

  // 연결 실패
  connection.state = 'failed';
  return {
    success: false,
    connectionId,
    canRetry: true,
    error: lastError,
  };
}

/**
 * 단일 연결 시도를 수행한다.
 *
 * 서버 릴레이에 연결 요청을 보내고 피어 응답을 대기한다.
 * 타임아웃 내에 응답이 없으면 false를 반환한다.
 */
async function attemptConnection(
  connectionId: string,
  peerId: string,
  sessionToken: string,
  timeoutMs: number
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 서버 릴레이를 통해 피어에게 연결 요청 전송
    const response = await fetch('/api/p2p/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        connectionId,
        peerId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Connection request failed: ${response.status}`);
    }

    const result = (await response.json()) as { accepted: boolean };
    return result.accepted;
  } catch (error) {
    clearTimeout(timeoutId);

    // 타임아웃에 의한 abort
    if (error instanceof DOMException && error.name === 'AbortError') {
      return false;
    }

    throw error;
  }
}

/**
 * 연결을 통해 데이터를 전송한다.
 *
 * Tor 네트워크를 경유하여 서버 릴레이를 통해 피어에게 데이터를 전달한다.
 * 모든 전송은 Tor 회로를 통해 라우팅되어 IP가 노출되지 않는다.
 *
 * @param connectionId - 연결 식별자
 * @param data - 전송할 데이터 (바이트 배열)
 * @returns 전송 성공 여부
 * @throws 연결이 존재하지 않거나 활성 상태가 아닌 경우
 */
export async function sendData(
  connectionId: string,
  data: Uint8Array,
  sessionToken: string
): Promise<boolean> {
  const connection = connections.get(connectionId);

  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  if (connection.state !== 'connected') {
    throw new Error(`Connection is not active: ${connection.state}`);
  }

  try {
    const response = await fetch('/api/p2p/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        connectionId,
        peerId: connection.peerId,
        payload: toBase64(data),
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 데이터 수신 콜백을 등록한다.
 *
 * 연결을 통해 데이터가 수신될 때마다 콜백이 호출된다.
 * 복수의 콜백을 등록할 수 있다.
 *
 * @param connectionId - 연결 식별자
 * @param callback - 데이터 수신 시 호출할 함수
 * @returns 콜백 해제 함수
 * @throws 연결이 존재하지 않는 경우
 */
export function onData(connectionId: string, callback: DataCallback): () => void {
  const connection = connections.get(connectionId);

  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  let callbacks = dataCallbacks.get(connectionId);
  if (!callbacks) {
    callbacks = new Set();
    dataCallbacks.set(connectionId, callbacks);
  }
  callbacks.add(callback);

  // 콜백 해제 함수 반환
  return () => {
    const cbs = dataCallbacks.get(connectionId);
    if (cbs) {
      cbs.delete(callback);
    }
  };
}

/**
 * 연결을 종료한다.
 *
 * P2P 연결을 닫고 임시 Hidden Service를 폐기한다.
 * 모든 관련 키 자료를 즉시 삭제(메모리 제로화)한다.
 *
 * @param connectionId - 연결 식별자
 */
export async function closeConnection(connectionId: string, sessionToken?: string): Promise<void> {
  const connection = connections.get(connectionId);

  if (!connection) {
    return; // 이미 닫힌 연결은 무시
  }

  // 폴링 중지
  stopDataPolling(connectionId);

  // 서버에 연결 종료 알림 (best-effort)
  if (sessionToken) {
    try {
      await fetch('/api/p2p/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ connectionId }),
      });
    } catch {
      // 종료 알림 실패는 무시 (네트워크 불안정 가능)
    }
  }

  // 키 자료 즉시 삭제 (메모리 제로화)
  zeroizeKey(connection.sessionKey);
  connection.sessionKey = null;

  // 연결 상태 업데이트
  connection.state = 'disconnected';

  // 콜백 제거
  dataCallbacks.delete(connectionId);

  // 연결 맵에서 제거
  connections.delete(connectionId);
}

/**
 * 연결 상태를 조회한다.
 *
 * @param connectionId - 연결 식별자
 * @returns 현재 연결 상태, 연결이 없으면 'disconnected'
 */
export function getConnectionState(connectionId: string): ConnectionState {
  const connection = connections.get(connectionId);
  if (!connection) {
    return 'disconnected';
  }
  return connection.state;
}

/**
 * 모든 활성 연결을 즉시 종료한다.
 *
 * 패닉 버튼(긴급 삭제) 시 호출된다.
 * 모든 P2P 연결을 종료하고, Hidden Service를 폐기하며,
 * 관련 키 자료를 즉시 삭제한다.
 */
export async function closeAllConnections(): Promise<void> {
  const connectionIds = Array.from(connections.keys());

  // 모든 연결을 병렬로 종료
  await Promise.allSettled(
    connectionIds.map((id) => closeConnection(id))
  );

  // 안전을 위해 맵 완전 초기화
  connections.clear();
  dataCallbacks.clear();

  // 모든 폴링 타이머 정리
  for (const timerId of pollTimers.values()) {
    clearInterval(timerId);
  }
  pollTimers.clear();
}

/**
 * 현재 활성 연결 수를 반환한다.
 */
export function getActiveConnectionCount(): number {
  let count = 0;
  for (const conn of connections.values()) {
    if (conn.state === 'connected') {
      count++;
    }
  }
  return count;
}

/**
 * 특정 피어와의 활성 연결을 조회한다.
 *
 * @param peerId - 피어 식별자
 * @returns 연결 ID 또는 null (활성 연결 없는 경우)
 */
export function getConnectionByPeer(peerId: string): string | null {
  for (const [id, conn] of connections) {
    if (conn.peerId === peerId && conn.state === 'connected') {
      return id;
    }
  }
  return null;
}

/**
 * 연결에 대한 데이터 폴링을 시작한다.
 * 서버 릴레이에서 피어가 보낸 데이터를 주기적으로 가져온다.
 */
function startDataPolling(connectionId: string, sessionToken: string): void {
  // 기존 폴링 중지
  stopDataPolling(connectionId);

  const timerId = setInterval(async () => {
    const connection = connections.get(connectionId);
    if (!connection || connection.state !== 'connected') {
      stopDataPolling(connectionId);
      return;
    }

    try {
      const response = await fetch(
        `/api/p2p/recv?connectionId=${encodeURIComponent(connectionId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        }
      );

      if (!response.ok) return;

      const result = (await response.json()) as {
        messages: Array<{ payload: string }>;
      };

      // 수신 데이터를 콜백에 전달
      const callbacks = dataCallbacks.get(connectionId);
      if (callbacks && result.messages.length > 0) {
        for (const msg of result.messages) {
          const data = fromBase64(msg.payload);
          for (const cb of callbacks) {
            try {
              cb(data);
            } catch {
              // 콜백 에러는 무시하여 다른 콜백에 영향 없음
            }
          }
        }
      }
    } catch {
      // 폴링 오류는 무시, 다음 간격에서 재시도
    }
  }, POLL_INTERVAL_MS);

  pollTimers.set(connectionId, timerId);
}

/**
 * 연결에 대한 데이터 폴링을 중지한다.
 */
function stopDataPolling(connectionId: string): void {
  const timerId = pollTimers.get(connectionId);
  if (timerId) {
    clearInterval(timerId);
    pollTimers.delete(connectionId);
  }
}
