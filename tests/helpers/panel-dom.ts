import { vi } from 'vitest';

export class PanelElement extends EventTarget {
  children: PanelElement[] = [];
  parentElement: PanelElement | null = null;
  attributes = new Map<string, string>();
  className = '';
  textContent = '';
  value = '';
  type = '';
  hidden = false;
  disabled = false;
  checked = false;
  focused = false;
  focus(): void {
    this.focused = true;
  }
  placeholder = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  constructor(public readonly tagName: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  append(...nodes: PanelElement[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: PanelElement[]): void {
    for (const node of this.children) node.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
}
export const panelNodes = (root: PanelElement): PanelElement[] => [
  root,
  ...root.children.flatMap(panelNodes),
];
export const panelText = (root: PanelElement): string =>
  panelNodes(root)
    .map((n) => n.textContent)
    .join(' ');
export const fakePanelDocument = (): void => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new PanelElement(tag),
    createTextNode: (text: string) =>
      Object.assign(new PanelElement('#text'), { textContent: text }),
  });
};
export const asPanelElement = (element: Element): PanelElement =>
  element as unknown as PanelElement;
