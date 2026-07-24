/**
 * 메시지 패딩 및 더미 트래픽 모듈
 *
 * 메시지 길이 분석을 방지하기 위한 고정 크기 패딩과
 * 실제 통신 패턴을 은닉하기 위한 더미 트래픽 생성기.
 *
 * 패딩 스킴:
 * - 첫 4바이트: 실제 메시지 길이 (big-endian uint32)
 * - 다음 N바이트: 실제 메시지 데이터
 * - 나머지 바이트: 랜덤 패딩 (targetSize까지)
 *
 * Requirements: 4.3, 4.4
 */

/** 기본 패딩 블록 크기 (바이트) */
const DEFAULT_BLOCK_SIZE = 4096;

/** 메시지 길이 헤더 크기 (바이트) */
const LENGTH_HEADER_SIZE = 4;

/** 더미 트래픽 최소 간격 (밀리초) */
const DUMMY_MIN_INTERVAL_MS = 30_000;

/** 더미 트래픽 최대 간격 (밀리초) */
const DUMMY_MAX_INTERVAL_MS = 120_000;

/** 더미 트래픽 타이머 ID */
let dummyTrafficTimerId: ReturnType<typeof setTimeout> | null = null;

/** 더미 트래픽 활성 상태 */
let dummyTrafficActive = false;

/**
 * 메시지에 고정 크기 패딩을 적용한다.
 *
 * 메시지를 targetSize 바이트로 패딩한다.
 * 메시지 + 헤더가 targetSize보다 큰 경우, targetSize의 다음 배수로 패딩한다.
 *
 * @param message - 원본 메시지 바이트 배열
 * @param targetSize - 목표 패딩 크기 (기본: 4096바이트)
 * @returns 패딩된 메시지 (고정 크기)
 */
export function padMessage(
  message: Uint8Array,
  targetSize: number = DEFAULT_BLOCK_SIZE
): Uint8Array {
  const totalNeeded = LENGTH_HEADER_SIZE + message.length;

  // 목표 크기 계산: 메시지가 targetSize에 맞지 않으면 다음 배수로 확장
  let paddedSize = targetSize;
  while (paddedSize < totalNeeded) {
    paddedSize += targetSize;
  }

  const padded = new Uint8Array(paddedSize);

  // 첫 4바이트: 메시지 길이 (big-endian uint32)
  const lengthView = new DataView(padded.buffer, padded.byteOffset, LENGTH_HEADER_SIZE);
  lengthView.setUint32(0, message.length, false); // big-endian

  // 메시지 데이터 복사
  padded.set(message, LENGTH_HEADER_SIZE);

  // 나머지를 랜덤 바이트로 채움
  const paddingStart = LENGTH_HEADER_SIZE + message.length;
  const randomPadding = getRandomBytes(paddedSize - paddingStart);
  padded.set(randomPadding, paddingStart);

  return padded;
}

/**
 * 패딩된 메시지에서 원본 메시지를 추출한다.
 *
 * @param paddedMessage - 패딩된 메시지
 * @returns 원본 메시지 바이트 배열
 * @throws 메시지 길이가 유효하지 않은 경우
 */
export function unpadMessage(paddedMessage: Uint8Array): Uint8Array {
  if (paddedMessage.length < LENGTH_HEADER_SIZE) {
    throw new Error('Invalid padded message: too short');
  }

  // 첫 4바이트에서 원본 메시지 길이 읽기
  const lengthView = new DataView(
    paddedMessage.buffer,
    paddedMessage.byteOffset,
    LENGTH_HEADER_SIZE
  );
  const messageLength = lengthView.getUint32(0, false); // big-endian

  // 유효성 검증
  if (messageLength > paddedMessage.length - LENGTH_HEADER_SIZE) {
    throw new Error('Invalid padded message: declared length exceeds available data');
  }

  // 원본 메시지 추출
  return paddedMessage.slice(LENGTH_HEADER_SIZE, LENGTH_HEADER_SIZE + messageLength);
}

/**
 * 더미 트래픽 생성을 시작한다.
 *
 * 30초~120초 무작위 간격으로 sendFn을 호출하여 더미 메시지를 전송한다.
 * 더미 메시지는 실제 메시지와 동일한 크기와 구조를 가진다.
 *
 * @param sendFn - 더미 메시지를 전송하는 함수
 */
export function startDummyTraffic(sendFn: () => Promise<void>): void {
  if (dummyTrafficActive) {
    return; // 이미 활성화 상태면 중복 시작 방지
  }

  dummyTrafficActive = true;
  scheduleDummySend(sendFn);
}

/**
 * 더미 트래픽 생성을 중지한다.
 */
export function stopDummyTraffic(): void {
  dummyTrafficActive = false;
  if (dummyTrafficTimerId !== null) {
    clearTimeout(dummyTrafficTimerId);
    dummyTrafficTimerId = null;
  }
}

/**
 * 더미 페이로드를 생성한다.
 *
 * 실제 암호화된 메시지와 구별 불가능한 랜덤 페이로드를 만든다.
 * 기본 크기는 DEFAULT_BLOCK_SIZE(4096)로 실제 패딩된 메시지와 동일한 크기.
 *
 * @param size - 페이로드 크기 (기본: 4096바이트)
 * @returns 랜덤 페이로드
 */
export function generateDummyPayload(size: number = DEFAULT_BLOCK_SIZE): Uint8Array {
  return getRandomBytes(size);
}

/**
 * 30초~120초 사이 무작위 간격을 계산한다.
 */
function getRandomInterval(): number {
  return (
    DUMMY_MIN_INTERVAL_MS +
    Math.floor(Math.random() * (DUMMY_MAX_INTERVAL_MS - DUMMY_MIN_INTERVAL_MS))
  );
}

/**
 * 다음 더미 전송을 스케줄링한다.
 */
function scheduleDummySend(sendFn: () => Promise<void>): void {
  if (!dummyTrafficActive) return;

  const interval = getRandomInterval();

  dummyTrafficTimerId = setTimeout(async () => {
    if (!dummyTrafficActive) return;

    try {
      await sendFn();
    } catch {
      // 더미 트래픽 전송 실패는 무시 (실제 메시지가 아님)
    }

    // 다음 더미 전송 스케줄
    scheduleDummySend(sendFn);
  }, interval);
}

/**
 * 랜덤 바이트 배열 생성
 *
 * crypto.getRandomValues가 사용 가능하면 사용하고,
 * 그렇지 않으면 Math.random 폴백 사용.
 */
function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // 폴백 (테스트 환경 등)
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return bytes;
}
