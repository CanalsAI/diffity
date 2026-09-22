import { useEffect } from 'react';

type ModalEscapeEvent = Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopImmediatePropagation'>;

export function handleModalEscape(event: ModalEscapeEvent, onEscape: () => void): void {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  onEscape();
}

export function useModalEscape(onEscape: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => handleModalEscape(event, onEscape);
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onEscape]);
}
