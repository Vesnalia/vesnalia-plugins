// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { mountProjectTitleLinks } from "./title-link";
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
function fixture() {
  document.body.innerHTML = `<div data-sidebar-project-id="p1"><div data-sidebar="group-label"><span><span title="Same name">Same name</span><button id="chevron">Collapse</button></span><button id="menu">Actions</button></div><div data-sidebar="group-label"><span><span title="Subsection">Subsection</span></span></div><a id="thread">Thread</a></div><div data-sidebar-project-id="p2"><div data-sidebar="group-label"><span><span title="Same name">Same name</span></span></div></div>`;
  return document.querySelector<HTMLElement>('[title="Same name"]')!;
}
test("only project titles activate; duplicate names route by identity", () => {
  const title = fixture(); const navigate = vi.fn();
  dispose = mountProjectTitleLinks(document, navigate);
  title.click();
  document.querySelector<HTMLElement>('#chevron')!.click();
  document.querySelector<HTMLElement>('#menu')!.click();
  document.querySelector<HTMLElement>('#thread')!.click();
  document.querySelector<HTMLElement>('[title="Subsection"]')!.click();
  document.querySelector<HTMLElement>('[data-sidebar-project-id="p2"] [title]')!.click();
  expect(navigate.mock.calls).toEqual([["p1"], ["p2"]]);
  expect(document.querySelector('[title="Subsection"]')!.hasAttribute('role')).toBe(false);
});
test("keyboard activation, dynamic rows, host drag suppression, and cleanup", async () => {
  const title = fixture(); const navigate = vi.fn();
  dispose = mountProjectTitleLinks(document, navigate);
  title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(navigate).toHaveBeenLastCalledWith("p1");
  const prevented = new MouseEvent("click", { bubbles: true, cancelable: true }); prevented.preventDefault(); title.dispatchEvent(prevented);
  expect(navigate).toHaveBeenCalledTimes(1);
  const row = document.createElement('div'); row.dataset.sidebarProjectId = 'new';
  row.innerHTML = '<div data-sidebar="group-label"><span><span title="New">New</span></span></div>'; document.body.append(row);
  await new Promise(resolve => setTimeout(resolve, 0));
  row.querySelector<HTMLElement>('[title]')!.click(); expect(navigate).toHaveBeenLastCalledWith("new");
  dispose(); dispose = undefined;
  expect(title.getAttribute("role")).toBeNull(); expect(title.getAttribute("tabindex")).toBeNull();
  title.click(); expect(navigate).toHaveBeenCalledTimes(2);
});
test("closes the mobile drawer through its native toggle after opening a title", () => {
  fixture();
  const drawer = document.createElement('div'); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Sidebar');
  drawer.append(...Array.from(document.body.children)); document.body.append(drawer);
  const toggle = document.createElement('button'); toggle.dataset.sidebar = 'trigger'; toggle.setAttribute('aria-expanded', 'true'); document.body.append(toggle);
  const close = vi.fn(); toggle.addEventListener('click', close);
  const navigate = vi.fn(); dispose = mountProjectTitleLinks(document, navigate);
  drawer.querySelector<HTMLElement>('[title]')!.click();
  expect(navigate).toHaveBeenCalledWith('p1'); expect(close).toHaveBeenCalledTimes(1);
});
test("selection follows the rendered homepage, including page changes and leaving it", async () => {
  const title = fixture();
  const page = document.createElement('main'); page.dataset.projectPageId = 'p1'; document.body.append(page);
  dispose = mountProjectTitleLinks(document, vi.fn());
  expect(title.getAttribute('aria-current')).toBe('page');
  expect(title.closest('[data-sidebar="group-label"]')!.hasAttribute('data-project-page-current')).toBe(true);
  page.dataset.projectPageId = 'p2';
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(title.hasAttribute('aria-current')).toBe(false);
  const second = document.querySelector('[data-sidebar-project-id="p2"] [title]')!;
  expect(second.getAttribute('aria-current')).toBe('page');
  delete page.dataset.projectPageId;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.querySelector('[data-project-page-current]')).toBeNull();
  expect(second.hasAttribute('aria-current')).toBe(false);
});
test("disabling removes project selection along with title enhancements", () => {
  const title = fixture(); const page = document.createElement('main'); page.dataset.projectPageId = 'p1'; document.body.append(page);
  dispose = mountProjectTitleLinks(document, vi.fn());
  dispose(); dispose = undefined;
  expect(title.hasAttribute('aria-current')).toBe(false);
  expect(document.querySelector('[data-project-page-current]')).toBeNull();
});
