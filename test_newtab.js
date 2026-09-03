const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://localhost:8500/reader-enhanced', { waitUntil: 'networkidle0' });
  
  const logs = await page.evaluate(async () => {
      const logs = [];
      try {
          let roomId = sessionStorage.getItem('remote_notes_room_id');
          if (!roomId) {
              roomId = 'notes-' + Date.now().toString(36);
              sessionStorage.setItem('remote_notes_room_id', roomId);
          }
          logs.push('Room id: ' + roomId);
          
          if (typeof RemoteNotesEngine === 'undefined') {
              return logs.concat(['ERROR: RemoteNotesEngine is undefined']);
          }
          
          logs.push('Instantiating RemoteNotesEngine');
          window.testEngine = new RemoteNotesEngine(roomId);
          logs.push('Instantiated.');
      } catch (e) {
          logs.push('Error: ' + e.message);
      }
      return logs;
  });
  
  console.log(logs.join('\n'));
  
  await browser.close();
})();
