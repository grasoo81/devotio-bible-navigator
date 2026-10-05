const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'obsidian') return {
    Plugin: class {}, MarkdownView: class {}, Notice: class {}, Platform: { isMobile: false },
  };
  return originalLoad.call(this, id, ...args);
};
const Navigator = require('./main.js');
Module._load = originalLoad;

class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    this.text = options.text || '';
    this.classes = new Set((options.cls || '').split(/\s+/).filter(Boolean));
    this.children = [];
    this.handlers = {};
  }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  createEl(tag, options = {}) {
    const el = new Element(tag, options);
    this.children.push(el);
    return el;
  }
  addClass(...names) { names.forEach(name => this.classes.add(name)); }
  removeClass(name) { this.classes.delete(name); }
  setText(text) { this.text = text; }
  setAttr() {}
  empty() { this.children = []; this.text = ''; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  click() { assert.ok(this.handlers.click); return this.handlers.click(); }
  all(predicate) { return this.children.flatMap(el => [el, ...el.all(predicate)]).filter(predicate); }
  querySelectorAll(selector) {
    if (selector === 'button') return this.all(el => el.tag === 'button');
    if (selector.startsWith('.')) return this.all(el => el.classes.has(selector.slice(1)));
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function fixture() {
  const nav = new Navigator();
  const book = { path: 'Bible/Genesis.md', book: '창세기', book_abbr: '창', testament: '구약' };
  const chapter = { path: 'Bible/Genesis1.md', num: 1, unit: '장' };
  nav.getBookIndex = () => [book];
  nav.getChapterIndex = () => [chapter];
  nav.extractVerseNumbers = () => [1, 2];
  nav.app = { vault: {
    getAbstractFileByPath: path => ({path, parent: {children: []}}),
    cachedRead: async () => '**[[창1_1|1]]**\n**[[창1_2|2]]**',
  }};
  return { nav, root: new Element() };
}
const one = (root, selector) => {
  const found = root.querySelectorAll(selector);
  assert.equal(found.length, 1, `Expected one ${selector}, found ${found.length}`);
  return found[0];
};

test('desktop chapter and verse header can reset selection to the book list', async () => {
  const {nav, root} = fixture();
  nav.renderNavigator(root);
  one(root, '.devotio-bible-btn-book').click();
  one(root, '.devotio-bible-btn-chapter').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.querySelectorAll('.devotio-bible-btn-verse').length, 2);
  const home = root.querySelectorAll('.devotio-bible-home-btn');
  assert.ok(home.length >= 1, 'Home button is available beside a visible heading');
  home.at(-1).click();
  assert.equal(root.querySelectorAll('.devotio-bible-btn-book').length, 1);
  assert.equal(root.querySelectorAll('.devotio-bible-btn-chapter').length, 0);
  assert.equal(root.querySelectorAll('.devotio-bible-btn-verse').length, 0);
});

test('mobile verse header returns directly to books without stepping back through chapters', async () => {
  const {nav, root} = fixture();
  nav.renderMobileNavigator(root);
  one(root, '.devotio-bible-btn-book').click();
  one(root, '.devotio-bible-btn-chapter').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.querySelectorAll('.devotio-bible-btn-verse').length, 2);
  one(root, '.devotio-bible-home-btn').click();
  assert.equal(one(root, '.devotio-bible-screen-title').text, '성경');
  assert.equal(root.querySelectorAll('.devotio-bible-btn-book').length, 1);
  assert.equal(root.querySelectorAll('.devotio-bible-btn-chapter').length, 0);
  assert.equal(root.querySelectorAll('.devotio-bible-btn-verse').length, 0);
});

test('mobile chapter header also returns directly to the book list', () => {
  const {nav, root} = fixture();
  nav.renderMobileNavigator(root);
  one(root, '.devotio-bible-btn-book').click();
  assert.equal(root.querySelectorAll('.devotio-bible-btn-chapter').length, 1);
  one(root, '.devotio-bible-home-btn').click();
  assert.equal(one(root, '.devotio-bible-screen-title').text, '성경');
  assert.equal(root.querySelectorAll('.devotio-bible-btn-chapter').length, 0);
  assert.equal(root.querySelectorAll('.devotio-bible-btn-book').length, 1);
});

test('desktop chapter header returns to books before choosing a verse', () => {
  const {nav, root} = fixture();
  nav.renderNavigator(root);
  one(root, '.devotio-bible-btn-book').click();
  assert.equal(root.querySelectorAll('.devotio-bible-btn-chapter').length, 1);
  const chapterHeader = root.querySelectorAll('.devotio-bible-box-header')[1];
  one(chapterHeader, '.devotio-bible-home-btn').click();
  assert.equal(root.querySelectorAll('.devotio-bible-btn-chapter').length, 0);
  assert.equal(root.querySelectorAll('.devotio-bible-btn-book').length, 1);
  assert.equal(nav.navigatorResets.length, 1);
});
