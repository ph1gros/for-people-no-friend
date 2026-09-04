import { afterEach, describe, expect, it, vi } from 'vitest';

import { el } from '../src/renderer/chat/elements';

class FakeElement {
  public readonly attributes = new Map<string, string>();
  public className = '';
  public textContent = '';
  public hidden = false;
  public type = '';
  public value = '';
  public placeholder = '';
  public maxLength = 0;

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const created: string[] = [];
const assignmentOrder: string[] = [];

const stubDocument = (recordOrder = false): void => {
  created.length = 0;
  assignmentOrder.length = 0;
  vi.stubGlobal('document', {
    createElement(tag: string) {
      created.push(tag);
      const node = new FakeElement();
      if (!recordOrder) return node;
      return new Proxy(node, {
        set(target, property, value) {
          assignmentOrder.push(String(property));
          return Reflect.set(target, property, value);
        },
      });
    },
  });
};

describe('el', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a bare element when no options are given', () => {
    stubDocument();
    const node = el('div') as unknown as FakeElement;

    expect(created).toEqual(['div']);
    expect(node.className).toBe('');
    expect(node.attributes.size).toBe(0);
  });

  it('assigns IDL properties directly', () => {
    stubDocument();
    const node = el('input', {
      type: 'text',
      placeholder: '名称',
      maxLength: 40,
    }) as unknown as FakeElement;

    expect(node.type).toBe('text');
    expect(node.placeholder).toBe('名称');
    expect(node.maxLength).toBe(40);
  });

  it('routes attrs through setAttribute instead of property assignment', () => {
    stubDocument();
    const node = el('p', {
      className: 'settings-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    }) as unknown as FakeElement;

    expect(node.className).toBe('settings-status');
    expect(node.attributes.get('role')).toBe('status');
    expect(node.attributes.get('aria-live')).toBe('polite');
    expect(Object.hasOwn(node, 'role')).toBe(false);
  });

  it('applies properties in declaration order so order-sensitive pairs stay correct', () => {
    // An input must receive `type` before `value`: setting a value first and then switching the
    // type can discard it. Object.assign follows key order, and this pins that behaviour down.
    stubDocument(true);
    el('input', { type: 'range', value: '0.6' });

    expect(assignmentOrder).toEqual(['type', 'value']);
  });

  it('keeps falsy values that are meaningful', () => {
    stubDocument(true);
    const node = el('input', {
      className: '',
      hidden: false,
      maxLength: 0,
    }) as unknown as FakeElement;

    expect(node.className).toBe('');
    expect(node.hidden).toBe(false);
    expect(node.maxLength).toBe(0);
    expect(assignmentOrder).toEqual(['className', 'hidden', 'maxLength']);
  });
});
