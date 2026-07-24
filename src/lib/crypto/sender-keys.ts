/**
 * Sender Keys - 그룹 E2EE (Sender Keys 프로토콜)
 *
 * 그룹 채팅에서의 효율적인 암호화를 위해 Sender Keys 프로토콜을 구현한다.
 * 각 그룹 멤버는 자신만의 Sender Key를 생성하여 다른 멤버들에게 배포한다.
 * 메시지 전송 시 자신의 Sender Key로 한 번만 암호화하면 모든 수신자가 복호화 가능하다.
 *
 * - Sender Key 생성, 로테이션, 폐기
 * - HMAC 기반 발신자 인증
 * - 멤버 퇴장 시 키 폐기 및 새 그룹 키 분배
 *
 * Requirements: 16.2, 16.4, 16.5
 */

import sodium from 'libsodium-wrappers';
import type { EncryptedPayload } from '@/types/crypto';

/** Sender Key 길이 (32바이트) */
const SENDER_KEY_LENGTH = 32;

/** XChaCha20 논스 길이 (24바이트) */
const NONCE_LENGTH = 24;

/** HMAC 길이 (32바이트, crypto_auth 출력) */
const HMAC_LENGTH = 32;

/**
 * libsodium 초기화를 보장한다.
 */
async function ensureSodiumReady(): Promise<void> {
  await sodium.ready;
}

/**
 * 새로운 Sender Key를 생성한다.
 * 각 그룹 멤버가 자신의 메시지 암호화에 사용할 32바이트 대칭 키를 생성한다.
 *
 * @returns 32바이트 랜덤 Sender Key
 */
export async function generateSenderKey(): Promise<Uint8Array> {
  await ensureSodiumReady();

  return sodium.randombytes_buf(SENDER_KEY_LENGTH);
}

/**
 * Sender Key를 사용하여 그룹 메시지를 암호화한다.
 * XChaCha20-Poly1305 AEAD 암호화를 사용한다.
 *
 * @param plaintext - 암호화할 평문 데이터
 * @param senderKey - 발신자의 Sender Key (32바이트)
 * @returns 암호문, 논스, 인증 태그를 포함하는 EncryptedPayload
 */
export async function encryptGroupMessage(
  plaintext: Uint8Array,
  senderKey: Uint8Array
): Promise<EncryptedPayload> {
  await ensureSodiumReady();

  const nonce = sodium.randombytes_buf(NONCE_LENGTH);

  const { ciphertext, mac } = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt_detached(
    plaintext,
    null,
    null,
    nonce,
    senderKey
  );

  return {
    ciphertext,
    nonce,
    tag: mac,
  };
}

/**
 * Sender Key를 사용하여 그룹 메시지를 복호화한다.
 * Poly1305 인증 태그를 검증하여 무결성을 보장한다.
 *
 * @param payload - 암호문, 논스, 태그를 포함하는 EncryptedPayload
 * @param senderKey - 발신자의 Sender Key (32바이트)
 * @returns 복호화된 평문 데이터
 * @throws 인증 태그 검증 실패 시 예외 발생
 */
export async function decryptGroupMessage(
  payload: EncryptedPayload,
  senderKey: Uint8Array
): Promise<Uint8Array> {
  await ensureSodiumReady();

  const { ciphertext, nonce, tag } = payload;

  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt_detached(
    null,
    ciphertext,
    tag,
    null,
    nonce,
    senderKey
  );

  return plaintext;
}

/**
 * 메시지에 대한 HMAC을 생성하여 발신자를 인증한다.
 * 그룹 내 메시지 위조를 방지하기 위해 발신자의 Sender Key로 HMAC을 생성한다.
 *
 * @param message - HMAC을 생성할 메시지 데이터
 * @param senderKey - 발신자의 Sender Key (32바이트)
 * @returns 32바이트 HMAC 값
 */
export async function authenticateMessage(
  message: Uint8Array,
  senderKey: Uint8Array
): Promise<Uint8Array> {
  await ensureSodiumReady();

  return sodium.crypto_auth(message, senderKey);
}

/**
 * 메시지의 HMAC을 검증하여 발신자를 확인한다.
 * HMAC이 유효하지 않으면 메시지가 위조되었거나 발신자가 일치하지 않음을 의미한다.
 *
 * @param message - 검증할 메시지 데이터
 * @param hmac - 검증할 HMAC 값 (32바이트)
 * @param senderKey - 발신자의 Sender Key (32바이트)
 * @returns HMAC이 유효하면 true, 아니면 false
 */
export async function verifyMessageAuth(
  message: Uint8Array,
  hmac: Uint8Array,
  senderKey: Uint8Array
): Promise<boolean> {
  await ensureSodiumReady();

  return sodium.crypto_auth_verify(hmac, message, senderKey);
}

/**
 * Sender Key를 로테이션한다.
 * 멤버 퇴장 시 기존 키를 폐기하고 새 키를 생성하여 남은 멤버에게 분배해야 한다.
 * 이전 키는 안전하게 삭제되고 새 키가 반환된다.
 *
 * @param currentKey - 현재 Sender Key (폐기 대상)
 * @returns 새로 생성된 Sender Key (32바이트)
 */
export async function rotateSenderKey(currentKey: Uint8Array): Promise<Uint8Array> {
  await ensureSodiumReady();

  // 현재 키를 메모리에서 안전하게 삭제
  sodium.memzero(currentKey);

  // 새 Sender Key 생성
  return sodium.randombytes_buf(SENDER_KEY_LENGTH);
}

/**
 * Sender Key를 안전하게 메모리에서 폐기한다.
 * 멤버 퇴장 시 해당 멤버의 키를 모든 참여자 메모리에서 제거해야 한다.
 *
 * @param key - 폐기할 Sender Key
 */
export async function revokeSenderKey(key: Uint8Array): Promise<void> {
  await ensureSodiumReady();

  sodium.memzero(key);
}

/**
 * Sender Keys 모듈 인터페이스
 */
export const senderKeys = {
  generateSenderKey,
  encryptGroupMessage,
  decryptGroupMessage,
  authenticateMessage,
  verifyMessageAuth,
  rotateSenderKey,
  revokeSenderKey,
};

export default senderKeys;
