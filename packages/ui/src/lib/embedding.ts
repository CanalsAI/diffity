export function shouldRequestHostClose(defaultPrevented: boolean, dialogOpen: boolean): boolean {
  return !defaultPrevented && !dialogOpen;
}

export function requestHostClose(): void {
  if (window.parent === window) {
    return;
  }

  try {
    if (!document.referrer) {
      return;
    }
    const targetOrigin = new URL(document.referrer).origin;
    window.parent.postMessage({ source: 'diffity', kind: 'close-request' }, targetOrigin);
  } catch {
    return;
  }
}
