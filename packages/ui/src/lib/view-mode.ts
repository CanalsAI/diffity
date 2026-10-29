import type { ViewMode } from './diff-utils';

const COOKIE_NAME = 'diffity-view-mode';

export function getViewMode(explicit?: string | null): ViewMode {
  if (explicit === 'split' || explicit === 'unified') return explicit;

  try {
    const saved = document.cookie.split('; ').find(cookie => cookie.startsWith(`${COOKIE_NAME}=`))?.split('=')[1];
    if (saved === 'split' || saved === 'unified') return saved;
  } catch {}

  return 'split';
}

export function saveViewMode(mode: ViewMode): void {
  try {
    // Devspaces app hosts use <port>--<workspace>.<domain>.
    const domain = window.location.hostname.match(/^[^.]+--[^.]+\.(.+)$/)?.[1];
    const scope = domain ? `; Domain=${domain}` : '';
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_NAME}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${scope}${secure}`;
  } catch {}
}
