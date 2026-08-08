
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch({ headless: false, args: ["--start-maximized"] });
    const page = await browser.newPage();
    await page.setViewport({width: 1400, height: 900});
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Clicking fullscreen button...");
    await page.evaluate(() => {
        window.toggleFullScreen();
    });
    
    await new Promise(r => setTimeout(r, 2000));
    
    const hasClass = await page.evaluate(() => {
        return document.body.classList.contains("presentation-mode");
    });
    
    console.log("Body has presentation-mode class: " + hasClass);
    
    await browser.close();
})();
