/**
 * E2EE Module 단위 테스트
 * XChaCha20-Poly1305 암호화/복호화 검증
 */

import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { encrypt, decrypt } from './e2ee';

describe('E2EE Module', () => {
  let sessionKey: Uint8Array;

  beforeAll(async () => {
    await sodium.ready;
    // 32바이트 세션 키 생성
    sessionKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  });

  describe('encrypt', () => {
    it('평문을 암호화하여 EncryptedPayload를 반환한다', async () => {
      const plaintext = new TextEncoder().encode('Hello, World!');
      const payload = await encrypt(plaintext, sessionKey);

      expect(payload.ciphertext).toBeInstanceOf(Uint8Array);
      expect(payload.nonce).toBeInstanceOf(Uint8Array);
      expect(payload.tag).toBeInstanceOf(Uint8Array);
    });

    it('24바이트 논스를 생성한다', async () => {
      const plaintext = new TextEncoder().encode('test message');
      const payload = await encrypt(plaintext, sessionKey);

      expect(payload.nonce.length).toBe(24);
    });

    it('16바이트 Poly1305 인증 태그를 생성한다', async () => {
      const plaintext = new TextEncoder().encode('test message');
      const payload = await encrypt(plaintext, sessionKey);

      expect(payload.tag.length).toBe(16);
    });

    it('동일한 평문이라도 매번 다른 논스로 다른 암호문을 생성한다', async () => {
      const plaintext = new TextEncoder().encode('same message');
      const payload1 = await encrypt(plaintext, sessionKey);
      const payload2 = await encrypt(plaintext, sessionKey);

      // 논스가 다름
      expect(payload1.nonce).not.toEqual(payload2.nonce);
      // 암호문도 다름
      expect(payload1.ciphertext).not.toEqual(payload2.ciphertext);
    });

    it('빈 평문도 암호화할 수 있다', async () => {
      const plaintext = new Uint8Array(0);
      const payload = await encrypt(plaintext, sessionKey);

      expect(payload.ciphertext).toBeInstanceOf(Uint8Array);
      expect(payload.nonce.length).toBe(24);
      expect(payload.tag.length).toBe(16);
    });
  });

  describe('decrypt', () => {
    it('암호화된 메시지를 올바르게 복호화한다', async () => {
      const originalText = 'Hello, 보안 메신저!';
      const plaintext = new TextEncoder().encode(originalText);
      const payload = await encrypt(plaintext, sessionKey);
      const decrypted = await decrypt(payload, sessionKey);

      const decryptedText = new TextDecoder().decode(decrypted);
      expect(decryptedText).toBe(originalText);
    });

    it('빈 메시지의 암호화/복호화 라운드트립이 성공한다', async () => {
      const plaintext = new Uint8Array(0);
      const payload = await encrypt(plaintext, sessionKey);
      const decrypted = await decrypt(payload, sessionKey);

      expect(decrypted.length).toBe(0);
    });

    it('큰 메시지의 암호화/복호화 라운드트립이 성공한다', async () => {
      // 64KB 랜덤 데이터 (테스트 환경에서 적절한 크기)
      const plaintext = sodium.randombytes_buf(64 * 1024);
      const payload = await encrypt(plaintext, sessionKey);
      const decrypted = await decrypt(payload, sessionKey);

      expect(decrypted).toEqual(plaintext);
    }, 30000);

    it('잘못된 키로 복호화하면 예외를 발생시킨다', async () => {
      const plaintext = new TextEncoder().encode('secret message');
      const payload = await encrypt(plaintext, sessionKey);

      const wrongKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();

      await expect(decrypt(payload, wrongKey)).rejects.toThrow();
    });

    it('변조된 암호문으로 복호화하면 예외를 발생시킨다', async () => {
      const plaintext = new TextEncoder().encode('secret message');
      const payload = await encrypt(plaintext, sessionKey);

      // 암호문 변조
      const tampered = { ...payload, ciphertext: new Uint8Array(payload.ciphertext.length) };
      tampered.ciphertext.set(payload.ciphertext);
      tampered.ciphertext[0] ^= 0xff;

      await expect(decrypt(tampered, sessionKey)).rejects.toThrow();
    });

    it('변조된 태그로 복호화하면 예외를 발생시킨다', async () => {
      const plaintext = new TextEncoder().encode('secret message');
      const payload = await encrypt(plaintext, sessionKey);

      // 태그 변조
      const tampered = { ...payload, tag: new Uint8Array(payload.tag.length) };
      tampered.tag.set(payload.tag);
      tampered.tag[0] ^= 0xff;

      await expect(decrypt(tampered, sessionKey)).rejects.toThrow();
    });

    it('변조된 논스로 복호화하면 예외를 발생시킨다', async () => {
      const plaintext = new TextEncoder().encode('secret message');
      const payload = await encrypt(plaintext, sessionKey);

      // 논스 변조
      const tampered = { ...payload, nonce: new Uint8Array(payload.nonce.length) };
      tampered.nonce.set(payload.nonce);
      tampered.nonce[0] ^= 0xff;

      await expect(decrypt(tampered, sessionKey)).rejects.toThrow();
    });
  });

  describe('라운드트립', () => {
    it('다양한 유니코드 문자를 올바르게 처리한다', async () => {
      const messages = [
        '안녕하세요',
        '🔐 암호화된 메시지 🔒',
        'مرحبا بالعالم',
        '日本語テスト',
        'Ĥéĺĺö Ŵőŕĺď',
      ];

      for (const msg of messages) {
        const plaintext = new TextEncoder().encode(msg);
        const payload = await encrypt(plaintext, sessionKey);
        const decrypted = await decrypt(payload, sessionKey);
        const result = new TextDecoder().decode(decrypted);
        expect(result).toBe(msg);
      }
    });

    it('바이너리 데이터를 올바르게 처리한다', async () => {
      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127]);
      const payload = await encrypt(binaryData, sessionKey);
      const decrypted = await decrypt(payload, sessionKey);

      expect(decrypted).toEqual(binaryData);
    });
  });
});
