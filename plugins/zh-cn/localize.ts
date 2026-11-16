export type Dictionary = Record<string, string>;
export type TemplateRules = Record<string, { englishPluralSuffixes?: string[]; placeholderChoices?: Record<string, Record<string, string>>; placeholderUnits?: Record<string, Record<string, string>> }>;
export type ContextRule = { source: string; translation: string; ancestorAriaLabel?: string; siblingText?: string; precedingText?: string };
const attributes = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'data-placeholder'];
export const excluded = [
  'script', 'style', 'noscript', 'pre', 'code', 'kbd', 'samp', 'textarea',
  'iframe', 'object', 'svg', '[contenteditable]:not([contenteditable="false"])',
  '.monaco-editor', '.cm-editor', '.xterm', '.tiptap', '.ProseMirror',
  '[data-markdown-preview]', '[data-message-seq]', '[data-message-column]',
  '[data-sidebar-thread-id]', '[data-thread-toc]', '[data-raw-thread-id]',
  '.alia-thread-title', '[data-sidebar-sticky-tier="label"] span[title]',
  '[data-sent-message-inline-editor-host]', '[data-alia-zh-skip]', '[translate="no"]',
].join(',');
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createTranslator(dictionary: Dictionary, rules: TemplateRules = {}) {
  const exact = new Map(Object.entries(dictionary).map(([k,v]) => [normalize(k),v]));
  // cronstrue uses ordered %s slots instead of the app's numbered slots.
  const cronTemplate = (key: string) => key.includes('%s') && /^(, |every |Every |between |at |minutes |seconds |weekday |%s of the month)/.test(key);
  const patterns = Object.entries(dictionary)
    .filter(([k,v]) => (/\{\d+\}/.test(k) || cronTemplate(k)) && k !== v && /[\u3400-\u9fff]/.test(v))
    .sort(([a],[b]) => b.replace(/\{\d+\}/g,'').length - a.replace(/\{\d+\}/g,'').length)
    .filter(([k]) => k.replace(/\{\d+\}/g,'').trim().length >= 4)
    .map(([key,value]) => {
      const cron = cronTemplate(key);
      let slot = 0;
      const template = cron ? key.replace(/%s/g, () => `{${slot++}}`) : key;
      slot = 0;
      const translatedTemplate = cron ? value.replace(/%s/g, () => `{${slot++}}`) : value;
      const ids: string[] = [];
      const source = normalize(template).split(/(\{\d+\})/).map(part => {
        if (/^\{\d+\}$/.test(part)) {
          ids.push(part);
          return rules[key]?.englishPluralSuffixes?.includes(part) ? '(s?)' : '([\\s\\S]*?)';
        }
        return escape(part).replace(/ /g, '\\s+');
      }).join('');
      return { expression: new RegExp('^'+source+'$', cron ? 'i' : ''), ids, value: translatedTemplate, suffixes: rules[key]?.englishPluralSuffixes ?? [], choices: rules[key]?.placeholderChoices, units: rules[key]?.placeholderUnits };
    });
  return (input: string): string => {
    const key = normalize(input);
    if (!key || !/[A-Za-z]/.test(key)) return input;
    let value = exact.get(key);
    if (value === undefined && key.length < 1600) {
      for (const pattern of patterns) {
        const match = pattern.expression.exec(input.trim());
        if (!match) continue;
        const captures = new Map(pattern.ids.map((id,i) => {
          const raw = match[i+1], choices = pattern.choices?.[id];
          for (const [unit,label] of Object.entries(pattern.units?.[id] ?? {})) {
            if (!raw.endsWith(' '+unit)) continue;
            const number = raw.slice(0,-unit.length-1);
            if (/^\d[\d.,\s]*$/.test(number)) return [id,number+' '+label];
          }
          return [id, pattern.suffixes.includes(id) ? '' : choices && Object.hasOwn(choices,raw) ? choices[raw] : raw];
        }));
        value = pattern.value.replace(/\{\d+\}/g, id => captures.get(id) ?? id);
        break;
      }
    }
    if (value === undefined || value === key) return input;
    return input.replace(/\S(?:[\s\S]*\S)?/,value);
  };
}

export function mountChinese(doc: Document, dictionary: Dictionary, signal?: AbortSignal, rules: TemplateRules = {}, contextRules: ContextRule[] = []) {
  const win = doc.defaultView!;
  const translate = createTranslator(dictionary, rules);
  const textChanges = new Map<Text, { original: string; translated: string }>();
  const attributeChanges = new Map<Element, Map<string, { original: string; translated: string }>>();
  const oldLang = doc.documentElement.getAttribute('lang');
  let disposed = false;
  const skipped = (element: Element | null) => !element || !!element.closest(excluded);
  const originalText = (child: Node): string => {
    if (child.nodeType !== 3) return Array.from(child.childNodes).map(originalText).join('');
    const change = textChanges.get(child as Text);
    return change?.translated === child.textContent ? change.original : child.textContent ?? '';
  };
  function contextual(node: Text): string | undefined {
    for (const rule of contextRules) {
      if (normalize(node.data) !== rule.source) continue;
      let matches = false;
      if (rule.ancestorAriaLabel) {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const current = parent.getAttribute('aria-label');
          const change = attributeChanges.get(parent)?.get('aria-label');
          if ((change?.translated === current ? change.original : current) === rule.ancestorAriaLabel) { matches = true; break; }
        }
      } else if (rule.siblingText && node.parentElement) {
        for (const container of [node.parentElement, node.parentElement.parentElement]) {
          if (!container) continue;
          for (const sibling of Array.from(container.childNodes)) {
            if (sibling.contains(node)) continue;
            if (normalize(originalText(sibling)) === rule.siblingText) { matches = true; break; }
          }
          if (matches) break;
        }
      } else if (rule.precedingText) {
        const preceding = node.parentElement?.previousElementSibling;
        matches = !!preceding && normalize(originalText(preceding)) === rule.precedingText;
      }
      if (matches) return node.data.replace(/\S(?:[\s\S]*\S)?/, rule.translation);
    }
    return undefined;
  }
  function text(node: Text) {
    if (skipped(node.parentElement)) return;
    const current = node.data;
    const translated = contextual(node) ?? translate(current);
    if (translated === current) return;
    const previous = textChanges.get(node);
    textChanges.set(node, { original: previous?.translated === current ? previous.original : current, translated });
    node.data = translated;
  }
  function element(node: Element) {
    if (skipped(node) && !node.matches('input,textarea,[contenteditable="true"]')) return;
    for (const attribute of attributes) {
      const current = node.getAttribute(attribute);
      if (current === null) continue;
      const translated = translate(current);
      if (translated === current) continue;
      let records = attributeChanges.get(node);
      if (!records) attributeChanges.set(node, records = new Map());
      const previous = records.get(attribute);
      records.set(attribute,{original:previous?.translated === current ? previous.original : current, translated});
      node.setAttribute(attribute, translated);
    }
  }
  function scan(root: Node) {
    if (root.nodeType === 3) { text(root as Text); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1) {
      element(root as Element);
      if (skipped(root as Element)) return;
    }
    const walker = doc.createTreeWalker(root, 1 | 4, {
      acceptNode(node) {
        if (node.nodeType === 1 && skipped(node as Element)) {
          element(node as Element);
          return 2;
        }
        return 1;
      },
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) text(node as Text); else element(node as Element);
    }
  }
  function restoreText(node: Text) {
    const change = textChanges.get(node);
    if (change && node.data === change.translated) node.data = change.original;
    textChanges.delete(node);
  }
  function restoreAttributes(node: Element) {
    for (const [key,change] of attributeChanges.get(node) ?? []) {
      if (node.getAttribute(key) === change.translated) node.setAttribute(key,change.original);
    }
    attributeChanges.delete(node);
  }
  const observer = new win.MutationObserver(records => {
    if (disposed) return;
    observer.disconnect();
    try {
      for (const record of records) {
        if (record.type === 'characterData') scan(record.target);
        else if (record.type === 'attributes') element(record.target as Element);
        else for (const added of record.addedNodes) scan(added);
      }
      for (const node of textChanges.keys()) if (!node.isConnected) restoreText(node);
      for (const node of attributeChanges.keys()) if (!node.isConnected) restoreAttributes(node);
    } finally { observe(); }
  });
  function observe() {
    if (!disposed) observer.observe(doc.documentElement, {
      subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:attributes,
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    signal?.removeEventListener('abort',dispose);
    for (const node of textChanges.keys()) restoreText(node);
    for (const node of attributeChanges.keys()) restoreAttributes(node);
    if (doc.documentElement.lang === 'zh-CN') {
      if (oldLang === null) doc.documentElement.removeAttribute('lang');
      else doc.documentElement.setAttribute('lang',oldLang);
    }
  }
  if (signal?.aborted) return dispose;
  doc.documentElement.lang = 'zh-CN';
  scan(doc.body);
  observe();
  signal?.addEventListener('abort',dispose,{once:true});
  return dispose;
}
