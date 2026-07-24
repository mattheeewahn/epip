'use client';

import { useState, useEffect } from 'react';

export interface AlertData {
  id: string;
  type: 'key_change' | 'screenshot' | 'warning';
  message: string;
}

interface SecurityAlertProps {
  alerts: AlertData[];
  onDismiss: (id: string) => void;
}

/**
 * 보안 경고 알림 (키 변경, 스크린샷 감지 등)
 * Requirements: 21.4, 13.1
 */
export default function SecurityAlert({ alerts, onDismiss }: SecurityAlertProps) {
  if (alerts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        right: 12,
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {alerts.map((alert) => (
        <div
          key={alert.id}
          style={{
            border: '1px solid var(--color-text)',
            borderRadius: 6,
            padding: '8px 12px',
            background: 'var(--color-bg)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
          }}
        >
          <span style={{ flex: 1 }}>{alert.message}</span>
          <button
            onClick={() => onDismiss(alert.id)}
            style={{ border: 'none', padding: '0 4px', minWidth: 'auto', minHeight: 'auto' }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
