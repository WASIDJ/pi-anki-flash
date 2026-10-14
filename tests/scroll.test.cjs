const {test}=require('node:test');const assert=require('node:assert/strict');
const {resolve}=require('node:path');const {createJiti}=require('jiti');
const tuiPath=require('../tsconfig.json').compilerOptions.paths['@earendil-works/pi-tui'].find(p=>require('node:fs').existsSync(resolve(p,'dist/index.js')));
const jiti=createJiti(__filename,{alias:{'@earendil-works/pi-tui':resolve(tuiPath,'dist/index.js')}});
const {FlashcardComponent}=jiti('../extensions/anki-flash/review.ts');const {DEFAULT_CONFIG}=jiti('../extensions/anki-flash/config.ts');
const {stripTerminalSequences}=jiti(resolve(tuiPath,'dist/index.js'));
test('long review scrolls with arrows/page keys, clamps, and keeps actions visible',()=>{
 const c=new FlashcardComponent({}, {terminal:{rows:20},requestRender(){}},()=>{},DEFAULT_CONFIG,'test');
 c.view='review';c.showAnswer=true;c.card={deckName:'test',buttons:[1,2,3,4],nextReviews:[]};
 c.rendered={questionLines:Array.from({length:60},(_,i)=>`line ${i}`),answerLines:['LAST ANSWER'],truncated:false};
 const first=c.render(60);assert.ok(first.length<=18);assert.match(first.map(stripTerminalSequences).join('\n'),/1 重来/);
 c.handleInput('\x1b[6~');const next=c.render(60);assert.notDeepEqual(next,first);
 c.handleInput('\x1b[F');const end=c.render(60).map(stripTerminalSequences).join('\n');assert.match(end,/LAST ANSWER/);
 c.handleInput('\x1b[B');assert.equal(c.render(60).map(stripTerminalSequences).join('\n'),end);
 c.handleInput('\x1b[H');assert.deepEqual(c.render(60),first);
 c.handleMouse({type:'wheel',wheelDelta:3});assert.notDeepEqual(c.render(60),first);c.dispose();
});
