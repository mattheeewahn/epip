'use client';

import { useEffect } from 'react';
import { execute, registerShortcut } from '@/lib/security/panic';

/**
 * 패닉 버튼 및 보안 경고 UI
 * 화면 하단 긴급 삭제 버튼 (항상 표시)
 * Ctrl+Shift+X 단축키 등록
 *
 * Requirements: 14.1
 */
export default function PanicButton() {
  useEffect(() => {
    registerShortcut();
  }, []);

  return (
    <button
      onClick={() => execute()}
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        minHeight: 44,
        minWidth: 44,
        fontSize: 12,
        borderColor: '#a44',
        borderRadius: 6,
        padding: '8px 12px',
        zIndex: 9999,
      }}
      title="긴급 삭제 (Ctrl+Shift+X)"
    >
      ✕
    </button>
  );
}
