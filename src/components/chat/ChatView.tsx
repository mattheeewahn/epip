'use client';

import { useState, useRef, useCallback } from 'react';
import type { Message } from '@/types/message';
import type { SafetyNumber } from '@/lib/security/key-verify';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import SafetyNumberDisplay from './SafetyNumberDisplay';
import { createExcerpt, findOriginalMessage, getOriginalMessageIndex } from '@/lib/chat/reply';

interface ChatViewProps {
  messages: Message[];
  myId: string;
  peerName: string;
  verified: boolean;
  safetyNumber: SafetyNumber | null;
  readReceiptEnabled: boolean;
  onSend: (text: string, replyTo?: string) => void;
  onVerify: () => void;
}

/**
 * 채팅 뷰 (메시지 영역 + 입력)
 * Requirements: 18.2, 18.5, 3.2, 17.2, 21.2, 21.3
 */
export default function ChatView({
  messages,
  myId,
  peerName,
  verified,
  safetyNumber,
  readReceiptEnabled,
  onSend,
  onVerify,
}: ChatViewProps) {
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  const replyMsg = replyToId ? messages.find((m) => m.id === replyToId) : null;
  const replyExcerpt = replyMsg ? createExcerpt(replyMsg.content) : null;

  const handleSend = useCallback(
    (text: string) => {
      onSend(text, replyToId ?? undefined);
      setReplyToId(null);
    },
    [onSend, replyToId]
  );

  const scrollToMessage = useCallback(
    (hash: string) => {
      const idx = getOriginalMessageIndex(messages, hash);
      if (idx >= 0 && messagesRef.current) {
        const el = messagesRef.current.children[idx] as HTMLElement | undefined;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [messages]
  );

  return (
    <div className="chat-area">
      <div className="chat-header">
        <span style={{ flex: 1, fontSize: 14 }}>
          {peerName}
          {verified && <span style={{ marginLeft: 6, fontSize: 11 }}>✓</span>}
        </span>
        <button
          onClick={() => setShowSafety(!showSafety)}
          style={{ border: 'none', fontSize: 12, padding: '4px 8px' }}
        >
          🔑
        </button>
      </div>

      {showSafety && (
        <SafetyNumberDisplay
          safetyNumber={safetyNumber}
          verified={verified}
          onVerify={onVerify}
        />
      )}

      <div className="chat-messages" ref={messagesRef}>
        {messages.map((msg) => {
          const isMine = msg.senderId === myId;
          const original = msg.replyTo ? findOriginalMessage(messages, msg.replyTo) : null;
          const quoteExcerpt = msg.replyTo
            ? original
              ? createExcerpt(original.content)
              : '삭제된 메시지'
            : null;

          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isMine={isMine}
              quoteExcerpt={quoteExcerpt}
              readReceiptEnabled={readReceiptEnabled}
              onQuoteTap={
                msg.replyTo ? () => scrollToMessage(msg.replyTo!) : undefined
              }
            />
          );
        })}
      </div>

      <div style={{ position: 'relative' }}>
        <ChatInput
          onSend={handleSend}
          replyTo={replyExcerpt}
          onCancelReply={() => setReplyToId(null)}
        />
      </div>
    </div>
  );
}
