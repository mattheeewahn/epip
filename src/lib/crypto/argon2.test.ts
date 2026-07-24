/**
 * Argon2id 패스프레이즈 해싱 모듈 테스트
 *
 * Requirements: 19.2, 19.6
 */

import { describe, it, expect } from 'vitest';
import {
  hashPassphrase,
  verifyPassphrase,
  clearFromMemory,
  DEFAULT_PARAMS,
  type Argon2Params,
} from './argon2';

/** 테스트용 저비용 파라미터 (타임아웃 방지) */
const TEST_PARAMS: Argon2Params = {
  memorySize: 1024, // 1MB (테스트용)
  iterations: 1,
  parallelism: 1,
  hashLength: 32,
};

describe('Argon2id 패스프레이즈 해싱', () => {
  describe('DEFAULT_PARAMS', () => {
    it('프로덕션 파라미터가 올바르게 설정되어야 한다 (64MB, 3회, 4 병렬)', () => {
      expect(DEFAULT_PARAMS.memorySize).toBe(65536); // 64MB in KiB
      expect(DEFAULT_PARAMS.iterations).toBe(3);
      expect(DEFAULT_PARAMS.parallelism).toBe(4);
      expect(DEFAULT_PARAMS.hashLength).toBe(32);
    });
  });

  describe('hashPassphrase', () => {
    it('패스프레이즈를 해싱하여 hash와 salt를 반환해야 한다', async () => {
      const result = await hashPassphrase('test-passphrase', TEST_PARAMS);

      expect(result.hash).toBeDefined();
      expect(result.salt).toBeDefined();
      // 32바이트 해시 = 64자 hex 문자열
      expect(result.hash).toHaveLength(64);
      // 16바이트 솔트 = 32자 hex 문자열
      expect(result.salt).toHaveLength(32);
    });

    it('동일 패스프레이즈라도 매번 다른 솔트/해시를 생성해야 한다', async () => {
      const result1 = await hashPassphrase('same-passphrase', TEST_PARAMS);
      const result2 = await hashPassphrase('same-passphrase', TEST_PARAMS);

      expect(result1.salt).not.toBe(result2.salt);
      expect(result1.hash).not.toBe(result2.hash);
    });

    it('해시가 유효한 hex 문자열이어야 한다', async () => {
      const result = await hashPassphrase('hex-test', TEST_PARAMS);

      expect(result.hash).toMatch(/^[0-9a-f]+$/);
      expect(result.salt).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('verifyPassphrase', () => {
    it('올바른 패스프레이즈를 검증하면 true를 반환해야 한다', async () => {
      const passphrase = 'correct-passphrase';
      const { hash, salt } = await hashPassphrase(passphrase, TEST_PARAMS);

      const isValid = await verifyPassphrase(passphrase, hash, salt, TEST_PARAMS);

      expect(isValid).toBe(true);
    });

    it('잘못된 패스프레이즈를 검증하면 false를 반환해야 한다', async () => {
      const { hash, salt } = await hashPassphrase('original', TEST_PARAMS);

      const isValid = await verifyPassphrase('wrong-passphrase', hash, salt, TEST_PARAMS);

      expect(isValid).toBe(false);
    });

    it('다른 솔트로 검증하면 false를 반환해야 한다', async () => {
      const passphrase = 'test-passphrase';
      const { hash } = await hashPassphrase(passphrase, TEST_PARAMS);
      const { salt: differentSalt } = await hashPassphrase('other', TEST_PARAMS);

      const isValid = await verifyPassphrase(passphrase, hash, differentSalt, TEST_PARAMS);

      expect(isValid).toBe(false);
    });

    it('빈 패스프레이즈는 에러를 발생시켜야 한다', async () => {
      await expect(hashPassphrase('', TEST_PARAMS)).rejects.toThrow();
    });
  });

  describe('clearFromMemory', () => {
    it('Uint8Array를 제로화해야 한다', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      clearFromMemory(data);

      expect(data.every((byte) => byte === 0)).toBe(true);
    });

    it('빈 Uint8Array에 대해 오류 없이 동작해야 한다', () => {
      const data = new Uint8Array(0);
      expect(() => clearFromMemory(data)).not.toThrow();
    });

    it('문자열에 대해 오류 없이 동작해야 한다', () => {
      expect(() => clearFromMemory('sensitive-data')).not.toThrow();
    });
  });
});
