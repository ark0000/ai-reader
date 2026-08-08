const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const errors = [];
    
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            errors.push(msg.text());
        }
    });
    
    page.on('pageerror', err => {
        errors.push(err.toString());
    });
    
    await page.goto('http://localhost:8080/reader-enhanced');
    
    await new Promise(r => setTimeout(r, 2000)); // wait for load
    
    console.log("Clicking fullscreen button...");
    await page.evaluate(() => {
        if (typeof toggleFullScreen === 'function') {
            toggleFullScreen();
        } else {
            console.error("toggleFullScreen is not defined!");
        }
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    console.log("Collected errors:");
    console.log(errors);
    
    await browser.close();
})();