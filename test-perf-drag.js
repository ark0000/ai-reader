
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
    let page = await browser.newPage();
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Toggling perf dashboard...");
    await page.evaluate(() => {
        if (window.AuraPerf && window.AuraPerf.toggleUI) {
            window.AuraPerf.toggleUI(true);
        }
    });
    await new Promise(r => setTimeout(r, 1000));
    
    const uiData = await page.evaluate(() => {
        const pd = document.getElementById("universal-perf-dashboard");
        const slider = document.getElementById("perf-telemetry-slider");
        const hasBody = pd && pd.querySelector(".perf-body");
        
        return {
            hasDashboard: !!pd,
            hasSlider: !!slider,
            hasBody: !!hasBody
        };
    });
    
    console.log("Validation:", uiData);
    await browser.close();
})();
