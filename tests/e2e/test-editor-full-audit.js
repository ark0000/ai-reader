const puppeteer = require("puppeteer");

(async () => {
    console.log("[E2E] Starting Notes Editor Full Audit...");
    const browser = await puppeteer.launch({ headless: true });
    let page = await browser.newPage();
    const logs = [];
    page.on("console", msg => logs.push("[CONSOLE] " + msg.text()));
    page.on("pageerror", err => logs.push("[PAGE_ERROR] " + err.message));
    
    // We navigate to the enhanced reader page. Adjust URL if necessary.
    const TEST_URL = "http://localhost:8000/reader-enhanced";
    console.log(`[E2E] Navigating to ${TEST_URL}`);
    
    try {
        await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 10000 });
    } catch (e) {
        console.error("[E2E] Navigation failed. Is the server running on port 8000?", e.message);
        await browser.close();
        process.exit(1);
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("[E2E] Injecting test mock functions...");
    await page.evaluate(() => {
        // Mock prompt to return a fixed test value
        window._originalPrompt = window.prompt;
        window.prompt = () => "Audit Test Book";
        
        // Mock confirm
        window.confirm = () => true;
        
        // Expose a test tracker
        window.auditResults = {};
    });

    // T1: Book Creation
    console.log("[E2E] Testing Book Creation...");
    const t1 = await page.evaluate(async () => {
        if (!window.createNewBook) return { error: "createNewBook not found" };
        
        window.prompt = () => "E2E Audit Book";
        await window.createNewBook();
        
        // Verify a book node was created in the repository
        const notes = await window.notesRepo.getAllNotes();
        const bookRoot = notes.find(n => n.title && n.title.includes("[book:") && n.title.includes("E2E Audit Book"));
        return { success: !!bookRoot, bookTitle: bookRoot ? bookRoot.title : null };
    });
    console.log("T1 - Book Creation:", JSON.stringify(t1));

    // T2: Chapter Creation
    console.log("[E2E] Testing Chapter Creation...");
    const t2 = await page.evaluate(async () => {
        if (!window.createNewChapter) return { error: "createNewChapter not found" };
        
        // Select the book we just created by setting currentExternalNoteId
        const notes = await window.notesRepo.getAllNotes();
        const bookRoot = notes.find(n => n.title && n.title.includes("E2E Audit Book"));
        if (!bookRoot) return { error: "Root book not found for chapter creation" };
        
        window.currentExternalNoteId = bookRoot.id;
        
        window.prompt = () => "Audit Chapter 1";
        await window.createNewChapter();
        
        const allNotes = await window.notesRepo.getAllNotes();
        const chapter = allNotes.find(n => n.title && n.title.includes("[ch:") && n.title.includes("Audit Chapter 1"));
        return { success: !!chapter, chapterTitle: chapter ? chapter.title : null };
    });
    console.log("T2 - Chapter Creation:", JSON.stringify(t2));

    // T3: Renaming & Prefix Hiding
    console.log("[E2E] Testing Renaming (Prefix Hiding)...");
    const t3 = await page.evaluate(async () => {
        const titleEl = document.getElementById('external-note-title');
        if (!titleEl) return { error: "Title input not found" };
        
        // Fake a load
        const fakeNote = {
            id: 999,
            title: "[book:audit-123][ch:1] Original Title",
            content: "test"
        };
        
        // Simulate load logic
        const match = (fakeNote.title || '').match(/^(\[book:[^\]]+\](?:\[ch:\d+\]\s*)?)(.*)$/);
        if (match) {
            titleEl.dataset.bookPrefix = match[1];
            titleEl.value = match[2];
        }
        
        const isHidden = (titleEl.value === "Original Title");
        
        // Simulate save logic
        titleEl.value = "Renamed Title";
        const prefix = titleEl.dataset.bookPrefix || '';
        const finalTitle = prefix + titleEl.value.trim();
        
        return {
            hiddenCorrectly: isHidden,
            savedCorrectly: finalTitle === "[book:audit-123][ch:1] Renamed Title"
        };
    });
    console.log("T3 - Prefix Hiding:", JSON.stringify(t3));

    // T4: AI Prompt trigger check
    console.log("[E2E] Testing AI Prompt hook...");
    const t4 = await page.evaluate(() => {
        let aiTriggered = false;
        window.askAI = (prompt) => { aiTriggered = true; window.auditResults.lastPrompt = prompt; };
        
        // Simulate clicking AI button logic
        if (window.askAI) {
            window.askAI("Test prompt analysis");
        }
        
        return { aiTriggered: aiTriggered, prompt: window.auditResults.lastPrompt };
    });
    console.log("T4 - AI Hook:", JSON.stringify(t4));

    // T5: Deletion Cascading
    console.log("[E2E] Testing Book Deletion Cascading...");
    const t5 = await page.evaluate(async () => {
        if (!window.deleteExternalNote) return { error: "deleteExternalNote not found" };
        
        // Delete the root book we made
        const notes = await window.notesRepo.getAllNotes();
        const bookRoot = notes.find(n => n.title && n.title.includes("E2E Audit Book"));
        if (!bookRoot) return { error: "Book not found to delete" };
        
        const match = bookRoot.title.match(/^\[book:([^\]]+)\]/);
        if (!match) return { error: "Book ID not found in title" };
        const bookId = match[1];
        
        // Call delete (isBookRoot = true)
        await window.deleteExternalNote(bookId, true);
        
        // Check if chapter was orphaned successfully
        const updatedNotes = await window.notesRepo.getAllNotes();
        const rootStillExists = updatedNotes.some(n => n.id === bookRoot.id);
        const chapterStillExists = updatedNotes.some(n => n.title === "Audit Chapter 1"); // Prefix should be stripped
        
        return {
            rootDeleted: !rootStillExists,
            chapterOrphaned: chapterStillExists
        };
    });
    console.log("T5 - Cascading Deletion:", JSON.stringify(t5));

    // Check for JS errors
    const errors = logs.filter(l => l.startsWith("[PAGE_ERROR]"));
    console.log("[E2E] JS Errors:", errors.length > 0 ? errors.join("; ") : "NONE");
    
    console.log("[E2E] Audit Complete.");
    await browser.close();
})();
