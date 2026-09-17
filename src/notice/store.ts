import { makeAutoObservable } from "mobx";
import { Readable } from "../ecs/components";

/**
 * MobX-backed state for the paged notice reader (posters/scrolls — see
 * `Readable` in ecs/components.ts). Reads `Readable`'s parallel arrays
 * directly by eid rather than going through a shared registry the way
 * `dialogueStore.open` looks up a tree by id: a notice's text is unique per
 * placement, carried on the entity itself, not a reusable "type" a
 * registry would make sense for. There's also no ECS-mutating half here
 * (unlike dialogueStore's `DialogueActions`/`toggleFollow`) — reading a
 * notice never changes anything in the world, so there's nothing for
 * game.ts to bind.
 */
class NoticeStore {
  activeEid: number | null = null;
  pageIndex = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get isOpen(): boolean {
    return this.activeEid !== null;
  }

  get title(): string | undefined {
    return this.activeEid === null ? undefined : Readable.title[this.activeEid];
  }

  get pages(): string[] {
    return this.activeEid === null ? [] : Readable.pages[this.activeEid];
  }

  get currentPage(): string | undefined {
    return this.pages[this.pageIndex];
  }

  get hasMultiplePages(): boolean {
    return this.pages.length > 1;
  }

  /** Opens `eid`'s notice at its first page — called from the interact
   * dispatch (`doors.ts`'s `tryInteract`) when a `Readable` entity is hit.
   * Silently no-ops (well, "opens" an entity with no pages, which the panel
   * then just renders nothing for) if `eid` somehow isn't a real
   * `Readable` — callers are expected to have already checked
   * `hasComponent(world, eid, Readable)`, same as every other dispatch
   * branch in `tryInteract`. */
  open(eid: number): void {
    this.activeEid = eid;
    this.pageIndex = 0;
  }

  close(): void {
    this.activeEid = null;
    this.pageIndex = 0;
  }

  next(): void {
    if (this.pageIndex < this.pages.length - 1) this.pageIndex++;
  }

  prev(): void {
    if (this.pageIndex > 0) this.pageIndex--;
  }
}

/** Single shared instance — there's only one reader panel/one player. */
export const noticeStore = new NoticeStore();
