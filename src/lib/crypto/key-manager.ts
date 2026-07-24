/**
 * Key Manager - X25519 키 교환 및 Double Ratchet 프로토콜
 *
 * - X25519 Diffie-Hellman 키 교환으로 세션 키 생성
 * - Double Ratchet 프로토콜로 전방향 비밀성(Forward Secrecy) 보장
 * - 키 교환 무결성 검증 실패 시 세션 종료 및 경고
 *
 * Requirements: 2.1, 2.4, 2.5
 */

import sodium from 'libsodium-wrappers';
import type { KeyPair, RatchetState } from '@/types/crypto';

/** Chain key에서 message key를 파생할 때 사용하는 상수 */
const MESSAGE_KEY_SEED = new Uint8Array([0x01]);
/** Chain key를 다음 단계로 진행할 때 사용하는 상수 */
const CHAIN_KEY_SEED = new Uint8Array([0x02]);

/**
 * libsodium 초기화를 보장한다.
 */
async function ensureSodiumReady(): Promise<void> {
  await sodium.ready;
}

/**
 * X25519 키 쌍을 생성한다.
 *
 * @returns X25519 공개 키와 비밀 키 쌍
 */
export async function generateKeyPair(): Promise<KeyPair> {
  await ensureSodiumReady();

  const keyPair = sodium.crypto_box_keypair();
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/**
 * X25519 Diffie-Hellman 키 교환으로 공유 비밀을 도출한다.
 *
 * @param myPrivate - 내 비밀 키 (32바이트)
 * @param theirPublic - 상대방 공개 키 (32바이트)
 * @returns 32바이트 공유 비밀
 */
export async function deriveSharedSecret(
  myPrivate: Uint8Array,
  theirPublic: Uint8Array
): Promise<Uint8Array> {
  await ensureSodiumReady();

  return sodium.crypto_scalarmult(myPrivate, theirPublic);
}

/**
 * BLAKE2b 기반 KDF. rootKey와 DH 출력을 결합하여 새 rootKey와 chainKey를 도출한다.
 *
 * @param rootKey - 현재 루트 키 (32바이트)
 * @param dhOutput - DH 결과값 (32바이트)
 * @returns [newRootKey, newChainKey] 각 32바이트
 */
function kdfRootKey(rootKey: Uint8Array, dhOutput: Uint8Array): [Uint8Array, Uint8Array] {
  // BLAKE2b(key=rootKey, message=dhOutput, outputLen=64) → 앞 32바이트 = newRootKey, 뒤 32바이트 = newChainKey
  const derived = sodium.crypto_generichash(64, dhOutput, rootKey);
  const newRootKey = derived.slice(0, 32);
  const newChainKey = derived.slice(32, 64);
  return [newRootKey, newChainKey];
}

/**
 * Chain key에서 message key를 파생한다.
 * HMAC-SHA256(chainKey, 0x01) → messageKey
 *
 * @param chainKey - 현재 체인 키 (32바이트)
 * @returns 메시지 키 (32바이트)
 */
function deriveMessageKey(chainKey: Uint8Array): Uint8Array {
  return sodium.crypto_auth(MESSAGE_KEY_SEED, chainKey);
}

/**
 * Chain key를 다음 단계로 진행한다.
 * HMAC-SHA256(chainKey, 0x02) → nextChainKey
 *
 * @param chainKey - 현재 체인 키 (32바이트)
 * @returns 다음 체인 키 (32바이트)
 */
function advanceChainKey(chainKey: Uint8Array): Uint8Array {
  return sodium.crypto_auth(CHAIN_KEY_SEED, chainKey);
}

/**
 * 초기 RatchetState를 생성한다.
 * 공유 비밀과 역할(initiator/responder)에 따라 초기 상태를 설정한다.
 *
 * @param sharedSecret - DH로 도출된 공유 비밀 (32바이트)
 * @param isInitiator - 세션을 시작하는 측인지 여부
 * @returns 초기화된 RatchetState
 */
export async function initializeRatchet(
  sharedSecret: Uint8Array,
  isInitiator: boolean
): Promise<RatchetState> {
  await ensureSodiumReady();

  // 공유 비밀로부터 rootKey와 초기 chainKey를 도출
  const rootKey = sodium.crypto_generichash(32, sharedSecret, null);

  // Initiator는 새로운 ratchet 키 쌍을 생성
  const ratchetKeyPair = sodium.crypto_box_keypair();

  // rootKey로부터 send/recv 체인 키를 도출
  const sendChainKey = sodium.crypto_generichash(32, new Uint8Array([0x01]), rootKey);
  const recvChainKey = sodium.crypto_generichash(32, new Uint8Array([0x02]), rootKey);

  if (isInitiator) {
    return {
      rootKey,
      sendChainKey,
      recvChainKey,
      sendRatchetPrivate: ratchetKeyPair.privateKey,
      recvRatchetPublic: new Uint8Array(32), // 상대방 공개 키는 아직 수신하지 않음
      sendMessageNumber: 0,
      recvMessageNumber: 0,
    };
  } else {
    // Responder는 send/recv를 반전한다
    return {
      rootKey,
      sendChainKey: recvChainKey,
      recvChainKey: sendChainKey,
      sendRatchetPrivate: ratchetKeyPair.privateKey,
      recvRatchetPublic: new Uint8Array(32),
      sendMessageNumber: 0,
      recvMessageNumber: 0,
    };
  }
}

/**
 * DH Ratchet 단계를 수행한다.
 * 상대방의 새 공개 키를 받아 루트 키와 체인 키를 갱신한다.
 *
 * @param state - 현재 RatchetState
 * @param theirNewPublic - 상대방의 새 ratchet 공개 키 (32바이트)
 * @returns 갱신된 RatchetState
 */
export async function ratchetStep(
  state: RatchetState,
  theirNewPublic: Uint8Array
): Promise<RatchetState> {
  await ensureSodiumReady();

  // 1. 수신 체인 갱신: 현재 내 비밀 키와 상대방의 새 공개 키로 DH
  const dhRecv = sodium.crypto_scalarmult(state.sendRatchetPrivate, theirNewPublic);
  const [rootKey1, newRecvChainKey] = kdfRootKey(state.rootKey, dhRecv);

  // 2. 새 ratchet 키 쌍 생성
  const newKeyPair = sodium.crypto_box_keypair();

  // 3. 송신 체인 갱신: 새 비밀 키와 상대방의 새 공개 키로 DH
  const dhSend = sodium.crypto_scalarmult(newKeyPair.privateKey, theirNewPublic);
  const [rootKey2, newSendChainKey] = kdfRootKey(rootKey1, dhSend);

  return {
    rootKey: rootKey2,
    sendChainKey: newSendChainKey,
    recvChainKey: newRecvChainKey,
    sendRatchetPrivate: newKeyPair.privateKey,
    recvRatchetPublic: theirNewPublic,
    sendMessageNumber: 0,
    recvMessageNumber: 0,
  };
}

/**
 * 현재 상태에서 메시지 키를 획득하고 체인을 한 단계 진행한다.
 *
 * @param state - 현재 RatchetState
 * @param sending - true면 송신 체인, false면 수신 체인에서 키를 가져온다
 * @returns [messageKey, updatedState] 메시지 키와 갱신된 상태
 */
export async function getMessageKey(
  state: RatchetState,
  sending: boolean
): Promise<[Uint8Array, RatchetState]> {
  await ensureSodiumReady();

  if (sending) {
    const messageKey = deriveMessageKey(state.sendChainKey);
    const nextChainKey = advanceChainKey(state.sendChainKey);
    const newState: RatchetState = {
      ...state,
      sendChainKey: nextChainKey,
      sendMessageNumber: state.sendMessageNumber + 1,
    };
    return [messageKey, newState];
  } else {
    const messageKey = deriveMessageKey(state.recvChainKey);
    const nextChainKey = advanceChainKey(state.recvChainKey);
    const newState: RatchetState = {
      ...state,
      recvChainKey: nextChainKey,
      recvMessageNumber: state.recvMessageNumber + 1,
    };
    return [messageKey, newState];
  }
}

/**
 * 키 교환 무결성을 검증한다.
 * 예상되는 공개 키와 실제 수신된 공개 키가 일치하는지 확인한다.
 *
 * @param expectedPublic - 예상되는 공개 키 (32바이트)
 * @param receivedPublic - 실제 수신된 공개 키 (32바이트)
 * @returns 키가 일치하면 true, 불일치 시 false 및 경고 발생
 * @throws 키 불일치 시 세션 종료를 위한 에러 발생
 */
export function verifyKeyIntegrity(
  expectedPublic: Uint8Array,
  receivedPublic: Uint8Array
): boolean {
  if (expectedPublic.length !== receivedPublic.length) {
    throw new KeyIntegrityError('키 길이 불일치: 키 교환이 변조되었을 수 있습니다.');
  }

  // 상수 시간 비교로 타이밍 공격 방지
  if (!sodium.memcmp(expectedPublic, receivedPublic)) {
    throw new KeyIntegrityError('키 무결성 검증 실패: 중간자 공격이 의심됩니다. 세션을 종료합니다.');
  }

  return true;
}

/**
 * 키 무결성 검증 실패 에러.
 * 이 에러가 발생하면 해당 세션을 즉시 종료해야 한다.
 */
export class KeyIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyIntegrityError';
  }
}

/**
 * Key Manager 인터페이스
 */
export const keyManager = {
  generateKeyPair,
  deriveSharedSecret,
  initializeRatchet,
  ratchetStep,
  getMessageKey,
  verifyKeyIntegrity,
};

export default keyManager;
