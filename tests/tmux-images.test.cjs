const {test, before, after}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync, spawn, spawnSync}=require('node:child_process');
const {createJiti}=require('jiti');
const {resolve}=require('node:path');
if(spawnSync('tmux',['-V']).status!==0){
 test('tmux image integration',{skip:'tmux unavailable'},()=>{});return;
}
const socket=`anki-images-test-${process.pid}`;
const tmux=(...args)=>execFileSync('tmux',['-L',socket,...args],{encoding:'utf8'}).trim();
tmux('-f','/dev/null','new-session','-d','-s','test','-x','100','-y','40');
const client=spawn('tmux',['-L',socket,'-C','attach-session','-t','test']);
client.stdout.on('data',()=>{});
client.stderr.on('data',()=>{});
before(async()=>{for(let i=0;i<50;i++){if(tmux('display-message','-p','-t','test','#{session_attached}')==='1')return;await new Promise(r=>setTimeout(r,20));}throw Error('tmux control client failed to attach');});
const pane=tmux('display-message','-p','-t','test','#{pane_id}');
process.env.TMUX=`/tmp/${socket},1,0`;process.env.TMUX_PANE=pane;
// Use the real socket path so production tmux selection is exercised.
process.env.TMUX=tmux('display-message','-p','-t',pane,'#{socket_path}')+',1,0';
process.env.PI_IMAGE_PROTOCOL='kitty';
const tuiPath=require('../tsconfig.json').compilerOptions.paths['@earendil-works/pi-tui'].find(path=>require('node:fs').existsSync(resolve(path,'dist/index.js')));
const jiti=createJiti(__filename,{alias:{'@earendil-works/pi-tui':resolve(tuiPath,'dist/index.js')}});
const render=jiti('../extensions/anki-flash/render.ts');
const {DEFAULT_CONFIG}=jiti('../extensions/anki-flash/config.ts');
const {visibleWidth}=jiti(resolve(tuiPath,'dist/index.js'));
// Valid PNG header with a wide/tall image, through the real media retrieval path.
const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(720,16);png.writeUInt32BE(360,20);
const originalFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({result:png.toString('base64'),error:null})});
after(()=>{global.fetch=originalFetch;client.stdin.end('detach-client\n');tmux('kill-server');});
test('tmux images use text-bound virtual placement and fit a narrow pane',async()=>{
 const image=await render.renderFirstImage('<img src="wide.png">',DEFAULT_CONFIG);
 const writes=[];const originalWrite=process.stdout.write;
 process.stdout.write=(s)=>{writes.push(String(s));return true;};
 let lines;try{lines=render.wrapLines(image.lines,18);}finally{process.stdout.write=originalWrite;}
 const output=writes.join('')+lines.join('\n');
 assert.match(output,/U=1/,'ordinary passthrough placements leak across panes');
 assert.match(output,/\u{10eeee}/u);
 assert.ok(lines.every(line=>visibleWidth(line)<=18),'image grid exceeds card width');
});
test('inactive pane uses a placeholder even when image capability is forced',async()=>{
 const image=await render.renderFirstImage('<img src="wide.png">',DEFAULT_CONFIG);
 tmux('split-window','-h','-t',pane);
 const lines=render.wrapLines(image.lines,40);
 assert.deepEqual(lines,['[image: wide.png]']);
 tmux('select-pane','-t',pane);
});
test('review disposal frees only its own tmux image IDs',async()=>{
 const {FlashcardComponent}=jiti('../extensions/anki-flash/review.ts');
 const c=new FlashcardComponent({}, {requestRender(){}},()=>{},DEFAULT_CONFIG,'test');
 c.rendered=await render.renderCard('<img src="wide.png">','',DEFAULT_CONFIG);
 c.view='review';c.card={deckName:'test',buttons:[],nextReviews:[]};
 const writes=[];const originalWrite=process.stdout.write;
 process.stdout.write=(s)=>{writes.push(String(s));return true;};
 try{c.render(40);writes.length=0;c.dispose();}finally{process.stdout.write=originalWrite;}
 assert.match(writes.join(''),/a=d,d=I,i=\d+/,'old image data and placements survive closing');
 assert.doesNotMatch(writes.join(''),/d=A/,'must not delete images owned by other panes');
});

test('changing cards deletes the previous image; repeated FrontSide allocates once',async()=>{
 const {FlashcardComponent}=jiti('../extensions/anki-flash/review.ts');
 const c=new FlashcardComponent({}, {requestRender(){}},()=>{},DEFAULT_CONFIG,'test');
 c.refreshMetadata=async()=>{};
 c.card={question:'<img src="wide.png">',answer:'<img src="wide.png">',deckName:'test',buttons:[],nextReviews:[]};
 await c.finishLoadingCurrentCard();
 assert.ok(c.rendered.answerLines.every(line=>!line.startsWith("[ANKI_IMAGE:")));
 const token=c.rendered.questionLines[0];
 const id=/:(\d+)/.exec(token)[1];
 const writes=[];const originalWrite=process.stdout.write;
 process.stdout.write=(s)=>{writes.push(String(s));return true;};
 try{
  await c.finishLoadingCurrentCard();
  assert.match(writes.join(''),new RegExp('a=d,d=I,i='+id));
  assert.notEqual(c.rendered.questionLines[0],token);
  c.card=null;await c.finishLoadingCurrentCard();
  assert.equal(c.rendered,null);
  c.dispose();writes.length=0;c.dispose();assert.deepEqual(writes,[]);
 }finally{process.stdout.write=originalWrite;}
});
test('plain terminal kitty rendering keeps its original protocol path',async()=>{
 const saved=process.env.TMUX;delete process.env.TMUX;
 const tui=jiti(resolve(tuiPath,'dist/index.js'));tui.setCapabilities({images:'kitty',trueColor:true,hyperlinks:true});
 try{
  const image=await render.renderFirstImage('<img src="wide.png">',DEFAULT_CONFIG);
  assert.match(image.lines[0],/^\x1b_Ga=T,/);
  assert.doesNotMatch(image.lines[0],/U=1|tmux;/);
 }finally{process.env.TMUX=saved;}
});
test('tmux iTerm2 or missing opt-in degrades without a graphics upload',async()=>{
 for(const protocol of ['iterm2','']){
  process.env.PI_IMAGE_PROTOCOL=protocol;
  const image=await render.renderFirstImage('<img src="wide.png">',DEFAULT_CONFIG);
  assert.deepEqual(image.lines,['[image: wide.png]']);
 }
 process.env.PI_IMAGE_PROTOCOL='kitty';
});

test('large uploads wrap every kitty chunk separately and unchanged redraws do not reupload',async()=>{
 const savedFetch=global.fetch;
 global.fetch=async()=>({ok:true,json:async()=>({result:png.toString('base64')+'A'.repeat(260000),error:null})});
 const image=await render.renderFirstImage('<img src="large.png">',DEFAULT_CONFIG);
 global.fetch=savedFetch;
 const writes=[];const originalWrite=process.stdout.write;
 process.stdout.write=(s)=>{writes.push(String(s));return true;};
 try{
  render.wrapLines(image.lines,40);
  const envelopes=writes.join('').match(/\x1bPtmux;[\s\S]*?\x1b\\/g);
  assert.ok(envelopes.length>60);
  assert.ok(envelopes.every(envelope=>envelope.length<4300));
  writes.length=0;render.wrapLines(image.lines,40);assert.deepEqual(writes,[]);
  render.wrapLines(image.lines,18);assert.ok(writes.length>0,'resize updates virtual geometry');
 }finally{process.stdout.write=originalWrite;}
});
