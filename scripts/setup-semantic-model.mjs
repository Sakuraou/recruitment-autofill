import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {mkdir,writeFile,stat,rename,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(root,'artifacts');
if(!process.stdin.isTTY){console.error('请在本机终端运行此配置向导；也可以按 docs/COMPATIBLE_API_SETUP.md 使用本机JSON文件配置。');process.exitCode=1;}else{
 await mkdir(directory,{recursive:true});const bundle=resolve(directory,'semantic-model-config.mjs');await build({entryPoints:[resolve(root,'src/companion/modelConfig.ts')],bundle:true,platform:'node',format:'esm',target:'node22',outfile:bundle});const {resolveCompanionModel}=await import(pathToFileURL(bundle).href);
 let hidden=false;const output=new Writable({write(chunk,_encoding,done){if(!hidden)process.stdout.write(chunk);done();}});const terminal=createInterface({input:process.stdin,output,terminal:true});
 const ask=async(label,fallback='')=>(await terminal.question(label)).trim()||fallback;
 const path=resolve(directory,'semantic-model.local.json');let temp;
 try{
  console.info('配置OpenAI兼容模型。API密钥输入时不显示，仅写入本机忽略目录。');
  let exists=false;try{await stat(path);exists=true;}catch(error){if(error.code!=='ENOENT')throw new Error('file');}
  if(exists&&!/^(?:y|yes|是)$/iu.test(await ask('已有本机配置，是否替换？ [y/N]：','n'))){console.info('已保留原配置。');}
  else{
   const choice=await ask('服务：1 DeepSeek，2 通义千问/其他兼容服务 [1]：','1');
   if(!['1','2'].includes(choice))throw new Error('choice');
   const baseUrl=choice==='1'?'https://api.deepseek.com/v1':await ask('服务地址 Base URL（从供应商控制台复制）：');
   const model=await ask('模型名（需支持JSON输出）：');
   process.stdout.write('API Key（输入不显示）：');hidden=true;let apiKey;try{apiKey=(await terminal.question('')).trim();}finally{hidden=false;process.stdout.write('\n');}
   const mode=await ask('输出：1 JSON Object（兼容广），2 JSON Schema（模型须支持） [1]：','1');if(!['1','2'].includes(mode))throw new Error('format');
   const value={provider:'openai-compatible',baseUrl,model,apiKey,outputFormat:mode==='1'?'json_object':'json_schema'};resolveCompanionModel({},value);
   temp=resolve(directory,'semantic-model.local.json.tmp');await writeFile(temp,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});await rename(temp,path);temp=undefined;
   console.info('配置已保存：'+path);console.info('下一步运行 npm run semantic:serve，再在扩展“AI识别连接”导入 artifacts/semantic-connection.local.json。');
  }
 }catch{console.error('配置未保存，请检查服务地址、模型名和密钥后重试。');process.exitCode=1;}
 finally{terminal.close();output.end();if(temp)await rm(temp,{force:true});}
}
