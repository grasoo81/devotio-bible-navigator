const { Plugin, ItemView, MarkdownView, Notice, Platform } = require('obsidian');

// 이 플러그인이 찾아 여는 "성경 찾아가기" 노트의 경로.
// 볼트(Devotio) 안에서 이 경로가 바뀌면 여기도 같이 고쳐야 합니다.
const ENTRY_NOTE_PATH = '100. notes/170. 성경/📖 성경 찾아가기.md';

// 노트 안의 ```devotio-bible-navigator 코드블록을 찾아 UI로 바꿔 줍니다.
const NAVIGATOR_BLOCK_LANG = 'devotio-bible-navigator';
const ROOT = '100. notes/170. 성경/';
const SIDEBAR_VIEW_TYPE = 'devotio-bible-navigator-sidebar';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Read only chapter metadata and verse positions from a local Bible note.
function parseChapter(path, text) {
  if (!path.startsWith(ROOT)) return null;
  const fm = text.match(/^---\x0d?\n([\s\S]*?)\x0d?\n---/);
  if (!fm || !/^type: bible-chapter\s*$/m.test(fm[1])) return null;
  const value = key => (fm[1].match(new RegExp('^' + key + ':\\s*(.+)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
  const book = value('book'), abbr = value('book_abbr'), chapter = Number(value('chapter'));
  if (!book || !abbr || !Number.isInteger(chapter) || chapter < 1) return null;
  const verses = [];
  text.split(/\x0d?\n/).forEach((line, index) => {
    const m = line.match(/^\*\*\[\[([^|]+)\|(\d+)\]\]\*\*/);
    if (m && m[1] === abbr + chapter + '_' + m[2]) verses.push({ number: Number(m[2]), line: index });
  });
  return { path, book, abbr, chapter, verses };
}

class BibleSidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return SIDEBAR_VIEW_TYPE; }
  getDisplayText() { return '성경 찾아가기'; }
  getIcon() { return 'book-open'; }
  async onOpen() { this.plugin.renderMobileNavigator(this.contentEl); }
}

module.exports = class DevotioBibleNavigatorPlugin extends Plugin {
  async onload() {
    // 왼쪽 리본에 📖 아이콘. 누르면 "성경 찾아가기" 노트를 엽니다.
    const ribbonEl = this.addRibbonIcon('book-open', '성경 찾아가기', () => {
      this.openEntryNote();
    });
    ribbonEl.empty();
    ribbonEl.addClass('devotio-bible-ribbon-emoji');
    ribbonEl.setText('📖');

    // 리본 아이콘이 안 보이는 기기/설정(예: Focus Mode 켜짐)에서도 쓸 수 있도록
    // 명령 팔레트(검색)에서도 찾을 수 있게 등록합니다.
    this.addCommand({
      id: 'open-bible-navigator',
      name: '성경 찾아가기 열기',
      callback: () => this.openEntryNote(),
    });

    // Keep the PC's existing Alt+Shift+B shortcut registered to :open.
    this.addCommand({ id: 'open', name: '성경 찾아가기', callback: () => this.openEntryNote() });
    this.registerObsidianProtocolHandler('devotio-bible', params => this.handleVerseLink(params));
    this.registerDomEvent(document, 'click', async event => {
      const clicked = event.target?.closest?.('a[href], .cm-link');
      if (!clicked) return;
      let href = clicked.href;
      if (!href && clicked.classList?.contains('cm-link')) {
        const line = clicked.closest('.cm-line');
        const leaf = this.app.workspace.getLeavesOfType('markdown').find(l => l.view.containerEl.contains(clicked));
        const cm = leaf?.view.editor?.cm;
        if (!line || !cm) return;
        const lineNumber = cm.state.doc.lineAt(cm.posAtDOM(line)).number;
        const source = leaf.view.editor.getLine(lineNumber - 1);
        const matches = Array.from(source.matchAll(/\[([^\]]+)\]\((obsidian:\/\/devotio-bible\?[^)\s]+)\)/g))
          .filter(m => m[1] === clicked.textContent);
        if (matches.length !== 1) return;
        href = matches[0][2];
      }
      let url;
      try { url = new URL(href); } catch { return; }
      if (url.protocol !== 'obsidian:' || url.hostname !== 'devotio-bible') return;
      event.preventDefault();
      event.stopPropagation();
      await this.handleVerseLink(Object.fromEntries(url.searchParams));
    }, true);
    this.addCommand({
      id: 'link-selected-verse', name: '선택한 성경 구절을 새 창 링크로 만들기',
      editorCallback: async editor => {
        const label = editor.getSelection();
        const match = label.trim().match(/^([가-힣0-9]+)\s*(\d+)(?:장|\s*:\s*(\d+)(?:\s*[-–~]\s*(\d+))?)?$/);
        if (!match || (match[4] && Number(match[4]) < Number(match[3]))) {
          new Notice('렘 3장, 단 3:19 또는 단 3:19-20처럼 선택해 주세요.'); return;
        }
        const [, book, chapterNumber, selectedVerse, endVerse] = match;
        const verseText = selectedVerse || '1';
        const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(ROOT) &&
          (f.name === `${book}${chapterNumber}장.md` ||
           (f.name.endsWith(`${chapterNumber}장.md`) && f.path.includes(`.${book}/`))));
        const chapters = [];
        for (const file of files) {
          const chapter = parseChapter(file.path, await this.app.vault.cachedRead(file));
          if (chapter && chapter.chapter === Number(chapterNumber) &&
              (chapter.abbr === book || chapter.book === book) &&
              chapter.verses.some(v => v.number === Number(verseText)) &&
              (!endVerse || chapter.verses.some(v => v.number === Number(endVerse)))) chapters.push(chapter);
        }
        if (chapters.length !== 1) { new Notice('해당 구절을 하나의 장별 노트에서 확인하지 못했습니다.'); return; }
        const query = new URLSearchParams({ vault: 'Devotio', file: chapters[0].path, verse: String(Number(verseText)) });
        editor.replaceSelection(`[${label}](obsidian://devotio-bible?${query})`);
      },
    });
    this.registerMarkdownCodeBlockProcessor(NAVIGATOR_BLOCK_LANG, (source, el) => {
      // 아이폰·아이패드는 화면이 좁아서 성경/장/절을 한 화면에 같이 보여주지 않고,
      // 단계마다 화면을 바꿔 가며(책 화면 → 장 화면 → 절 화면) 보여줍니다.
      // 맥·PC는 기존처럼 박스를 세로로 쌓아서 한 화면에 같이 보여줍니다.
      if (Platform.isMobile) {
        this.renderMobileNavigator(el);
      } else {
        this.renderNavigator(el);
      }
    });
    this.registerView(SIDEBAR_VIEW_TYPE, leaf => new BibleSidebarView(leaf, this));
    if (Platform.isMobile) {
      this.app.workspace.onLayoutReady(() => this.ensureMobileSidebarView());
    }
  }

  async ensureMobileSidebarView() {
    const workspace = this.app.workspace;
    if (workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE).length) return;
    const leaf = workspace.getLeftLeaf(false);
    if (leaf) await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: false });
  }

  async handleVerseLink(params) {
    if (!params.file?.startsWith(ROOT) || !/^\d+$/.test(params.verse || '')) return;
    const file = this.app.vault.getAbstractFileByPath(params.file);
    if (!file || file.path !== params.file) return;
    const chapter = parseChapter(file.path, await this.app.vault.read(file));
    const verse = Number(params.verse);
    if (chapter?.verses.some(v => v.number === verse)) await this.openChapter(chapter, verse, true);
  }

  async openChapter(chapter, verseNumber, popout = false) {
    try {
      const file = this.app.vault.getAbstractFileByPath(chapter.path);
      if (!file) throw new Error('Missing chapter');
      const fresh = parseChapter(file.path, await this.app.vault.read(file));
      const verse = verseNumber === undefined ? null : fresh?.verses.find(v => v.number === verseNumber);
      if (!fresh || (verseNumber !== undefined && !verse)) {
        new Notice('선택한 절을 찾지 못했습니다.'); return;
      }
      const leaf = this.app.workspace.getLeaf(popout && Platform.isDesktopApp ? 'window' : false);
      await leaf.openFile(file, { state: { mode: 'source', source: false }, eState: { line: verse?.line || 0 } });
      const view = leaf.view;
      if (view instanceof MarkdownView && verse && view.editor) {
        const start = { line: verse.line, ch: 0 };
        const end = { line: verse.line, ch: view.editor.getLine(verse.line).length };
        view.editor.setSelection(start, end);
        view.editor.scrollIntoView({ from: start, to: end }, true);
      }
    } catch (error) { new Notice('성경 노트를 열지 못했습니다.'); console.error(error); }
  }

  async openEntryNote() {
    const file = this.app.vault.getAbstractFileByPath(ENTRY_NOTE_PATH);
    if (!file) {
      new Notice('성경 찾아가기 노트를 찾을 수 없습니다: ' + ENTRY_NOTE_PATH);
      return;
    }
    const existing = this.app.workspace.getLeavesOfType?.('markdown')?.find(l => l.view?.file?.path === file.path);
    const leaf = existing || this.app.workspace.getLeaf(false);
    if (existing) this.app.workspace.setActiveLeaf?.(existing, true, true);
    await leaf.openFile(file);

    // 이 노트가 이미 열려 있던 상태였다면 Obsidian이 코드블록을 다시 그리지
    // 않을 수 있어서, 전에 눌러서 가 있던 장/절 화면이 그대로 남아 있을 수
    // 있습니다. 그래서 열려 있는 내비게이터를 전부 "성경" 화면(처음)으로
    // 되돌려서, 📖를 누르면 항상 책부터 시작하게 합니다.
    if (this.navigatorResets) {
      this.navigatorResets = this.navigatorResets.filter((r) => r.containerEl.isConnected);
      // resetFn()이 renderNavigator를 다시 불러서 registerNavigatorReset을
      // 또 호출하므로, 지금 돌고 있는 배열 자체가 아니라 복사본(slice)을
      // 돌아야 합니다. 그렇지 않으면 도는 동안 계속 길어져서 끝나지 않는
      // 반복이 됩니다(실제로 이 버그 때문에 앱이 멈췄습니다).
      for (const r of this.navigatorResets.slice()) r.resetFn();
    }
  }

  // renderNavigator/renderMobileNavigator가 자기 자신을 다시 그릴 수 있는
  // 함수를 등록해 둡니다. openEntryNote에서 "처음부터 다시 보여주기"에 씁니다.
  // 같은 containerEl에 대해서는 새 걸로 교체만 하고, 쌓아 두지 않습니다.
  registerNavigatorReset(containerEl, resetFn) {
    if (!this.navigatorResets) this.navigatorResets = [];
    this.navigatorResets = this.navigatorResets.filter((r) => r.containerEl !== containerEl);
    this.navigatorResets.push({ containerEl, resetFn });
  }

  // 볼트 전체에서 frontmatter type: bible-book 인 노트(각 책의 인덱스 노트)를 모읍니다.
  // 책 이름·약어·구약/신약 구분을 전부 이 frontmatter에서 읽어 오므로,
  // 책이 추가되거나 구조가 바뀌어도 이 코드를 고칠 필요가 없습니다.
  getBookIndex() {
    const books = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && fm.type === 'bible-book') {
        books.push({
          path: file.path,
          book: fm.book || file.basename,
          book_abbr: fm.book_abbr,
          book_no: typeof fm.book_no === 'number' ? fm.book_no : 999,
          testament: fm.testament || '기타',
        });
      }
    }
    books.sort((a, b) => {
      if (a.testament !== b.testament) {
        return a.testament.localeCompare(b.testament, 'ko');
      }
      return a.book_no - b.book_no;
    });
    return books;
  }

  // 책 폴더 안에서 frontmatter type: bible-chapter 인 노트(장별/편별 노트)를 모읍니다.
  // 시편처럼 "장" 대신 "편"을 쓰는 책도 frontmatter의 unit 필드로 그대로 처리됩니다.
  getChapterIndex(folder, bookAbbr) {
    const chapters = [];
    if (!folder || !folder.children) return chapters;
    for (const child of folder.children) {
      if (!child.path || !child.path.endsWith('.md')) continue;
      const fm = this.app.metadataCache.getFileCache(child)?.frontmatter;
      if (fm && fm.type === 'bible-chapter' && fm.book_abbr === bookAbbr) {
        chapters.push({
          path: child.path,
          num: fm.chapter,
          unit: fm.unit || '장',
        });
      }
    }
    chapters.sort((a, b) => a.num - b.num);
    return chapters;
  }

  // 장별 노트 본문에서 "[[창10_1|1]]" 형태의 절 링크를 찾아 실제로 존재하는 절 번호만 돌려줍니다.
  // frontmatter의 verse_count를 믿지 않고 본문을 직접 읽는 이유는, 절이 나중에 추가/수정돼도
  // 항상 실제 본문과 일치하는 목록을 보여주기 위해서입니다.
  extractVerseNumbers(content, bookAbbr, chapterNum) {
    const needle = escapeRegExp(bookAbbr + String(chapterNum)) + '_(\\d+)\\|';
    const pattern = new RegExp('\\[\\[' + needle, 'g');
    const nums = new Set();
    let m;
    while ((m = pattern.exec(content))) {
      nums.add(Number(m[1]));
    }
    return Array.from(nums).sort((a, b) => a - b);
  }

  // 장별 노트를 라이브 미리보기로 열고, 선택한 절이 있는 줄을 찾아 선택합니다.
  // 본문 내용은 절대 바꾸지 않습니다(읽기/선택만 합니다).
  async goToVerse(chapterPath, bookAbbr, chapterNum, verseNum, statusEl) {
    const file = this.app.vault.getAbstractFileByPath(chapterPath);
    if (!file) {
      statusEl.setText('노트를 찾을 수 없습니다: ' + chapterPath);
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const lines = content.split('\n');
    const needle = '[[' + bookAbbr + String(chapterNum) + '_' + String(verseNum) + '|';
    const lineIdx = lines.findIndex((l) => l.includes(needle));

    if (lineIdx === -1) {
      statusEl.setText(bookAbbr + chapterNum + '_' + verseNum + ' 줄을 찾지 못했습니다.');
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, {
      state: { mode: 'source', source: false }, // 라이브 미리보기
      eState: { line: lineIdx },
    });

    const view = leaf.view;
    if (view instanceof MarkdownView && view.editor) {
      const lineLen = lines[lineIdx].length;
      view.editor.setSelection({ line: lineIdx, ch: 0 }, { line: lineIdx, ch: lineLen });
      view.editor.scrollIntoView(
        { from: { line: lineIdx, ch: 0 }, to: { line: lineIdx, ch: 0 } },
        true
      );
    }

    statusEl.setText(file.basename + ' · ' + verseNum + '절로 이동했습니다.');
  }

  // 버튼 하나를 만들고 클릭하면 같은 줄의 다른 버튼들의 선택 표시를 지운 뒤
  // 이 버튼에만 선택 표시를 합니다 (라디오 버튼처럼 동작).
  createChoiceButton(rowEl, cls, label, title, onClick) {
    const btn = rowEl.createEl('button', { cls: 'devotio-bible-btn ' + cls, text: label });
    if (title) btn.setAttr('title', title);
    btn.addEventListener('click', () => {
      rowEl.querySelectorAll('button').forEach((el) => el.removeClass('is-selected'));
      btn.addClass('is-selected');
      onClick(btn);
    });
    return btn;
  }

  // 성경/장/절 각 단계를 테두리가 있는 박스로 감싸고, 위에 "장"·"절" 같은 라벨 배지와
  // (있으면) 책 제목을 보여줍니다. 제목을 나중에 바꿀 수 있도록 title span을 돌려줍니다.
  createBox(parentEl, labelText, onHome) {
    const box = parentEl.createDiv({ cls: 'devotio-bible-box' });
    const header = box.createDiv({ cls: 'devotio-bible-box-header' });
    const titleEl = header.createSpan({ cls: 'devotio-bible-box-title' });
    header.createSpan({ cls: 'devotio-bible-box-label', text: labelText });
    const homeBtn = header.createEl('button', {
      cls: 'devotio-bible-home-btn', text: '⌂ 책 목록',
      attr: { type: 'button', 'aria-label': '성경 책 목록으로 돌아가기' },
    });
    homeBtn.addEventListener('click', onHome);
    const bodyEl = box.createDiv({ cls: 'devotio-bible-row' });
    return { box, titleEl, bodyEl };
  }

  renderNavigator(containerEl) {
    containerEl.empty();
    containerEl.addClass('devotio-bible-navigator');
    this.registerNavigatorReset(containerEl, () => this.renderNavigator(containerEl));

    const state = { book: null, chapter: null, verses: null };

    const goHome = () => this.renderNavigator(containerEl);
    const bookBox = this.createBox(containerEl, '성경', goHome);
    const chapterBox = this.createBox(containerEl, '장', goHome);
    chapterBox.box.addClass('is-hidden');
    const verseBox = this.createBox(containerEl, '절', goHome);
    verseBox.box.addClass('is-hidden');

    const statusEl = containerEl.createDiv({ cls: 'devotio-bible-status' });

    const books = this.getBookIndex();
    let lastTestament = null;
    for (const b of books) {
      if (b.testament !== lastTestament) {
        bookBox.bodyEl.createSpan({ cls: 'devotio-bible-group-label', text: b.testament });
        lastTestament = b.testament;
      }
      this.createChoiceButton(
        bookBox.bodyEl,
        'devotio-bible-btn-book',
        b.book_abbr || b.book,
        b.book,
        () => this.showChapters(b, chapterBox, verseBox, statusEl, state)
      );
    }
  }

  showChapters(book, chapterBox, verseBox, statusEl, state) {
    state.book = book;
    state.chapter = null;
    state.verses = null;

    chapterBox.box.removeClass('is-hidden');
    chapterBox.titleEl.setText(book.book);
    chapterBox.bodyEl.empty();

    verseBox.box.addClass('is-hidden');
    verseBox.bodyEl.empty();
    statusEl.setText('');

    const bookFile = this.app.vault.getAbstractFileByPath(book.path);
    const chapters = this.getChapterIndex(bookFile.parent, book.book_abbr);

    if (chapters.length === 0) {
      statusEl.setText('이 책에는 장(편) 노트가 아직 없습니다.');
      return;
    }

    for (const c of chapters) {
      this.createChoiceButton(
        chapterBox.bodyEl,
        'devotio-bible-btn-chapter',
        String(c.num),
        c.num + c.unit,
        async () => {
          const alreadySelected = state.chapter && state.chapter.path === c.path;
          if (alreadySelected) {
            // 같은 장을 다시 누르면 그 장으로 바로 이동합니다(첫 절로).
            if (state.verses && state.verses.length > 0) {
              await this.goToVerse(c.path, book.book_abbr, c.num, state.verses[0], statusEl);
              const firstVerseBtn = verseBox.bodyEl.querySelector('.devotio-bible-btn-verse');
              if (firstVerseBtn) {
                verseBox.bodyEl.querySelectorAll('button').forEach((el) => el.removeClass('is-selected'));
                firstVerseBtn.addClass('is-selected');
              }
            }
            return;
          }
          // 처음 누르면 이동하지 않고, 절을 고를 수 있게 절 박스만 엽니다.
          await this.showVerses(book, c, verseBox, statusEl, state);
        }
      );
    }
  }

  // 장(편)을 처음 누르면 이동하지 않고, 그 장의 절 버튼들만 보여줍니다.
  // 절 박스 제목에 책 이름 + 장(편)을 함께 보여 줍니다.
  async showVerses(book, chapter, verseBox, statusEl, state) {
    state.chapter = chapter;
    state.verses = null;

    verseBox.box.removeClass('is-hidden');
    verseBox.titleEl.setText(book.book + ' ' + chapter.num + chapter.unit);
    verseBox.bodyEl.empty();
    statusEl.setText('');

    const chapterFile = this.app.vault.getAbstractFileByPath(chapter.path);
    const content = await this.app.vault.cachedRead(chapterFile);
    const verses = this.extractVerseNumbers(content, book.book_abbr, chapter.num);
    state.verses = verses;

    if (verses.length === 0) {
      statusEl.setText('이 장(편)에는 절 링크를 찾지 못했습니다.');
      return;
    }

    for (const v of verses) {
      this.createChoiceButton(
        verseBox.bodyEl,
        'devotio-bible-btn-verse',
        String(v),
        v + '절',
        () => this.goToVerse(chapter.path, book.book_abbr, chapter.num, v, statusEl)
      );
    }
  }

  // ───────────────────────── 모바일(아이폰·아이패드) 전용 화면 ─────────────────────────
  // 책을 고르면 장 화면으로, 장을 고르면 절 화면으로 완전히 바뀐다(한 화면에 다 안 보임).
  // 뒤로 버튼으로 이전 화면으로 돌아간다. 실제 데이터는 위의 getBookIndex 등을
  // 그대로 재사용하고, 여기서는 화면 전환만 다르게 만든다.

  renderMobileNavigator(containerEl) {
    containerEl.empty();
    containerEl.addClass('devotio-bible-navigator', 'devotio-bible-navigator-mobile');
    this.registerNavigatorReset(containerEl, () => this.renderMobileNavigator(containerEl));

    const screenEl = containerEl.createDiv({ cls: 'devotio-bible-screen' });
    const statusEl = containerEl.createDiv({ cls: 'devotio-bible-status' });

    this.showBookScreen(screenEl, statusEl);
  }

  createScreenHeader(screenEl, title, onBack, onHome) {
    const header = screenEl.createDiv({ cls: 'devotio-bible-screen-header' });
    if (onBack) {
      const backBtn = header.createEl('button', { cls: 'devotio-bible-back-btn' });
      backBtn.setText('‹ ' + onBack.label);
      backBtn.addEventListener('click', onBack.handler);
    }
    header.createSpan({ cls: 'devotio-bible-screen-title', text: title });
    const homeBtn = header.createEl('button', {
      cls: 'devotio-bible-home-btn', text: '⌂ 책 목록',
      attr: { type: 'button', 'aria-label': '성경 책 목록으로 돌아가기' },
    });
    homeBtn.addEventListener('click', onHome);
  }

  showBookScreen(screenEl, statusEl) {
    screenEl.empty();
    statusEl.setText('');

    this.createScreenHeader(screenEl, '성경', null, () => this.showBookScreen(screenEl, statusEl));
    const row = screenEl.createDiv({ cls: 'devotio-bible-row' });

    const books = this.getBookIndex();
    let lastTestament = null;
    for (const b of books) {
      if (b.testament !== lastTestament) {
        row.createSpan({ cls: 'devotio-bible-group-label', text: b.testament });
        lastTestament = b.testament;
      }
      this.createChoiceButton(
        row,
        'devotio-bible-btn-book',
        b.book_abbr || b.book,
        b.book,
        () => this.showChapterScreen(b, screenEl, statusEl)
      );
    }
  }

  showChapterScreen(book, screenEl, statusEl) {
    screenEl.empty();
    statusEl.setText('');

    this.createScreenHeader(screenEl, book.book, {
      label: '성경',
      handler: () => this.showBookScreen(screenEl, statusEl),
    }, () => this.showBookScreen(screenEl, statusEl));
    const row = screenEl.createDiv({ cls: 'devotio-bible-row' });

    const bookFile = this.app.vault.getAbstractFileByPath(book.path);
    const chapters = this.getChapterIndex(bookFile.parent, book.book_abbr);

    if (chapters.length === 0) {
      statusEl.setText('이 책에는 장(편) 노트가 아직 없습니다.');
      return;
    }

    for (const c of chapters) {
      this.createChoiceButton(
        row,
        'devotio-bible-btn-chapter',
        String(c.num),
        c.num + c.unit,
        () => this.showVerseScreen(book, c, screenEl, statusEl)
      );
    }
  }

  async showVerseScreen(book, chapter, screenEl, statusEl) {
    screenEl.empty();
    statusEl.setText('');

    this.createScreenHeader(screenEl, book.book + ' ' + chapter.num + chapter.unit, {
      label: book.book,
      handler: () => this.showChapterScreen(book, screenEl, statusEl),
    }, () => this.showBookScreen(screenEl, statusEl));
    const row = screenEl.createDiv({ cls: 'devotio-bible-row' });

    const chapterFile = this.app.vault.getAbstractFileByPath(chapter.path);
    const content = await this.app.vault.cachedRead(chapterFile);
    const verses = this.extractVerseNumbers(content, book.book_abbr, chapter.num);

    if (verses.length === 0) {
      statusEl.setText('이 장(편)에는 절 링크를 찾지 못했습니다.');
      return;
    }

    for (const v of verses) {
      this.createChoiceButton(
        row,
        'devotio-bible-btn-verse',
        String(v),
        v + '절',
        () => this.goToVerse(chapter.path, book.book_abbr, chapter.num, v, statusEl)
      );
    }
  }
};
