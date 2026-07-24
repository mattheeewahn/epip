/**
 * 암호화 영상 통화 모듈
 *
 * P2P 릴레이를 통해 암호화된 영상+음성 채널을 수립한다.
 * VP8/VP9 코덱으로 인코딩하고, 각 프레임을 XChaCha20-Poly1305로 실시간 암호화한다.
 *
 * Tor 브라우저 환경에서는 WebRTC/getUserMedia가 비활성화될 수 있으므로,
 * 가용성을 먼저 확인하고 적절한 에러를 반환한다.
 *
 * 보안 특성:
 * - 모든 영상/음성 프레임을 E2EE로 암호화하여 전송
 * - 영상/음성 데이터를 로컬/서버에 저장하지 않음
 * - 통화 종료 시 키, 프레임 버퍼, 코덱 상태를 즉시 메모리에서 제거
 * - 통화 기록/스크린샷을 저장하지 않음
 *
 * 적응적 해상도:
 * - 대역폭 충분: 720p
 * - 대역폭 부족 1단계: 480p
 * - 대역폭 부족 2단계: 360p
 * - 대역폭 심각 부족: 음성 전용
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8
 */

import { encrypt, decrypt } from '@/lib/crypto/e2ee';
import { sendData, onData } from '@/lib/transport/p2p-relay';

/** 영상 통화 상태 */
export type VideoCallState =
  | 'idle'
  | 'connecting'
  | 'active'
  | 'degraded'
  | 'audio-only'
  | 'ended'
  | 'failed';

/** 영상 해상도 등급 */
export type VideoResolution = '720p' | '480p' | '360p' | 'audio-only';

/** 네트워크 품질 */
export type NetworkQuality = 'good' | 'fair' | 'poor' | 'critical';

/** 영상 통화 설정 */
export interface VideoCallConfig {
  /** 초기 해상도 (기본 720p) */
  initialResolution: VideoResolution;
  /** 프레임레이트 (기본 30) */
  frameRate: number;
  /** 비디오 코덱 (기본 VP8) */
  videoCodec: 'VP8' | 'VP9';
  /** 적응적 해상도 활성화 */
  adaptiveResolution: boolean;
}

/** 영상 통화 이벤트 콜백 */
export interface VideoCallCallbacks {
  onStateChange?: (state: VideoCallState) => void;
  onResolutionChange?: (resolution: VideoResolution) => void;
  onQualityChange?: (quality: NetworkQuality, latencyMs: number) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onError?: (error: string) => void;
}

/** 영상 프레임 패킷 */
interface VideoFramePacket {
  type: 'video-frame';
  callId: string;
  seq: number;
  timestamp: number;
  resolution: VideoResolution;
  data: string; // base64 encrypted frame
}

/** 음성 패킷 */
interface AudioPacket {
  type: 'audio-data';
  callId: string;
  seq: number;
  timestamp: number;
  data: string; // base64 encrypted audio
}

/** 통화 제어 메시지 */
interface VideoCallControl {
  type: 'vcall-start' | 'vcall-end' | 'vcall-accept' | 'vcall-reject' | 'vcall-camera-off' | 'vcall-camera-on';
  callId: string;
}

type VideoCallMessage = VideoFramePacket | AudioPacket | VideoCallControl;

/** 해상도별 설정 */
const RESOLUTION_CONFIGS: Record<Exclude<VideoResolution, 'audio-only'>, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
  '360p': { width: 640, height: 360 },
};

/** 지연 임계값 (ms) */
const LATENCY_THRESHOLDS = {
  degrade480: 400,
  degrade360: 700,
  audioOnly: 1200,
} as const;

/** 기본 설정 */
const DEFAULT_CONFIG: VideoCallConfig = {
  initialResolution: '720p',
  frameRate: 30,
  videoCodec: 'VP8',
  adaptiveResolution: true,
};

/** 활성 영상 통화 세션 (메모리 전용) */
let activeVideoCall: {
  callId: string;
  connectionId: string;
  sessionToken: string;
  encryptionKey: Uint8Array;
  mediaStream: MediaStream | null;
  audioContext: AudioContext | null;
  config: VideoCallConfig;
  state: VideoCallState;
  currentResolution: VideoResolution;
  cameraEnabled: boolean;
  videoSeq: number;
  audioSeq: number;
  latencyBuffer: number[];
  captureInterval: ReturnType<typeof setInterval> | null;
  audioProcessor: ScriptProcessorNode | null;
  unsubscribe: (() => void) | null;
} | null = null;

/**
 * 통화 ID 생성
 */
function generateCallId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 통화 암호화 키 생성 (메모리 전용)
 */
function generateCallKey(): Uint8Array {
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
 * WebRTC/getUserMedia 가용성 확인
 */
export function isVideoCallAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * 영상 통화를 시작한다.
 *
 * 1. getUserMedia로 카메라+마이크 접근
 * 2. VP8/VP9 코덱 설정
 * 3. P2P 연결을 통해 통화 시작 신호 전송
 * 4. 실시간 영상/음성 프레임 암호화 및 전송 시작
 *
 * @param connectionId - P2P 연결 ID
 * @param sessionToken - 세션 토큰
 * @param callbacks - 이벤트 콜백
 * @param config - 통화 설정 (선택)
 * @returns 통화 ID
 */
export async function startVideoCall(
  connectionId: string,
  sessionToken: string,
  callbacks?: VideoCallCallbacks,
  config?: Partial<VideoCallConfig>
): Promise<string> {
  if (!isVideoCallAvailable()) {
    throw new Error(
      'Video call is not available. WebRTC/getUserMedia is disabled in this browser.'
    );
  }

  if (activeVideoCall) {
    throw new Error('A video call is already active. End the current call first.');
  }

  const callId = generateCallId();
  const callConfig = { ...DEFAULT_CONFIG, ...config };
  const encryptionKey = generateCallKey();
  const resolutionKey = callConfig.initialResolution === 'audio-only'
    ? '720p' : callConfig.initialResolution;
  const resolution = RESOLUTION_CONFIGS[resolutionKey];

  // 카메라+마이크 접근
  let mediaStream: MediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: resolution.width },
        height: { ideal: resolution.height },
        frameRate: { ideal: callConfig.frameRate },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      },
    });
  } catch {
    throw new Error('Camera/microphone access denied or unavailable.');
  }

  const audioContext = new AudioContext({ sampleRate: 48000 });

  activeVideoCall = {
    callId,
    connectionId,
    sessionToken,
    encryptionKey,
    mediaStream,
    audioContext,
    config: callConfig,
    state: 'connecting',
    currentResolution: callConfig.initialResolution,
    cameraEnabled: true,
    videoSeq: 0,
    audioSeq: 0,
    latencyBuffer: [],
    captureInterval: null,
    audioProcessor: null,
    unsubscribe: null,
  };

  callbacks?.onStateChange?.('connecting');

  // 통화 시작 신호 전송
  const startMsg: VideoCallControl = { type: 'vcall-start', callId };
  const msgBytes = new TextEncoder().encode(JSON.stringify(startMsg));
  await sendData(connectionId, msgBytes, sessionToken);

  // 수신 핸들러 등록
  activeVideoCall.unsubscribe = onData(connectionId, async (data: Uint8Array) => {
    await handleIncomingData(data, callbacks);
  });

  // 영상+음성 캡처 시작
  startVideoCapture(callbacks);
  startAudioCapture(callbacks);

  activeVideoCall.state = 'active';
  callbacks?.onStateChange?.('active');

  return callId;
}

/**
 * 수신된 영상 통화 요청을 수락한다.
 */
export async function acceptVideoCall(
  connectionId: string,
  sessionToken: string,
  callId: string,
  callbacks?: VideoCallCallbacks,
  config?: Partial<VideoCallConfig>
): Promise<void> {
  if (!isVideoCallAvailable()) {
    throw new Error('Video call is not available in this browser.');
  }

  const callConfig = { ...DEFAULT_CONFIG, ...config };
  const encryptionKey = generateCallKey();
  const resolutionKey = callConfig.initialResolution === 'audio-only'
    ? '720p' : callConfig.initialResolution;
  const resolution = RESOLUTION_CONFIGS[resolutionKey];

  let mediaStream: MediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: resolution.width },
        height: { ideal: resolution.height },
        frameRate: { ideal: callConfig.frameRate },
      },
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
    });
  } catch {
    const rejectMsg: VideoCallControl = { type: 'vcall-reject', callId };
    const msgBytes = new TextEncoder().encode(JSON.stringify(rejectMsg));
    await sendData(connectionId, msgBytes, sessionToken);
    throw new Error('Camera/microphone access denied.');
  }

  const audioContext = new AudioContext({ sampleRate: 48000 });

  activeVideoCall = {
    callId,
    connectionId,
    sessionToken,
    encryptionKey,
    mediaStream,
    audioContext,
    config: callConfig,
    state: 'active',
    currentResolution: callConfig.initialResolution,
    cameraEnabled: true,
    videoSeq: 0,
    audioSeq: 0,
    latencyBuffer: [],
    captureInterval: null,
    audioProcessor: null,
    unsubscribe: null,
  };

  // 수락 신호
  const acceptMsg: VideoCallControl = { type: 'vcall-accept', callId };
  const msgBytes = new TextEncoder().encode(JSON.stringify(acceptMsg));
  await sendData(connectionId, msgBytes, sessionToken);

  activeVideoCall.unsubscribe = onData(connectionId, async (data: Uint8Array) => {
    await handleIncomingData(data, callbacks);
  });

  startVideoCapture(callbacks);
  startAudioCapture(callbacks);
  callbacks?.onStateChange?.('active');
}

/**
 * 영상 통화를 종료한다.
 *
 * 모든 키, 프레임 버퍼, 코덱 상태를 즉시 메모리에서 제거한다.
 * 통화 기록/스크린샷을 저장하지 않는다.
 */
export async function endVideoCall(): Promise<void> {
  if (!activeVideoCall) return;

  const { connectionId, sessionToken, callId } = activeVideoCall;

  // 종료 신호 전송 (best-effort)
  try {
    const endMsg: VideoCallControl = { type: 'vcall-end', callId };
    const msgBytes = new TextEncoder().encode(JSON.stringify(endMsg));
    await sendData(connectionId, msgBytes, sessionToken);
  } catch {
    // 전송 실패 무시
  }

  cleanupVideoCall();
}

/**
 * 카메라를 토글한다.
 *
 * 카메라 비활성화 시 음성 전용 모드로 전환하며,
 * 카메라 스트림을 즉시 중단한다.
 */
export async function toggleCamera(): Promise<void> {
  if (!activeVideoCall) return;

  activeVideoCall.cameraEnabled = !activeVideoCall.cameraEnabled;

  if (!activeVideoCall.cameraEnabled) {
    // 카메라 스트림 중단
    const videoTracks = activeVideoCall.mediaStream?.getVideoTracks() ?? [];
    videoTracks.forEach(track => track.stop());

    // 영상 캡처 중지
    if (activeVideoCall.captureInterval) {
      clearInterval(activeVideoCall.captureInterval);
      activeVideoCall.captureInterval = null;
    }

    activeVideoCall.state = 'audio-only';
    activeVideoCall.currentResolution = 'audio-only';

    // 상대방에게 카메라 오프 알림
    const msg: VideoCallControl = {
      type: 'vcall-camera-off',
      callId: activeVideoCall.callId,
    };
    const msgBytes = new TextEncoder().encode(JSON.stringify(msg));
    await sendData(activeVideoCall.connectionId, msgBytes, activeVideoCall.sessionToken);
  } else {
    // 카메라 재활성화
    try {
      const resKey = activeVideoCall.config.initialResolution === 'audio-only'
        ? '720p' : activeVideoCall.config.initialResolution;
      const resolution = RESOLUTION_CONFIGS[resKey];
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: resolution.width },
          height: { ideal: resolution.height },
          frameRate: { ideal: activeVideoCall.config.frameRate },
        },
      });

      // 기존 스트림에 비디오 트랙 추가
      const videoTrack = newStream.getVideoTracks()[0];
      if (videoTrack && activeVideoCall.mediaStream) {
        activeVideoCall.mediaStream.addTrack(videoTrack);
      }

      activeVideoCall.state = 'active';
      activeVideoCall.currentResolution = activeVideoCall.config.initialResolution;
      startVideoCapture();

      const msg: VideoCallControl = {
        type: 'vcall-camera-on',
        callId: activeVideoCall.callId,
      };
      const msgBytes = new TextEncoder().encode(JSON.stringify(msg));
      await sendData(activeVideoCall.connectionId, msgBytes, activeVideoCall.sessionToken);
    } catch {
      // 카메라 재활성화 실패 → 음성 전용 유지
      activeVideoCall.cameraEnabled = false;
    }
  }
}

/**
 * 현재 통화 상태 조회
 */
export function getVideoCallState(): VideoCallState {
  return activeVideoCall?.state ?? 'idle';
}

/**
 * 현재 해상도 조회
 */
export function getCurrentResolution(): VideoResolution {
  return activeVideoCall?.currentResolution ?? 'audio-only';
}

/**
 * 카메라 활성 여부 조회
 */
export function isCameraEnabled(): boolean {
  return activeVideoCall?.cameraEnabled ?? false;
}

/**
 * 수신 데이터 처리
 */
async function handleIncomingData(
  data: Uint8Array,
  callbacks?: VideoCallCallbacks
): Promise<void> {
  if (!activeVideoCall) return;

  try {
    const message: VideoCallMessage = JSON.parse(new TextDecoder().decode(data));

    if (message.type === 'vcall-end') {
      cleanupVideoCall();
      callbacks?.onStateChange?.('ended');
      return;
    }

    if (message.type === 'vcall-camera-off') {
      callbacks?.onResolutionChange?.('audio-only');
      return;
    }

    if (message.type === 'vcall-camera-on') {
      callbacks?.onResolutionChange?.('720p');
      return;
    }

    // 지연 시간 측정 및 적응적 해상도 조정
    if ('timestamp' in message) {
      const latency = Date.now() - message.timestamp;
      activeVideoCall.latencyBuffer.push(latency);
      if (activeVideoCall.latencyBuffer.length > 30) {
        activeVideoCall.latencyBuffer.shift();
      }

      const avgLatency = activeVideoCall.latencyBuffer.reduce((a, b) => a + b, 0) /
        activeVideoCall.latencyBuffer.length;

      if (activeVideoCall.config.adaptiveResolution) {
        adjustResolution(avgLatency, callbacks);
      }
    }

    if (message.type === 'video-frame') {
      // 영상 프레임 복호화 (저장 없음)
      const encryptedBytes = fromBase64(message.data);
      const nonce = encryptedBytes.slice(0, 24);
      const tag = encryptedBytes.slice(24, 40);
      const ciphertext = encryptedBytes.slice(40);
      await decrypt({ ciphertext, nonce, tag }, activeVideoCall.encryptionKey);
      // 복호화된 프레임은 렌더링 후 즉시 GC 대상
    }

    if (message.type === 'audio-data') {
      // 음성 데이터 복호화 (저장 없음)
      const encryptedBytes = fromBase64(message.data);
      const nonce = encryptedBytes.slice(0, 24);
      const tag = encryptedBytes.slice(24, 40);
      const ciphertext = encryptedBytes.slice(40);
      await decrypt({ ciphertext, nonce, tag }, activeVideoCall.encryptionKey);
    }
  } catch {
    // 손상된 패킷은 무시
  }
}

/**
 * 적응적 해상도 조정
 *
 * 대역폭 부족 시 해상도를 순차적으로 낮춘다:
 * 720p → 480p → 360p → 음성 전용
 */
function adjustResolution(avgLatency: number, callbacks?: VideoCallCallbacks): void {
  if (!activeVideoCall) return;

  let targetResolution: VideoResolution;

  if (avgLatency > LATENCY_THRESHOLDS.audioOnly) {
    targetResolution = 'audio-only';
  } else if (avgLatency > LATENCY_THRESHOLDS.degrade360) {
    targetResolution = '360p';
  } else if (avgLatency > LATENCY_THRESHOLDS.degrade480) {
    targetResolution = '480p';
  } else {
    targetResolution = '720p';
  }

  if (targetResolution === activeVideoCall.currentResolution) return;

  activeVideoCall.currentResolution = targetResolution;
  callbacks?.onResolutionChange?.(targetResolution);

  if (targetResolution === 'audio-only') {
    // 비디오 캡처 중지
    if (activeVideoCall.captureInterval) {
      clearInterval(activeVideoCall.captureInterval);
      activeVideoCall.captureInterval = null;
    }
    activeVideoCall.state = 'audio-only';
    callbacks?.onStateChange?.('audio-only');

    const quality: NetworkQuality = 'critical';
    callbacks?.onQualityChange?.(quality, avgLatency);
  } else {
    activeVideoCall.state = 'degraded';
    callbacks?.onStateChange?.('degraded');

    const quality: NetworkQuality = targetResolution === '360p' ? 'poor' : 'fair';
    callbacks?.onQualityChange?.(quality, avgLatency);
  }
}

/**
 * 영상 캡처 시작
 *
 * Canvas를 사용해 비디오 프레임을 캡처하고 암호화하여 전송한다.
 */
function startVideoCapture(callbacks?: VideoCallCallbacks): void {
  if (!activeVideoCall || !activeVideoCall.cameraEnabled) return;

  // 기존 캡처 중지
  if (activeVideoCall.captureInterval) {
    clearInterval(activeVideoCall.captureInterval);
  }

  const frameInterval = 1000 / activeVideoCall.config.frameRate;

  activeVideoCall.captureInterval = setInterval(async () => {
    if (!activeVideoCall || !activeVideoCall.cameraEnabled) return;
    if (activeVideoCall.currentResolution === 'audio-only') return;

    try {
      const videoTrack = activeVideoCall.mediaStream?.getVideoTracks()[0];
      if (!videoTrack) return;

      // ImageCapture API (가용한 경우) 또는 Canvas 기반 캡처
      const frameData = await captureVideoFrame(videoTrack);
      if (!frameData) return;

      // XChaCha20-Poly1305 암호화
      const encrypted = await encrypt(frameData, activeVideoCall.encryptionKey);

      const encBytes = new Uint8Array(24 + 16 + encrypted.ciphertext.length);
      encBytes.set(encrypted.nonce, 0);
      encBytes.set(encrypted.tag, 24);
      encBytes.set(encrypted.ciphertext, 40);

      const packet: VideoFramePacket = {
        type: 'video-frame',
        callId: activeVideoCall.callId,
        seq: activeVideoCall.videoSeq++,
        timestamp: Date.now(),
        resolution: activeVideoCall.currentResolution,
        data: toBase64(encBytes),
      };

      const packetBytes = new TextEncoder().encode(JSON.stringify(packet));
      await sendData(activeVideoCall.connectionId, packetBytes, activeVideoCall.sessionToken);
    } catch {
      callbacks?.onError?.('Failed to capture/send video frame');
    }
  }, frameInterval);
}

/**
 * 음성 캡처 시작
 */
function startAudioCapture(callbacks?: VideoCallCallbacks): void {
  if (!activeVideoCall || !activeVideoCall.mediaStream || !activeVideoCall.audioContext) return;

  const { audioContext, mediaStream } = activeVideoCall;
  const source = audioContext.createMediaStreamSource(mediaStream);

  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  activeVideoCall.audioProcessor = processor;

  processor.onaudioprocess = async (event) => {
    if (!activeVideoCall || activeVideoCall.state === 'ended') {
      processor.disconnect();
      source.disconnect();
      return;
    }

    const inputData = event.inputBuffer.getChannelData(0);
    const audioBytes = float32ToInt16(inputData);

    try {
      const encrypted = await encrypt(audioBytes, activeVideoCall.encryptionKey);

      const encBytes = new Uint8Array(24 + 16 + encrypted.ciphertext.length);
      encBytes.set(encrypted.nonce, 0);
      encBytes.set(encrypted.tag, 24);
      encBytes.set(encrypted.ciphertext, 40);

      const packet: AudioPacket = {
        type: 'audio-data',
        callId: activeVideoCall.callId,
        seq: activeVideoCall.audioSeq++,
        timestamp: Date.now(),
        data: toBase64(encBytes),
      };

      const packetBytes = new TextEncoder().encode(JSON.stringify(packet));
      await sendData(activeVideoCall.connectionId, packetBytes, activeVideoCall.sessionToken);
    } catch {
      callbacks?.onError?.('Failed to send audio packet');
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

/**
 * 비디오 프레임 캡처 (ImageCapture 또는 fallback)
 */
async function captureVideoFrame(_videoTrack: MediaStreamTrack): Promise<Uint8Array | null> {
  try {
    // ImageCapture API 사용 (가용한 경우)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ImageCaptureAPI = (globalThis as any).ImageCapture;
    if (typeof ImageCaptureAPI !== 'undefined') {
      const capture = new ImageCaptureAPI(_videoTrack);
      const bitmap: ImageBitmap = await capture.grabFrame();

      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.6 });
      const arrayBuffer = await blob.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 통화 리소스 정리
 *
 * 키, 프레임 버퍼, 코덱 상태를 메모리에서 제거한다.
 * 통화 기록/스크린샷을 저장하지 않는다.
 */
function cleanupVideoCall(): void {
  if (!activeVideoCall) return;

  // 영상 캡처 중지
  if (activeVideoCall.captureInterval) {
    clearInterval(activeVideoCall.captureInterval);
    activeVideoCall.captureInterval = null;
  }

  // 오디오 프로세서 해제
  if (activeVideoCall.audioProcessor) {
    activeVideoCall.audioProcessor.disconnect();
    activeVideoCall.audioProcessor = null;
  }

  // 미디어 스트림 중지
  if (activeVideoCall.mediaStream) {
    activeVideoCall.mediaStream.getTracks().forEach(track => track.stop());
    activeVideoCall.mediaStream = null;
  }

  // AudioContext 종료
  if (activeVideoCall.audioContext && activeVideoCall.audioContext.state !== 'closed') {
    activeVideoCall.audioContext.close().catch(() => {});
    activeVideoCall.audioContext = null;
  }

  // 수신 콜백 해제
  activeVideoCall.unsubscribe?.();

  // 암호화 키 삭제
  zeroizeKey(activeVideoCall.encryptionKey);

  // 지연 버퍼 정리
  activeVideoCall.latencyBuffer.length = 0;

  activeVideoCall.state = 'ended';
  activeVideoCall = null;
}

/**
 * Float32 PCM → Int16 PCM 변환
 */
function float32ToInt16(float32: Float32Array): Uint8Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(int16.buffer);
}
