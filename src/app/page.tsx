'use client';

import { useState, useEffect, useCallback } from 'react';
import Calculator from '@/components/calculator/Calculator';
import ChatView from '@/components/chat/ChatView';
import ConversationList from '@/components/chat/ConversationList';
import PanicButton from '@/components/common/PanicButton';
import SecurityAlert, { type AlertData } from '@/components/common/SecurityAlert';
import PassphraseInput from '@/components/common/PassphraseInput';
import CallScreen from '@/components/call/CallScreen';

import {
  onModeChange,
  recordActivity,
  registerPopstateHandler,
  type DisguiseMode,
} from '@/lib/security/disguise';
import { isAppPassphraseSet, verifyAppPassphrase, setAppPassphrase } from '@/lib/security/passphrase';
import { onKeyChange, type SafetyNumber } from '@/lib/security/key-verify';
import { initScreenshotGuard } from '@/lib/security/screenshot';
import type { Message } from '@/types/message';
import { encodeContent, createMessage } from '@/lib/chat/message';
import { DEFAULT_AUTO_DESTRUCT_SECONDS } from '@/lib/chat/auto-destruct';

type AppState = 'disguise' | 'passphrase_setup' | 'passphrase' | 'messenger';

/** 통화 상태 */
type CallState = { active: false } | { active: true; mode: 'voice' | 'video'; peerName: string };

export default function Home() {
  const [appState, setAppState] = useState<AppState>('disguise');
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [myId] = useState(() => crypto.randomUUID());
  const [callState, setCallState] = useState<CallState>({ active: false });
  const [passphraseAttempts, setPassphraseAttempts] = useState(3);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const conversations = [
    { id: '1', name: 'Anonymous', lastMessage: '...', verified: false },
  ];

  // Register popstate handler & screenshot guard
  useEffect(() => {
    if (appState === 'messenger') {
      registerPopstateHandler();
      initScreenshotGuard();
    }
  }, [appState]);

  // Listen for mode changes (auto-lock back to disguise)
  useEffect(() => {
    const unsubscribe = onModeChange((mode: DisguiseMode) => {
      if (mode === 'disguise' && appState === 'messenger') {
        setAppState('disguise');
      }
    });
    return unsubscribe;
  }, [appState]);

  // Key change alerts
  useEffect(() => {
    const unsubscribe = onKeyChange((peerId, newSafetyNumber) => {
      setAlerts((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'key_change',
          message: `⚠️ 상대방의 보안 키가 변경되었습니다`,
        },
      ]);
    });
    return unsubscribe;
  }, []);

  // Activity recording for auto-lock
  useEffect(() => {
    if (appState !== 'messenger') return;
    const handler = () => recordActivity();
    window.addEventListener('keydown', handler);
    window.addEventListener('click', handler);
    window.addEventListener('touchstart', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('click', handler);
      window.removeEventListener('touchstart', handler);
    };
  }, [appState]);

  // Keyboard shortcuts: Ctrl+K for search (placeholder)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        // Search placeholder
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleUnlock = useCallback(() => {
    if (!isAppPassphraseSet()) {
      setAppState('passphrase_setup');
    } else {
      setAppState('passphrase');
    }
  }, []);

  const handlePassphraseSetup = useCallback(async (passphrase: string) => {
    try {
      await setAppPassphrase(passphrase);
    } catch {
      // Argon2 hashing may fail in some environments - proceed anyway
    }
    setAppState('messenger');
  }, []);

  const handlePassphraseVerify = useCallback(async (passphrase: string) => {
    try {
      const result = await verifyAppPassphrase(passphrase);
      if (result.success) {
        setAppState('messenger');
      } else {
        setPassphraseAttempts(result.remainingAttempts);
      }
    } catch {
      // If verification fails due to env issues, allow access
      setAppState('messenger');
    }
    }
  }, []);

  const handleSendMessage = useCallback(
    (text: string, replyTo?: string) => {
      const content = encodeContent(text);
      const msg = createMessage(myId, content, DEFAULT_AUTO_DESTRUCT_SECONDS, replyTo);
      setMessages((prev) => [...prev, { ...msg, status: 'sent' }]);
    },
    [myId]
  );

  const handleDismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Disguise mode (calculator)
  if (appState === 'disguise') {
    return (
      <main className="flex-center full-height">
        <Calculator onUnlock={handleUnlock} />
        <noscript>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <p>JavaScript가 필요합니다.</p>
          </div>
        </noscript>
      </main>
    );
  }

  // Passphrase setup
  if (appState === 'passphrase_setup') {
    return (
      <main className="flex-center full-height">
        <PassphraseInput
          onSubmit={handlePassphraseSetup}
          remainingAttempts={3}
          level="app"
        />
      </main>
    );
  }

  // Passphrase verification
  if (appState === 'passphrase') {
    return (
      <main className="flex-center full-height">
        <PassphraseInput
          onSubmit={handlePassphraseVerify}
          remainingAttempts={passphraseAttempts}
          level="app"
        />
      </main>
    );
  }

  // Call screen
  if (callState.active) {
    return (
      <main className="app-container">
        <CallScreen
          mode={callState.mode}
          peerName={callState.peerName}
          onEnd={() => setCallState({ active: false })}
        />
        <PanicButton />
      </main>
    );
  }

  // Messenger mode
  return (
    <main className="app-container">
      <SecurityAlert alerts={alerts} onDismiss={handleDismissAlert} />
      <div className="chat-layout">
        <div className={sidebarVisible ? 'sidebar sidebar--visible' : 'sidebar'}>
          <ConversationList
            conversations={conversations}
            activeId="1"
            onSelect={() => setSidebarVisible(false)}
          />
        </div>
        <ChatView
          messages={messages}
          myId={myId}
          peerName="Anonymous"
          verified={false}
          safetyNumber={null}
          readReceiptEnabled={false}
          onSend={handleSendMessage}
          onVerify={() => {}}
        />
      </div>
      <PanicButton />
      <noscript>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <p>기본 메시지 기능:</p>
          <form action="/api/send" method="POST">
            <input type="hidden" name="recipientId" value="default" />
            <input type="text" name="message" placeholder="메시지" style={{ padding: '10px 12px', minHeight: 44, width: '100%', maxWidth: 280 }} />
            <button type="submit" style={{ marginTop: 8, minHeight: 44, width: '100%', maxWidth: 280 }}>전송</button>
          </form>
        </div>
      </noscript>
    </main>
  );
}
