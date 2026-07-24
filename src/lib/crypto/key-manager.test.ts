/**
 * Key Manager 단위 테스트
 * X25519 키 교환, Double Ratchet 프로토콜, 키 무결성 검증
 *
 * Requirements: 2.1, 2.4, 2.5
 */

import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import {
  generateKeyPair,
  deriveSharedSecret,
  initializeRatchet,
  ratchetStep,
  getMessageKey,
  verifyKeyIntegrity,
  KeyIntegrityError,
} from './key-manager';

describe('Key Manager', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  describe('generateKeyPair', () => {
    it('32바이트 공개 키와 비밀 키를 생성한다', async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.publicKey.length).toBe(32);
      expect(keyPair.privateKey.length).toBe(32);
    });

    it('매번 다른 키 쌍을 생성한다', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();

      expect(kp1.publicKey).not.toEqual(kp2.publicKey);
      expect(kp1.privateKey).not.toEqual(kp2.privateKey);
    });
  });

  describe('deriveSharedSecret', () => {
    it('DH 키 교환으로 32바이트 공유 비밀을 도출한다', async () => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();

      const sharedA = await deriveSharedSecret(alice.privateKey, bob.publicKey);
      const sharedB = await deriveSharedSecret(bob.privateKey, alice.publicKey);

      expect(sharedA.length).toBe(32);
      expect(sharedA).toEqual(sharedB);
    });

    it('동일한 키 쌍으로 항상 동일한 공유 비밀을 도출한다', async () => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();

      const shared1 = await deriveSharedSecret(alice.privateKey, bob.publicKey);
      const shared2 = await deriveSharedSecret(alice.privateKey, bob.publicKey);

      expect(shared1).toEqual(shared2);
    });

    it('다른 상대방과는 다른 공유 비밀을 도출한다', async () => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();
      const charlie = await generateKeyPair();

      const sharedAB = await deriveSharedSecret(alice.privateKey, bob.publicKey);
      const sharedAC = await deriveSharedSecret(alice.privateKey, charlie.publicKey);

      expect(sharedAB).not.toEqual(sharedAC);
    });
  });

  describe('initializeRatchet', () => {
    it('초기 RatchetState를 올바르게 생성한다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      const state = await initializeRatchet(sharedSecret, true);

      expect(state.rootKey).toBeInstanceOf(Uint8Array);
      expect(state.rootKey.length).toBe(32);
      expect(state.sendChainKey.length).toBe(32);
      expect(state.recvChainKey.length).toBe(32);
      expect(state.sendRatchetPrivate.length).toBe(32);
      expect(state.sendMessageNumber).toBe(0);
      expect(state.recvMessageNumber).toBe(0);
    });

    it('initiator와 responder의 send/recv 체인 키가 대칭이다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      const initiator = await initializeRatchet(sharedSecret, true);
      const responder = await initializeRatchet(sharedSecret, false);

      // Initiator의 send = Responder의 recv (역할 반전)
      expect(initiator.sendChainKey).toEqual(responder.recvChainKey);
      expect(initiator.recvChainKey).toEqual(responder.sendChainKey);
    });
  });

  describe('ratchetStep', () => {
    it('DH ratchet 단계를 수행하여 새로운 상태를 반환한다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      const state = await initializeRatchet(sharedSecret, true);

      const theirNewKeyPair = sodium.crypto_box_keypair();
      const newState = await ratchetStep(state, theirNewKeyPair.publicKey);

      expect(newState.rootKey).not.toEqual(state.rootKey);
      expect(newState.sendChainKey).not.toEqual(state.sendChainKey);
      expect(newState.recvChainKey).not.toEqual(state.recvChainKey);
      expect(newState.sendRatchetPrivate).not.toEqual(state.sendRatchetPrivate);
      expect(newState.recvRatchetPublic).toEqual(theirNewKeyPair.publicKey);
      expect(newState.sendMessageNumber).toBe(0);
      expect(newState.recvMessageNumber).toBe(0);
    });

    it('연속 ratchet 단계마다 다른 키가 생성된다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      let state = await initializeRatchet(sharedSecret, true);

      const keyPair1 = sodium.crypto_box_keypair();
      const state1 = await ratchetStep(state, keyPair1.publicKey);

      const keyPair2 = sodium.crypto_box_keypair();
      const state2 = await ratchetStep(state1, keyPair2.publicKey);

      expect(state1.rootKey).not.toEqual(state2.rootKey);
      expect(state1.sendChainKey).not.toEqual(state2.sendChainKey);
    });
  });

  describe('getMessageKey', () => {
    it('송신 메시지 키를 생성하고 체인을 진행한다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      const state = await initializeRatchet(sharedSecret, true);

      const [msgKey, newState] = await getMessageKey(state, true);

      expect(msgKey).toBeInstanceOf(Uint8Array);
      expect(msgKey.length).toBe(32);
      expect(newState.sendMessageNumber).toBe(1);
      expect(newState.sendChainKey).not.toEqual(state.sendChainKey);
    });

    it('수신 메시지 키를 생성하고 체인을 진행한다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      const state = await initializeRatchet(sharedSecret, true);

      const [msgKey, newState] = await getMessageKey(state, false);

      expect(msgKey).toBeInstanceOf(Uint8Array);
      expect(msgKey.length).toBe(32);
      expect(newState.recvMessageNumber).toBe(1);
      expect(newState.recvChainKey).not.toEqual(state.recvChainKey);
    });

    it('연속 호출 시 서로 다른 메시지 키를 반환한다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      const state = await initializeRatchet(sharedSecret, true);

      const [msgKey1, state1] = await getMessageKey(state, true);
      const [msgKey2, state2] = await getMessageKey(state1, true);

      expect(msgKey1).not.toEqual(msgKey2);
      expect(state2.sendMessageNumber).toBe(2);
    });

    it('initiator의 송신 키와 responder의 수신 키가 일치한다', async () => {
      const sharedSecret = sodium.randombytes_buf(32);
      const initiator = await initializeRatchet(sharedSecret, true);
      const responder = await initializeRatchet(sharedSecret, false);

      const [sendKey] = await getMessageKey(initiator, true);
      const [recvKey] = await getMessageKey(responder, false);

      expect(sendKey).toEqual(recvKey);
    });
  });

  describe('verifyKeyIntegrity', () => {
    it('동일한 키에 대해 true를 반환한다', async () => {
      const keyPair = await generateKeyPair();

      const result = verifyKeyIntegrity(keyPair.publicKey, keyPair.publicKey);
      expect(result).toBe(true);
    });

    it('다른 키에 대해 KeyIntegrityError를 발생시킨다', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();

      expect(() => verifyKeyIntegrity(kp1.publicKey, kp2.publicKey)).toThrow(KeyIntegrityError);
    });

    it('길이가 다른 키에 대해 KeyIntegrityError를 발생시킨다', () => {
      const key32 = new Uint8Array(32);
      const key16 = new Uint8Array(16);

      expect(() => verifyKeyIntegrity(key32, key16)).toThrow(KeyIntegrityError);
      expect(() => verifyKeyIntegrity(key32, key16)).toThrow('키 길이 불일치');
    });

    it('1비트 변조도 감지한다', async () => {
      const keyPair = await generateKeyPair();
      const tampered = new Uint8Array(keyPair.publicKey);
      tampered[0] ^= 0x01; // 1비트만 변조

      expect(() => verifyKeyIntegrity(keyPair.publicKey, tampered)).toThrow(KeyIntegrityError);
    });

    it('중간자 공격 시나리오에서 에러 메시지에 경고를 포함한다', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();

      expect(() => verifyKeyIntegrity(kp1.publicKey, kp2.publicKey)).toThrow(
        '중간자 공격이 의심됩니다'
      );
    });
  });
});
