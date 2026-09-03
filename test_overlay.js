const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://localhost:8500/reader-enhanced', { waitUntil: 'networkidle0' });
  
  const btnTools = await page.$('#btn-editor-main');
  console.log('Main button found:', !!btnTools);
  
  if (btnTools) {
      console.log('Clicking main button...');
      await btnTools.click();
      await new Promise(r => setTimeout(r, 500));
      
      const overlayBtn = await page.$('button[title="Open in Overlay"]');
      console.log('Overlay button found:', !!overlayBtn);
      
      if (overlayBtn) {
          await overlayBtn.click();
          await new Promise(r => setTimeout(r, 500));
          
          const overlayDisplay = await page.evaluate(() => document.getElementById('external-notes-overlay').style.display);
          console.log('Overlay display after click:', overlayDisplay);
      }
  }
  
  await browser.close();
})();
