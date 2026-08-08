
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
    let page = await browser.newPage();
    const logs = [];
    page.on("console", msg => logs.push("[CONSOLE] " + msg.text()));
    page.on("pageerror", err => logs.push("[PAGE_ERROR] " + err.message));
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 2500));
    
    // T1: Verify cascading on Deep Search ON
    const t1 = await page.evaluate(() => {
        document.body.classList.add("dev-mode-active");
        const deepCb = document.getElementById("perf-deep-search-cb");
        const virtCb = document.getElementById("perf-virt-cb");
        const lazyCb = document.getElementById("perf-lazy-cb");
        
        const before = { virt: virtCb.checked, lazy: lazyCb.checked };
        deepCb.click(); // Turn deep search ON
        const afterOn = { virt: virtCb.checked, lazy: lazyCb.checked, deep: deepCb.checked };
        
        return { before, afterOn };
    });
    console.log("T1 - Cascade ON:", JSON.stringify(t1));
    
    // T2: Verify state restoration on Deep Search OFF
    const t2 = await page.evaluate(() => {
        const deepCb = document.getElementById("perf-deep-search-cb");
        const virtCb = document.getElementById("perf-virt-cb");
        const lazyCb = document.getElementById("perf-lazy-cb");
        
        deepCb.click(); // Turn deep search OFF
        return { virt: virtCb.checked, lazy: lazyCb.checked, deep: deepCb.checked };
    });
    console.log("T2 - Restore OFF:", JSON.stringify(t2));
    
    // T3: Verify batched rendering exists
    const t3 = await page.evaluate(() => {
        return {
            forceRenderExists: typeof window.forceRenderAllPages === "function",
            pdfDeepSearchToggleExists: typeof window.pdfToggleDeepSearch === "function"
        };
    });
    console.log("T3 - Engine functions:", JSON.stringify(t3));
    
    // T4: Verify init persistence
    await page.evaluate(() => {
        window.safeStorage.setItem("aura-pdf-deep-search", "true");
    });
    await page.reload();
    await new Promise(r => setTimeout(r, 2500));
    const t4 = await page.evaluate(() => {
        const deepCb = document.getElementById("perf-deep-search-cb");
        const virtCb = document.getElementById("perf-virt-cb");
        const lazyCb = document.getElementById("perf-lazy-cb");
        return { deep: deepCb?.checked, virt: virtCb?.checked, lazy: lazyCb?.checked };
    });
    console.log("T4 - After reload with deep=true:", JSON.stringify(t4));
    
    // T5: Check for JS errors
    const errors = logs.filter(l => l.startsWith("[PAGE_ERROR]"));
    console.log("T5 - JS Errors:", errors.length > 0 ? errors.join("; ") : "NONE");
    
    // Clean up
    await page.evaluate(() => {
        window.safeStorage.removeItem("aura-pdf-deep-search");
    });
    
    await browser.close();
})();
