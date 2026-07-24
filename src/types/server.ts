/**
 * 서버 측 인터페이스 (Vercel KV, TTL 전용)
 * Requirements: 7.1
 */

/** KV에 저장되는 메시지 (암호화된 상태, TTL 5분) */
export interface QueuedMessage {
  id: string;
  /** 수신자 식별자 */
  recipientId: string;
  /** base64 인코딩된 암호문 */
  payload: string;
  /** 고정 크기 (패딩 포함) */
  paddedSize: number;
  createdAt: number;
  /** 5분 후 자동 삭제 */
  ttl: 300;
}

/** 키 교환 요청 (TTL 60초) */
export interface HandshakeRequest {
  fromId: string;
  toId: string;
  /** base64 */
  ephemeralPublicKey: string;
  /** base64 */
  identityPublicKey: string;
  preKeyId: number;
  ttl: 60;
}
