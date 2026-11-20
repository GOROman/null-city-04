import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const blender=process.env.BLENDER??(process.platform==='darwin'?'/Applications/Blender.app/Contents/MacOS/Blender':'blender');
const result=spawnSync(blender,['--background',path.join(root,'NULL_CITY_NC04.blend'),'--python-exit-code','1','--python',path.join(root,'scripts/export_web_model.py')],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
