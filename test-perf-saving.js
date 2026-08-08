const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("http://localhost:8080/reader-enhanced");

    console.log("Evaluating safeStorage behavior...");

    const testResults = await page.evaluate(() => {
        const results = [];
        const assert = (condition, msg) => {
            results.push(condition ? `✅ PASS: ${msg}` : `❌ FAIL: ${msg}`);
        };

        // 1. Initial State: saving is OFF by default.
        window.safeStorage.setItem('aura-pdf-virt', 'true');
        assert(window.safeStorage.getItem('aura-pdf-virt') === 'true', "Memory Saver reads from session memory");
        assert(localStorage.getItem('aura-pdf-virt') === null, "Memory Saver does NOT write to localStorage by default");

        // 2. Critical keys still save
        window.safeStorage.setItem('auraVersion', '16');
        assert(localStorage.getItem('auraVersion') === '16', "auraVersion writes to localStorage (critical key)");

        // 3. Toggle saving ON
        window.toggleStateKey('aura-pdf-virt', true);
        assert(localStorage.getItem('aura-pdf-virt') === 'true', "Memory Saver flushes to localStorage when toggled ON");

        // 4. Toggle saving OFF
        window.toggleStateKey('aura-pdf-virt', false);
        assert(localStorage.getItem('aura-pdf-virt') === null, "Memory Saver removes from localStorage when toggled OFF");
        assert(window.safeStorage.getItem('aura-pdf-virt') === 'true', "Memory Saver STILL readable from session memory");

        return results;
    });

    console.log(testResults.join('\n'));
    await browser.close();
})();
