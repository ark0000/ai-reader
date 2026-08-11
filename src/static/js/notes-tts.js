/* HIGHLIGHTING */
window.hlColor = '#fde68a';
window.invertColorHex = function(hex) {
  if(hex.indexOf('#')===0) hex = hex.slice(1);
  if(hex.length===3) hex = hex.split('').map(function(c){return c+c}).join('');
  var r = (255 - parseInt(hex.slice(0,2), 16)).toString(16).padStart(2, '0');
  var g = (255 - parseInt(hex.slice(2,4), 16)).toString(16).padStart(2, '0');
  var b = (255 - parseInt(hex.slice(4,6), 16)).toString(16).padStart(2, '0');
  return '#' + r + g + b;
};

window.setHL = function(btn){
  window.hlColor = btn.dataset.c;
  document.querySelectorAll('.hl-dot').forEach(function(b){b.classList.remove('sel')});
  btn.classList.add('sel');
};

window.popHL = function(){
  if(!window.selRange || !window.selText) return;
  var txt = window.selText;
  var noteId = Date.now();
  window.notes.push({q: '', txt: '<blockquote>' + txt + '</blockquote><br>', id: noteId, isHl: true, color: window.hlColor});
  
  var finalColor = window.hlColor;
  
  if (window.currentExt === 'pdf') {
    window.pdfHighlights = window.pdfHighlights || [];
    var rects = window.selRange.getClientRects();
    var wrapper = window.selRange.startContainer.parentElement ? window.selRange.startContainer.parentElement.closest('.pdf-page-wrapper') : null;
    if (wrapper) {
      var wrapRect = wrapper.getBoundingClientRect();
      var normalizedRects = [];
      for (var i = 0; i < rects.length; i++) {
         normalizedRects.push({
            x: (rects[i].left - wrapRect.left) / wrapRect.width,
            y: (rects[i].top - wrapRect.top) / wrapRect.height,
            w: rects[i].width / wrapRect.width,
            h: rects[i].height / wrapRect.height
         });
      }
      var pageNum = parseInt(wrapper.dataset.page, 10);
      window.pdfHighlights.push({ id: noteId, page: pageNum, rects: normalizedRects, color: finalColor });
      if (window.redrawPdfHighlights) window.redrawPdfHighlights();
    }
  } else {
    var treeWalker = document.createTreeWalker(window.selRange.commonAncestorContainer, NodeFilter.SHOW_TEXT, function(node) {
      if (!window.selRange.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }, false);
    
    var nodes = [];
    while(treeWalker.nextNode()) nodes.push(treeWalker.currentNode);
    
    if(nodes.length === 0 && window.selRange.startContainer.nodeType === Node.TEXT_NODE) {
      nodes.push(window.selRange.startContainer);
    }
    
    nodes.forEach(function(node) {
      var range = document.createRange();
      range.selectNodeContents(node);
      if(node === window.selRange.startContainer) range.setStart(node, window.selRange.startOffset);
      if(node === window.selRange.endContainer) range.setEnd(node, window.selRange.endOffset);
      if(range.collapsed) return;
      
      var mark = document.createElement('mark');
      mark.className = 'hl';
      mark.dataset.hlId = noteId;
      mark.style.background = finalColor;
      try {
        var contents = range.extractContents();
        mark.appendChild(contents);
        range.insertNode(mark);
        mark.onclick = function(ev){
          ev.stopPropagation();
          window.showActionPopup(ev, '&#10005; Remove highlight', function(){
            window.deleteNote(noteId);
          });
        };
      } catch(e) {}
    });
  }
  
  window.getSelection().removeAllRanges();
  window.hidePopup();
  window.renderNotes();
};

/* NOTES */
window.popNote = function(){
  window.hidePopup(); 
  window.pendingQuote=window.selText;
  window.openRteModal(null, window.selText);
};
window.currentEditingNoteId = null;

window.openRteModal = function(noteId, newQuote) {
  var modal = document.getElementById('rte-modal');
  var title = document.getElementById('rte-title');
  var quoteEl = document.getElementById('rte-quote');
  var editor = document.getElementById('rte-editor');
  
  // Hide the read-only quote box completely, we will embed it in the editor
  quoteEl.style.display = 'none';

  if (noteId) {
    // Edit existing
    var note = window.notes.find(function(n) { return n.id === noteId; });
    if (!note) return;
    window.currentEditingNoteId = noteId;
    title.textContent = 'Edit Note';
    
    // Combine quote and text into the editor
    var content = '';
    if (note.q) {
      if (!note.q.startsWith('<img') && !note.q.startsWith('<svg')) {
        content += '<blockquote>' + note.q + '</blockquote><br>';
      } else {
        content += note.q + '<br>';
      }
    }
    content += (note.txt === 'Highlighted section' ? '' : (note.txt || ''));
    editor.innerHTML = content;
  } else {
    // Add new
    window.currentEditingNoteId = null;
    title.textContent = 'Add Note';
    if (newQuote) {
      editor.innerHTML = '<blockquote>' + newQuote + '</blockquote><br>';
    } else {
      editor.innerHTML = '';
    }
  }
  window.pendingQuote = ''; // We no longer use pendingQuote since everything is in the editor
  modal.style.display = 'flex';
  setTimeout(function() { editor.focus(); }, 100);
};

window.saveRteNote = function() {
  var txt = document.getElementById('rte-editor').innerHTML.trim();
  if (!txt) {
    document.getElementById('rte-modal').style.display = 'none';
    return;
  }
  
  if (window.currentEditingNoteId) {
    window.notes.forEach(function(n){ 
      if(n.id === window.currentEditingNoteId) { 
        n.txt = txt; 
        n.q = ''; // Clear old separate quote field
        n.isEditing = false; 
      } 
    });
  } else {
    window.notes.push({ q: '', txt: txt, id: Date.now() });
  }
  
  window.renderNotes();
  document.getElementById('rte-modal').style.display = 'none';
  window.pendingQuote = '';
  window.currentEditingNoteId = null;
  if (window.panel.classList.contains('hidden')) window.togglePanel();
  window.switchTab('notes');
};
window.deleteNote = function(id){ 
  window.notes=window.notes.filter(function(n){return n.id!==id}); 
  if (window.pdfHighlights) {
     window.pdfHighlights = window.pdfHighlights.filter(function(h){return h.id!==id});
     if(window.redrawPdfHighlights) window.redrawPdfHighlights();
  }
  document.querySelectorAll('mark[data-hl-id="'+id+'"]').forEach(function(m){
    var p=m.parentNode;while(m.firstChild)p.insertBefore(m.firstChild,m);p.removeChild(m);
  });
  window.renderNotes(); 
};

window.redrawPdfHighlights = function() {
  if (!window.pdfHighlights || window.currentExt !== 'pdf') return;
  document.querySelectorAll('.pdf-page-wrapper').forEach(function(wrap) {
    var pageNum = parseInt(wrap.dataset.page, 10);
    var dl = wrap.querySelector('.draw-layer');
    if (!dl) return;
    var ctx = dl.getContext('2d');
    ctx.clearRect(0, 0, dl.width, dl.height);
    var hls = window.pdfHighlights.filter(function(h) { return h.page === pageNum; });
    hls.forEach(function(hl) {
       ctx.fillStyle = hl.color;
       ctx.globalAlpha = 0.35;
       hl.rects.forEach(function(r) {
          ctx.fillRect(r.x * dl.width, r.y * dl.height, r.w * dl.width, r.h * dl.height);
       });
       ctx.globalAlpha = 1.0;
    });
  });
};

window.addScreenshotNote = function(dataUrl) {
  window.notes.push({q: '<img src="'+dataUrl+'" style="background:#fff; max-width:100%; border:1px solid var(--border); border-radius:4px; margin-top:8px;">', txt: 'Screenshot Note', id: Date.now(), isScreenshot: true});
  window.renderNotes();
  if(window.panel.classList.contains('hidden')) window.togglePanel();
  window.switchTab('notes');
};

window.editNote = function(id) {
  window.openRteModal(id);
};

window.cancelEdit = function(id) {
  window.notes.forEach(function(n){ if(n.id === id) n.isEditing = false; });
  window.renderNotes();
};

window.renderNotes = function(){
  // Save notes to IndexedDB for persistence if enabled
  if (window.safeStorage && window.safeStorage.getItem('aura-notes-state') === 'true' && window.currentFileName) {
    if (window.storageRepository) {
      var uname = window.currentUsername || (window.safeStorage && window.safeStorage.getItem('username')) || 'guest';
      window.storageRepository.saveNotes(uname + '_' + window.currentFileName, window.notes, window.pdfHighlights);
    }
  }

  var notesList = document.getElementById('notes-list');
  notesList.innerHTML = window.notes.length ? '' : '<div class="msg msg-s">No notes yet.</div>';
  var hIdx=1;
  window.notes.forEach(function(n){
    var c=document.createElement('div');c.className='note-card';
    var textContent = n.txt;
    var qStyle = '';
    if(n.isHl) {
      var bg = n.color;
      var fg = '#1a1a2e';
      var bubble = '<span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:'+bg+';color:'+fg+';text-align:center;line-height:22px;font-weight:bold;font-size:12px;margin-right:8px;" title="Highlight ' + hIdx + '">' + (hIdx++) + '</span>';
      textContent = bubble + (n.txt === 'Highlighted section' ? '<span style="opacity:0.6;font-style:italic;">Highlighted section</span>' : n.txt);
      qStyle = 'style="border-left-color:'+bg+'"';
    }
    var qContent = n.q;
    if(n.q && !n.q.startsWith('<img') && !n.q.startsWith('<svg')) {
      qContent = '"'+n.q.substring(0,100)+(n.q.length>100?'...':'')+'"';
    }
    
    var controls = '<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">';
    controls += '<button class="tb-btn" onclick="editNote('+n.id+')" style="padding:4px 8px; font-size:12px;">&#9998; Edit</button>';
    controls += '<button class="tb-btn" onclick="deleteNote('+n.id+')" style="padding:4px 8px; font-size:12px; color:#fc8181;">&#10005; Delete</button>';
    controls += '</div>';

    var txtBlock = '<div class="note-rte-content" style="margin-top:6px; color:var(--text-1); line-height:1.5;">' + textContent + '</div>';

    c.innerHTML=(n.q?'<div class="note-q" '+qStyle+'>'+qContent+'</div>':'') + txtBlock + controls;
    notesList.appendChild(c);
  });
};
window.exportNotes = function(format) {
  if(!window.notes.length) { alert('No notes to export.'); return; }
  var hIdxTxt=1, hIdxPdf=1;
  if(format === 'txt') {
    var txt = window.notes.map(function(n) { 
      var temp = document.createElement('div');
      temp.innerHTML = n.txt;
      var cleanTxt = temp.innerText || temp.textContent || '';
      var noteTxt = n.isHl ? ('Highlight ' + (hIdxTxt++) + '\n' + cleanTxt) : cleanTxt;
      return (n.q ? '"' + n.q + '"\n' : '') + (noteTxt ? 'Note: ' + noteTxt : ''); 
    }).join('\n\n---\n\n');
    var blob = new Blob([txt], {type: 'text/plain'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'EmanationReader_Notes.txt';
    a.click();
  } else if (format === 'pdf') {
    var iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    
    var doc = iframe.contentWindow.document;
    doc.open();
    var preserveColors = window.safeStorage && window.safeStorage.getItem('aura-pdf-colors') === 'true';
    var styleOverride = preserveColors ? '' : '<style>* { color: #000 !important; } pre, code { background-color: #f5f5f5 !important; }</style>';
    doc.write('<html><head><title>Emanation Reader Notes</title>' + styleOverride + '</head><body style="padding:20px;font-family:sans-serif;color:#000;background:#fff;">');
    doc.write('<h2>Emanation Reader Notes</h2><hr>' + window.notes.map(function(n) {
      var noteTxt = n.isHl ? '<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:'+n.color+';color:#000;text-align:center;line-height:20px;font-weight:bold;font-size:12px;">' + (hIdxPdf++) + '</span>' : n.txt;
      var qColor = n.isHl ? n.color : '#ccc';
      return '<div style="margin-bottom:15px">' + (n.q ? '<blockquote style="border-left:3px solid '+qColor+';padding-left:10px;color:#555;font-style:italic">"' + n.q + '"</blockquote>' : '') + '<div style="color:#000;margin-top:8px">' + noteTxt + '</div></div>';
    }).join(''));
    doc.write('</body></html>');
    doc.close();
    
    iframe.contentWindow.focus();
    setTimeout(function() {
      iframe.contentWindow.print();
      setTimeout(function() { document.body.removeChild(iframe); }, 1000);
    }, 250);
  }
};

/* TTS — Chunked sentence-by-sentence engine for natural, reliable long reading */
window._ttsChunks = [];
window._ttsIdx = 0;
window._ttsPaused = false;
window._ttsPlaying = false;
window._ttsPdfPage = 0;

window.updateTTSParams = function() {
  if (window._ttsPlaying && !window._ttsPaused) {
    window._ttsCurrentU = null;
    speechSynthesis.cancel();
    speechSynthesis.resume();
    if (window._ttsSkipTimer) clearTimeout(window._ttsSkipTimer);
    window._ttsSkipTimer = setTimeout(function() { speakChunk(window._ttsIdx); }, 50);
  }
};

window.finishTTS = function() {
  window._ttsPlaying = false;
  var s = document.getElementById('tts-status');
  if (s) { s.textContent = 'Done'; s.className = 'tts-status'; }
  var box = document.getElementById('tts-box');
  if (box) box.textContent = '—';
  var prog = document.getElementById('tts-progress');
  if (prog) prog.textContent = '';
  var btn = document.getElementById('tts-pause-btn');
  if (btn) btn.innerHTML = '&#9208; Pause';
};

window.loadVoices = function(){
  var sel = document.getElementById('voice-sel');
  if (!sel) return;
  var voices = speechSynthesis.getVoices();
  sel.innerHTML = '';
  if (!voices.length) { sel.innerHTML = '<option>Default</option>'; return; }

  // Score voices: prefer natural/neural, English, Google/Microsoft
  var scored = voices.map(function(v, i) {
    var score = 0;
    var name = v.name.toLowerCase();
    var lang = v.lang.toLowerCase();
    if (lang.startsWith('en')) score += 100;
    if (name.includes('natural') || name.includes('neural')) score += 80;
    if (name.includes('google')) score += 40;
    if (name.includes('microsoft')) score += 35;
    if (name.includes('female') || name.includes('zira') || name.includes('samantha')) score += 10;
    if (v.localService) score += 5;
    return { voice: v, index: i, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });

  var bestIdx = scored[0].index;
  scored.forEach(function(s) {
    var o = document.createElement('option');
    o.value = s.index;
    var tag = '';
    if (s.score >= 140) tag = ' ⭐';
    else if (s.score >= 100) tag = ' ✓';
    
    // Clean up extremely long native voice names to prevent dropdown overflow
    var cleanName = s.voice.name.replace(/^Microsoft /i, '')
                                .replace(/Multilingual Online \(Natural\)/gi, '')
                                .replace(/Online \(Natural\)/gi, '')
                                .replace(/\(Natural\)/gi, '')
                                .trim();
                                
    // Truncate to keep the dropdown width reasonable
    if (cleanName.length > 25) {
      cleanName = cleanName.substring(0, 22) + '...';
    }
    
    o.textContent = cleanName + ' (' + s.voice.lang + ')' + tag;
    if (s.index === bestIdx) o.selected = true;
    sel.appendChild(o);
  });
};
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = window.loadVoices;
  setTimeout(window.loadVoices, 500);
}

// Split text into sentence-level chunks (max ~200 chars each)
function splitIntoChunks(text) {
  var raw = text.replace(/\s+/g, ' ').trim();
  var sentences = raw.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [raw];
  var chunks = [];
  var current = '';
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i].trim();
    if (!s) continue;
    if ((current + ' ' + s).length > 200 && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += (current ? ' ' : '') + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [raw];
}

function speakChunk(idx) {
  if (idx >= window._ttsChunks.length) {
      if (window.currentExt === 'pdf' && window._ttsPdfPage > 0 && window.currentPdfDoc) {
         window._ttsPdfPage++;
         if (window._ttsPdfPage <= window.currentPdfDoc.numPages) {
            document.getElementById('tts-status').textContent = 'Loading next page...';
            
            if (window.pageTextCache && window.pageTextCache.has(window._ttsPdfPage)) {
               var txt = window.pageTextCache.get(window._ttsPdfPage);
               if (!txt.trim()) {
                  window._ttsChunks = [' '];
                  speakChunk(1);
               } else {
                  window._ttsChunks = splitIntoChunks(txt);
                  speakChunk(0);
               }
               return;
            }
            
            window.currentPdfDoc.getPage(window._ttsPdfPage).then(function(page) {
               return page.getTextContent();
            }).then(function(content) {
               var txt = content.items.map(function(item){ return item.str; }).join(' ');
               if (window.pageTextCache) window.pageTextCache.set(window._ttsPdfPage, txt);
               
               if (!txt.trim()) {
                  // If page is empty (e.g. just images), skip to next
                  window._ttsChunks = [' '];
                  speakChunk(1);
               } else {
                  window._ttsChunks = splitIntoChunks(txt);
                  speakChunk(0);
               }
            }).catch(function(e) {
               window.finishTTS();
            });
            return;
         }
      }
    
    // For EPUB, automatically going to the next chapter requires UI interaction (rendition.next()), 
    // which is complex to do invisibly here, so we just stop at the end of the chapter for now.
    
    window.finishTTS();
    return;
  }
  window._ttsIdx = idx;
  var chunk = window._ttsChunks[idx];
  var u = new SpeechSynthesisUtterance(chunk);
  var voices = speechSynthesis.getVoices();
  var vi = parseInt(document.getElementById('voice-sel').value);
  if (voices.length && !isNaN(vi)) u.voice = voices[vi];
  u.rate = parseFloat(document.getElementById('speed-r').value);
  u.pitch = parseFloat(document.getElementById('pitch-r').value);

  u.onstart = function() {
    var s = document.getElementById('tts-status');
    if (s) { s.textContent = 'Speaking...'; s.className = 'tts-status speaking'; }
    var box = document.getElementById('tts-box');
    if (box) box.textContent = chunk.substring(0, 300) + (chunk.length > 300 ? '...' : '');
    var prog = document.getElementById('tts-progress');
    if (prog) prog.textContent = 'Chunk ' + (idx + 1) + ' / ' + window._ttsChunks.length;
  };
  u.onend = function() {
    if (window._ttsCurrentU !== u) return;
    if (!window._ttsPaused) speakChunk(idx + 1);
  };
  u.onerror = function(ev) {
    if (ev.error === 'interrupted' || ev.error === 'canceled') return;
    var s = document.getElementById('tts-status');
    if (s) s.textContent = 'Error: ' + ev.error;
  };
  window._ttsCurrentU = u;
  speechSynthesis.speak(u);
}

window.ttsSpeak = function(text) {
  if (typeof speechSynthesis === 'undefined') { alert('TTS not supported.'); return; }
  speechSynthesis.cancel();
  
  if (typeof text !== 'string') text = text ? text.toString() : '';
  if (!text.trim()) return;

  window._ttsChunks = splitIntoChunks(text);
  window._ttsIdx = 0;
  window._ttsPaused = false;
  window._ttsPlaying = true;
  var btn = document.getElementById('tts-pause-btn');
  if (btn) btn.innerHTML = '&#9208; Pause';
  speakChunk(0);
};

window.ttsAll = async function() {
  if (window.panel.classList.contains('hidden')) window.togglePanel();
  window.switchTab('tts');
  
  var textToRead = "";
  if (window.currentExt === 'pdf' && window.currentPdfDoc) {
    document.getElementById('tts-status').textContent = 'Extracting PDF text...';
    try {
      window._ttsPdfPage = 1;
      while (window._ttsPdfPage <= window.currentPdfDoc.numPages) {
        var page = await window.currentPdfDoc.getPage(window._ttsPdfPage);
        var content = await page.getTextContent();
        textToRead = content.items.map(function(item){ return item.str; }).join(' ');
        if (textToRead.trim()) break;
        window._ttsPdfPage++;
      }
    } catch (e) {
      console.error(e);
      alert("Failed to extract text from PDF page.");
      document.getElementById('tts-status').textContent = 'Ready';
      return;
    }
  } else if (window.currentExt === 'epub' && window.currentEpubRendition) {
    try {
      var contents = window.currentEpubRendition.getContents();
      if (contents && contents.length > 0) {
        textToRead = contents[0].document.body.innerText;
      }
    } catch (e) {
      console.error(e);
      alert("Failed to extract text from EPUB.");
      document.getElementById('tts-status').textContent = 'Ready';
      return;
    }
  } else {
    textToRead = window.docText;
  }

  if (!textToRead || !textToRead.trim()) { 
    if (window.currentExt === 'pdf' && window.currentPdfDoc) {
       textToRead = ' '; // Provide dummy text so it doesn't abort and speakChunk handles next page if needed
    } else {
       alert('No text found to read on the current page/document.'); 
       document.getElementById('tts-status').textContent = 'Ready';
       return; 
    }
  }
  window.ttsSpeak(textToRead);
};

window.ttsFromHere = async function() {
  if (window.panel.classList.contains('hidden')) window.togglePanel();
  window.switchTab('tts');
  
  var textToRead = "";
  if (window.currentExt === 'pdf' && window.currentPdfDoc) {
    document.getElementById('tts-status').textContent = 'Extracting PDF text...';
    try {
      var state = window.getPdfScrollState();
      window._ttsPdfPage = state.page || 1;
      
      if (window.pageTextCache && window.pageTextCache.has(window._ttsPdfPage)) {
        textToRead = window.pageTextCache.get(window._ttsPdfPage);
      } else {
        var page = await window.currentPdfDoc.getPage(window._ttsPdfPage);
        var content = await page.getTextContent();
        textToRead = content.items.map(function(item){ return item.str; }).join(' ');
        if (window.pageTextCache) window.pageTextCache.set(window._ttsPdfPage, textToRead);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to extract text from PDF page.");
      document.getElementById('tts-status').textContent = 'Ready';
      return;
    }
  } else if (window.currentExt === 'epub' && window.currentEpubRendition) {
    try {
      var contents = window.currentEpubRendition.getContents();
      if (contents && contents.length > 0) {
        textToRead = contents[0].document.body.innerText;
      }
    } catch (e) {
      console.error(e);
      alert("Failed to extract text from EPUB.");
      document.getElementById('tts-status').textContent = 'Ready';
      return;
    }
  } else {
    textToRead = window.docText;
  }

  if (!textToRead || !textToRead.trim()) { 
    if (window.currentExt === 'pdf' && window.currentPdfDoc) {
       textToRead = ' '; 
    } else {
       alert('No text found to read on the current page/document.'); 
       document.getElementById('tts-status').textContent = 'Ready';
       return; 
    }
  }

  if (window.selText && window.selText.trim() && textToRead) {
     var idx = textToRead.indexOf(window.selText);
     if (idx === -1) {
       var firstFewWords = window.selText.trim().split(/\s+/).slice(0, 5);
       var escapedWords = firstFewWords.map(function(w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
       var regexPattern = escapedWords.join('\\s+');
       try {
         var match = textToRead.match(new RegExp(regexPattern, 'i'));
         if (match) {
           idx = match.index;
         }
       } catch(e) {}
     }
     if (idx !== -1) {
       textToRead = textToRead.substring(idx);
     } else {
       textToRead = window.selText;
     }
  }

  window.ttsSpeak(textToRead);
};

window.ttsPause = function() {
  if (window._ttsPaused) {
    speechSynthesis.resume();
    window._ttsPaused = false;
    var btn = document.getElementById('tts-pause-btn');
    if (btn) btn.innerHTML = '&#9208; Pause';
    var s = document.getElementById('tts-status');
    if (s) { s.textContent = 'Speaking...'; s.className = 'tts-status speaking'; }
  } else {
    speechSynthesis.pause();
    window._ttsPaused = true;
    var btn = document.getElementById('tts-pause-btn');
    if (btn) btn.innerHTML = '&#9654; Resume';
    var s = document.getElementById('tts-status');
    if (s) { s.textContent = 'Paused'; s.className = 'tts-status'; }
  }
};

window.ttsStop = function() {
  speechSynthesis.cancel();
  window._ttsPaused = false;
  window._ttsPlaying = false;
  var btn = document.getElementById('tts-pause-btn');
  if (btn) btn.innerHTML = '&#9208; Pause';
  var s = document.getElementById('tts-status');
  if (s) { s.textContent = 'Stopped'; s.className = 'tts-status'; }
  var prog = document.getElementById('tts-progress');
  if (prog) prog.textContent = '';
};

window.popTTS = function() {
  window.hidePopup();
  if (window.panel.classList.contains('hidden')) window.togglePanel();
  window.switchTab('tts');
  var txt = window.selText;
  if (typeof txt !== 'string') txt = txt ? txt.toString() : '';
  if (txt.trim()) window.ttsSpeak(txt);
};

window.popTTSFromHere = function() {
  window.hidePopup();
  window.ttsFromHere();
};

window.ttsBackward = function() {
  if (window._ttsIdx > 0) {
    speechSynthesis.cancel();
    speakChunk(window._ttsIdx - 1);
  }
};

window.ttsForward = function() {
  if (window._ttsIdx < window._ttsChunks.length - 1) {
    speechSynthesis.cancel();
    speakChunk(window._ttsIdx + 1);
  }
};

window.insertCodeBlock = function() { var sel = window.getSelection(); if (!sel.rangeCount) return; var range = sel.getRangeAt(0); if (sel.isCollapsed) { var code = document.createElement('code'); code.textContent = 'code'; range.insertNode(code); sel.removeAllRanges(); var newRange = document.createRange(); newRange.selectNodeContents(code); sel.addRange(newRange); } else { var code = document.createElement('code'); code.appendChild(range.extractContents()); range.insertNode(code); } };
