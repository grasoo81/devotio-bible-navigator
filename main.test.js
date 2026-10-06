const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const platform = { isMobile: false, isDesktopApp: true };
Module._load = function (id, ...args) {
  if (id === 'obsidian') return {
    Plugin: class {
      addRibbonIcon() { return {empty() {}, addClass() {}, setText() {}}; }
      addCommand(command) { this.commands.push(command); }
      registerMarkdownCodeBlockProcessor() {}
      registerView(type, factory) { this.viewRegistration = {type, factory}; }
      registerObsidianProtocolHandler(name, handler) { this.protocol = {name, handler}; }
      registerDomEvent(_target, name, handler) { this.domHandler = {name, handler}; }
    }, ItemView: class { constructor(leaf) { this.leaf = leaf; this.contentEl = leaf.contentEl; } },
    MarkdownView: class {}, Notice: class {}, Platform: platform,
  };
  return originalLoad.call(this, id, ...args);
};
const Navigator = require('./main.js');
Module._load = originalLoad;
global.document = {};

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

const versePath = '100. notes/170. 성경/구약/27.다니엘/단3장.md';
const verseText = '---\ntype: bible-chapter\nbook: 다니엘\nbook_abbr: 단\nchapter: 3\n---\n**[[단3_19|19]]** text\n**[[단3_20|20]]** text\n';
function linkFixture() {
  const nav = new Navigator();
  nav.commands = [];
  const opened = [];
  const file = {path: versePath, name: '단3장.md'};
  nav.app = {
    vault: {
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: path => path === versePath ? file : null,
      cachedRead: async () => verseText,
      read: async () => verseText,
    },
    workspace: {
      getLeaf: kind => {
        opened.push(kind);
        return {openFile: async () => {}, view: {editor: {getLine: () => '', setSelection() {}, scrollIntoView() {}}}};
      },
    },
  };
  return {nav, opened};
}

test('old PC shortcut command id opens the same entry note as the GitHub command', async () => {
  const {nav, opened} = linkFixture();
  const index = '100. notes/170. 성경/📖 성경 찾아가기.md';
  nav.app.vault.getAbstractFileByPath = path => path === index ? {path} : null;
  await nav.onload();
  const original = nav.commands.find(command => command.id === 'open-bible-navigator');
  const legacy = nav.commands.find(command => command.id === 'open');
  assert.ok(original);
  assert.ok(legacy, 'Alt+Shift+B still points at devotio-bible-navigator:open');
  await legacy.callback();
  assert.deepEqual(opened, [false]);
});

test('selected Korean verse links to a verified local chapter and opens its verse in a popout', async () => {
  const {nav, opened} = linkFixture();
  await nav.onload();
  const command = nav.commands.find(command => command.id === 'link-selected-verse');
  assert.ok(command, 'PC selected-reference command remains available');
  let replacement;
  await command.editorCallback({getSelection: () => '단 3:19-20', replaceSelection: text => replacement = text});
  assert.match(replacement, /^\[단 3:19-20\]\(obsidian:\/\/devotio-bible\?/);
  const url = new URL(replacement.match(/\((obsidian:\/\/[^)]+)\)/)[1]);
  assert.equal(url.searchParams.get('file'), versePath);
  assert.equal(url.searchParams.get('verse'), '19');
  await nav.protocol.handler(Object.fromEntries(url.searchParams));
  assert.deepEqual(opened, ['window']);
});

test('vault click on a verse link opens once in the desktop popout', async () => {
  const {nav, opened} = linkFixture();
  await nav.onload();
  let prevented = 0;
  await nav.domHandler.handler({
    target: {closest: () => ({href: 'obsidian://devotio-bible?file=' + encodeURIComponent(versePath) + '&verse=20'})},
    preventDefault: () => prevented++, stopPropagation: () => {},
  });
  assert.equal(prevented, 1);
  assert.deepEqual(opened, ['window']);
});

test('an invalid path or non-existent verse cannot open a chapter', async () => {
  const {nav, opened} = linkFixture();
  await nav.onload();
  await nav.protocol.handler({file: '../private.md', verse: '19'});
  await nav.protocol.handler({file: versePath, verse: '99'});
  await nav.protocol.handler({file: versePath, verse: '19x'});
  assert.deepEqual(opened, []);
});

test('the same verified verse link opens in the current leaf on a mobile device', async () => {
  const {nav, opened} = linkFixture();
  await nav.onload();
  platform.isDesktopApp = false;
  try {
    await nav.protocol.handler({file: versePath, verse: '19'});
    assert.deepEqual(opened, [false]);
  } finally { platform.isDesktopApp = true; }
});

test('iPhone startup adds one Bible tab to the left sidebar without replacing existing tabs', async () => {
  platform.isMobile = true;
  try {
    const nav = new Navigator();
    nav.commands = [];
    nav.getBookIndex = () => [{book: '창세기', book_abbr: '창', testament: '구약', path: 'book.md'}];
    let ready, splitArg, calls = 0;
    const leaves = [];
    const leaf = {contentEl: new Element(), setViewState: async state => {
      const view = nav.viewRegistration.factory(leaf);
      leaf.view = view;
      leaves.push(leaf);
      await view.onOpen();
      assert.equal(state.type, nav.viewRegistration.type);
    }};
    nav.app = {workspace: {
      onLayoutReady: callback => {ready = callback;},
      getLeavesOfType: type => type === nav.viewRegistration.type ? leaves : [],
      getLeftLeaf: split => {splitArg = split; calls++; return leaf;},
    }};
    await nav.onload();
    assert.equal(typeof ready, 'function');
    await ready();
    assert.equal(splitArg, false);
    assert.equal(calls, 1);
    assert.equal(leaf.view.getIcon(), 'book-open');
    assert.equal(leaf.view.getDisplayText(), '성경 찾아가기');
    assert.equal(leaf.contentEl.querySelectorAll('.devotio-bible-btn-book').length, 1);
    await ready();
    assert.equal(calls, 1, 'restart/layout callback should not duplicate sidebar tabs');
  } finally { platform.isMobile = false; }
});
