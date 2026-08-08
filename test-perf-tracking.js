
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Toggling perf dashboard...");
    await page.evaluate(() => {
        if (window.AuraPerf && window.AuraPerf.toggleUI) {
            window.AuraPerf.toggleUI(true);
        }
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    console.log("Simulating render and API call...");
    await page.evaluate(async () => {
        // Force a render log
        if (window.AuraPerf && window.AuraPerf.logRender) {
            window.AuraPerf.logRender(45.2);
        }
        
        // Force an API call
        try {
            await fetch("/api/ai/chat", { method: "POST", body: "{}" });
        } catch(e) {}
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    const uiData = await page.evaluate(() => {
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.textContent : "MISSING";
        };
        
        return {
            fps: getVal("fps"),
            activeCanvases: getVal("activeCanvases"),
            estimatedRamMB: getVal("estimatedRamMB"),
            lastRenderTimeMs: getVal("lastRenderTimeMs"),
            aiLatencyMs: getVal("aiLatencyMs"),
            apiCount: getVal("apiCount")
        };
    });
    
    console.log("Dashboard Values:");
    console.log(uiData);
    
    await browser.close();
})();
