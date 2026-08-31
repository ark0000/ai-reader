const fs = require('fs');
const { execSync } = require('child_process');

const code = fs.readFileSync('src/static/js/external-editor.js', 'utf8');
const html = fs.readFileSync('src/static/reader_enhanced.html', 'utf8');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS:', name);
    pass++;
  } catch(e) {
    console.log('FAIL:', name, '-', e.message);
    fail++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// 1. SizeStyle registered before Quill instance
test('SizeStyle attributor registered before new Quill()', () => {
  assert(code.includes("Quill.import('attributors/style/size')"), 'style attributor import missing');
  assert(code.includes('Quill.register(SizeStyle, true)'), 'register call missing');
  const regIdx = code.indexOf('Quill.register(SizeStyle, true)');
  const newIdx = code.indexOf('new Quill(');
  assert(regIdx < newIdx, 'register must happen BEFORE new Quill()');
});

// 2. Whitelist contains all expected sizes
test('Whitelist contains all pixel sizes (10px..64px)', () => {
  const sizes = ['10px', '12px', '14px', '18px', '24px', '32px', '48px', '64px'];
  for (const s of sizes) {
    assert(code.includes(s), `whitelist missing size: ${s}`);
  }
});

// 3. Custom handler is defined (not relying on Quill default)
test('Custom size handler defined in toolbar handlers', () => {
  assert(code.includes("'size': function(value)"), 'custom size handler missing');
  assert(code.includes('handlers:'), 'handlers key missing');
  assert(code.includes('container: toolbarOptions'), 'container key missing');
});

// 4. Handler uses formatText to apply inline style
test('Handler uses formatText() to apply size', () => {
  assert(code.includes('quill.formatText(range.index, range.length'), 'formatText with range missing');
  assert(code.includes("'size', sizeValue") || code.includes("'size', value"), 'size format call missing');
});

// 5. Handler falls back to whole line when no text selected
test('Handler applies to whole line when nothing is selected', () => {
  assert(code.includes('range.length === 0'), 'no-selection check missing');
  assert(code.includes('quill.getLine(range.index)'), 'getLine fallback missing');
  assert(code.includes('quill.getIndex(line)'), 'getIndex call missing');
});

// 6. CSS labels exist in reader_enhanced.html for all sizes
test('CSS labels defined in reader_enhanced.html', () => {
  const sizes = ['10px', '12px', '14px', '18px', '24px', '32px', '48px', '64px'];
  for (const s of sizes) {
    assert(html.includes(`data-value="${s}"`), `CSS label missing for: ${s}`);
  }
});

// 7. JS file passes Node syntax check
test('JS file has valid syntax (node -c)', () => {
  execSync('node -c src/static/js/external-editor.js', { stdio: 'pipe' });
});

console.log('');
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
