const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEARCH = 'http://localhost:3000/api';
const REPLACE = '/api';

function walk(dir){
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fp = path.join(dir, file);
    try{
      const stat = fs.statSync(fp);
      if(stat && stat.isDirectory()){
        // skip node_modules and .git
        if(file === 'node_modules' || file === '.git') return;
        results = results.concat(walk(fp));
      } else {
        results.push(fp);
      }
    }catch(e){ }
  });
  return results;
}

const files = walk(ROOT);
let changed = 0;
files.forEach(f => {
  // operate only on text files we care about
  const ext = path.extname(f).toLowerCase();
  if(!['.html','.js','.download','.css','.json'].includes(ext)) return;
  let content;
  try{ content = fs.readFileSync(f,'utf8'); } catch(e){ return; }
  if(content.includes(SEARCH)){
    // create backup if not exists
    const bak = f + '.bak';
    if(!fs.existsSync(bak)) fs.copyFileSync(f,bak);
    const newContent = content.split(SEARCH).join(REPLACE);
    fs.writeFileSync(f,newContent,'utf8');
    changed++;
    console.log(`[fixed] ${f}`);
  }
});
console.log(`Done. Files changed: ${changed}`);
if(changed === 0) console.log('No occurrences found.');
