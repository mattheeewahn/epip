/**
 * Tor 접속 강제 모듈 (Network Sentinel)
 *
 * 앱 로드 시 /api/tor-check API를 호출하여 Tor 네트워크 경유 여부를 검증한다.
 * Tor를 통하지 않은 접속은 모든 기능 로드를 차단하고 경고를 표시한다.
 *
 * Requirements: 20.1, 20.2, 20.4, 20.5
 */

/** Tor 체크 API 응답 타입 */
export interface TorCheckResponse {
  isTor: boolean;
  allowed: boolean;
  message: string;
  isVpn?: boolean;
}

/** 네트워크 상태 */
export type NetworkStatus = 'checking' | 'allowed' | 'blocked' | 'error';

/** 네트워크 센티넬 상태 */
export interface NetworkSentinelState {
  status: NetworkStatus;
  isTor: boolean;
  isVpn: boolean;
  message: string;
}

/** 상태 변경 콜백 */
export type NetworkStatusCallback = (state: NetworkSentinelState) => void;

/** 내부 상태 */
let currentState: NetworkSentinelState = {
  status: 'checking',
  isTor: false,
  isVpn: false,
  message: '',
};

/** 상태 변경 리스너 */
const listeners: Set<NetworkStatusCallback> = new Set();

/**
 * 상태 변경을 리스너에 알린다.
 */
function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener({ ...currentState });
    } catch {
      // 리스너 오류 무시
    }
  }
}

/**
 * Tor 접속 여부를 검증한다.
 *
 * /api/tor-check API를 호출하여 현재 접속이 Tor 네트워크를 경유하는지 확인한다.
 * Tor를 사용하지 않는 경우 모든 기능을 차단한다.
 *
 * @returns 네트워크 센티넬 상태
 */
export async function checkTorConnection(): Promise<NetworkSentinelState> {
  currentState = {
    status: 'checking',
    isTor: false,
    isVpn: false,
    message: '접속 확인 중...',
  };
  notifyListeners();

  try {
    const response = await fetch('/api/tor-check', {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });

    const data: TorCheckResponse = await response.json();

    if (data.allowed && data.isTor) {
      currentState = {
        status: 'allowed',
        isTor: true,
        isVpn: false,
        message: data.message,
      };
    } else {
      currentState = {
        status: 'blocked',
        isTor: false,
        isVpn: data.isVpn ?? false,
        message: data.message || 'Tor 브라우저를 사용하세요.',
      };
    }
  } catch {
    // 네트워크 오류 시 차단 (안전 기본값)
    currentState = {
      status: 'error',
      isTor: false,
      isVpn: false,
      message: '네트워크 연결을 확인할 수 없습니다. Tor 브라우저를 사용하세요.',
    };
  }

  notifyListeners();
  return { ...currentState };
}

/**
 * 현재 네트워크 상태를 반환한다.
 */
export function getNetworkState(): NetworkSentinelState {
  return { ...currentState };
}

/**
 * 앱 기능 사용이 허용되는지 확인한다.
 *
 * Tor 접속이 확인된 경우에만 true를 반환한다.
 * 이 함수가 false를 반환하면 모든 기능 로드를 차단해야 한다.
 *
 * @returns Tor 접속이 확인되어 기능 사용이 허용되는지 여부
 */
export function isAccessAllowed(): boolean {
  return currentState.status === 'allowed' && currentState.isTor;
}

/**
 * 차단 시 표시할 경고 메시지를 반환한다.
 *
 * VPN 전용 접속인 경우 별도 메시지를 반환한다.
 */
export function getBlockMessage(): string {
  if (currentState.isVpn) {
    return 'VPN만으로는 충분하지 않습니다. Tor 브라우저를 사용하세요.';
  }
  return currentState.message || 'Tor 브라우저를 사용하세요.';
}

/**
 * 상태 변경 리스너를 등록한다.
 *
 * @param callback - 상태 변경 시 호출할 함수
 * @returns 리스너 해제 함수
 */
export function onStatusChange(callback: NetworkStatusCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * 모듈 상태를 초기화한다 (테스트용).
 */
export function resetSentinel(): void {
  currentState = {
    status: 'checking',
    isTor: false,
    isVpn: false,
    message: '',
  };
  listeners.clear();
}
