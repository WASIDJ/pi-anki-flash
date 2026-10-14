const {test}=require('node:test');const assert=require('node:assert/strict');const sharp=require('sharp');
const {resolve}=require('node:path');const {createJiti}=require('jiti');
const tuiPath=require('../tsconfig.json').compilerOptions.paths['@earendil-works/pi-tui'].find(p=>require('node:fs').existsSync(resolve(p,'dist/index.js')));
const jiti=createJiti(__filename,{alias:{'@earendil-works/pi-tui':resolve(tuiPath,'dist/index.js')}});
const {compositeOcclusion,occlusionFields}=jiti('../extensions/anki-flash/occlusion.ts');
const shape=(state,extra='')=>`<div class="${state}" data-shape="rect" data-left=".25" data-top=".25" data-width=".5" data-height=".5" ${extra}></div>`;
test('normalized masks become native clozes with group and hideOthers semantics',()=>{
 const fields=occlusionFields({image:'diagram.png',hideOthers:false,masks:[{left:0,top:0,width:.2,height:.3,group:2},{left:.4,top:.5,width:.1,height:.1,group:2}]});
 assert.equal((fields.Occlusion.match(/{{c2::/g)||[]).length,2);assert.match(fields.Occlusion,/oi=0/);assert.equal(fields.Image,'<img src="diagram.png">');
 assert.throws(()=>occlusionFields({image:'x.png',masks:[{left:.9,top:0,width:.2,height:.3}]}),/图片内部/);
});
test('front pixels are hidden while answer highlight reveals the target',async()=>{
 const source=await sharp({create:{width:100,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();
 for(const [state,expected,extra] of [['cloze',[255,142,142],''],['cloze-highlight',[255,255,255],''],['cloze-inactive',[255,235,162],'data-occludeinactive="1"'],['cloze-inactive',[255,255,255],'data-occludeinactive="0"']]){
  const output=await compositeOcclusion(source.toString('base64'),shape(state,extra));
  const {data,info}=await sharp(Buffer.from(output,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([...data.subarray((50*info.width+50)*3,(50*info.width+50)*3+3)],expected,state);
 }
 await assert.rejects(compositeOcclusion(source.toString('base64'),'<canvas id="image-occlusion-canvas"></canvas>'),/遮罩数据/);
});
test('native occlusion cards render distinct front/back uploads and hide malformed fronts',async()=>{
 const {renderCard}=jiti('../extensions/anki-flash/render.ts');const {DEFAULT_CONFIG}=jiti('../extensions/anki-flash/config.ts');
 jiti(resolve(tuiPath,'dist/index.js')).setCapabilities({images:'kitty',trueColor:true,hyperlinks:true});
 const source=await sharp({create:{width:100,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();
 const oldFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({result:source.toString('base64'),error:null})});
 try{
  const html=s=>`<div id="image-occlusion-container"><img src="x.png"><canvas id="image-occlusion-canvas"></canvas></div>${shape(s)}`;
  const r=await renderCard(html('cloze'),html('cloze-highlight'),DEFAULT_CONFIG);
  assert.equal(r.replaceQuestionOnAnswer,true);assert.match(r.questionLines[0],/\x1b_G/);assert.match(r.answerLines[0],/\x1b_G/);assert.notEqual(r.questionLines[0],r.answerLines[0]);
  const bad=await renderCard(html('cloze').replace('data-shape="rect"','data-shape="unknown"'),'Answer',DEFAULT_CONFIG);
  assert.doesNotMatch(bad.questionLines.join(''),/\x1b_G/);assert.match(bad.questionLines.join(''),/unavailable/);
 }finally{global.fetch=oldFetch;}
});

test('native ellipse, polygon and rotated rectangles cover their target pixels',async()=>{
 const source=await sharp({create:{width:100,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();
 const examples=[
  ['<div class="cloze" data-shape="ellipse" data-left=".2" data-top=".2" data-rx=".3" data-ry=".3"></div>',50,50],
  ['<div class="cloze" data-shape="polygon" data-left=".25" data-top=".25" data-points="0,0 .5,0 .5,.5 0,.5"></div>',50,50],
  ['<div class="cloze" data-shape="rect" data-left=".25" data-top=".25" data-width=".5" data-height=".2" data-angle="2500"></div>',15,50],
 ];
 for(const [html,x,y] of examples){
  const output=await compositeOcclusion(source.toString('base64'),html);
  const data=await sharp(Buffer.from(output,'base64')).removeAlpha().raw().toBuffer();
  assert.deepEqual([...data.subarray((y*100+x)*3,(y*100+x)*3+3)],[255,142,142]);
 }
});
