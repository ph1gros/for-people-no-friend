/**
 * DOM construction helpers for the chat renderer.
 *
 * `initializeChat` used to spend roughly a fifth of its length on `createElement` followed by a
 * run of property assignments. Collapsing that boilerplate keeps the surrounding logic readable
 * without introducing a rendering framework, and these helpers stay pure: they touch no
 * controller state, register no listeners, and own nothing that needs disposing.
 */

type WritableKey =
  | 'alt'
  | 'autocomplete'
  | 'checked'
  | 'className'
  | 'cols'
  | 'disabled'
  | 'draggable'
  | 'href'
  | 'htmlFor'
  | 'id'
  | 'hidden'
  | 'inputMode'
  | 'max'
  | 'maxLength'
  | 'method'
  | 'min'
  | 'minLength'
  | 'multiple'
  | 'name'
  | 'open'
  | 'placeholder'
  | 'rel'
  | 'rows'
  | 'selected'
  | 'spellcheck'
  | 'src'
  | 'step'
  | 'target'
  | 'textContent'
  | 'title'
  | 'type'
  | 'value';

/**
 * Keys a type declares explicitly, dropping index signatures.
 *
 * `HTMLFormElement` and `HTMLSelectElement` carry a `[name: string]: any` index signature for
 * named form controls, which widens `keyof` to `string` and makes a plain `Extract` collapse to
 * `never`. Filtering those out first keeps per-tag property checking intact for every element.
 */
type ExplicitKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: unknown;
};

export type ElementOptions<K extends keyof HTMLElementTagNameMap> = Partial<
  Pick<HTMLElementTagNameMap[K], Extract<ExplicitKeys<HTMLElementTagNameMap[K]>, WritableKey>>
> & {
  /** Attributes that have no matching IDL property, such as ARIA state. */
  attrs?: Readonly<Record<string, string>>;
};

/**
 * Create an element and apply the given properties in one step.
 *
 * Only IDL properties that exist on the requested tag are accepted, so a typo or a property
 * borrowed from another element type fails at compile time rather than silently doing nothing.
 */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElementOptions<K>,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (!options) return node;
  const { attrs, ...direct } = options;
  Object.assign(node, direct);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  }
  return node;
};
