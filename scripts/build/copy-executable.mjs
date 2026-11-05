import {copyFile,chmod,rename,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function copyExecutable(source,destination){
 const temporary=join(dirname(destination),`.${basename(destination)}-${randomUUID()}.tmp`);
 try{
  await copyFile(source,temporary,constants.COPYFILE_EXCL);
  await chmod(temporary,0o755);
  await rename(temporary,destination);
 }finally{await rm(temporary,{force:true});}
}
