const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createJiti}=require('jiti');
const {resolve}=require('node:path');
const paths=require('../tsconfig.json').compilerOptions.paths;
const tuiPath=paths['@earendil-works/pi-tui'][0];
const jiti=createJiti(__filename,{alias:{'@earendil-works/pi-tui':resolve(tuiPath,'dist/index.js')}});
const {wrap,answerOnly,renderCard,styleCardLine}=jiti('../extensions/anki-flash/render.ts');
const {FlashcardComponent}=jiti('../extensions/anki-flash/review.ts');
const {DEFAULT_CONFIG}=jiti('../extensions/anki-flash/config.ts');
const {visibleWidth,stripTerminalSequences}=jiti(resolve(tuiPath,'dist/index.js'));

test('word wrapping preserves ANSI sequences and full English words',()=>{
 const lines=wrap('中文 Global Rationality \x1b[1m4 Easy\x1b[22m (3d)',24);
 assert.ok(lines.every(line=>visibleWidth(line)<=24));
 assert.ok(lines.some(line=>line.includes('Rationality')));
 assert.doesNotMatch(lines.map(stripTerminalSequences).join('\n'),/\[22m|\x1b/);
});
test('standard repeated FrontSide is removed, custom/cloze backs preserved',()=>{
 assert.equal(answerOnly('<div>Question</div>','<div>Question</div><hr id=answer>Answer'),'Answer');
 assert.equal(answerOnly('Question','Context<hr id="answer">Answer'),'Context<hr id="answer">Answer');
 assert.equal(answerOnly('[...] definition','Term definition'),'Term definition');
});
test('answer layout stays readable at narrow and normal widths',async()=>{
 const cfg=structuredClone(DEFAULT_CONFIG);cfg.media.playAudio=false;
 const c=new FlashcardComponent({}, {requestRender(){}},()=>{},cfg,'有限理性');
 c.view='review';c.showAnswer=true;
 c.card={deckName:'有限理性',buttons:[1,2,3,4],nextReviews:['<1m','<6m','<10m','3d']};
 c.deckStats={new_count:7,learn_count:0,review_count:0,total_in_deck:7};c.cardInfo={type:0};
 c.rendered=await renderCard('核心区别是什么？','核心区别是什么？<hr id=answer>**有限理性**：<br>- 信息有限<br>- 认知有限',cfg);
 for(const width of [32,60,86,120]){
  const lines=c.render(width);const plain=lines.map(stripTerminalSequences).join('\n');
  assert.ok(lines.every(line=>visibleWidth(line)<=width));
  assert.equal(plain.split('核心区别是什么？').length-1,1);
  assert.doesNotMatch(plain,/\*\*|\[22m|\x1b/);
  for(const label of ['1 重来','2 困难','3 良好','4 简单','答案'])assert.ok(plain.includes(label));
 }
 assert.match(styleCardLine('**有限理性**'),/\x1b\[1m/);
});
