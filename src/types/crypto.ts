/**
 * 암호화 관련 핵심 인터페이스
 * Requirements: 2.1, 2.2
 */

/** XChaCha20-Poly1305 암호화 결과물 */
export interface EncryptedPayload {
  /** 암호문 */
  ciphertext: Uint8Array;
  /** 24바이트 논스 (XChaCha20) */
  nonce: Uint8Array;
  /** Poly1305 인증 태그 */
  tag: Uint8Array;
}

/** X25519 키 쌍 */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Double Ratchet 프로토콜 상태 */
export interface RatchetState {
  rootKey: Uint8Array;
  sendChainKey: Uint8Array;
  recvChainKey: Uint8Array;
  sendRatchetPrivate: Uint8Array;
  recvRatchetPublic: Uint8Array;
  sendMessageNumber: number;
  recvMessageNumber: number;
}
