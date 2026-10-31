// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Button, Notice, Toggle } from './ui';
afterEach(cleanup);
describe('new workspace primitives',()=>{
  it('forwards accessible names and native button props',()=>{render(<Button aria-label="Stop automation" title="Stop" data-testid="stop">X</Button>);const button=screen.getByRole('button',{name:'Stop automation'});expect(button.getAttribute('title')).toBe('Stop');expect(button.getAttribute('type')).toBe('button');});
  it('does not submit forms unless explicitly requested',()=>{render(<Button type="submit">Save</Button>);expect(screen.getByRole('button').getAttribute('type')).toBe('submit');});
  it('disables a busy action and reports its pending state',()=>{render(<Button busy>Save</Button>);const b=screen.getByRole('button') as HTMLButtonElement;expect(b.disabled).toBe(true);expect(b.getAttribute('aria-busy')).toBe('true');});
  it('fires button actions',()=>{const click=vi.fn();render(<Button onClick={click}>Save</Button>);fireEvent.click(screen.getByRole('button'));expect(click).toHaveBeenCalledTimes(1);});
  it('exposes errors as alerts',()=>{render(<Notice tone="error">Failed safely</Notice>);expect(screen.getByRole('alert').textContent).toBe('Failed safely');});
  it('toggles accessible switches without silently changing permissions',()=>{const changed=vi.fn();render(<Toggle checked={false} label="Allow trades" onChange={changed}/>);fireEvent.click(screen.getByRole('switch'));expect(changed).toHaveBeenCalledWith(true);expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');});
});
