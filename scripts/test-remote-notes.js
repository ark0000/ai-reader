const puppeteer = require('puppeteer');

(async () => {
    let browser;
    try {
        console.log("Launching browser...");
        browser = await puppeteer.launch({ headless: 'new' });
        
        // 1. Desktop Tab
        console.log("Opening desktop tab...");
        const desktopPage = await browser.newPage();
        desktopPage.on('console', msg => console.log('DESKTOP CONSOLE:', msg.text()));
        
        await desktopPage.goto('http://localhost:8500/reader-enhanced', { waitUntil: 'domcontentloaded' });
        
        // 2. Open Remote Notes UI
        console.log("Opening Remote Notes UI...");
        await desktopPage.evaluate(() => {
            connectRemoteNotes();
        });
        
        // 3. Extract Remote Notes URL
        console.log("Extracting Remote Notes URL...");
        await desktopPage.waitForSelector('#remote-notes-qr-modal a', { timeout: 5000 });
        const tabletUrl = await desktopPage.$eval('#remote-notes-qr-modal a', el => el.href);
        console.log(`Extracted URL: ${tabletUrl}`);
        
        // 4. Open Remote Notes URL in new tab
        console.log("Opening tablet tab...");
        const tabletPage = await browser.newPage();
        tabletPage.on('console', msg => console.log('TABLET CONSOLE:', msg.text()));
        await tabletPage.goto(tabletUrl, { waitUntil: 'networkidle2' });
        
        // 5. Wait for status Connected
        console.log("Waiting for tablet to connect...");
        await tabletPage.waitForFunction(() => {
            const el = document.getElementById('connection-status');
            return el && (el.innerText.includes('Connected') || el.classList.contains('status-connected'));
        }, { timeout: 5000 });
        console.log("Tablet connected!");
        
        // 6. Click + New Note on tablet
        console.log("Clicking + New Note on tablet...");
        await tabletPage.evaluate(() => {
            window.RemoteNotesApp.createNote('text');
        });
        
        // 7. Verify new note created (wait for title to update)
        console.log("Waiting for new note to be activated on tablet...");
        // 7. Verify new note created (wait for title to update)
        console.log("Waiting for new note to be activated on tablet...");
        await tabletPage.waitForFunction(() => {
            const el = document.getElementById('active-note-title');
            return el && (el.value || el.innerText).includes('Untitled Note');
        }, { timeout: 5000 });
        
        // 8. Rename the note on tablet
        console.log("Renaming the note on the tablet...");
        await tabletPage.evaluate(() => {
            const titleInput = document.getElementById('active-note-title');
            titleInput.value = 'My Awesome Synced Note';
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Wait a bit for rename sync
        await new Promise(r => setTimeout(r, 1000));

        // 9. Type 'Hello from the tablet!'
        console.log("Typing 'Hello from the tablet!'...");
        await tabletPage.evaluate(() => {
            const quillContainer = document.querySelector('#quill-editor');
            if (quillContainer && quillContainer.__quill) {
                // Clear and insert
                quillContainer.__quill.setContents([]);
                quillContainer.__quill.insertText(0, 'Hello from the tablet!', 'user');
            }
        });
        
        // Wait a bit for sync
        await new Promise(r => setTimeout(r, 2000));
        
        // 10. Switch to desktop tab & verify sync
        console.log("Checking desktop for synced text and title...");
        // Close modal on desktop first just in case it blocks
        await desktopPage.evaluate(() => {
            const modal = document.getElementById('remote-notes-qr-modal');
            if (modal) modal.remove();
        });
        
        const desktopData = await desktopPage.evaluate(() => {
            const editor = document.querySelector('.ql-editor');
            const titleInput = document.getElementById('external-note-title');
            return {
                text: editor ? editor.innerText.trim() : '',
                title: titleInput ? titleInput.value : ''
            };
        });
        
        console.log(`Desktop text: "${desktopData.text}"`);
        console.log(`Desktop title: "${desktopData.title}"`);
        if (desktopData.text.includes('Hello from the tablet!') && desktopData.title === 'My Awesome Synced Note') {
            console.log("✅ Text and Title Sync successful!");
        } else {
            console.log("❌ Sync failed. Desktop did not receive the text or title update.");
        }
        
        // 11. Test Canvas Sync
        console.log("Testing Canvas Sync...");
        console.log("Clicking Draw button on tablet...");
        await tabletPage.click('#btn-draw');
        
        await tabletPage.waitForSelector('.stylus-embed-canvas', { timeout: 5000 });
        
        console.log("Drawing on the tablet canvas...");
        await tabletPage.evaluate(async () => {
            const canvas = document.querySelector('.stylus-embed-canvas');
            const rect = canvas.getBoundingClientRect();
            
            // Dispatch pointerdown
            const downEvent = new PointerEvent('pointerdown', {
                bubbles: true,
                clientX: rect.left + 50,
                clientY: rect.top + 50,
                pointerId: 1
            });
            canvas.dispatchEvent(downEvent);
            
            // Dispatch pointermove
            const moveEvent = new PointerEvent('pointermove', {
                bubbles: true,
                clientX: rect.left + 150,
                clientY: rect.top + 150,
                pointerId: 1
            });
            canvas.dispatchEvent(moveEvent);
            
            // Dispatch pointerup
            const upEvent = new PointerEvent('pointerup', {
                bubbles: true,
                clientX: rect.left + 150,
                clientY: rect.top + 150,
                pointerId: 1
            });
            canvas.dispatchEvent(upEvent);
        });
        
        // Wait for batch flush and network transit (batch is 50ms, let's wait 1s)
        await new Promise(r => setTimeout(r, 1000));
        
        console.log("Checking desktop for synced canvas strokes...");
        const canvasSynced = await desktopPage.evaluate(() => {
            // Check if StylusStore has any keys with data
            if (!window.StylusStore) return false;
            
            for (let [key, strokes] of window.StylusStore.entries()) {
                if (strokes && strokes.length > 0) {
                    return true;
                }
            }
            return false;
        });
        
        if (canvasSynced) {
            console.log("✅ Canvas Drawing Sync successful!");
        } else {
            console.log("❌ Canvas Drawing Sync failed. Desktop did not receive strokes.");
        }
        
    } catch (e) {
        console.error("Test failed with error:", e);
    } finally {
        if (browser) await browser.close();
    }
})();
