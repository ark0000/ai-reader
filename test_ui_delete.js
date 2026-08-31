const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.error('BROWSER ERROR:', msg.text()); else console.log('BROWSER LOG:', msg.text()); });
  page.on('dialog', async dialog => { console.log('DIALOG:', dialog.message()); await dialog.accept(); });
  await page.goto('http://127.0.0.1:8500/reader-enhanced', { waitUntil: 'networkidle0' });
  await page.evaluate(() => { window.createNewExternalNote(); });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(async () => {
     const btns = Array.from(document.querySelectorAll('.sidebar-note-item button, .sidebar-book-item button')).filter(b => b.textContent === 'Delete');
     console.log('Found ' + btns.length + ' delete buttons');
     if (btns.length > 0) btns[0].click();
  });
  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
})();
