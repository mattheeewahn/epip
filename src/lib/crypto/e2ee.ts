/**
 * E2EE Module - XChaCha20-Poly1305 암호화/복호화
 *
 * 모든 암호화/복호화는 클라이언트 측에서만 수행된다.
 * libsodium-wrappers를 사용하여 AEAD 암호화를 구현한다.
 *
 * Requirements: 2.2, 2.3
 */

import sodium from 'libsodium-wrappers';
import type { EncryptedPayload } from '@/types/crypto';

/** XChaCha20 논스 길이 (24바이트) */
const NONCE_LENGTH = 24;

/**
 * libsodium 초기화를 보장한다.
 * 모든 암호화 함수 호출 전에 반드시 실행해야 한다.
 */
async function ensureSodiumReady(): Promise<void> {
  await sodium.ready;
}

/**
 * 평문을 XChaCha20-Poly1305로 암호화한다.
 *
 * - 24바이트 랜덤 논스를 생성한다.
 * - detached 모드로 암호화하여 ciphertext와 tag(mac)를 분리 반환한다.
 *
 * @param plaintext - 암호화할 평문 데이터
 * @param sessionKey - 32바이트 세션 키
 * @returns 암호문, 논스, 인증 태그를 포함하는 EncryptedPayload
 */
export async function encrypt(
  plaintext: Uint8Array,
  sessionKey: Uint8Array
): Promise<EncryptedPayload> {
  await ensureSodiumReady();

  // 24바이트 랜덤 논스 생성
  const nonce = sodium.randombytes_buf(NONCE_LENGTH);

  // XChaCha20-Poly1305 AEAD 암호화 (detached 모드)
  // CryptoBox { ciphertext, mac } 형태로 반환
  const { ciphertext, mac } = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt_detached(
    plaintext,
    null, // additional data (없음)
    null, // nsec (사용하지 않음)
    nonce,
    sessionKey
  );

  return {
    ciphertext,
    nonce,
    tag: mac,
  };
}

/**
 * XChaCha20-Poly1305 암호문을 복호화한다.
 *
 * - Poly1305 인증 태그를 검증하여 무결성을 보장한다.
 * - 태그 검증 실패 시 예외를 발생시킨다.
 *
 * @param payload - 암호문, 논스, 태그를 포함하는 EncryptedPayload
 * @param sessionKey - 32바이트 세션 키
 * @returns 복호화된 평문 데이터
 * @throws 인증 태그 검증 실패 시 예외 발생
 */
export async function decrypt(
  payload: EncryptedPayload,
  sessionKey: Uint8Array
): Promise<Uint8Array> {
  await ensureSodiumReady();

  const { ciphertext, nonce, tag } = payload;

  // XChaCha20-Poly1305 AEAD 복호화 (detached 모드, 태그 검증 포함)
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt_detached(
    null, // nsec (사용하지 않음)
    ciphertext,
    tag,
    null, // additional data (없음)
    nonce,
    sessionKey
  );

  return plaintext;
}

/**
 * E2EE 모듈 인터페이스
 */
export const e2ee = {
  encrypt,
  decrypt,
};

export default e2ee;
