'use client';

import type { SafetyNumber } from '@/lib/security/key-verify';

interface SafetyNumberDisplayProps {
  safetyNumber: SafetyNumber | null;
  verified: boolean;
  onVerify: () => void;
}

/**
 * 안전번호 표시 컴포넌트
 * 숫자 그룹(5자리 × 12그룹) + QR 코드 데이터
 * 검증 상태 배지
 *
 * Requirements: 21.2, 21.3
 */
export default function SafetyNumberDisplay({
  safetyNumber,
  verified,
  onVerify,
}: SafetyNumberDisplayProps) {
  if (!safetyNumber) {
    return (
      <div style={{ padding: 16, textAlign: 'center', fontSize: 13, opacity: 0.6 }}>
        안전번호를 생성 중...
      </div>
    );
  }

  const groups = safetyNumber.formatted.split(' ');

  return (
    <div style={{ padding: 16 }}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13 }}>안전번호</span>
        {verified && (
          <span style={{ marginLeft: 8, fontSize: 11 }}>✓ 검증됨</span>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '4px 12px',
          fontFamily: 'monospace',
          fontSize: 14,
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        {groups.map((group, i) => (
          <span key={i}>{group}</span>
        ))}
      </div>
      <div
        style={{
          border: '1px solid var(--color-text)',
          borderRadius: 6,
          padding: 16,
          textAlign: 'center',
          marginBottom: 12,
          fontSize: 11,
          wordBreak: 'break-all',
          opacity: 0.5,
        }}
      >
        QR: {safetyNumber.qrData.slice(0, 60)}...
      </div>
      {!verified && (
        <button onClick={onVerify} style={{ width: '100%' }}>
          번호 확인 완료
        </button>
      )}
    </div>
  );
}
