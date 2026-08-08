
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch();
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
    
    console.log("Errors/Warnings:");
    console.log(errors);
    
    await browser.close();
})();
