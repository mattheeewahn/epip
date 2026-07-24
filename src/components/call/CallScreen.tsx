'use client';

import { useState, useCallback } from 'react';

type CallMode = 'voice' | 'video';
type NetworkQuality = 'good' | 'fair' | 'poor';

interface CallScreenProps {
  mode: CallMode;
  peerName: string;
  onEnd: () => void;
}

/**
 * 음성/영상 통화 화면
 * 네트워크 품질 표시, 카메라 온/오프 토글
 *
 * Requirements: 11.5, 12.5, 12.6
 */
export default function CallScreen({ mode, peerName, onEnd }: CallScreenProps) {
  const [cameraOn, setCameraOn] = useState(mode === 'video');
  const [quality] = useState<NetworkQuality>('good');
  const [elapsed, setElapsed] = useState(0);

  // Timer
  useState(() => {
    const interval = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(interval);
  });

  const qualityLabel = quality === 'good' ? '●' : quality === 'fair' ? '◐' : '○';
  const qualityColor = quality === 'good' ? '#4a4' : quality === 'fair' ? '#aa4' : '#a44';

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleCameraToggle = useCallback(() => {
    setCameraOn((prev) => !prev);
  }, []);

  return (
    <div
      className="flex-center full-height"
      style={{ flexDirection: 'column', gap: 24, padding: 24 }}
    >
      <div style={{ fontSize: 14, opacity: 0.7 }}>
        {mode === 'video' && cameraOn ? '영상 통화' : '음성 통화'}
      </div>
      <div style={{ fontSize: 18 }}>{peerName}</div>
      <div style={{ fontSize: 24, fontFamily: 'monospace' }}>{formatTime(elapsed)}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ color: qualityColor }}>{qualityLabel}</span>
        <span style={{ opacity: 0.6 }}>
          {quality === 'good' ? '양호' : quality === 'fair' ? '보통' : '불량'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {mode === 'video' && (
          <button
            onClick={handleCameraToggle}
            style={{ minHeight: 44, minWidth: 44 }}
          >
            {cameraOn ? '카메라 끄기' : '카메라 켜기'}
          </button>
        )}
        <button
          onClick={onEnd}
          style={{ minHeight: 44, minWidth: 44, borderColor: '#a44' }}
        >
          종료
        </button>
      </div>
    </div>
  );
}
