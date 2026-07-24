'use client';

import { useState, useCallback } from 'react';

interface PassphraseInputProps {
  onSubmit: (passphrase: string) => void;
  remainingAttempts: number;
  level: 'app' | 'room';
}

/**
 * 패스프레이즈 입력 화면
 * Requirements: 19.1
 */
export default function PassphraseInput({
  onSubmit,
  remainingAttempts,
  level,
}: PassphraseInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (value.trim()) {
        onSubmit(value);
        setValue('');
      }
    },
    [value, onSubmit]
  );

  return (
    <div className="flex-center full-height" style={{ flexDirection: 'column', gap: 16, padding: 24 }}>
      <div style={{ fontSize: 14, textAlign: 'center' }}>
        {level === 'app' ? '패스프레이즈 입력' : '대화방 패스프레이즈'}
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 280 }}>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="패스프레이즈"
          autoComplete="off"
          style={{ padding: '10px 12px', minHeight: 44 }}
        />
        <button type="submit" style={{ minHeight: 44 }}>확인</button>
      </form>
      {remainingAttempts < 3 && (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          남은 시도: {remainingAttempts}
        </div>
      )}
    </div>
  );
}
