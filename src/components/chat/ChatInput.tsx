'use client';

import { useState, useRef, useCallback } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  replyTo?: string | null;
  onCancelReply?: () => void;
}

/**
 * 채팅 입력 필드
 * Requirements: 18.2, 22.4
 */
export default function ChatInput({ onSend, replyTo, onCancelReply }: ChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === 'Escape' && onCancelReply) {
        onCancelReply();
      }
    },
    [handleSend, onCancelReply]
  );

  return (
    <div className="chat-input-bar">
      {replyTo && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            padding: '4px 16px',
            fontSize: 12,
            borderTop: '1px solid var(--color-text)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ opacity: 0.7 }}>답장: {replyTo}</span>
          <button
            onClick={onCancelReply}
            style={{ border: 'none', padding: '0 4px', minWidth: 'auto', minHeight: 'auto' }}
          >
            ✕
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="메시지"
        autoComplete="off"
        style={{ padding: '10px 12px' }}
      />
      <button onClick={handleSend}>전송</button>
    </div>
  );
}
