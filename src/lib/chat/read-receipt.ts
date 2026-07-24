/**
 * 읽음 확인 모듈
 *
 * 기본 비활성화 상태로, 대화방별 개별 설정을 지원한다.
 * 비활성화 시 양방향으로 읽음 확인을 차단한다.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */

/** 읽음 확인 설정 (대화방별) */
export interface ReadReceiptConfig {
  /** 대화방 ID → 활성화 여부 */
  roomSettings: Map<string, boolean>;
}

/** 읽음 확인 이벤트 */
export interface ReadReceiptEvent {
  messageId: string;
  readerId: string;
  roomId: string;
  timestamp: number;
}

/**
 * 기본 설정을 생성한다.
 * 모든 대화방에서 읽음 확인은 기본 비활성화 상태이다.
 */
export function createDefaultConfig(): ReadReceiptConfig {
  return {
    roomSettings: new Map(),
  };
}

/**
 * 특정 대화방의 읽음 확인 활성화 여부를 반환한다.
 * 설정이 없으면 기본값(비활성화)을 반환한다.
 */
export function isReadReceiptEnabled(config: ReadReceiptConfig, roomId: string): boolean {
  return config.roomSettings.get(roomId) ?? false;
}

/**
 * 특정 대화방의 읽음 확인 설정을 변경한다.
 */
export function setReadReceiptEnabled(
  config: ReadReceiptConfig,
  roomId: string,
  enabled: boolean
): void {
  config.roomSettings.set(roomId, enabled);
}

/**
 * 읽음 확인을 전송할 수 있는지 판단한다.
 * 양측 모두 활성화 상태일 때만 전송 가능하다.
 *
 * @param myConfig - 나의 읽음 확인 설정
 * @param peerEnabled - 상대방의 읽음 확인 활성화 여부
 * @param roomId - 대화방 ID
 * @returns 읽음 확인 전송 가능 여부
 */
export function canSendReadReceipt(
  myConfig: ReadReceiptConfig,
  peerEnabled: boolean,
  roomId: string
): boolean {
  const myEnabled = isReadReceiptEnabled(myConfig, roomId);
  // 양방향 차단: 둘 다 활성화일 때만 전송 가능
  return myEnabled && peerEnabled;
}

/**
 * 읽음 확인 이벤트를 수신할 수 있는지 판단한다.
 * 내 설정이 비활성화이면 상대방의 읽음 확인도 수신하지 않는다.
 */
export function canReceiveReadReceipt(
  myConfig: ReadReceiptConfig,
  roomId: string
): boolean {
  return isReadReceiptEnabled(myConfig, roomId);
}

/**
 * 읽음 확인 이벤트를 생성한다.
 */
export function createReadReceiptEvent(
  messageId: string,
  readerId: string,
  roomId: string
): ReadReceiptEvent {
  return {
    messageId,
    readerId,
    roomId,
    timestamp: Date.now(),
  };
}
