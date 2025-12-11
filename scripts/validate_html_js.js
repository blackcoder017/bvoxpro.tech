const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

(async ()=>{
  const html = fs.readFileSync(path.join(__dirname,'..','contract-record.html'), 'utf8');
  const $ = cheerio.load(html);
  const scripts = $('script').toArray().map(s => $(s).html()).filter(Boolean);
  for (let i=0;i<scripts.length;i++){
    try{
      new Function(scripts[i]);
      console.log(`Script ${i} OK`);
    }catch(e){
      console.error(`Script ${i} ERROR:`, e.message);
      console.error(scripts[i].split('\n').slice(0,40).join('\n'));
      process.exit(1);
    }
  }
  console.log('All inline scripts parse OK');
})();