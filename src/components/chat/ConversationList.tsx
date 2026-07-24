'use client';

interface ConversationItem {
  id: string;
  name: string;
  lastMessage: string;
  verified: boolean;
}

interface ConversationListProps {
  conversations: ConversationItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 대화 목록 컴포넌트
 * Requirements: 18.2
 */
export default function ConversationList({
  conversations,
  activeId,
  onSelect,
}: ConversationListProps) {
  return (
    <div className="sidebar">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-text)' }}>
        <span style={{ fontSize: 14 }}>대화</span>
      </div>
      {conversations.length === 0 && (
        <div style={{ padding: 16, opacity: 0.6, fontSize: 13 }}>
          대화가 없습니다
        </div>
      )}
      {conversations.map((conv) => (
        <div
          key={conv.id}
          className="conversation-item"
          role="button"
          tabIndex={0}
          onClick={() => onSelect(conv.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelect(conv.id);
          }}
          style={{
            background: activeId === conv.id ? 'rgba(255,255,255,0.05)' : undefined,
            cursor: 'pointer',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>{conv.name}</span>
              {conv.verified && (
                <span title="검증됨" style={{ fontSize: 11 }}>✓</span>
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                opacity: 0.6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {conv.lastMessage}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
