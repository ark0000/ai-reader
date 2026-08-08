
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 1000));
    
    console.log("Adding presentation-mode class to body...");
    await page.evaluate(() => {
        document.body.classList.add("presentation-mode");
    });
    
    await new Promise(r => setTimeout(r, 500));
    
    const isTopBarHidden = await page.evaluate(() => {
        const tb = document.querySelector(".top-bar");
        return window.getComputedStyle(tb).display === "none";
    });
    
    console.log("Is top-bar hidden? " + isTopBarHidden);
    
    await browser.close();
})();
