
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
    let page = await browser.newPage();
    const logs = [];
    page.on("console", msg => logs.push("[CONSOLE] " + msg.text()));
    
    await page.goto("http://localhost:8080/reader-enhanced?file=aiefs-vol1-foundations.pdf");
    await new Promise(r => setTimeout(r, 2000));
    
    // T1: Check Settings
    const aiText = await page.evaluate(() => {
        if(window.toggleSettings) window.toggleSettings();
        const display = document.getElementById("active-connection-display");
        return display ? display.textContent : null;
    });
    console.log("AI Display:", aiText);
    
    // T2: Check TOC
    const tocResult = await page.evaluate(async () => {
        if (window.toggleToc) window.toggleToc();
        await new Promise(r => setTimeout(r, 1000)); // wait for getOutline
        const list = document.getElementById("toc-list");
        return list ? list.innerHTML.substring(0, 200) : null;
    });
    console.log("TOC List HTML:", tocResult);
    
    await browser.close();
})();
