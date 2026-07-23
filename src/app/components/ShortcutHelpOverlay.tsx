import { BOUNDARY_NUDGE_MS } from "../../domain/candidateBoundaryRevision";

interface ShortcutHelpOverlayProps {
  readonly onClose: () => void;
}

const NUDGE_SECONDS = BOUNDARY_NUDGE_MS / 1_000;

/** Discoverability for the keyboard review loop. Opened with `?`, closed with Escape. */
export function ShortcutHelpOverlay({ onClose }: ShortcutHelpOverlayProps) {
  return (
    <div
      className="rh-shortcut-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      onClick={onClose}
    >
      <div
        className="rh-shortcut-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="rh-shortcut-heading">
          <h3 id="shortcut-help-title">검토 단축키</h3>
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            닫기
          </button>
        </div>
        <dl className="rh-shortcut-list">
          <div>
            <dt><kbd>Space</kbd></dt>
            <dd>현재 후보 재생 · 일시정지</dd>
          </div>
          <div>
            <dt><kbd>←</kbd> <kbd>→</kbd></dt>
            <dd>이전 · 다음 후보</dd>
          </div>
          <div>
            <dt><kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd></dt>
            <dd>시작 위치를 {NUDGE_SECONDS}초 앞뒤로</dd>
          </div>
          <div>
            <dt><kbd>Alt</kbd> + <kbd>←</kbd> <kbd>→</kbd></dt>
            <dd>끝 위치를 {NUDGE_SECONDS}초 앞뒤로</dd>
          </div>
          <div>
            <dt><kbd>A</kbd></dt>
            <dd>사용하기 · 승인 취소</dd>
          </div>
          <div>
            <dt><kbd>R</kbd></dt>
            <dd>빼기 · 다시 검토</dd>
          </div>
          <div>
            <dt><kbd>Z</kbd></dt>
            <dd>방금 한 판단 되돌리기</dd>
          </div>
          <div>
            <dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt>
            <dd>후보 카드의 요약 · 단서 · 맥락 탭으로 이동</dd>
          </div>
          <div>
            <dt><kbd>D</kbd></dt>
            <dd>요약 · 단서 · 맥락 탭 순환</dd>
          </div>
          <div>
            <dt><kbd>M</kbd></dt>
            <dd>방송 지도 열고 닫기</dd>
          </div>
          <div>
            <dt><kbd>?</kbd></dt>
            <dd>이 안내 열고 닫기</dd>
          </div>
        </dl>
        <p className="rh-help">
          사용·빼기를 누르면 아직 판단하지 않은 다음 후보로 자동으로 넘어가요.
          글자를 입력하는 칸에서는 단축키가 동작하지 않습니다.
        </p>
      </div>
    </div>
  );
}
