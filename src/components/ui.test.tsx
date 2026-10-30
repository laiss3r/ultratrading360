// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Button, Toggle } from '@/components/ui';

/**
 * These tests exist because of a bug that no other layer could catch.
 *
 * `Button` used to declare a closed props type and forward only the properties it named. Callers
 * that passed `aria-label` were silently ignored — and TypeScript did not complain, because it does
 * not type-check JSX attributes containing a hyphen (they cannot be valid identifiers). ESLint did
 * not complain either. An icon-only Stop button on the Overlord page therefore shipped with no
 * accessible name at all: a screen reader would announce nothing for the one control that halts a
 * running bot.
 *
 * Rendering to a DOM and asserting what actually lands on the element is the only check that catches
 * that class of bug, so that is what this file does.
 */
describe('Button forwards native attributes to the DOM', () => {
  afterEach(() => cleanup());

  it('puts aria-label on the rendered element', () => {
    render(<Button aria-label="Stop bot">X</Button>);
    // If the prop were dropped, this lookup would find nothing — which is exactly how the bug hid.
    expect(screen.getByRole('button', { name: 'Stop bot' })).toBeTruthy();
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Stop bot');
  });

  it('puts title on the rendered element', () => {
    render(<Button title="halts immediately">X</Button>);
    expect(screen.getByRole('button').getAttribute('title')).toBe('halts immediately');
  });

  it('forwards arbitrary aria-* and data-* attributes', () => {
    render(
      <Button aria-label="Pause bot" aria-describedby="hint" data-testid="ctl">
        X
      </Button>,
    );
    const el = screen.getByTestId('ctl');
    expect(el.getAttribute('aria-label')).toBe('Pause bot');
    expect(el.getAttribute('aria-describedby')).toBe('hint');
  });

  it('an icon-only button is still reachable by its accessible name', () => {
    // The real shape of the Overlord controls: no text node, only an icon child.
    render(
      <Button aria-label="Resume bot" title="Resume">
        <svg data-testid="icon" />
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Resume bot' });
    expect(el.textContent).toBe(''); // proves the name comes from aria-label, not from text
    expect(el.getAttribute('title')).toBe('Resume');
  });

  it('keeps type="button" by default so it cannot submit a form accidentally', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('honours an explicit submit type', () => {
    render(<Button type="submit">X</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit');
  });

  it('forwards disabled and reflects it in the DOM', () => {
    render(<Button disabled aria-label="Pause bot">X</Button>);
    const el = screen.getByRole('button', { name: 'Pause bot' }) as HTMLButtonElement;
    expect(el.disabled).toBe(true);
  });

  it('merges the caller className with the variant classes instead of dropping one', () => {
    render(<Button className="flex-1" variant="danger">X</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('flex-1'); // caller class survives
    expect(cls).toContain('inline-flex'); // base classes survive
  });

  it('still fires onClick', () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>X</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('Toggle exposes its state to assistive technology', () => {
  afterEach(() => cleanup());

  it('renders role=switch with aria-checked reflecting the value', () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} label="Trading enabled" />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');

    rerender(<Toggle checked onChange={() => {}} label="Trading enabled" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('calls onChange with the negated value', () => {
    const fn = vi.fn();
    render(<Toggle checked={false} onChange={fn} label="Trading enabled" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it('can be disabled, which is how real-money acknowledgement is gated', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Real-money trading acknowledged" disabled />);
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });
});
