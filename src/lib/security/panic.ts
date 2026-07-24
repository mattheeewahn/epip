/**
 * 패닉 엔진 (Panic Engine)
 *
 * 긴급 상황에서 모든 로컬 데이터를 2초 이내에 완전히 삭제하고,
 * 모든 P2P 연결을 종료한 후 about:blank으로 리디렉션한다.
 *
 * - 화면 하단에 긴급 삭제 버튼 상시 표시
 * - 확인 대화상자 없이 즉시 실행
 * - 키보드 단축키: Ctrl+Shift+X
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */

import { closeAllConnections } from '@/lib/transport/p2p-relay';

/** 패닉 삭제 대상 유형 */
export type PanicTarget =
  | { type: 'memory'; ref: string }
  | { type: 'connection'; id: string }
  | { type: 'storage'; key: string };

/** 패닉 엔진 상태 */
export type PanicState = 'idle' | 'executing' | 'completed';

/** 메모리 내 민감 데이터 레지스트리 */
const memoryRegistry: Map<string, Uint8Array | null> = new Map();

/** 패닉 엔진 상태 */
let panicState: PanicState = 'idle';

/** 키보드 리스너 등록 여부 */
let shortcutRegistered = false;

/**
 * 메모리 내 민감 데이터를 등록한다.
 *
 * 패닉 실행 시 등록된 모든 데이터가 제로화된다.
 *
 * @param ref - 데이터 참조 이름
 * @param data - 삭제 대상 Uint8Array
 */
export function registerSensitiveData(ref: string, data: Uint8Array): void {
  memoryRegistry.set(ref, data);
}

/**
 * 등록된 민감 데이터를 제거한다.
 *
 * @param ref - 데이터 참조 이름
 */
export function unregisterSensitiveData(ref: string): void {
  memoryRegistry.delete(ref);
}

/**
 * 현재 패닉 엔진 상태를 반환한다.
 */
export function getPanicState(): PanicState {
  return panicState;
}

/**
 * 삭제 대상 목록을 반환한다.
 */
export function getTargets(): PanicTarget[] {
  const targets: PanicTarget[] = [];

  // 메모리 내 민감 데이터
  for (const ref of memoryRegistry.keys()) {
    targets.push({ type: 'memory', ref });
  }

  // sessionStorage 항목
  if (typeof sessionStorage !== 'undefined') {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) {
        targets.push({ type: 'storage', key });
      }
    }
  }

  // localStorage 항목
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        targets.push({ type: 'storage', key });
      }
    }
  }

  return targets;
}

/**
 * 모든 메모리 내 민감 데이터를 제로화한다.
 */
function destroyMemoryData(): void {
  for (const [ref, data] of memoryRegistry) {
    if (data) {
      data.fill(0);
    }
    memoryRegistry.delete(ref);
  }
  memoryRegistry.clear();
}

/**
 * 모든 브라우저 스토리지를 삭제한다.
 */
function destroyStorage(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  } catch {
    // 접근 불가 시 무시
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  } catch {
    // 접근 불가 시 무시
  }

  // IndexedDB 삭제 (가능한 경우)
  try {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.databases?.()?.then?.((dbs) => {
        for (const db of dbs) {
          if (db.name) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      });
    }
  } catch {
    // 접근 불가 시 무시
  }
}

/**
 * 긴급 삭제를 실행한다 (2초 이내 완료).
 *
 * 실행 순서:
 * 1. 모든 메모리 내 민감 데이터 제로화 (메시지, 세션 키, 암호화 키)
 * 2. 모든 P2P 연결 및 Hidden Service 종료
 * 3. 브라우저 스토리지(sessionStorage, localStorage, IndexedDB) 삭제
 * 4. about:blank으로 리디렉션
 *
 * 확인 대화상자 없이 즉시 실행된다.
 */
export async function execute(): Promise<void> {
  if (panicState === 'executing') {
    return; // 이미 실행 중이면 중복 실행 방지
  }

  panicState = 'executing';

  try {
    // 1. 메모리 내 민감 데이터 즉시 제로화
    destroyMemoryData();

    // 2. 모든 P2P 연결 종료
    await closeAllConnections();

    // 3. 브라우저 스토리지 삭제
    destroyStorage();

    panicState = 'completed';

    // 4. about:blank으로 리디렉션
    if (typeof window !== 'undefined') {
      window.location.replace('about:blank');
    }
  } catch {
    // 오류가 발생하더라도 리디렉션은 실행
    panicState = 'completed';
    if (typeof window !== 'undefined') {
      window.location.replace('about:blank');
    }
  }
}

/**
 * Ctrl+Shift+X 키보드 단축키 리스너를 등록한다.
 *
 * 단축키가 감지되면 즉시 패닉 삭제를 실행한다.
 */
export function registerShortcut(): void {
  if (shortcutRegistered) return;
  if (typeof window === 'undefined') return;

  window.addEventListener('keydown', handlePanicShortcut);
  shortcutRegistered = true;
}

/**
 * 키보드 단축키 리스너를 해제한다.
 */
export function unregisterShortcut(): void {
  if (!shortcutRegistered) return;
  if (typeof window === 'undefined') return;

  window.removeEventListener('keydown', handlePanicShortcut);
  shortcutRegistered = false;
}

/**
 * 패닉 단축키 이벤트 핸들러
 */
function handlePanicShortcut(event: KeyboardEvent): void {
  // Ctrl+Shift+X
  if (event.ctrlKey && event.shiftKey && event.key === 'X') {
    event.preventDefault();
    event.stopPropagation();
    execute();
  }
}

/**
 * 모듈 상태를 초기화한다 (테스트용).
 */
export function resetPanic(): void {
  panicState = 'idle';
  memoryRegistry.clear();
  unregisterShortcut();
}
