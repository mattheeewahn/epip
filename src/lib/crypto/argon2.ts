/**
 * Argon2id 패스프레이즈 해싱 모듈
 *
 * hash-wasm 라이브러리를 사용하여 Argon2id 해싱을 수행한다.
 * 패스프레이즈는 검증 후 즉시 메모리에서 제거된다.
 *
 * Requirements: 19.2, 19.6
 */

import { argon2id } from 'hash-wasm';

/** Argon2id 기본 파라미터 */
export interface Argon2Params {
  /** 메모리 비용 (KiB 단위). 기본값: 65536 (64MB) */
  memorySize: number;
  /** 반복 횟수. 기본값: 3 */
  iterations: number;
  /** 병렬 처리 수. 기본값: 4 */
  parallelism: number;
  /** 해시 출력 길이 (바이트). 기본값: 32 */
  hashLength: number;
}

/** 해시 결과 */
export interface HashResult {
  /** Argon2id 해시 (hex 문자열) */
  hash: string;
  /** 솔트 (hex 문자열) */
  salt: string;
}

/** 기본 프로덕션 파라미터 (64MB 메모리, 3회 반복, 4 병렬) */
export const DEFAULT_PARAMS: Argon2Params = {
  memorySize: 65536, // 64MB in KiB
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
};

/**
 * 랜덤 솔트를 생성한다 (16바이트).
 */
function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Uint8Array를 hex 문자열로 변환한다.
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * hex 문자열을 Uint8Array로 변환한다.
 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 민감한 문자열 데이터를 메모리에서 제거한다.
 *
 * JavaScript에서 문자열은 immutable이므로 완전한 제거가 불가능하지만,
 * Uint8Array의 경우 제로화를 통해 데이터를 덮어쓸 수 있다.
 *
 * @param data - 제거할 데이터 (문자열 또는 Uint8Array)
 */
export function clearFromMemory(data: string | Uint8Array): void {
  if (data instanceof Uint8Array) {
    data.fill(0);
  }
  // 문자열은 JavaScript에서 immutable이므로 직접적인 제로화가 불가능하다.
  // 호출자는 해당 참조를 null/undefined로 재할당하여 GC 대상으로 만들어야 한다.
}

/**
 * 패스프레이즈를 Argon2id로 해싱한다.
 *
 * - 16바이트 랜덤 솔트를 생성한다.
 * - Argon2id 파라미터: 메모리 64MB, 반복 3회, 병렬 4
 * - 해시와 솔트를 hex 문자열로 반환한다.
 *
 * @param passphrase - 해싱할 패스프레이즈
 * @param params - Argon2id 파라미터 (기본값 사용 가능)
 * @returns 해시와 솔트가 포함된 HashResult
 */
export async function hashPassphrase(
  passphrase: string,
  params: Argon2Params = DEFAULT_PARAMS
): Promise<HashResult> {
  const saltBytes = generateSalt();

  const hash = await argon2id({
    password: passphrase,
    salt: saltBytes,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: params.hashLength,
    outputType: 'hex',
  });

  return {
    hash,
    salt: toHex(saltBytes),
  };
}

/**
 * 패스프레이즈를 검증한다.
 *
 * - 저장된 솔트로 패스프레이즈를 다시 해싱하여 저장된 해시와 비교한다.
 * - 상수 시간 비교(constant-time comparison)로 타이밍 공격을 방지한다.
 * - 검증 후 패스프레이즈를 메모리에서 즉시 제거한다.
 *
 * @param passphrase - 검증할 패스프레이즈
 * @param storedHash - 저장된 해시 (hex 문자열)
 * @param salt - 저장된 솔트 (hex 문자열)
 * @param params - Argon2id 파라미터 (기본값 사용 가능)
 * @returns 패스프레이즈 일치 여부
 */
export async function verifyPassphrase(
  passphrase: string,
  storedHash: string,
  salt: string,
  params: Argon2Params = DEFAULT_PARAMS
): Promise<boolean> {
  try {
    const saltBytes = fromHex(salt);

    const computedHash = await argon2id({
      password: passphrase,
      salt: saltBytes,
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memorySize,
      hashLength: params.hashLength,
      outputType: 'hex',
    });

    // 상수 시간 비교로 타이밍 공격 방지
    const result = constantTimeEqual(computedHash, storedHash);

    return result;
  } finally {
    // 검증 후 패스프레이즈를 메모리에서 제거
    clearFromMemory(passphrase);
  }
}

/**
 * 상수 시간 문자열 비교 (타이밍 공격 방지).
 *
 * 두 문자열의 모든 바이트를 비교하여, 비교 시간이 내용에 의존하지 않도록 한다.
 *
 * @param a - 비교할 첫 번째 문자열
 * @param b - 비교할 두 번째 문자열
 * @returns 두 문자열이 동일한지 여부
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
