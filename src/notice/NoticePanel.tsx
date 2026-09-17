import { noticeStore } from "./store";
import { useObserved } from "./useObserved";

/**
 * Paged notice reader — shown whenever `noticeStore` has an active
 * readable (a poster or scroll interacted with, see `ecs/systems/doors.ts`'s
 * `tryInteract`). Same "own fixed overlay, own Preact tree" pattern as
 * `DialoguePanel`/`HUD`/inventory (see mount.tsx). Next/Prev only render
 * for a multi-page notice — a single-page one is just its text and a Close
 * button, same as reading a sign.
 */
export function NoticePanel() {
  const { isOpen, title, currentPage, hasMultiplePages, pageIndex, pageCount } = useObserved(() => ({
    isOpen: noticeStore.isOpen,
    title: noticeStore.title,
    currentPage: noticeStore.currentPage,
    hasMultiplePages: noticeStore.hasMultiplePages,
    pageIndex: noticeStore.pageIndex,
    pageCount: noticeStore.pages.length,
  }));

  if (!isOpen) return null;

  return (
    <div class="notice-root" data-testid="notice-panel">
      {title && <div class="notice-title">{title}</div>}
      <div class="notice-page" data-testid="notice-page">
        {currentPage}
      </div>
      <div class="notice-controls">
        {hasMultiplePages && (
          <button
            type="button"
            class="notice-nav-btn"
            data-testid="notice-prev"
            disabled={pageIndex === 0}
            onClick={() => noticeStore.prev()}
          >
            ‹ Prev
          </button>
        )}
        {hasMultiplePages && (
          <div class="notice-page-label" data-testid="notice-page-label">
            {pageIndex + 1} / {pageCount}
          </div>
        )}
        {hasMultiplePages && (
          <button
            type="button"
            class="notice-nav-btn"
            data-testid="notice-next"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => noticeStore.next()}
          >
            Next ›
          </button>
        )}
        <button type="button" class="notice-close-btn" data-testid="notice-close" onClick={() => noticeStore.close()}>
          Close
        </button>
      </div>
    </div>
  );
}
