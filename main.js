const { Plugin, MarkdownView, Notice } = require('obsidian');

// 이 플러그인이 찾아 여는 "성경 찾아가기" 노트의 경로.
// 볼트(Devotio) 안에서 이 경로가 바뀌면 여기도 같이 고쳐야 합니다.
const ENTRY_NOTE_PATH = '100. notes/170. 성경/📖 성경 찾아가기.md';

// 노트 안의 ```devotio-bible-navigator 코드블록을 찾아 UI로 바꿔 줍니다.
const NAVIGATOR_BLOCK_LANG = 'devotio-bible-navigator';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    this.registerMarkdownCodeBlockProcessor(NAVIGATOR_BLOCK_LANG, (source, el) => {
      this.renderNavigator(el);
    });
  }

  async openEntryNote() {
    const file = this.app.vault.getAbstractFileByPath(ENTRY_NOTE_PATH);
    if (!file) {
      new Notice('성경 찾아가기 노트를 찾을 수 없습니다: ' + ENTRY_NOTE_PATH);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
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

  renderNavigator(containerEl) {
    containerEl.empty();
    containerEl.addClass('devotio-bible-navigator');

    const books = this.getBookIndex();

    const bookSelect = containerEl.createEl('select', { cls: 'devotio-bible-select' });
    bookSelect.createEl('option', { text: '성경 선택', value: '' });

    let lastTestament = null;
    let group = null;
    for (const b of books) {
      if (b.testament !== lastTestament) {
        group = bookSelect.createEl('optgroup');
        group.setAttr('label', b.testament);
        lastTestament = b.testament;
      }
      const opt = (group || bookSelect).createEl('option', { text: b.book, value: b.path });
      opt.setAttr('data-abbr', b.book_abbr || '');
    }

    const chapterSelect = containerEl.createEl('select', { cls: 'devotio-bible-select' });
    chapterSelect.disabled = true;
    chapterSelect.createEl('option', { text: '장 선택', value: '' });

    const verseSelect = containerEl.createEl('select', { cls: 'devotio-bible-select' });
    verseSelect.disabled = true;
    verseSelect.createEl('option', { text: '절 선택', value: '' });

    const statusEl = containerEl.createEl('div', { cls: 'devotio-bible-status' });

    bookSelect.addEventListener('change', () => {
      chapterSelect.empty();
      chapterSelect.createEl('option', { text: '장 선택', value: '' });
      verseSelect.empty();
      verseSelect.createEl('option', { text: '절 선택', value: '' });
      verseSelect.disabled = true;
      statusEl.setText('');

      const bookPath = bookSelect.value;
      if (!bookPath) {
        chapterSelect.disabled = true;
        return;
      }

      const bookFile = this.app.vault.getAbstractFileByPath(bookPath);
      const fm = this.app.metadataCache.getFileCache(bookFile)?.frontmatter;
      const abbr = fm?.book_abbr;
      const chapters = this.getChapterIndex(bookFile.parent, abbr);

      for (const c of chapters) {
        chapterSelect.createEl('option', {
          text: c.num + c.unit,
          value: JSON.stringify({ path: c.path, num: c.num, unit: c.unit, abbr }),
        });
      }
      chapterSelect.disabled = chapters.length === 0;
      if (chapters.length === 0) {
        statusEl.setText('이 책에는 장(편) 노트가 아직 없습니다.');
      }
    });

    chapterSelect.addEventListener('change', async () => {
      verseSelect.empty();
      verseSelect.createEl('option', { text: '절 선택', value: '' });
      statusEl.setText('');

      if (!chapterSelect.value) {
        verseSelect.disabled = true;
        return;
      }

      const { path, num, abbr } = JSON.parse(chapterSelect.value);
      const chapterFile = this.app.vault.getAbstractFileByPath(path);
      const content = await this.app.vault.cachedRead(chapterFile);
      const verses = this.extractVerseNumbers(content, abbr, num);

      for (const v of verses) {
        verseSelect.createEl('option', { text: v + '절', value: String(v) });
      }
      verseSelect.disabled = verses.length === 0;
      if (verses.length === 0) {
        statusEl.setText('이 장(편)에는 절 링크를 찾지 못했습니다.');
      }
    });

    verseSelect.addEventListener('change', async () => {
      if (!verseSelect.value || !chapterSelect.value) return;
      const { path, num, abbr } = JSON.parse(chapterSelect.value);
      const verseNum = Number(verseSelect.value);
      await this.goToVerse(path, abbr, num, verseNum, statusEl);
    });
  }
};
