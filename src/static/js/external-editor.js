window.quillEditor = null;
let currentExternalNoteId = null; // Used for global notes
let currentSessionNoteId = null;  // Used for highlight notes
let saveTimeout = null;

// Wait for Quill to be ready
function initQuillEditor() {
  if (window.quillEditor) return; // already initialized
  
  if (typeof Quill === 'undefined') {
    console.error("Quill is not loaded.");
    alert("The Rich Text Editor failed to load because the Quill library is missing. Please check your internet connection.");
    return;
  }

  try {
    const toolbarOptions = [
      [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      ['blockquote', 'code-block'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'script': 'sub'}, { 'script': 'super' }],
      [{ 'align': [] }],
      ['link', 'image', 'video', 'formula'],
      ['clean'] 
    ];

    window.quillEditor = new Quill('#quill-editor', {
      theme: 'snow',
      modules: {
        toolbar: toolbarOptions
      },
      placeholder: 'Start writing your note here...'
    });

    // Auto-save logic
    window.quillEditor.on('text-change', function() {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveExternalNote, 5000); // Auto-save every 5 seconds
    });
  } catch (err) {
    console.error("Failed to initialize Quill editor:", err);
    alert("An error occurred while loading the editor: " + err.message);
  }
}

function openExternalNotes() {
  const overlay = document.getElementById('external-notes-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    if (!window.quillEditor) {
      // Need a small timeout to ensure the container is fully rendered before Quill mounts
      setTimeout(initQuillEditor, 100);
    }
    loadExternalNotesList();
  }
}

function closeExternalNotes() {
  const overlay = document.getElementById('external-notes-overlay');
  if (overlay) overlay.style.display = 'none';
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveExternalNote(true); // silent save on close
  }
}

function createNewExternalNote() {
  currentExternalNoteId = null;
  currentSessionNoteId = null;
  document.getElementById('external-note-title').value = '';
  if (window.quillEditor) window.quillEditor.root.innerHTML = '';
  loadExternalNotesList();
}

async function loadExternalNotesList() {
  if (!window.notesRepo) return;
  try {
    const notes = await window.notesRepo.getAllNotes();
    const listEl = document.getElementById('external-notes-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    if (notes.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-3); font-size:12px; padding:10px;">No saved notes.</div>';
      return;
    }
    
    notes.forEach(note => {
      const isSelected = currentExternalNoteId === note.id;
      const div = document.createElement('div');
      div.style.padding = '12px 16px';
      div.style.borderBottom = '1px solid var(--border)';
      div.style.cursor = 'pointer';
      div.style.background = isSelected ? 'rgba(255,107,0,0.1)' : 'transparent';
      div.style.borderLeft = isSelected ? '3px solid var(--accent)' : '3px solid transparent';
      div.style.transition = 'all 0.2s ease';
      
      div.onclick = () => loadExternalNote(note.id);
      
      const title = note.title || 'Untitled Note';
      const date = new Date(note.updatedAt).toLocaleString();
      
      div.innerHTML = `
        <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:11px; color:var(--text-3);">${date}</div>
          <div style="display:flex; gap:4px;">
            <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: var(--accent); background: transparent; border: 1px solid transparent; border-radius: 4px;" onclick="event.stopPropagation(); readNoteInReader('${note.id}')">Read</button>
            <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: #e53e3e; background: transparent; border: 1px solid transparent; border-radius: 4px;" onclick="event.stopPropagation(); deleteExternalNote('${note.id}')">Delete</button>
          </div>
        </div>
      `;
      listEl.appendChild(div);
    });
  } catch (e) {
    console.error("Failed to load notes list:", e);
  }
}

async function loadExternalNote(id) {
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  if (!window.notesRepo) return;
  try {
    const note = await window.notesRepo.getNote(parsedId);
    if (note) {
      currentExternalNoteId = note.id;
      currentSessionNoteId = null; // Clear session note context
      document.getElementById('external-note-title').value = note.title || '';
      if (window.quillEditor) {
        window.quillEditor.root.innerHTML = note.content || '';
      }
      loadExternalNotesList(); // Refresh list to update selection highlight
    }
  } catch(e) {
    console.error("Failed to load note:", e);
  }
}

async function saveExternalNote(silent = false) {
  if (!window.quillEditor) return;
  
  const title = document.getElementById('external-note-title').value.trim();
  const content = window.quillEditor.root.innerHTML;
  const rawText = window.quillEditor.getText().trim();
  
  if (!content || content === '<p><br></p>') {
    if (!silent) alert("Cannot save an empty note.");
    return;
  }
  
  // FACADE: Determine where to save based on context
  if (currentSessionNoteId) {
    // Save to the current PDF session highlight notes
    if (window.notes) {
      const idx = window.notes.findIndex(n => n.id === currentSessionNoteId);
      if (idx !== -1) {
        window.notes[idx].txt = content;
        if (typeof renderNotes === 'function') renderNotes();
      }
    }
    
    if (!silent) {
      const btn = document.getElementById('save-external-btn');
      const oldText = btn.textContent;
      btn.textContent = 'Saved to Session';
      btn.style.background = '#48bb78';
      setTimeout(() => {
        btn.textContent = oldText;
        btn.style.background = 'var(--accent)';
      }, 2000);
    }
    return;
  }

  // Fallback to Global Notes repository
  if (!window.notesRepo) return;

  const noteToSave = {
    id: currentExternalNoteId || Date.now(), // Create new ID if it's a new global note
    title: title || 'Untitled Note',
    content: content,
    rawText: rawText
  };
  
  try {
    const saved = await window.notesRepo.saveNote(noteToSave);
    currentExternalNoteId = saved.id;
    if (!silent) {
      const btn = document.getElementById('save-external-btn');
      const oldText = btn.textContent;
      btn.textContent = 'Saved';
      btn.style.background = '#48bb78';
      setTimeout(() => {
        btn.textContent = oldText;
        btn.style.background = 'var(--accent)';
      }, 2000);
      loadExternalNotesList();
    }
  } catch(e) {
    console.error("Failed to save note:", e);
    if (!silent) alert("Failed to save note. Check console for details.");
  }
}

async function deleteExternalNote(id) {
    const parsedId = isNaN(Number(id)) ? id : Number(id);
    // Removed confirm() because Chrome's "Prevent this page from creating additional dialogs" permanently breaks it
    try {
      await window.notesRepo.deleteNote(parsedId);
      if (currentExternalNoteId === parsedId) {
        createNewExternalNote(); // Clear editor if we deleted the currently open note
      } else {
        loadExternalNotesList();
      }
    } catch(e) {
      console.error("Failed to delete note:", e);
      alert("Error: " + e.message);
    }
  }

function exportExternalNoteTXT() {
  if (!window.quillEditor) return;
  const rawText = window.quillEditor.getText().trim();
  if (!rawText) { alert("Note is empty."); return; }
  
  const title = document.getElementById('external-note-title').value.trim() || 'Untitled Note';
  const blob = new Blob([rawText], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = title + '.txt';
  a.click();
}

function exportExternalNotePDF() {
  if (!window.quillEditor) return;
  const content = window.quillEditor.root.innerHTML;
  if (!content || content === '<p><br></p>') { alert("Note is empty."); return; }
  
  const title = document.getElementById('external-note-title').value.trim() || 'Untitled Note';
  
  var iframe = document.createElement('iframe');
  iframe.style.position = 'absolute';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);
  
  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write('<html><head><title>'+title+'</title><style>body{font-family:sans-serif;padding:20px;line-height:1.6;} img{max-width:100%;height:auto;}</style></head><body>');
  doc.write('<h2>' + title + '</h2><hr>');
  doc.write(content);
  doc.write('</body></html>');
  doc.close();
  
  iframe.contentWindow.focus();
  setTimeout(function() {
    iframe.contentWindow.print();
    setTimeout(function() { document.body.removeChild(iframe); }, 1000);
  }, 250);
}

// Function to open the Full Editor specifically for a session note (PDF highlight note)
window.editSessionNoteInFullEditor = function(id) {
  if (!window.notes) return;
  const note = window.notes.find(n => String(n.id) === String(id));
  if (!note) return;
  
  currentSessionNoteId = note.id;
  currentExternalNoteId = null; // Clear global context
  
  openExternalNotes();
  
  // Set the title visually (session notes don't formally use titles, but this looks better)
  document.getElementById('external-note-title').value = 'Highlight Note ' + (note.isHl ? '(Annotated)' : '');
  
  setTimeout(() => {
    if (window.quillEditor) {
      window.quillEditor.root.innerHTML = note.txt || '';
    }
    loadExternalNotesList();
  }, 100);
};

// Open the note in the main Enhanced Reader viewer
async function readNoteInReader(id) {
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  if (!window.notesRepo) return;
  
  try {
    const note = await window.notesRepo.getNote(parsedId);
    if (note && window.openFile) {
      const blob = new Blob([note.content], { type: 'text/markdown' });
      const file = new File([blob], (note.title || 'Untitled Note') + '.md', { type: 'text/markdown' });
      
      closeExternalNotes(); // Close the modal
      window.openFile(file); // Open in Enhanced Reader
      
      // Auto-slide away the AI sidebar so the user can see the note
      const panel = document.getElementById('ai-panel');
      if (panel && !panel.classList.contains('hidden') && window.togglePanel) {
        window.togglePanel();
      }
    }
  } catch(e) {
    console.error("Failed to read note:", e);
  }
}
