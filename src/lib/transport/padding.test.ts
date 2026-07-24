/**
 * 메시지 패딩 및 더미 트래픽 단위 테스트
 *
 * Requirements: 4.3, 4.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  padMessage,
  unpadMessage,
  startDummyTraffic,
  stopDummyTraffic,
  generateDummyPayload,
} from './padding';

beforeEach(() => {
  vi.useFakeTimers();
  stopDummyTraffic();
});

afterEach(() => {
  stopDummyTraffic();
  vi.useRealTimers();
});

describe('padMessage', () => {
  it('메시지를 기본 4096바이트로 패딩한다', () => {
    const message = new Uint8Array([1, 2, 3, 4, 5]);
    const padded = padMessage(message);

    expect(padded.length).toBe(4096);
  });

  it('첫 4바이트에 원본 메시지 길이를 big-endian으로 저장한다', () => {
    const message = new Uint8Array([10, 20, 30]);
    const padded = padMessage(message);

    const view = new DataView(padded.buffer, padded.byteOffset, 4);
    const storedLength = view.getUint32(0, false);

    expect(storedLength).toBe(3);
  });

  it('헤더 이후에 원본 메시지 데이터를 포함한다', () => {
    const message = new Uint8Array([10, 20, 30, 40, 50]);
    const padded = padMessage(message);

    const extracted = padded.slice(4, 4 + message.length);
    expect(extracted).toEqual(message);
  });

  it('메시지가 targetSize보다 크면 다음 배수로 패딩한다', () => {
    // 4096 - 4 = 4092바이트 이상의 메시지
    const message = new Uint8Array(5000);
    message.fill(42);
    const padded = padMessage(message);

    // 5000 + 4(헤더) = 5004 > 4096 → 다음 배수 = 8192
    expect(padded.length).toBe(8192);
  });

  it('커스텀 targetSize를 사용할 수 있다', () => {
    const message = new Uint8Array([1, 2, 3]);
    const padded = padMessage(message, 1024);

    expect(padded.length).toBe(1024);
  });

  it('모든 패딩된 메시지가 동일한 크기를 가진다 (고정 크기)', () => {
    const short = padMessage(new Uint8Array([1]));
    const medium = padMessage(new Uint8Array(100));
    const longer = padMessage(new Uint8Array(1000));

    expect(short.length).toBe(4096);
    expect(medium.length).toBe(4096);
    expect(longer.length).toBe(4096);
  });

  it('빈 메시지도 패딩 가능하다', () => {
    const message = new Uint8Array(0);
    const padded = padMessage(message);

    expect(padded.length).toBe(4096);

    const view = new DataView(padded.buffer, padded.byteOffset, 4);
    expect(view.getUint32(0, false)).toBe(0);
  });
});

describe('unpadMessage', () => {
  it('패딩된 메시지에서 원본 메시지를 정확히 추출한다', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const padded = padMessage(original);
    const extracted = unpadMessage(padded);

    expect(extracted).toEqual(original);
  });

  it('padMessage/unpadMessage 라운드트립이 일관된다', () => {
    const messages = [
      new Uint8Array(0),
      new Uint8Array([255]),
      new Uint8Array(100).fill(42),
      new Uint8Array(4000).fill(99),
      new Uint8Array(5000).fill(77), // 블록 크기 초과
    ];

    for (const original of messages) {
      const padded = padMessage(original);
      const extracted = unpadMessage(padded);
      expect(extracted).toEqual(original);
    }
  });

  it('패딩된 메시지가 너무 짧으면 에러를 발생시킨다', () => {
    const tooShort = new Uint8Array([1, 2, 3]); // 4바이트 미만

    expect(() => unpadMessage(tooShort)).toThrow('Invalid padded message: too short');
  });

  it('선언된 길이가 실제 데이터보다 크면 에러를 발생시킨다', () => {
    // 헤더에 큰 길이를 쓰고 데이터는 적게
    const invalid = new Uint8Array(10);
    const view = new DataView(invalid.buffer, 0, 4);
    view.setUint32(0, 100, false); // 100바이트라고 선언했지만 실제는 6바이트만 남음

    expect(() => unpadMessage(invalid)).toThrow(
      'Invalid padded message: declared length exceeds available data'
    );
  });
});

describe('startDummyTraffic / stopDummyTraffic', () => {
  it('30초~120초 무작위 간격으로 sendFn을 호출한다', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);

    startDummyTraffic(sendFn);

    // 30초 전에는 호출되지 않음
    await vi.advanceTimersByTimeAsync(29_999);
    expect(sendFn).not.toHaveBeenCalled();

    // 120초까지 진행하면 최소 1회 호출
    await vi.advanceTimersByTimeAsync(90_001);
    expect(sendFn).toHaveBeenCalled();

    stopDummyTraffic();
  });

  it('stopDummyTraffic 호출 후 더 이상 sendFn을 호출하지 않는다', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);

    startDummyTraffic(sendFn);

    // 첫 호출까지 대기 (최대 120초)
    await vi.advanceTimersByTimeAsync(120_000);
    const callCount = sendFn.mock.calls.length;

    stopDummyTraffic();

    // 추가 시간이 지나도 호출 수 변하지 않음
    await vi.advanceTimersByTimeAsync(240_000);
    expect(sendFn.mock.calls.length).toBe(callCount);
  });

  it('중복 startDummyTraffic 호출을 무시한다', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);

    startDummyTraffic(sendFn);
    startDummyTraffic(sendFn); // 무시됨

    await vi.advanceTimersByTimeAsync(120_000);

    // 중복 시작이 없으므로 합리적인 호출 수 (1-2회)
    expect(sendFn.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(sendFn.mock.calls.length).toBeLessThanOrEqual(2);

    stopDummyTraffic();
  });

  it('sendFn 실패 시에도 더미 트래픽을 계속 생성한다', async () => {
    const sendFn = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(undefined);

    startDummyTraffic(sendFn);

    // 첫 호출 (실패)
    await vi.advanceTimersByTimeAsync(120_000);

    // 두 번째 호출 (성공)
    await vi.advanceTimersByTimeAsync(120_000);

    expect(sendFn.mock.calls.length).toBeGreaterThanOrEqual(2);

    stopDummyTraffic();
  });
});

describe('generateDummyPayload', () => {
  it('기본 4096바이트의 랜덤 페이로드를 생성한다', () => {
    const payload = generateDummyPayload();

    expect(payload.length).toBe(4096);
    expect(payload).toBeInstanceOf(Uint8Array);
  });

  it('커스텀 크기의 페이로드를 생성할 수 있다', () => {
    const payload = generateDummyPayload(8192);

    expect(payload.length).toBe(8192);
  });

  it('실제 패딩된 메시지와 동일한 크기를 가진다 (구분 불가)', () => {
    const realMessage = padMessage(new Uint8Array([1, 2, 3]));
    const dummy = generateDummyPayload();

    expect(dummy.length).toBe(realMessage.length);
  });
});
