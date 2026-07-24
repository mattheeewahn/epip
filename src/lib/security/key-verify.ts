/**
 * 키 검증 모듈 (Key Verification)
 *
 * 양측 공개 키를 기반으로 60자리 안전번호를 생성하고,
 * QR 코드 데이터 및 검증 상태를 관리한다.
 *
 * - SHA-256 해시로 60자리 안전번호 생성
 * - 5자리 × 12그룹 형식으로 표시
 * - 검증 완료 상태 표시
 * - 키 변경 시 경고 및 검증 상태 초기화
 * - 미검증 대화 안내 메시지
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6
 */

/** 키 검증 상태 */
export type VerificationStatus = 'unverified' | 'verified' | 'key_changed';

/** 안전번호 정보 */
export interface SafetyNumber {
  /** 60자리 숫자 문자열 */
  digits: string;
  /** 5자리 × 12그룹 포맷 */
  formatted: string;
  /** QR 코드 데이터 (숫자 + 공개키 정보) */
  qrData: string;
}

/** 키 검증 상태 정보 */
export interface KeyVerificationState {
  peerId: string;
  status: VerificationStatus;
  safetyNumber: SafetyNumber | null;
  verifiedAt: number | null;
  lastKeyChange: number | null;
}

/** 키 변경 경고 콜백 */
export type KeyChangeCallback = (peerId: string, newSafetyNumber: SafetyNumber) => void;

/** 피어별 검증 상태 */
const verificationStates: Map<string, KeyVerificationState> = new Map();

/** 키 변경 리스너 */
const keyChangeListeners: Set<KeyChangeCallback> = new Set();

/**
 * 양측 공개 키로부터 60자리 안전번호를 생성한다.
 *
 * SHA-256 해시를 사용하여 양측 공개 키를 결합하고,
 * 해시 결과에서 60자리 숫자를 추출한다.
 *
 * @param myPublicKey - 내 공개 키 (Uint8Array)
 * @param theirPublicKey - 상대방 공개 키 (Uint8Array)
 * @returns 60자리 안전번호 정보
 */
export async function generateSafetyNumber(
  myPublicKey: Uint8Array,
  theirPublicKey: Uint8Array
): Promise<SafetyNumber> {
  // 양측 공개 키를 정렬하여 결합 (양측에서 동일한 결과 보장)
  const combined = combineKeys(myPublicKey, theirPublicKey);

  // SHA-256 해시 수행
  const inputBuffer = new Uint8Array(combined).buffer as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', inputBuffer);
  const hashArray = new Uint8Array(hashBuffer);

  // 해시에서 60자리 숫자 추출
  const digits = extractDigits(hashArray, 60);

  // 5자리 × 12그룹 포맷
  const formatted = formatSafetyNumber(digits);

  // QR 코드 데이터 생성
  const qrData = generateQRData(digits, myPublicKey, theirPublicKey);

  return { digits, formatted, qrData };
}

/**
 * 두 공개 키를 일관된 순서로 결합한다.
 *
 * 바이트 비교로 정렬하여 양측에서 동일한 안전번호를 생성한다.
 */
function combineKeys(keyA: Uint8Array, keyB: Uint8Array): Uint8Array {
  // 바이트 비교로 순서 결정 (항상 동일한 순서로 결합)
  let first: Uint8Array;
  let second: Uint8Array;

  const comparison = compareBytes(keyA, keyB);
  if (comparison <= 0) {
    first = keyA;
    second = keyB;
  } else {
    first = keyB;
    second = keyA;
  }

  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);

  return combined;
}

/**
 * 두 바이트 배열을 사전순으로 비교한다.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return a.length - b.length;
}

/**
 * 해시 바이트에서 지정된 길이의 숫자 문자열을 추출한다.
 *
 * 각 바이트를 10진수로 변환하여 필요한 자릿수를 채운다.
 * 32바이트(256비트)의 SHA-256 해시에서 60자리를 추출한다.
 */
function extractDigits(hash: Uint8Array, length: number): string {
  let digits = '';

  for (let i = 0; i < hash.length && digits.length < length; i++) {
    // 각 바이트(0-255)를 3자리 숫자로 변환
    const threeDigits = hash[i]!.toString().padStart(3, '0');
    digits += threeDigits;
  }

  // 정확히 요청된 길이만큼 반환
  return digits.slice(0, length);
}

/**
 * 60자리 숫자를 5자리 × 12그룹으로 포맷한다.
 *
 * 예: "12345 67890 12345 67890 12345 67890 12345 67890 12345 67890 12345 67890"
 */
function formatSafetyNumber(digits: string): string {
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 5) {
    groups.push(digits.slice(i, i + 5));
  }
  return groups.join(' ');
}

/**
 * QR 코드 데이터를 생성한다.
 *
 * 안전번호와 공개 키 정보를 포함한 검증용 데이터를 생성한다.
 */
function generateQRData(
  digits: string,
  myPublicKey: Uint8Array,
  theirPublicKey: Uint8Array
): string {
  const myKeyHex = bytesToHex(myPublicKey.slice(0, 8));
  const theirKeyHex = bytesToHex(theirPublicKey.slice(0, 8));

  return JSON.stringify({
    version: 1,
    safetyNumber: digits,
    keys: [myKeyHex, theirKeyHex],
  });
}

/**
 * Uint8Array를 hex 문자열로 변환한다.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 피어의 키 검증 상태를 초기화하거나 업데이트한다.
 *
 * 키가 변경된 경우 검증 상태를 초기화하고 경고를 발생시킨다.
 *
 * @param peerId - 피어 식별자
 * @param myPublicKey - 내 공개 키
 * @param theirPublicKey - 상대방 공개 키
 */
export async function updateKeyVerification(
  peerId: string,
  myPublicKey: Uint8Array,
  theirPublicKey: Uint8Array
): Promise<KeyVerificationState> {
  const safetyNumber = await generateSafetyNumber(myPublicKey, theirPublicKey);
  const existingState = verificationStates.get(peerId);

  // 이전 안전번호와 비교 (키 변경 감지)
  if (existingState?.safetyNumber && existingState.safetyNumber.digits !== safetyNumber.digits) {
    // 키가 변경됨: 검증 상태 초기화 + 경고
    const newState: KeyVerificationState = {
      peerId,
      status: 'key_changed',
      safetyNumber,
      verifiedAt: null,
      lastKeyChange: Date.now(),
    };
    verificationStates.set(peerId, newState);

    // 키 변경 경고 알림
    for (const listener of keyChangeListeners) {
      try {
        listener(peerId, safetyNumber);
      } catch {
        // 리스너 오류 무시
      }
    }

    return { ...newState };
  }

  // 새로운 피어 또는 키 변경 없음
  if (!existingState) {
    const newState: KeyVerificationState = {
      peerId,
      status: 'unverified',
      safetyNumber,
      verifiedAt: null,
      lastKeyChange: null,
    };
    verificationStates.set(peerId, newState);
    return { ...newState };
  }

  // 기존 상태 유지 (안전번호 업데이트만)
  existingState.safetyNumber = safetyNumber;
  return { ...existingState };
}

/**
 * 피어를 "검증됨" 상태로 표시한다.
 *
 * 사용자가 안전번호를 직접 비교하여 확인한 후 호출한다.
 *
 * @param peerId - 피어 식별자
 * @returns 검증 성공 여부
 */
export function markAsVerified(peerId: string): boolean {
  const state = verificationStates.get(peerId);
  if (!state) return false;

  state.status = 'verified';
  state.verifiedAt = Date.now();
  return true;
}

/**
 * 피어의 검증 상태를 반환한다.
 *
 * @param peerId - 피어 식별자
 * @returns 검증 상태 정보 또는 null
 */
export function getVerificationState(peerId: string): KeyVerificationState | null {
  const state = verificationStates.get(peerId);
  return state ? { ...state } : null;
}

/**
 * 미검증 대화 안내 메시지를 반환한다.
 *
 * @param peerId - 피어 식별자
 * @returns 안내 메시지 또는 null (검증됨인 경우)
 */
export function getUnverifiedWarning(peerId: string): string | null {
  const state = verificationStates.get(peerId);

  if (!state) {
    return '키 검증이 필요합니다. 안전번호를 확인하세요.';
  }

  switch (state.status) {
    case 'verified':
      return null;
    case 'key_changed':
      return '⚠️ 상대방의 보안 키가 변경되었습니다. 안전번호를 다시 확인하세요.';
    case 'unverified':
      return '이 대화는 아직 검증되지 않았습니다. 안전번호를 비교하여 상대방을 확인하세요.';
  }
}

/**
 * 키 변경 경고 리스너를 등록한다.
 *
 * @param callback - 키 변경 시 호출할 함수
 * @returns 리스너 해제 함수
 */
export function onKeyChange(callback: KeyChangeCallback): () => void {
  keyChangeListeners.add(callback);
  return () => {
    keyChangeListeners.delete(callback);
  };
}

/**
 * 모듈 상태를 초기화한다 (테스트용).
 */
export function resetKeyVerification(): void {
  verificationStates.clear();
  keyChangeListeners.clear();
}
