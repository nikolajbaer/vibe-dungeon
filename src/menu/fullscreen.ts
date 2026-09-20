type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** Fullscreen must be requested directly inside the Play-button gesture. */
export function requestGameFullscreen(container: HTMLElement): void {
  const target = container as WebkitFullscreenElement;
  const request = target.requestFullscreen?.bind(target) ?? target.webkitRequestFullscreen?.bind(target);
  if (!request) return;
  try {
    const result = request();
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // Fullscreen is an enhancement: unsupported/denied requests still play.
  }
}

export function isGameFullscreen(): boolean {
  const doc = document as WebkitFullscreenDocument;
  return Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);
}

export function exitGameFullscreen(): void {
  const doc = document as WebkitFullscreenDocument;
  const exit = document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc);
  if (!exit) return;
  try {
    const result = exit();
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // The browser may have already left fullscreen through its own chrome.
  }
}
