'use client';

import { useState, useCallback } from 'react';
import { processCalculatorInput, calculate } from '@/lib/security/disguise';

interface CalculatorProps {
  onUnlock: () => void;
}

/**
 * 위장 계산기 UI
 *
 * 실제 계산 기능이 동작하는 계산기 화면.
 * 시크릿 코드(159*357=) 입력 시 메신저 전환을 트리거한다.
 *
 * Requirements: 15.1, 15.2, 15.3
 */
export default function Calculator({ onUnlock }: CalculatorProps) {
  const [display, setDisplay] = useState('0');
  const [expression, setExpression] = useState('');

  const handleKey = useCallback(
    (key: string) => {
      // 시크릿 코드 체크
      const unlocked = processCalculatorInput(key);
      if (unlocked) {
        onUnlock();
        return;
      }

      if (key === 'C') {
        setDisplay('0');
        setExpression('');
        return;
      }

      if (key === '=') {
        const result = calculate(expression + display);
        setDisplay(result);
        setExpression('');
        return;
      }

      if (['+', '-', '*', '/'].includes(key)) {
        setExpression(expression + display + key);
        setDisplay('0');
        return;
      }

      // 숫자 입력
      if (display === '0' && key !== '.') {
        setDisplay(key);
      } else {
        setDisplay(display + key);
      }
    },
    [display, expression, onUnlock]
  );

  const keys = [
    ['7', '8', '9', '/'],
    ['4', '5', '6', '*'],
    ['1', '2', '3', '-'],
    ['0', '.', '=', '+'],
  ];

  return (
    <div style={{ maxWidth: 320, margin: '0 auto', padding: 24 }}>
      <div
        style={{
          border: '1px solid var(--color-text)',
          borderRadius: 6,
          padding: '12px 16px',
          marginBottom: 16,
          textAlign: 'right',
          fontSize: 24,
          minHeight: 48,
          wordBreak: 'break-all',
        }}
      >
        {expression && (
          <div style={{ fontSize: 12, opacity: 0.6 }}>{expression}</div>
        )}
        {display}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <button
          onClick={() => handleKey('C')}
          style={{ gridColumn: 'span 4', minHeight: 44 }}
        >
          C
        </button>
        {keys.map((row) =>
          row.map((key) => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              style={{ minHeight: 44, minWidth: 44 }}
            >
              {key}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
