
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    const errors = [];
    
    page.on("console", msg => {
        if (msg.type() === "error" || msg.type() === "warning") {
            errors.push(msg.text());
        }
    });
    
    page.on("pageerror", err => {
        errors.push(err.toString());
    });
    
    await page.goto("http://localhost:8080/reader-enhanced");
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Locating fullscreen button...");
    const btn = await page.$("button[title=\"Toggle Fullscreen\"]");
    if (btn) {
        console.log("Clicking button as user gesture...");
        await btn.click();
        await new Promise(r => setTimeout(r, 1000));
    } else {
        console.log("Button not found!");
    }
    
    console.log("Collected errors:");
    console.log(errors);
    await browser.close();
})();
