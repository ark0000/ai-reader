class SidebarRenderStrategy {
  render(notes, listEl) {
    throw new Error('Not implemented');
  }

  // The existing render logic extracted here for reuse by strategies
  _renderSingleNote(note, listEl, isChild = false) {
    const isSelected = currentExternalNoteId === note.id;
    const div = document.createElement('div');
    div.className = 'sidebar-note-item';
    div.dataset.id = note.id;
    div.dataset.title = (note.title || 'Untitled Note').toLowerCase();
    div.dataset.type = isChild ? 'chapter' : 'standalone';
    div.style.padding = isChild ? '8px 16px 8px 32px' : '12px 16px';
    div.style.borderBottom = '1px solid var(--border)';
    div.style.cursor = 'pointer';
    div.style.background = isSelected ? 'rgba(255,107,0,0.1)' : 'transparent';
    div.style.borderLeft = isSelected ? '3px solid var(--accent)' : '3px solid transparent';
    div.style.transition = 'all 0.2s ease';
    if (isChild) {
      div.style.borderLeft = '3px solid transparent';
      div.style.position = 'relative';
      // Little L-bracket for children
      const bracket = document.createElement('div');
      bracket.style.position = 'absolute';
      bracket.style.left = '14px';
      bracket.style.top = '0';
      bracket.style.bottom = '50%';
      bracket.style.width = '10px';
      bracket.style.borderLeft = '2px solid var(--border)';
      bracket.style.borderBottom = '2px solid var(--border)';
      div.appendChild(bracket);
    }
    
    div.onclick = () => {
      if (typeof loadExternalNote === 'function') loadExternalNote(note.id);
    };
    
    const title = note.title || 'Untitled Note';
    const date = new Date(note.updatedAt).toLocaleString();
    
    let canvasesHtml = '';
    if (window.currentNotesTab === 'text' && note.html) {
        const regex = /class=['"][^'"]*ql-stylus-canvas[^'"]*['"][^>]*data-id=['"]([^'"]+)['"]/g;
        const canvasIds = [];
        let match;
        while ((match = regex.exec(note.html)) !== null) {
            canvasIds.push(match[1]);
        }
        if (canvasIds.length > 0) {
            canvasIds.forEach((cId, idx) => {
                const isLast = idx === canvasIds.length - 1;
                const prefix = isLast ? '└─' : '├─';
                canvasesHtml += `
                  <div style="display:flex; justify-content:space-between; align-items:center; padding: 4px 0 4px 16px; font-size:13px; color:var(--text-2);">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <span style="color:var(--text-3); font-family:monospace;">${prefix}</span> 
                      <span>Canvas ${idx + 1}</span>
                    </div>
                    <div style="display:flex; gap:4px;">
                      <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: var(--accent); background: transparent; border: 1px solid var(--border); border-radius: 4px;" onclick="event.stopPropagation(); if(window.StylusEngine && window.StylusEngine.activeFacade){ window.StylusEngine.activeFacade.repo.clear(); } if(typeof loadExternalNote === 'function') loadExternalNote('${note.id}'); setTimeout(() => { const el = document.querySelector('.ql-stylus-canvas[data-id=\\'${cId}\\']'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'}); }, 500);">Open</button>
                    </div>
                  </div>
                `;
            });
        }
    }

    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = '600';
    titleEl.style.fontSize = '14px';
    titleEl.style.marginBottom = '4px';
    titleEl.style.color = 'var(--text-1)';
    titleEl.style.whiteSpace = 'nowrap';
    titleEl.style.overflow = 'hidden';
    titleEl.style.textOverflow = 'ellipsis';
    titleEl.innerHTML = `<span style="margin-right:4px;">${window.currentNotesTab === 'canvas' ? '🎨' : (isChild ? '📄' : '📚')}</span>${title}`;
    
    // Add L-bracket spacing so text doesn't overlap
    if (isChild) {
      titleEl.style.paddingLeft = '8px';
    }

    const metaEl = document.createElement('div');
    metaEl.style.display = 'flex';
    metaEl.style.justifyContent = 'space-between';
    metaEl.style.alignItems = 'center';
    metaEl.style.marginBottom = canvasesHtml ? '8px' : '0';
    if (isChild) metaEl.style.paddingLeft = '8px';
    
    const isRootOverview = title === 'Book Overview';
    
    metaEl.innerHTML = `
      <div style="font-size:11px; color:var(--text-3);">${date}</div>
      <div style="display:flex; gap:4px;">
        ${!isRootOverview ? `<button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: var(--accent); background: transparent; border: 1px solid var(--border); border-radius: 4px;" onclick="event.stopPropagation(); duplicateExternalNote('${note.id}')">Copy</button>` : ''}
        <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: var(--accent); background: transparent; border: 1px solid var(--border); border-radius: 4px;" onclick="event.stopPropagation(); readNoteInReader('${note.id}')">Read</button>
        ${!isRootOverview ? `<button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: #e53e3e; background: transparent; border: 1px solid var(--border); border-radius: 4px;" onclick="event.stopPropagation(); deleteExternalNote('${note.id}')">Delete</button>` : ''}
      </div>
    `;

    div.appendChild(titleEl);
    div.appendChild(metaEl);
    
    if (canvasesHtml) {
      const canvasesWrapper = document.createElement('div');
      canvasesWrapper.innerHTML = canvasesHtml;
      div.appendChild(canvasesWrapper);
    }
    
    listEl.appendChild(div);
  }
}

/* 
class FlatSidebarRenderer extends SidebarRenderStrategy {
  render(notes, listEl) {
    if (notes.length === 0) {
      const msg = window.currentNotesTab === 'canvas' ? 'No saved canvases.' : 'No saved notes.';
      listEl.innerHTML = `<div style="color:var(--text-3); font-size:12px; padding:10px;">${msg}</div>`;
      return;
    }
    notes.forEach(note => {
      this._renderSingleNote(note, listEl);
    });
  }
}
*/

class BookSidebarRenderer extends SidebarRenderStrategy {
  constructor(adapter) {
    super();
    this._adapter = adapter;
  }
  
  render(notes, listEl) {
    // If it's canvas tab, don't use Book Mode rendering
    if (window.currentNotesTab === 'canvas') {
      if (notes.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-3); font-size:12px; padding:10px;">No saved canvases.</div>`;
        return;
      }
      notes.forEach(note => {
        this._renderSingleNote(note, listEl);
      });
      return;
    }
    
    const tree = this._adapter.build(notes);
    
    if (tree.standaloneNotes.length === 0 && tree.books.size === 0) {
      listEl.innerHTML = `<div style="color:var(--text-3); font-size:12px; padding:10px;">No saved notes.</div>`;
      return;
    }
    
    // Render books FIRST
    for (const [bookId, book] of tree.books.entries()) {
      const bookDiv = document.createElement('div');
      bookDiv.className = 'sidebar-book-item';
      bookDiv.dataset.title = (book.title || '').toLowerCase();
      bookDiv.dataset.type = 'book';
      bookDiv.style.borderBottom = '1px solid var(--border)';
      
      // Book Header
      const headerDiv = document.createElement('div');
      headerDiv.style.padding = '12px 16px';
      headerDiv.style.cursor = 'pointer';
      headerDiv.style.background = 'rgba(0,0,0,0.1)';
      headerDiv.style.display = 'flex';
      headerDiv.style.justifyContent = 'space-between';
      headerDiv.style.alignItems = 'center';
      
      // Expand/Collapse state
      let expanded = true; 
      
      headerDiv.innerHTML = `
        <div style="font-weight:700; font-size:15px; color:var(--text-1); display:flex; align-items:center; gap:8px;">
          <span class="book-toggle-icon" style="display:inline-block; transition:transform 0.2s;">▼</span>
          📖 ${book.title}
        </div>
        <div style="display:flex; gap:4px;">
           <button class="tb-btn" style="padding: 2px 8px; font-size: 11px; font-weight: 600; color: #fff; background: var(--accent); border: 1px solid var(--accent); border-radius: 4px;" onclick="event.stopPropagation(); readFullBookInReader('${bookId}')" title="Read entire book continuously in reader">📖 Read</button>
           <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: #4299e1; background: transparent; border: 1px solid var(--border); border-radius: 4px;" onclick="event.stopPropagation(); downloadBook('${bookId}')">Download</button>
           <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: #e53e3e; background: transparent; border: 1px solid var(--border); border-radius: 4px;" onclick="event.stopPropagation(); deleteExternalNote('${bookId}', true)">Delete</button>
        </div>
      `;
      
      const chaptersContainer = document.createElement('div');
      chaptersContainer.className = 'sidebar-chapters-container';
      chaptersContainer.style.background = 'rgba(0,0,0,0.05)';
      
      headerDiv.onclick = () => {
        expanded = !expanded;
        chaptersContainer.style.display = expanded ? 'block' : 'none';
        headerDiv.querySelector('.book-toggle-icon').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      };
      
      bookDiv.appendChild(headerDiv);
      bookDiv.appendChild(chaptersContainer);
      
      // Render the root note itself so it can be edited/renamed, unless it's an orphan dummy
      if (!book.isOrphan && book.id !== bookId) {
          // Clone it to change its display title slightly
          const rootDisplay = { ...book, title: "Book Overview" };
          this._renderSingleNote(rootDisplay, chaptersContainer, true);
      }
      
      book.chapters.forEach(chapter => {
        this._renderSingleNote(chapter, chaptersContainer, true);
      });
      
      listEl.appendChild(bookDiv);
    }
    
    // Render standalone notes SECOND
    if (tree.standaloneNotes.length > 0) {
      const unassignedHeader = document.createElement('div');
      unassignedHeader.className = 'sidebar-standalone-header';
      unassignedHeader.innerHTML = `<div style="padding:12px 16px; background:rgba(0,0,0,0.2); font-weight:700; font-size:13px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid var(--border);">Uncategorized Notes</div>`;
      listEl.appendChild(unassignedHeader);
      
      tree.standaloneNotes.forEach(note => {
        this._renderSingleNote(note, listEl);
      });
    }
  }
}

/*
class SidebarStrategyFactory {
  static create(bookMode) {
    return bookMode
      ? new BookSidebarRenderer(new window.BookNodeAdapter())
      : new FlatSidebarRenderer();
  }
}

window.SidebarStrategyFactory = SidebarStrategyFactory;
*/
window.BookSidebarRenderer = BookSidebarRenderer;
window.BookNodeAdapter = window.BookNodeAdapter;
