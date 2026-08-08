const fs = require('fs');
const code = fs.readFileSync('src/static/js/ai-chat.js', 'utf8');

let count = 0;
let lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') count++;
        if (line[j] === '}') count--;
    }
}
console.log("Final count:", count);
