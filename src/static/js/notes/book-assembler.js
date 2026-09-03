/**
 * book-assembler.js
 * Facade Pattern implementation for assembling multi-chapter books
 * into a single continuous-scroll reading experience.
 */

(function () {
  class BookAssemblerFacade {
    /**
     * Filters, validates, and orders all notes belonging to a specific bookId.
     * @param {string} bookId - Unique identifier of the book (e.g., 'b-xxxx')
     * @param {Array} allNotes - Array of all note objects from repository
     * @returns {Object} { bookId, bookTitle, rootNote, chapters }
     */
    static assembleBook(bookId, allNotes) {
      if (!allNotes || !Array.isArray(allNotes)) {
        throw new Error("Invalid notes collection provided to BookAssembler.");
      }

      const bookTag = `[book:${bookId}]`;
      const bookNotes = allNotes.filter(n => n.title && n.title.includes(bookTag));

      if (bookNotes.length === 0) {
        throw new Error(`No notes found for book: ${bookId}`);
      }

      // Separate root overview note from chapters
      const rootNote = bookNotes.find(n => !n.title.includes('[ch:'));
      const chapters = bookNotes.filter(n => n.title.includes('[ch:'));

      // Sort chapters numerically by chapter index [ch:N]
      chapters.sort((a, b) => {
        const matchA = a.title.match(/\[ch:(\d+)\]/);
        const matchB = b.title.match(/\[ch:(\d+)\]/);
        const numA = matchA ? parseInt(matchA[1], 10) : 0;
        const numB = matchB ? parseInt(matchB[1], 10) : 0;
        return numA - numB;
      });

      const bookTitle = rootNote
        ? rootNote.title.replace(/^\[book:[^\]]+\]/, '').trim()
        : (chapters[0] ? chapters[0].title.replace(/^\[book:[^\]]+\](?:\[ch:\d+\]\s*)?/, '').trim() : "Untitled Book");

      return {
        bookId,
        bookTitle: bookTitle || "Untitled Book",
        rootNote,
        chapters
      };
    }

    /**
     * Helper to extract clean Markdown text from note content (HTML or MD).
     */
    static _extractMarkdown(note) {
      if (!note) return '';
      if (typeof window.htmlToMarkdown === 'function' && note.content) {
        // If it looks like HTML, convert to markdown
        if (note.content.includes('<p>') || note.content.includes('<div>') || note.content.includes('<br>')) {
          return window.htmlToMarkdown(note.content);
        }
      }
      return note.rawText || note.content || '';
    }

    /**
     * Generates a rich, continuous-stream Markdown document with anchors,
     * modern chapter badges, navigation pagers, and a Mini-TOC.
     * @param {Object} assembled - Output of assembleBook()
     * @returns {string} Stitched Markdown content
     */
    static generateContinuousMarkdown(assembled) {
      const { bookTitle, rootNote, chapters } = assembled;
      const cleanChapters = chapters.map((ch, idx) => {
        const m = ch.title.match(/\[ch:(\d+)\]/);
        const chNum = m ? parseInt(m[1], 10) : (idx + 1);
        const cleanTitle = ch.title.replace(/^\[book:[^\]]+\](?:\[ch:\d+\]\s*)?/, '').trim();
        return {
          id: ch.id,
          chNum,
          anchorId: `ch-${chNum}`,
          title: cleanTitle || `Chapter ${chNum}`,
          content: this._extractMarkdown(ch)
        };
      });

      let md = `# 📖 ${bookTitle}\n\n`;

      // Mini Table of Contents Pills at top
      md += `<div class="book-stream-header" style="margin: 16px 0 24px; padding: 14px 18px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 10px;">\n`;
      md += `  <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 700; margin-bottom: 8px;">Continuous Book Stream &bull; ${cleanChapters.length + (rootNote ? 1 : 0)} Sections</div>\n`;
      md += `  <div style="display: flex; flex-wrap: wrap; gap: 8px;">\n`;
      
      if (rootNote) {
        md += `    <a href="#ch-overview" style="padding: 4px 10px; font-size: 12px; border-radius: 16px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--text-1); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">📑 Overview</a>\n`;
      }
      
      cleanChapters.forEach(ch => {
        md += `    <a href="#${ch.anchorId}" style="padding: 4px 10px; font-size: 12px; border-radius: 16px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--text-1); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;"><strong>${ch.chNum}.</strong> ${ch.title}</a>\n`;
      });
      md += `  </div>\n`;
      md += `</div>\n\n`;

      // Root / Book Overview
      if (rootNote) {
        const rootContent = this._extractMarkdown(rootNote);
        md += `<div id="ch-overview" class="book-chapter-divider" data-ch="0" data-title="Book Overview" style="padding-top: 10px; margin-top: 20px; border-top: 1px dashed rgba(255,255,255,0.15);">\n`;
        md += `  <span style="display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 4px; background: rgba(99, 179, 237, 0.15); color: var(--accent); border: 1px solid rgba(99, 179, 237, 0.3);">Book Overview</span>\n`;
        md += `  <h2 style="margin-top: 8px; font-size: 1.5rem; color: var(--text-1);">Book Overview</h2>\n`;
        md += `</div>\n\n`;

        if (rootContent.trim()) {
          md += `${rootContent}\n\n`;
        } else {
          md += `*No overview content recorded yet for this book.*\n\n`;
        }

        // Pager to first chapter
        if (cleanChapters.length > 0) {
          md += `<div class="chapter-pager" style="display: flex; justify-content: flex-end; margin: 30px 0 40px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08);">\n`;
          md += `  <a href="#${cleanChapters[0].anchorId}" style="padding: 6px 14px; font-size: 13px; font-weight: 600; border-radius: 20px; background: var(--accent); color: #fff; text-decoration: none;">Start Reading: ${cleanChapters[0].title} &rarr;</a>\n`;
          md += `</div>\n\n`;
        }
      }

      // Sequential Chapters
      cleanChapters.forEach((ch, idx) => {
        md += `<div id="${ch.anchorId}" class="book-chapter-divider" data-ch="${ch.chNum}" data-title="${ch.title}" style="padding-top: 24px; margin-top: 40px; border-top: 2px solid var(--border);">\n`;
        md += `  <span style="display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 4px; background: rgba(246, 173, 85, 0.15); color: #f6ad55; border: 1px solid rgba(246, 173, 85, 0.3);">Chapter ${ch.chNum}</span>\n`;
        md += `  <h2 style="margin-top: 8px; font-size: 1.5rem; color: var(--text-1);">${ch.title}</h2>\n`;
        md += `</div>\n\n`;

        if (ch.content.trim()) {
          md += `${ch.content}\n\n`;
        } else {
          md += `*This chapter is currently empty.*\n\n`;
        }

        // Chapter Bottom Navigation Bar (Prev / Next)
        const prevTarget = idx === 0 ? (rootNote ? { anchor: '#ch-overview', label: 'Book Overview' } : null) : { anchor: `#${cleanChapters[idx - 1].anchorId}`, label: `Ch ${cleanChapters[idx - 1].chNum}: ${cleanChapters[idx - 1].title}` };
        const nextTarget = idx < cleanChapters.length - 1 ? { anchor: `#${cleanChapters[idx + 1].anchorId}`, label: `Ch ${cleanChapters[idx + 1].chNum}: ${cleanChapters[idx + 1].title}` } : null;

        md += `<div class="chapter-pager" style="display: flex; justify-content: space-between; align-items: center; margin: 30px 0 40px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08);">\n`;
        if (prevTarget) {
          md += `  <a href="${prevTarget.anchor}" style="padding: 5px 12px; font-size: 12px; border-radius: 16px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--text-2); text-decoration: none;">&larr; Prev: ${prevTarget.label}</a>\n`;
        } else {
          md += `  <span></span>\n`;
        }

        if (nextTarget) {
          md += `  <a href="${nextTarget.anchor}" style="padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 16px; border: 1px solid var(--accent); background: rgba(99, 179, 237, 0.1); color: var(--accent); text-decoration: none;">Next: ${nextTarget.label} &rarr;</a>\n`;
        } else {
          md += `  <span style="font-size: 12px; color: var(--text-3); font-style: italic;">&check; End of Book</span>\n`;
        }
        md += `</div>\n\n`;
      });

      return md;
    }
  }

  window.BookAssemblerFacade = BookAssemblerFacade;
})();
