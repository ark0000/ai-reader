
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
    let page = await browser.newPage();
    const logs = [];
    page.on("console", msg => logs.push(msg.text()));
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 2000));
    
    // Unlock dev mode
    await page.evaluate(() => {
        document.body.classList.add("dev-mode-active");
    });
    
    console.log("Clicking Full Deep Search...");
    await page.evaluate(() => {
        console.log("UI LOG: Before clicking Deep Search");
        console.log("UI LOG: perf-virt-cb =", document.getElementById("perf-virt-cb").checked);
        console.log("UI LOG: perf-lazy-cb =", document.getElementById("perf-lazy-cb").checked);
        
        const cb = document.getElementById("perf-deep-search-cb");
        cb.click();
        
        console.log("UI LOG: After clicking Deep Search");
        console.log("UI LOG: perf-virt-cb =", document.getElementById("perf-virt-cb").checked);
        console.log("UI LOG: perf-lazy-cb =", document.getElementById("perf-lazy-cb").checked);
    });
    
    await new Promise(r => setTimeout(r, 1000));
    console.log("Logs:");
    console.log(logs.join("\n"));
    await browser.close();
})();
