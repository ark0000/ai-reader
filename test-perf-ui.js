
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 1000));
    
    console.log("Toggling perf dashboard...");
    await page.evaluate(() => {
        if (window.AuraPerf && window.AuraPerf.toggleUI) {
            window.AuraPerf.toggleUI(true);
        }
    });
    
    await new Promise(r => setTimeout(r, 500));
    
    const uiData = await page.evaluate(() => {
        const pd = document.getElementById("universal-perf-dashboard");
        if (!pd) return null;
        
        return {
            hasCanvasTracker: !!document.getElementById("activeCanvases"),
            hasRamTracker: !!document.getElementById("estimatedRamMB"),
            hasRenderTracker: !!document.getElementById("lastRenderTimeMs"),
            hasAITracker: !!document.getElementById("aiLatencyMs")
        };
    });
    
    console.log(uiData);
    await browser.close();
})();
