import { describe, expect, it, vi } from 'vitest';
import { handleModalEscape } from '../src/hooks/use-modal-escape';

describe('handleModalEscape', () => {
  it('consumes Escape before closing the modal', () => {
    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    const onEscape = vi.fn();

    handleModalEscape(event, onEscape);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('ignores other keys', () => {
    const event = {
      key: 'Enter',
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    const onEscape = vi.fn();

    handleModalEscape(event, onEscape);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
  });
});
