'use client';

import { getRemainingLifetime } from '@/lib/chat/auto-destruct';
import type { Message } from '@/types/message';
import { useEffect, useState } from 'react';

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  quoteExcerpt?: string | null;
  readReceiptEnabled: boolean;
  onQuoteTap?: () => void;
}

/**
 * 메시지 버블 컴포넌트
 * 답장/인용 UI, 자동삭제 타이머 표시, 읽음 확인 표시
 *
 * Requirements: 18.2, 18.5, 3.2, 17.2
 */
export default function MessageBubble({
  message,
  isMine,
  quoteExcerpt,
  readReceiptEnabled,
  onQuoteTap,
}: MessageBubbleProps) {
  const [remaining, setRemaining] = useState(() => getRemainingLifetime(message));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(getRemainingLifetime(message));
    }, 1000);
    return () => clearInterval(interval);
  }, [message]);

  const content = new TextDecoder().decode(message.content);
  const remainingSec = Math.ceil(remaining / 1000);

  const statusIcon =
    message.status === 'read' && readReceiptEnabled
      ? '✓✓'
      : message.status === 'delivered'
        ? '✓'
        : message.status === 'sent'
          ? '·'
          : '';

  return (
    <div className={`message ${isMine ? 'message--sent' : 'message--received'}`}>
      {quoteExcerpt && (
        <div
          onClick={onQuoteTap}
          role={onQuoteTap ? 'button' : undefined}
          tabIndex={onQuoteTap ? 0 : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onQuoteTap) onQuoteTap();
          }}
          style={{
            borderLeft: '2px solid var(--color-text)',
            paddingLeft: 8,
            marginBottom: 4,
            fontSize: 12,
            opacity: 0.7,
            cursor: onQuoteTap ? 'pointer' : undefined,
          }}
        >
          {quoteExcerpt}
        </div>
      )}
      <div style={{ fontSize: 14 }}>{content}</div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          opacity: 0.5,
          marginTop: 4,
        }}
      >
        <span>{remainingSec > 0 ? `${remainingSec}s` : '만료'}</span>
        {isMine && <span>{statusIcon}</span>}
      </div>
    </div>
  );
}
