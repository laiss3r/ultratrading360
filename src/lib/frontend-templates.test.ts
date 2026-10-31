import { describe, expect, it } from 'vitest';
import { templates, strategyFromTemplate } from './frontend-templates';
import { validateStrategy } from './engine/strategies';

describe('community pattern templates',()=>{
  it.each(templates.map((t)=>[t.id]))('%s is a valid editable, disabled-by-default strategy',(id)=>{const s=strategyFromTemplate(id);expect(validateStrategy(s).valid).toBe(true);expect(s.limits.tradingEnabled).toBe(false);expect(s.progression?.kind).toBe('flat');expect(s.stake).toBe(.35);});
  it('creates distinct strategy identities for separate customizations',()=>{expect(strategyFromTemplate('even').id).not.toBe(strategyFromTemplate('even').id);});
});
