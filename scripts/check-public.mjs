import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),failures=[];
const skip=new Set(['.git','node_modules','dist','dist-server','__pycache__']);
const forbidden=/\.(?:sqlite\d?|db)(?:-|$)|\.(?:key|pem|p12)$|^\.env(?:\.|$)/i;
function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(skip.has(item.name))continue;
 const file=path.join(dir,item.name),relative=path.relative(root,file);
 if(item.isDirectory()){visit(file);continue;}
 if(forbidden.test(item.name)&&item.name!=='.env.example'){failures.push(relative+': private file type');continue;}
 const bytes=fs.readFileSync(file);if(bytes.includes(0))continue;
 const text=bytes.toString('utf8');
 if(text.includes(String.fromCodePoint(0x2014)))failures.push(relative+': forbidden punctuation');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)||/\b(?:ghp_|github_pat_|vrclsec_)[A-Za-z0-9_]{16,}/.test(text))failures.push(relative+': credential pattern');
}}
visit(root);if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('Public-file checks passed.');
