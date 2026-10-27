import {Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,BufferTarget,Conversion} from 'mediabunny';
import {readFile,writeFile,access} from 'node:fs/promises';
const blob=new Blob([await readFile('test-results/video-stream.mp4')]);
for(const [name,fastStart] of [['fragmented','fragmented'],['tail',false]]){
 const path=`test-results/video-stream-${name}.mp4`;try{await access(path);continue}catch{}
 const input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS}),target=new BufferTarget();
 try{
  const output=new Output({format:new Mp4OutputFormat({fastStart,minimumFragmentDuration:2}),target});
  const conversion=await Conversion.init({input,output});if(!conversion.isValid)throw Error('invalid conversion');await conversion.execute();
  await writeFile(path,new Uint8Array(target.buffer));console.log('Generated',name,target.buffer.byteLength);
 }finally{input.dispose()}
}
