/**
 * HTTP 롱폴링 클라이언트 단위 테스트
 *
 * Requirements: 5.2, 5.5, 7.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { send, poll, startPolling, stopPolling } from './long-poll';
import type { IncomingMessage } from './long-poll';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
  stopPolling();
});

afterEach(() => {
  stopPolling();
  vi.useRealTimers();
});

describe('send', () => {
  it('POST /api/send에 암호화된 페이로드를 base64로 전송한다', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const messageId = 'msg-123';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messageId }),
    });

    const result = await send('recipient-1', payload, 'token-abc');

    expect(result.success).toBe(true);
    expect(result.messageId).toBe(messageId);

    expect(mockFetch).toHaveBeenCalledWith('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-abc',
      },
      body: expect.any(String),
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(callBody.recipientId).toBe('recipient-1');
    expect(callBody.payload).toBe(btoa(String.fromCharCode(1, 2, 3, 4, 5)));
  });

  it('네트워크 오류 시 재시도 후 실패를 반환한다', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const sendPromise = send('recipient-1', new Uint8Array([1]), 'token-abc');

    // 3회 재시도 × 2초
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await sendPromise;

    expect(result.success).toBe(false);
    expect(result.messageId).toBe('');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('서버 에러(non-ok) 시 재시도 후 실패를 반환한다', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const sendPromise = send('recipient-1', new Uint8Array([1]), 'token-abc');

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await sendPromise;

    expect(result.success).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('첫 실패 후 재시도에서 성공하면 성공 결과를 반환한다', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messageId: 'msg-456' }),
      });

    const sendPromise = send('recipient-1', new Uint8Array([1]), 'token-abc');

    await vi.advanceTimersByTimeAsync(2000);

    const result = await sendPromise;

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-456');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('poll', () => {
  it('GET /api/poll로 메시지를 수신하고 base64 payload를 Uint8Array로 디코딩한다', async () => {
    const base64Payload = btoa(String.fromCharCode(10, 20, 30));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [
          {
            id: 'msg-1',
            senderId: 'sender-1',
            payload: base64Payload,
            timestamp: 1700000000,
          },
        ],
        hasMore: false,
      }),
    });

    const result = await poll('my-id', 'token-abc');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.id).toBe('msg-1');
    expect(result.messages[0]!.senderId).toBe('sender-1');
    expect(result.messages[0]!.payload).toEqual(new Uint8Array([10, 20, 30]));
    expect(result.messages[0]!.timestamp).toBe(1700000000);
    expect(result.hasMore).toBe(false);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/poll?id=my-id&timeout=25',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token-abc' },
      })
    );
  });

  it('타임아웃 시 빈 결과를 반환한다 (AbortError)', async () => {
    mockFetch.mockImplementationOnce((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const pollPromise = poll('my-id', 'token-abc', 5);

    await vi.advanceTimersByTimeAsync(5000);

    const result = await pollPromise;

    expect(result.messages).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it('네트워크 오류 시 빈 결과를 반환한다 (Tor 회로 변경 대응)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection reset'));

    const result = await poll('my-id', 'token-abc');

    expect(result.messages).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it('서버 에러(non-ok) 시 빈 결과를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await poll('my-id', 'token-abc');

    expect(result.messages).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it('커스텀 타임아웃 값을 URL 파라미터에 포함한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [], hasMore: false }),
    });

    await poll('my-id', 'token-abc', 10);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/poll?id=my-id&timeout=10',
      expect.anything()
    );
  });
});

describe('startPolling / stopPolling', () => {
  it('수신된 메시지에 대해 콜백을 호출한다', async () => {
    const base64Payload = btoa(String.fromCharCode(99));
    const receivedMessages: IncomingMessage[] = [];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [
          { id: 'msg-1', senderId: 'sender-1', payload: base64Payload, timestamp: 1 },
        ],
        hasMore: false,
      }),
    });

    startPolling('my-id', 'token-abc', (msg) => {
      receivedMessages.push(msg);
    });

    // setTimeout(fn, 0) 트리거 + 비동기 처리
    await vi.advanceTimersByTimeAsync(1);

    stopPolling();

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]!.id).toBe('msg-1');
    expect(receivedMessages[0]!.payload).toEqual(new Uint8Array([99]));
  });

  it('stopPolling 호출 후 새로운 폴링 요청을 보내지 않는다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [], hasMore: false }),
    });

    startPolling('my-id', 'token-abc', () => {});

    // 첫 폴링 실행
    await vi.advanceTimersByTimeAsync(1);

    stopPolling();
    const callCount = mockFetch.mock.calls.length;

    // 추가 시간 경과해도 호출 수 변하지 않음
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockFetch.mock.calls.length).toBe(callCount);
  });

  it('중복 startPolling 호출을 무시한다', async () => {
    mockFetch.mockImplementation(() =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 25000);
      })
    );

    startPolling('my-id', 'token-abc', () => {});
    startPolling('my-id', 'token-abc', () => {}); // 무시됨

    await vi.advanceTimersByTimeAsync(1);

    // 한 번만 호출됨
    expect(mockFetch).toHaveBeenCalledTimes(1);

    stopPolling();
  });
});
