const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  await page.goto('http://localhost:8500/reader-enhanced', { waitUntil: 'networkidle0' });
  
  // Just trigger it via javascript directly
  const logs = await page.evaluate(async () => {
      const logs = [];
      const btnMain = document.getElementById('btn-editor-main');
      if (!btnMain) return ['btn-editor-main not found'];
      
      logs.push('Clicking main button');
      btnMain.click();
      
      await new Promise(r => setTimeout(r, 400));
      const optionsCont = document.getElementById('editor-options-container');
      logs.push('optionsCont width: ' + optionsCont.style.width);
      logs.push('optionsCont opacity: ' + optionsCont.style.opacity);
      
      const overlayBtn = document.querySelector('button[title="Open in Overlay"]');
      if (overlayBtn) {
          logs.push('Clicking overlay button');
          overlayBtn.click();
          await new Promise(r => setTimeout(r, 400));
          
          const modal = document.getElementById('external-notes-overlay');
          logs.push('Modal display: ' + modal.style.display);
      }
      return logs;
  });
  
  console.log(logs.join('\n'));
  
  await browser.close();
})();
