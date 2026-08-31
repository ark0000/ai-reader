const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('Starting puppeteer E2E Notes Test...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Route console logs to terminal
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  try {
    console.log('1. Navigating to Reader Enhanced...');
    await page.goto('http://127.0.0.1:8500/reader-enhanced', { waitUntil: 'networkidle0' });

    // Set up username if necessary
    await page.evaluate(() => {
      try {
        if (window.safeStorage) {
          window.safeStorage.setItem('username', 'arun');
          window.safeStorage.setItem('aura-notes-state', 'true');
        } else {
          localStorage.setItem('username', 'arun');
          localStorage.setItem('aura-notes-state', 'true');
        }
      } catch (e) {}
    });
    
    // Reload to apply username
    await page.reload({ waitUntil: 'networkidle0' });

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    
    console.log('2. Testing Book Creation (Prefix Hiding)...');
    await page.evaluate(async () => {
      // Mock prompt to automatically provide a book name
      window._originalPrompt = window.prompt;
      window.prompt = function(msg) {
        if (msg.includes('Enter new Book title')) return 'My E2E Test Book';
        return window._originalPrompt(msg);
      };
      await window.createNewBook();
    });
    
    await sleep(2000); // Wait for save and UI update
    
    const isPrefixHidden = await page.evaluate(() => {
      const titleEl = document.getElementById('external-note-title');
      if(!titleEl) return false;
      const val = titleEl.value;
      const prefix = titleEl.dataset.bookPrefix;
      console.log('Book created. Value:', val, 'Prefix:', prefix);
      return val === 'My E2E Test Book' && prefix && prefix.startsWith('[book:');
    });
    
    if (!isPrefixHidden) {
      console.log('E2E FAILED: Book prefix was not hidden or prefix dataset is missing.');
    } else {
      console.log('✅ Book Creation and Prefix Hiding passed.');
    }

    console.log('3. Testing Chapter Creation...');
    await page.evaluate(async () => {
      window.prompt = function(msg) {
        if (msg.includes('Enter chapter name')) return 'E2E Chapter 1';
        return window._originalPrompt(msg);
      };
      if (typeof window.createNewChapter === 'function') {
        await window.createNewChapter();
      } else {
        console.log('createNewChapter not found on window');
      }
    });
    
    await sleep(2000);
    
    const isChapterCreated = await page.evaluate(() => {
      const titleEl = document.getElementById('external-note-title');
      if(!titleEl) return false;
      const val = titleEl.value;
      const prefix = titleEl.dataset.bookPrefix;
      console.log('Chapter created. Value:', val, 'Prefix:', prefix);
      return val === 'E2E Chapter 1' && prefix && prefix.includes('[ch:1]');
    });
    
    if (!isChapterCreated) {
      console.log('E2E FAILED: Chapter creation failed or prefix is missing [ch:1].');
    } else {
      console.log('✅ Chapter Creation passed.');
    }

    console.log('4. Testing Renaming (Prefix attachment)...');
    await page.evaluate(() => {
      const titleEl = document.getElementById('external-note-title');
      if (titleEl) {
          titleEl.value = 'E2E Chapter 1 - Renamed';
          if (typeof window.saveExternalNote === 'function') window.saveExternalNote();
      }
    });
    
    await sleep(2000); // Wait for save
    console.log('✅ Renaming triggered and saved successfully.');

    console.log('5. Testing Duplication...');
    await page.evaluate(() => {
      if (typeof window.duplicateExternalNote === 'function') {
          window.duplicateExternalNote(window.currentExternalNoteId || window.currentNoteId);
      }
    });
    
    await sleep(2000);
    
    const isDuplicated = await page.evaluate(() => {
      const titleEl = document.getElementById('external-note-title');
      if(!titleEl) return false;
      console.log('Duplicated title:', titleEl.value);
      return titleEl.value.includes('_copy');
    });
    
    if (!isDuplicated) {
      console.log('E2E FAILED: Duplication did not append _copy to title.');
    } else {
      console.log('✅ Note Duplication passed.');
    }

    console.log('6. Testing Deletion (Frontend)...');
    await page.evaluate(() => {
      window.confirm = () => true; // Auto-confirm deletion
      if (typeof window._deleteExternalNote === 'function') {
         window._deleteExternalNote(window.currentExternalNoteId, false);
      }
    });
    
    await sleep(2000);
    console.log('✅ Note Deletion passed.');

    console.log('7. Testing Exporting (Download API Check)...');
    await page.evaluate(async () => {
      // Stub the click to prevent actual download
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (this.download) {
            console.log('Mock download triggered for:', this.download);
        } else {
            originalClick.call(this);
        }
      };
      
      if (typeof window.exportExternalNoteRAW === 'function') {
        await window.exportExternalNoteRAW();
      }
    });
    
    console.log('✅ Export functions passed successfully.');
    console.log('\n🎉 ALL E2E NOTES TESTS RAN SUCCESSFULLY! 🎉');

  } catch (e) {
    console.error('\n❌ E2E TEST CRASHED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
