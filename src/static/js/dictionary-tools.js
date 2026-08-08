var OFFLINE={'zenml':'An open-source MLOps framework for reproducible ML pipelines.','pipeline':'@pipeline decorator connects steps into a DAG.','embedding':'Dense vector representing text; similar meanings map nearby.','rag':'Retrieval-Augmented Generation: fetch facts before generating answers.','llm':'Large Language Model trained on vast text data (GPT-4, Gemini).','singleton':'Design pattern ensuring a class is instantiated exactly once.','lora':'Low-Rank Adaptation: efficient LLM fine-tuning technique.','fastapi':'Modern Python web framework for building REST APIs.','docker':'Container platform for packaging apps with all their dependencies.','kubernetes':'Container orchestration system for automated deployment.','async':'Allows Python to serve other tasks while waiting for I/O.','await':'Pauses an async function until the awaited task finishes.','pydantic':'Python validation library enforcing type hints at runtime.'};

function formatFullDefinition(data) {
  var entry = data[0];
  var html = '';

  // Word + Phonetics
  html += '<div style="margin-bottom:12px">';
  html += '<span style="font-size:1.3em;font-weight:700;color:var(--accent)">' + entry.word + '</span>';
  if (entry.phonetics && entry.phonetics.length > 0) {
    for (var p = 0; p < entry.phonetics.length; p++) {
      if (entry.phonetics[p].text) {
        html += ' <span style="color:var(--text-2);font-style:italic;font-size:0.95em">' + entry.phonetics[p].text + '</span>';
        break;
      }
    }
    // Find audio
    for (var p = 0; p < entry.phonetics.length; p++) {
      if (entry.phonetics[p].audio) {
        html += ' <button onclick="new Audio(\'' + entry.phonetics[p].audio + '\').play()" style="background:none;border:1px solid var(--border);border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;color:var(--accent);vertical-align:middle" title="Listen">&#128266;</button>';
        break;
      }
    }
  }
  html += '</div>';

  // All meanings
  if (entry.meanings) {
    for (var m = 0; m < entry.meanings.length; m++) {
      var meaning = entry.meanings[m];
      html += '<div style="margin-bottom:10px">';
      html += '<div style="font-weight:600;color:var(--accent);font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">' + meaning.partOfSpeech + '</div>';

      if (meaning.definitions) {
        for (var d = 0; d < meaning.definitions.length && d < 5; d++) {
          var def = meaning.definitions[d];
          html += '<div style="margin-left:12px;margin-bottom:6px">';
          html += '<span style="color:var(--text-2);font-size:0.85em;font-weight:600">' + (d+1) + '.</span> ' + def.definition;
          if (def.example) {
            html += '<div style="margin-left:16px;color:var(--text-2);font-style:italic;font-size:0.9em">"…' + def.example + '…"</div>';
          }
          html += '</div>';
        }
      }

      if (meaning.synonyms && meaning.synonyms.length > 0) {
        html += '<div style="margin-left:12px;margin-top:4px;font-size:0.85em"><span style="color:var(--text-2)">Synonyms:</span> <span style="color:var(--accent)">' + meaning.synonyms.slice(0, 8).join(', ') + '</span></div>';
      }
      if (meaning.antonyms && meaning.antonyms.length > 0) {
        html += '<div style="margin-left:12px;font-size:0.85em"><span style="color:var(--text-2)">Antonyms:</span> <span style="color:#fc8181">' + meaning.antonyms.slice(0, 5).join(', ') + '</span></div>';
      }
      html += '</div>';
    }
  }

  // Source
  if (entry.sourceUrls && entry.sourceUrls.length > 0) {
    html += '<div style="font-size:0.78em;color:var(--text-2);margin-top:8px;border-top:1px solid var(--border);padding-top:6px">Source: <a href="' + entry.sourceUrls[0] + '" target="_blank" style="color:var(--accent)">' + entry.sourceUrls[0] + '</a></div>';
  }

  return html;
}

window.extractSurroundingContext = function(word, selRange) {
  if (!selRange) return { before: "", after: "" };
  var blockNode = selRange.commonAncestorContainer;
  while (blockNode && blockNode.nodeType !== 1) blockNode = blockNode.parentNode;
  if (!blockNode) return { before: "", after: "" };
  
  var blockEl = blockNode.closest ? (blockNode.closest('p, div, li, td, h1, h2, h3, h4, h5, h6') || blockNode) : blockNode;
  var fullText = blockEl.innerText || blockEl.textContent || "";
  
  // Split into pseudo-sentences/lines based on common delimiters
  var segments = fullText.split(/(?<=[.?!;])\s+|\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
  
  var targetIdx = -1;
  for (var i = 0; i < segments.length; i++) {
    if (segments[i].toLowerCase().indexOf(word.toLowerCase()) !== -1) {
      targetIdx = i;
      break;
    }
  }
  
  if (targetIdx === -1) return { before: "", after: "" };
  
  var before = segments.slice(Math.max(0, targetIdx - 2), targetIdx).join(" ");
  var after = segments.slice(targetIdx + 1, targetIdx + 3).join(" ");
  
  return { before: before, after: after };
};

window.fetchDict = async function(word){
  if (!word || typeof word !== 'string') return;
  word = word.trim();
  if (!word) return;
  
  if(window.panel.classList.contains('hidden')) togglePanel(); switchTab('chat');
  addMsg('Define: ' + word, 'u');
  var mode = document.getElementById('dict-sel').value;
  if (mode === 'offline') {
    var def = OFFLINE[word.toLowerCase()];
    addMsg(def ? '**' + word + '**: ' + def : "'" + word + "' not in offline glossary. Switch to Online Dictionary.", 'd');
    return;
  }
  var load = addMsg('Looking up...', 'd');
  try {
    var r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase()));
    if (!r.ok) throw new Error('Not found');
    var d = await r.json();
    load.innerHTML = formatFullDefinition(d);
  } catch(e) {
    load.innerHTML = 'No definition found in dictionary API. Falling back to AI...';
    var ctx = window.extractSurroundingContext(word, window.selRange);
    
    var promptParts = [];
    if (ctx.before) promptParts.push(ctx.before);
    promptParts.push('Define: ' + word);
    promptParts.push('No definition found in dictionary API. Falling back to AI...');
    promptParts.push('Define and explain the word "' + word + '"');
    if (ctx.after) promptParts.push(ctx.after);
    
    var finalPrompt = promptParts.join('\n');
    setTimeout(function(){ askAI(finalPrompt); }, 800);
  }
};

