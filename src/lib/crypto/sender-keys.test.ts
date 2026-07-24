/**
 * Sender Keys 모듈 단위 테스트
 *
 * - Sender Key 생성/로테이션/폐기
 * - 그룹 메시지 암호화/복호화 라운드트립
 * - HMAC 발신자 인증 및 검증
 * - 멤버 퇴장 시나리오
 */

import { describe, it, expect } from 'vitest';
import {
  generateSenderKey,
  encryptGroupMessage,
  decryptGroupMessage,
  authenticateMessage,
  verifyMessageAuth,
  rotateSenderKey,
  revokeSenderKey,
} from './sender-keys';

describe('Sender Keys - 그룹 E2EE', () => {
  describe('generateSenderKey', () => {
    it('32바이트 Sender Key를 생성한다', async () => {
      const key = await generateSenderKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('매번 다른 랜덤 키를 생성한다', async () => {
      const key1 = await generateSenderKey();
      const key2 = await generateSenderKey();
      expect(key1).not.toEqual(key2);
    });
  });

  describe('encryptGroupMessage / decryptGroupMessage', () => {
    it('평문을 암호화하고 동일한 Sender Key로 복호화한다', async () => {
      const senderKey = await generateSenderKey();
      const plaintext = new TextEncoder().encode('그룹 채팅 메시지');

      const encrypted = await encryptGroupMessage(plaintext, senderKey);
      const decrypted = await decryptGroupMessage(encrypted, senderKey);

      expect(decrypted).toEqual(plaintext);
    });

    it('암호화 결과에 ciphertext, nonce, tag가 포함된다', async () => {
      const senderKey = await generateSenderKey();
      const plaintext = new TextEncoder().encode('테스트');

      const encrypted = await encryptGroupMessage(plaintext, senderKey);

      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce.length).toBe(24);
      expect(encrypted.tag).toBeInstanceOf(Uint8Array);
    });

    it('다른 Sender Key로는 복호화할 수 없다', async () => {
      const senderKey1 = await generateSenderKey();
      const senderKey2 = await generateSenderKey();
      const plaintext = new TextEncoder().encode('비밀 메시지');

      const encrypted = await encryptGroupMessage(plaintext, senderKey1);

      await expect(decryptGroupMessage(encrypted, senderKey2)).rejects.toThrow();
    });

    it('동일 키를 가진 여러 수신자가 복호화할 수 있다', async () => {
      const senderKey = await generateSenderKey();
      const plaintext = new TextEncoder().encode('전체 공지');

      const encrypted = await encryptGroupMessage(plaintext, senderKey);

      // 같은 sender key를 가진 여러 수신자가 동일 암호문을 복호화
      const decrypted1 = await decryptGroupMessage(encrypted, senderKey);
      const decrypted2 = await decryptGroupMessage(encrypted, senderKey);

      expect(decrypted1).toEqual(plaintext);
      expect(decrypted2).toEqual(plaintext);
    });

    it('빈 메시지도 정상적으로 암호화/복호화된다', async () => {
      const senderKey = await generateSenderKey();
      const plaintext = new Uint8Array(0);

      const encrypted = await encryptGroupMessage(plaintext, senderKey);
      const decrypted = await decryptGroupMessage(encrypted, senderKey);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('authenticateMessage / verifyMessageAuth', () => {
    it('메시지에 대해 HMAC을 생성하고 검증한다', async () => {
      const senderKey = await generateSenderKey();
      const message = new TextEncoder().encode('인증할 메시지');

      const hmac = await authenticateMessage(message, senderKey);
      const isValid = await verifyMessageAuth(message, hmac, senderKey);

      expect(hmac).toBeInstanceOf(Uint8Array);
      expect(hmac.length).toBe(32);
      expect(isValid).toBe(true);
    });

    it('다른 키로 생성된 HMAC은 검증에 실패한다', async () => {
      const senderKey1 = await generateSenderKey();
      const senderKey2 = await generateSenderKey();
      const message = new TextEncoder().encode('위조 시도');

      const hmac = await authenticateMessage(message, senderKey1);
      const isValid = await verifyMessageAuth(message, hmac, senderKey2);

      expect(isValid).toBe(false);
    });

    it('변조된 메시지는 HMAC 검증에 실패한다', async () => {
      const senderKey = await generateSenderKey();
      const originalMessage = new TextEncoder().encode('원본 메시지');
      const tamperedMessage = new TextEncoder().encode('변조된 메시지');

      const hmac = await authenticateMessage(originalMessage, senderKey);
      const isValid = await verifyMessageAuth(tamperedMessage, hmac, senderKey);

      expect(isValid).toBe(false);
    });

    it('동일 메시지와 키에 대해 동일한 HMAC을 생성한다', async () => {
      const senderKey = await generateSenderKey();
      const message = new TextEncoder().encode('일관성 테스트');

      const hmac1 = await authenticateMessage(message, senderKey);
      const hmac2 = await authenticateMessage(message, senderKey);

      expect(hmac1).toEqual(hmac2);
    });
  });

  describe('rotateSenderKey', () => {
    it('새 Sender Key를 생성하고 이전 키를 폐기한다', async () => {
      const currentKey = await generateSenderKey();
      const currentKeyCopy = new Uint8Array(currentKey);

      const newKey = await rotateSenderKey(currentKey);

      // 새 키는 32바이트여야 한다
      expect(newKey).toBeInstanceOf(Uint8Array);
      expect(newKey.length).toBe(32);

      // 이전 키는 제로화되어야 한다
      const zeroed = new Uint8Array(32);
      expect(currentKey).toEqual(zeroed);

      // 새 키는 이전 키와 달라야 한다
      expect(newKey).not.toEqual(currentKeyCopy);
    });

    it('로테이션된 키로 이전 암호문을 복호화할 수 없다', async () => {
      const originalKey = await generateSenderKey();
      const plaintext = new TextEncoder().encode('이전 메시지');

      const encrypted = await encryptGroupMessage(plaintext, originalKey);

      // 키 로테이션 실행
      const newKey = await rotateSenderKey(originalKey);

      // 새 키로는 이전 암호문을 복호화할 수 없다
      await expect(decryptGroupMessage(encrypted, newKey)).rejects.toThrow();
    });
  });

  describe('revokeSenderKey', () => {
    it('키를 안전하게 메모리에서 제거한다 (제로화)', async () => {
      const key = await generateSenderKey();

      await revokeSenderKey(key);

      const zeroed = new Uint8Array(32);
      expect(key).toEqual(zeroed);
    });
  });

  describe('그룹 시나리오: 멤버 퇴장', () => {
    it('퇴장한 멤버의 키로는 새 메시지를 복호화할 수 없다', async () => {
      // 3명의 그룹 멤버
      const aliceKey = await generateSenderKey();
      const bobKey = await generateSenderKey();
      const charlieKey = await generateSenderKey();

      // Alice가 그룹에 메시지 전송
      const msg1 = new TextEncoder().encode('안녕하세요 모두');
      const encrypted1 = await encryptGroupMessage(msg1, aliceKey);

      // Bob과 Charlie 모두 복호화 가능 (Alice의 키를 가지고 있으므로)
      expect(await decryptGroupMessage(encrypted1, aliceKey)).toEqual(msg1);

      // Charlie가 퇴장 → Alice의 키 로테이션
      const newAliceKey = await rotateSenderKey(aliceKey);
      // Charlie에게는 새 키를 배포하지 않음

      // Alice가 새 키로 메시지 전송
      const msg2 = new TextEncoder().encode('Charlie 나간 후 메시지');
      const encrypted2 = await encryptGroupMessage(msg2, newAliceKey);

      // Bob은 새 키를 받아 복호화 가능
      expect(await decryptGroupMessage(encrypted2, newAliceKey)).toEqual(msg2);

      // Charlie는 이전 키(제로화됨)로 복호화 불가
      await expect(decryptGroupMessage(encrypted2, aliceKey)).rejects.toThrow();
    });
  });
});
