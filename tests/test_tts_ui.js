const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log("Setting up JSDOM for TTS UI testing...");

  const html = fs.readFileSync(path.join(__dirname, '../src/static/reader_enhanced.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  const window = dom.window;
  const document = window.document;
  
  // Mock SpeechSynthesis
  window.speechSynthesis = {
    paused: false,
    speaking: false,
    pause: function() { this.paused = true; },
    resume: function() { this.paused = false; },
    cancel: function() { this.paused = false; this.speaking = false; },
    getVoices: function() { return [{ name: 'Test Voice', lang: 'en' }]; },
    speak: function(u) { 
      this.speaking = true; 
      if (u.onstart) u.onstart(); 
      // simulate instant finish
      if (u.onend) setTimeout(() => { u.onend(); }, 10);
    }
  };
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };

  // Load the JS
  const jsCode = fs.readFileSync(path.join(__dirname, '../src/static/js/notes-tts.js'), 'utf8');
  
  // Create dummy elements that notes-tts.js expects
  window.panel = document.createElement('div');
  
  // Execute JS in context
  const scriptEl = document.createElement("script");
  scriptEl.textContent = jsCode;
  document.body.appendChild(scriptEl);

  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) {
      console.log(`✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // --- Test 1: ttsPause toggles state ---
  console.log("--- Test 1: Pause/Resume Toggle ---");
  window.ttsPause();
  assert(window.speechSynthesis.paused === true, "SpeechSynthesis is paused");
  assert(document.getElementById('tts-pause-btn').innerHTML.includes('Resume'), "Button text changed to Resume");
  
  window.ttsPause();
  assert(window.speechSynthesis.paused === false, "SpeechSynthesis is resumed");
  assert(document.getElementById('tts-pause-btn').innerHTML.includes('Pause'), "Button text reverted to Pause");

  // --- Test 2: ttsStop resets state ---
  console.log("--- Test 2: Stop Resets UI ---");
  window.ttsPause(); // Pause it first
  assert(document.getElementById('tts-pause-btn').innerHTML.includes('Resume'), "Button is Resume before stop");
  window.ttsStop();
  assert(document.getElementById('tts-pause-btn').innerHTML.includes('Pause'), "Button text reset to Pause after stop");
  assert(window._ttsPlaying === false, "_ttsPlaying is false");
  
  // --- Test 3: ttsSpeak resets Pause state ---
  console.log("--- Test 3: New TTS resets Pause ---");
  window.ttsPause();
  window.ttsSpeak("Hello world");
  assert(document.getElementById('tts-pause-btn').innerHTML.includes('Pause'), "Button text reset to Pause upon new speech");
  
  // --- Test 4: Sliders updating UI ---
  // the oninput handlers are inline in HTML, let's trigger them
  console.log("--- Test 4: Sliders update labels ---");
  const speedR = document.getElementById('speed-r');
  speedR.value = "1.5";
  // Dispatch input event to trigger HTML inline oninput
  speedR.dispatchEvent(new window.Event('input'));
  assert(document.getElementById('spd-v').textContent === "1.5x", "Speed slider label updated to 1.5x");

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
