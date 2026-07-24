/**
 * 암호화 파일 전송 모듈
 *
 * XChaCha20-Poly1305 암호화 후 P2P 릴레이를 통해 파일을 전송한다.
 * 64KB 청크 단위로 분할 전송하며, BLAKE3 해시로 무결성을 검증한다.
 *
 * 보안 특성:
 * - 파일은 전송 전 클라이언트에서 XChaCha20-Poly1305로 암호화
 * - 암호화 키는 메모리에만 보관, 세션 종료 시 즉시 삭제
 * - 서버에 파일 데이터를 저장하지 않음 (P2P 전용)
 * - BLAKE3 해시로 수신 파일 무결성 검증
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { encrypt, decrypt } from '@/lib/crypto/e2ee';
import { sendData, onData } from '@/lib/transport/p2p-relay';
import type { EncryptedPayload } from '@/types/crypto';

/** 최대 파일 크기 (100MB) */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** 청크 크기 (64KB) */
const CHUNK_SIZE = 64 * 1024;

/** 파일 전송 상태 */
export type TransferStatus =
  | 'encrypting'
  | 'sending'
  | 'receiving'
  | 'paused'
  | 'complete'
  | 'failed'
  | 'verifying';

/** 진행률 콜백 */
export type ProgressCallback = (progress: number, status: TransferStatus) => void;

/** 파일 전송 핸들 */
export interface FileTransferHandle {
  id: string;
  fileName: string;
  fileSize: number;
  progress: number;
  status: TransferStatus;
  cancel: () => void;
}

/** 수신 완료 파일 */
export interface ReceivedFile {
  data: Uint8Array;
  name: string;
  size: number;
  blake3Hash: string;
  verified: boolean;
}

/** 전송 메타데이터 (P2P로 먼저 전송) */
interface TransferMetadata {
  type: 'file-meta';
  transferId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  blake3Hash: string;
}

/** 청크 데이터 패킷 */
interface ChunkPacket {
  type: 'file-chunk';
  transferId: string;
  index: number;
  data: string; // base64 encoded encrypted chunk
}

/** 전송 완료 신호 */
interface TransferComplete {
  type: 'file-complete';
  transferId: string;
}

/** 재개 요청 */
interface ResumeRequest {
  type: 'file-resume';
  transferId: string;
  lastReceivedIndex: number;
}

type FileMessage = TransferMetadata | ChunkPacket | TransferComplete | ResumeRequest;

/** 활성 전송 세션 (메모리 전용) */
const activeTransfers: Map<string, {
  key: Uint8Array;
  cancelled: boolean;
  lastSentIndex: number;
}> = new Map();

/**
 * 전송 ID 생성
 */
function generateTransferId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 암호화 키 생성 (메모리 전용)
 */
function generateFileKey(): Uint8Array {
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  return key;
}

/**
 * 키 자료 안전 삭제
 */
function zeroizeKey(key: Uint8Array): void {
  key.fill(0);
}

/**
 * Uint8Array를 base64로 인코딩
 */
function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}

/**
 * base64를 Uint8Array로 디코딩
 */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * BLAKE3 해시 계산 (hash-wasm 사용)
 */
async function computeBlake3Hash(data: Uint8Array): Promise<string> {
  const { blake3 } = await import('hash-wasm');
  return blake3(data);
}

/**
 * 파일을 암호화하여 P2P로 전송한다.
 *
 * 1. 파일 크기 검증 (최대 100MB)
 * 2. BLAKE3 해시 계산
 * 3. 64KB 청크로 분할
 * 4. 각 청크를 XChaCha20-Poly1305로 암호화
 * 5. P2P 릴레이를 통해 전송
 *
 * @param file - 전송할 파일 데이터
 * @param fileName - 파일명
 * @param connectionId - P2P 연결 ID
 * @param sessionToken - 세션 토큰
 * @param onProgress - 진행률 콜백
 * @returns 파일 전송 핸들
 */
export async function sendFile(
  file: Uint8Array,
  fileName: string,
  connectionId: string,
  sessionToken: string,
  onProgress?: ProgressCallback
): Promise<FileTransferHandle> {
  // 파일 크기 검증
  if (file.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum limit of 100MB`);
  }

  if (file.length === 0) {
    throw new Error('File is empty');
  }

  const transferId = generateTransferId();
  const fileKey = generateFileKey();
  const totalChunks = Math.ceil(file.length / CHUNK_SIZE);

  // 전송 세션 등록
  activeTransfers.set(transferId, {
    key: fileKey,
    cancelled: false,
    lastSentIndex: -1,
  });

  const handle: FileTransferHandle = {
    id: transferId,
    fileName,
    fileSize: file.length,
    progress: 0,
    status: 'encrypting',
    cancel: () => {
      const session = activeTransfers.get(transferId);
      if (session) {
        session.cancelled = true;
        zeroizeKey(session.key);
        activeTransfers.delete(transferId);
      }
      handle.status = 'failed';
    },
  };

  // 비동기 전송 시작
  (async () => {
    try {
      // BLAKE3 해시 계산
      const blake3Hash = await computeBlake3Hash(file);

      // 메타데이터 전송
      const meta: TransferMetadata = {
        type: 'file-meta',
        transferId,
        fileName,
        fileSize: file.length,
        totalChunks,
        blake3Hash,
      };

      const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
      await sendData(connectionId, metaBytes, sessionToken);

      // 청크 단위 암호화 및 전송
      handle.status = 'sending';
      onProgress?.(0, 'sending');

      for (let i = 0; i < totalChunks; i++) {
        const session = activeTransfers.get(transferId);
        if (!session || session.cancelled) {
          handle.status = 'failed';
          return;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.length);
        const chunk = file.slice(start, end);

        // XChaCha20-Poly1305 암호화
        const encrypted = await encrypt(chunk, fileKey);
        const encryptedBytes = serializeEncryptedPayload(encrypted);

        // 청크 패킷 전송
        const packet: ChunkPacket = {
          type: 'file-chunk',
          transferId,
          index: i,
          data: toBase64(encryptedBytes),
        };

        const packetBytes = new TextEncoder().encode(JSON.stringify(packet));
        const sent = await sendData(connectionId, packetBytes, sessionToken);

        if (!sent) {
          handle.status = 'paused';
          session.lastSentIndex = i - 1;
          onProgress?.(handle.progress, 'paused');
          return;
        }

        session.lastSentIndex = i;
        handle.progress = Math.round(((i + 1) / totalChunks) * 100);
        onProgress?.(handle.progress, 'sending');
      }

      // 전송 완료 신호
      const complete: TransferComplete = {
        type: 'file-complete',
        transferId,
      };
      const completeBytes = new TextEncoder().encode(JSON.stringify(complete));
      await sendData(connectionId, completeBytes, sessionToken);

      handle.status = 'complete';
      handle.progress = 100;
      onProgress?.(100, 'complete');

      // 키 삭제
      const session = activeTransfers.get(transferId);
      if (session) {
        zeroizeKey(session.key);
        activeTransfers.delete(transferId);
      }
    } catch {
      handle.status = 'failed';
      onProgress?.(handle.progress, 'failed');
      const session = activeTransfers.get(transferId);
      if (session) {
        zeroizeKey(session.key);
        activeTransfers.delete(transferId);
      }
    }
  })();

  return handle;
}

/**
 * 파일 수신을 처리한다.
 *
 * P2P 연결에서 수신된 청크를 복호화하고 조립한다.
 * 수신 완료 후 BLAKE3 해시로 무결성을 검증한다.
 *
 * @param connectionId - P2P 연결 ID
 * @param fileKey - 복호화 키 (키 교환으로 수신)
 * @param onProgress - 진행률 콜백
 * @returns 수신 완료된 파일
 */
export function receiveFile(
  connectionId: string,
  fileKey: Uint8Array,
  onProgress?: ProgressCallback
): Promise<ReceivedFile> {
  return new Promise((resolve, reject) => {
    let metadata: TransferMetadata | null = null;
    const receivedChunks: Map<number, Uint8Array> = new Map();
    let unsubscribe: (() => void) | null = null;

    unsubscribe = onData(connectionId, async (data: Uint8Array) => {
      try {
        const message: FileMessage = JSON.parse(new TextDecoder().decode(data));

        if (message.type === 'file-meta') {
          metadata = message;
          onProgress?.(0, 'receiving');
        } else if (message.type === 'file-chunk' && metadata) {
          // 청크 복호화
          const encryptedBytes = fromBase64(message.data);
          const payload = deserializeEncryptedPayload(encryptedBytes);
          const decrypted = await decrypt(payload, fileKey);

          receivedChunks.set(message.index, decrypted);

          const progress = Math.round((receivedChunks.size / metadata.totalChunks) * 100);
          onProgress?.(progress, 'receiving');
        } else if (message.type === 'file-complete' && metadata) {
          // 파일 조립
          onProgress?.(100, 'verifying');

          const totalSize = metadata.fileSize;
          const assembled = new Uint8Array(totalSize);
          let offset = 0;

          for (let i = 0; i < metadata.totalChunks; i++) {
            const chunk = receivedChunks.get(i);
            if (!chunk) {
              reject(new Error(`Missing chunk ${i}`));
              unsubscribe?.();
              return;
            }
            assembled.set(chunk, offset);
            offset += chunk.length;
          }

          // BLAKE3 무결성 검증
          const computedHash = await computeBlake3Hash(assembled);
          const verified = computedHash === metadata.blake3Hash;

          unsubscribe?.();
          receivedChunks.clear();

          resolve({
            data: assembled,
            name: metadata.fileName,
            size: metadata.fileSize,
            blake3Hash: computedHash,
            verified,
          });
        }
      } catch (err) {
        reject(err);
        unsubscribe?.();
      }
    });
  });
}

/**
 * 중단된 전송을 재개한다.
 *
 * 연결 끊김 후 복구 시 마지막으로 전송 성공한 청크 이후부터 재전송한다.
 *
 * @param transferId - 전송 ID
 * @param connectionId - P2P 연결 ID
 * @param sessionToken - 세션 토큰
 * @param file - 원본 파일 데이터
 * @param onProgress - 진행률 콜백
 */
export async function resumeTransfer(
  transferId: string,
  connectionId: string,
  sessionToken: string,
  file: Uint8Array,
  onProgress?: ProgressCallback
): Promise<boolean> {
  const session = activeTransfers.get(transferId);
  if (!session) {
    return false;
  }

  const totalChunks = Math.ceil(file.length / CHUNK_SIZE);
  const startIndex = session.lastSentIndex + 1;

  session.cancelled = false;

  for (let i = startIndex; i < totalChunks; i++) {
    if (session.cancelled) return false;

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.length);
    const chunk = file.slice(start, end);

    const encrypted = await encrypt(chunk, session.key);
    const encryptedBytes = serializeEncryptedPayload(encrypted);

    const packet: ChunkPacket = {
      type: 'file-chunk',
      transferId,
      index: i,
      data: toBase64(encryptedBytes),
    };

    const packetBytes = new TextEncoder().encode(JSON.stringify(packet));
    const sent = await sendData(connectionId, packetBytes, sessionToken);

    if (!sent) {
      session.lastSentIndex = i - 1;
      onProgress?.(Math.round((i / totalChunks) * 100), 'paused');
      return false;
    }

    session.lastSentIndex = i;
    onProgress?.(Math.round(((i + 1) / totalChunks) * 100), 'sending');
  }

  // 전송 완료
  const complete: TransferComplete = { type: 'file-complete', transferId };
  const completeBytes = new TextEncoder().encode(JSON.stringify(complete));
  await sendData(connectionId, completeBytes, sessionToken);

  zeroizeKey(session.key);
  activeTransfers.delete(transferId);
  onProgress?.(100, 'complete');
  return true;
}

/**
 * 세션 종료 시 모든 전송 키를 삭제한다.
 */
export function destroyAllTransferKeys(): void {
  for (const session of activeTransfers.values()) {
    zeroizeKey(session.key);
  }
  activeTransfers.clear();
}

/**
 * EncryptedPayload를 바이트 배열로 직렬화
 */
function serializeEncryptedPayload(payload: EncryptedPayload): Uint8Array {
  // Format: [nonce(24)] [tag(16)] [ciphertext(...)]
  const result = new Uint8Array(24 + 16 + payload.ciphertext.length);
  result.set(payload.nonce, 0);
  result.set(payload.tag, 24);
  result.set(payload.ciphertext, 40);
  return result;
}

/**
 * 바이트 배열을 EncryptedPayload로 역직렬화
 */
function deserializeEncryptedPayload(data: Uint8Array): EncryptedPayload {
  return {
    nonce: data.slice(0, 24),
    tag: data.slice(24, 40),
    ciphertext: data.slice(40),
  };
}
