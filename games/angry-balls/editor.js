'use strict';
const LEVELS_KEY='hungry-balls.levels.v1',DRAFT_KEY='hungry-balls.draft.v1';
const SELECTED_KEY='hungry-balls.selected.v1';
let levelCatalogue=[],selectedLevelId='builtin-1',catalogueLoaded=false;
const builtinIndex=id=>/^builtin-[1-3]$/.test(id)?Number(id.slice(-1))-1:-1;
const TOOLS=[['move','✥','Двигать'],['paint','▧','Сыр'],['erase','◯','Стереть'],['hero','◉','Герой'],['enemy','●','Враг'],['rock','⬟','Камень'],['bomb','✹','Бомба'],['laser','↤','Лазер'],['hive','🐝','Пчёлы'],['delete','×','Удалить']];
let draft=null,draftId=null,draftBase=null,editorTool='move',editorSelection=null,editorUndo=[],editorDrag=null,editorChanged=false,returnLevel=null,returnIndex=0;
const el=id=>document.getElementById(id);
function packTerrain(map=ground){const bytes=new Uint8Array(Math.ceil(map.length/8));for(let i=0;i<map.length;i++)if(map[i])bytes[i>>3]|=1<<(i&7);return btoa(String.fromCharCode(...bytes));}
function unpackTerrain(encoded){
  if(typeof encoded!=='string'||encoded.length!==Math.ceil(Math.ceil(COLS*ROWS/8)/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Некорректный грунт в файле.');
  const raw=atob(encoded);if(raw.length!==Math.ceil(COLS*ROWS/8))throw Error('Некорректный размер грунта.');
  const map=new Uint8Array(COLS*ROWS);for(let i=0;i<map.length;i++)map[i]=(raw.charCodeAt(i>>3)>>(i&7))&1;return map;
}
function validateLevelData(raw){
  if(!raw||raw.version!==1||raw.width!==W||raw.height!==H||raw.cell!==CELL)throw Error('Этот файл не подходит к редактору.');
  unpackTerrain(raw.terrain);
  const number=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('В файле есть недопустимый размер или координата.');return v;};
  const point=(v,r)=>{if(!v||typeof v!=='object')throw Error('Некорректный объект.');return{x:number(v.x,r,W-r),y:number(v.y,r,H-r)};};
  const circle=(v,min,max)=>{const r=number(v?.r,min,max);return{...point(v,r),r};};
  const list=(values,limit,fn)=>{if(!Array.isArray(values)||values.length>limit)throw Error('Слишком много объектов в уровне.');return values.map(fn);};
  const hero=circle(raw.hero,9,36);
  return{version:1,width:W,height:H,cell:CELL,name:typeof raw.name==='string'?raw.name.trim().slice(0,48)||'Мой уровень':'Мой уровень',terrain:raw.terrain,hero,
    targets:list(raw.targets,20,v=>circle(v,9,36)),rocks:list(raw.rocks,16,v=>circle(v,12,34)),bombs:list(raw.bombs,12,v=>point(v,13)),
    lasers:list(raw.lasers,12,v=>{if(!['left','right','up','down'].includes(v?.direction))throw Error('Некорректное направление лазера.');return{...point(v,13),direction:v.direction};}),
    hives:list(raw.hives,4,v=>({...point(v,24),r:24}))};
}
function captureLevelData(name=el('level-name').value||'Мой уровень'){
  const circle=b=>({x:b.x,y:b.y,r:b.r}),point=b=>({x:b.x,y:b.y});
  return{version:1,width:W,height:H,cell:CELL,name:name.trim().slice(0,48)||'Мой уровень',terrain:packTerrain(),hero:circle(ball),targets:targets.map(circle),rocks:rocks.map(circle),bombs:bombs.map(point),lasers:hazards.map(h=>({...point(h),direction:h.dx<0?'left':h.dx>0?'right':h.dy<0?'up':'down'})),hives:hives.map(circle)};
}
function renderGridTerrain(){
  terrain.clear();terrain.noStroke();terrain.fill('#f9d64d');terrain.drawingContext.save();const shape=new Path2D();
  for(let y=0;y<ROWS;y++){let start=-1;for(let x=0;x<=COLS;x++){
    const filled=x<COLS&&ground[y*COLS+x];if(filled&&start<0)start=x;
    if(!filled&&start>=0){terrain.rect(start*CELL,y*CELL,(x-start)*CELL,CELL);shape.rect(start*CELL,y*CELL,(x-start)*CELL,CELL);start=-1;}
  }}
  terrain.drawingContext.clip(shape);terrain.randomSeed(34);terrain.fill('#dfaf303d');
  for(let i=0;i<45;i++)terrain.circle(terrain.random(W),terrain.random(H),terrain.random(18,65));
  terrain.drawingContext.restore();
}
function refreshHiveBees(){bees=[];for(const hive of hives)for(let i=0;i<4;i++)bees.push(makeBee(hive.x+(i%2?8:-8),hive.y+(i<2?-8:8),i));beeNav=null;beeNavTimer=0;}
function loadLevelData(source){
  const data=validateLevelData(source);ground=unpackTerrain(data.terrain);renderGridTerrain();
  ball=makeCreature(data.hero.x,data.hero.y,data.hero.r,true);targets=data.targets.map(b=>makeCreature(b.x,b.y,b.r));rocks=data.rocks.map(b=>makeRock(b.x,b.y,b.r));bombs=data.bombs.map(b=>makeBomb(b.x,b.y));
  const directions={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};hazards=data.lasers.map(h=>({x:h.x,y:h.y,dx:directions[h.direction][0],dy:directions[h.direction][1],r:13,static:true,vx:0,vy:0}));
  hives=data.hives.map(h=>({...h}));refreshHiveBees();targetTotal=targets.length;
  particles=[];meals=[];explosions=[];clockTime=0;accumulator=0;resultWait=0;activePointer=null;lastPoint=null;state='ready';trail=0;beams=hazards.map(traceLaser);
  el('result').hidden=true;el('level').textContent=data.name;
}
function circleClearInMap(map,b){
  const r=b.r-.4;
  for(let y=Math.max(0,Math.floor((b.y-r)/CELL));y<=Math.min(ROWS-1,Math.floor((b.y+r)/CELL));y++)for(let x=Math.max(0,Math.floor((b.x-r)/CELL));x<=Math.min(COLS-1,Math.floor((b.x+r)/CELL));x++){
    if(!map[y*COLS+x])continue;const dx=b.x-constrain(b.x,x*CELL,(x+1)*CELL),dy=b.y-constrain(b.y,y*CELL,(y+1)*CELL);if(dx*dx+dy*dy<r*r)return false;
  }return true;
}
function validateForPlay(source){
  const data=validateLevelData(source),map=unpackTerrain(data.terrain);
  if(!data.targets.length)throw Error('Добавь хотя бы одного зелёного врага.');
  for(const b of [data.hero,...data.targets,...data.rocks,...data.bombs.map(b=>({...b,r:13}))])if(!circleClearInMap(map,b))throw Error('Объект оказался в грунте. Сотри вокруг него немного сыра.');
  for(const hive of data.hives)for(let i=0;i<4;i++)if(!circleClearInMap(map,{x:hive.x+(i%2?8:-8),y:hive.y+(i<2?-8:8),r:BEE_R+.3}))throw Error('В камере пчёл есть грунт. Освободи её внутри.');
  return data;
}
function initEditor(){
  for(const [key,icon,label] of TOOLS){const button=document.createElement('button');button.dataset.tool=key;button.innerHTML=`<span>${icon}</span>${label}`;button.setAttribute('aria-pressed',String(key===editorTool));button.onclick=()=>chooseEditorTool(key);el('tool-strip').append(button);}
  el('menu-open').onclick=()=>{activePointer=null;lastPoint=null;el('game-menu').showModal();};el('menu-close').onclick=()=>el('game-menu').close();
  el('editor-entry').onclick=()=>{if(!new URLSearchParams(location.search).has('editor')){location.href=location.pathname+'?editor=1';return;}el('game-menu').close();openEditor();};el('editor-exit').onclick=()=>{el('game-menu').close();closeEditor();};el('new-level').onclick=()=>newEditorLevel();el('editor-undo').onclick=()=>undoEditor();el('test-level').onclick=()=>testEditorLevel();el('save-level').onclick=()=>saveEditorLevel();
  el('library-open').onclick=()=>{renderLibrary();el('level-library').showModal();};el('library-close').onclick=()=>el('level-library').close();
  el('level-name').oninput=()=>persistDraft();el('brush-size').oninput=()=>{el('brush-output').textContent=el('brush-size').value;};
  el('object-size').oninput=()=>resizeEditorSelection();el('laser-direction').onchange=()=>rotateEditorSelection();
  el('export-level').onclick=()=>exportEditorLevel();el('import-level').onclick=()=>el('import-file').click();el('import-file').onchange=event=>importEditorLevel(event.target.files[0]);
  levelCatalogue=mergeCatalogue([]);el('menu-open').disabled=true;
  refreshCatalogue().finally(()=>{let remembered='builtin-1';try{remembered=localStorage.getItem(SELECTED_KEY)||remembered;}catch{}selectGameLevel(remembered);catalogueLoaded=true;el('menu-open').disabled=false;if(new URLSearchParams(location.search).has('editor'))openEditor();});
  el('editor-undo').disabled=true;el('level-picker').onclick=()=>{el('game-menu').close();openGameLevels();};el('game-levels-close').onclick=()=>el('game-levels').close();
}
function editorMessage(message){el('editor-message').textContent=message;}
function showEditorUI(show){
  document.body.classList.toggle('editing',show);for(const id of ['editor-top','editor-tools','editor-exit'])el(id).hidden=!show;
  el('page-title').textContent=show?'Редактор уровней':'Меню';el('editor-entry').textContent=editorTesting?'✎ К редактору':'✎ Редактор';
}
function openEditor(){
  if(!editorTesting){
    returnLevel=activeCustomLevel;returnIndex=levelIndex;
    const id=activeCustomLevel?selectedLevelId:'builtin-'+(levelIndex+1);selectedLevelId=id;
    resetLevel();draft=captureLevelData(activeCustomLevel?.name||levelCatalogue.find(row=>row.id===id)?.level?.name||'Уровень '+(levelIndex+1));draftId=id;draftBase=JSON.stringify(draft);
    try{const saved=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if(saved?.id===id&&saved.base===draftBase)draft=validateLevelData(saved.level);}catch{}
    editorUndo=[];el('editor-undo').disabled=true;
  }
  editorMode=true;editorTesting=false;activePointer=null;lastPoint=null;loadLevelData(draft);repairObjectPockets();el('level-name').value=draft.name;persistDraft();editorSelection=null;showEditorUI(true);chooseEditorTool(editorTool);editorMessage('Выбери инструмент. Ленту можно листать.');
}
function closeEditor(){history.replaceState(null,'',location.pathname);persistDraft();editorMode=false;editorTesting=false;activeCustomLevel=returnLevel;levelIndex=returnIndex;showEditorUI(false);resetLevel();}
function pushEditorUndo(){editorUndo.push({level:captureLevelData(),id:draftId,base:draftBase});if(editorUndo.length>25)editorUndo.shift();el('editor-undo').disabled=false;}
function undoEditor(){if(!editorUndo.length)return;const previous=editorUndo.pop();draft=previous.level;draftId=previous.id;draftBase=previous.base;loadLevelData(draft);el('level-name').value=draft.name;editorSelection=null;el('editor-undo').disabled=!editorUndo.length;persistDraft();editorMessage('Последнее действие отменено.');updateEditorProperties();}
function persistDraft(){
  if(!editorMode)return;repairObjectPockets();draft=captureLevelData();try{localStorage.setItem(DRAFT_KEY,JSON.stringify({id:draftId,base:draftBase,level:draft}));}catch{editorMessage('Не удалось сохранить черновик в браузере. Используй экспорт.');}
}
function chooseEditorTool(tool){
  editorTool=tool;for(const button of el('tool-strip').children)button.setAttribute('aria-pressed',String(button.dataset.tool===tool));
  const defaults={hero:17,enemy:15,rock:22};if(defaults[tool]){el('object-size').value=defaults[tool];el('object-size-output').textContent=defaults[tool];}
  updateEditorProperties();const hints={move:'Перетаскивай объекты пальцем.',paint:'Рисуй сыр пальцем.',erase:'Проведи пальцем, чтобы стереть сыр.',hero:'Коснись поля: герой будет здесь.',enemy:'Коснись поля: добавится враг.',rock:'Коснись поля: добавится камень.',bomb:'Коснись поля: добавится бомба.',laser:'Коснись поля и потяни палец в сторону луча.',hive:'Коснись сыра: появится камера с пчёлами.',delete:'Коснись объекта, чтобы удалить его.'};editorMessage(hints[tool]);
}
function updateEditorProperties(){
  const kind=editorTool==='move'?editorSelection?.type:editorTool;
  el('object-size').min=kind==='rock'?12:9;el('object-size').max=kind==='rock'?34:36;
  el('brush-control').hidden=!['paint','erase'].includes(editorTool);el('object-size-control').hidden=!['hero','enemy','rock'].includes(kind);el('laser-control').hidden=kind!=='laser';
  if(editorTool==='move'&&editorSelection){const b=editorSelection.object;if(['hero','enemy','rock'].includes(kind)){el('object-size').value=b.r;el('object-size-output').textContent=b.r;}if(kind==='laser')el('laser-direction').value=b.dx<0?'left':b.dx>0?'right':b.dy<0?'up':'down';}
}
function editorObjects(){return[{type:'hero',object:ball},...targets.map(object=>({type:'enemy',object})),...rocks.map(object=>({type:'rock',object})),...bombs.map(object=>({type:'bomb',object})),...hazards.map(object=>({type:'laser',object})),...hives.map(object=>({type:'hive',object}))];}
function pickEditorObject(q){
  const scale=document.getElementById('defaultCanvas0').getBoundingClientRect().width/W,margin=12/Math.max(.2,scale);let best=null,score=Infinity;
  for(const entry of editorObjects()){const b=entry.object,d=Math.hypot(q.x-b.x,q.y-b.y);if(d<b.r+margin&&d/(b.r+margin)<score){best=entry;score=d/(b.r+margin);}}return best;
}
function keepInWorld(q,r){return{x:constrain(q.x,r,W-r),y:constrain(q.y,r,H-r)};}
function clearObjectPocket(entry){dig(entry.object,entry.object,entry.object.r+CELL*2);particles=[];beeNav=null;if(entry.type==='hive')refreshHiveBees();}
function repairObjectPockets(){
  for(const entry of editorObjects())if(!circleClearInMap(ground,entry.object))clearObjectPocket(entry);
  beams=hazards.map(traceLaser);
}
function paintEditorGround(a,b,r){
  const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/5));
  for(let i=0;i<=steps;i++){const x=lerp(a.x,b.x,i/steps),y=lerp(a.y,b.y,i/steps);for(let gy=Math.max(0,Math.floor((y-r)/CELL));gy<=Math.min(ROWS-1,Math.ceil((y+r)/CELL));gy++)for(let gx=Math.max(0,Math.floor((x-r)/CELL));gx<=Math.min(COLS-1,Math.ceil((x+r)/CELL));gx++)if(((gx+.5)*CELL-x)**2+((gy+.5)*CELL-y)**2<=r*r)ground[gy*COLS+gx]=1;}
  renderGridTerrain();beeNav=null;
}
function editorPointerDown(event,canvas){
  const q=worldPoint(event);activePointer=event.pointerId;lastPoint=q;canvas.setPointerCapture(event.pointerId);editorChanged=false;editorDrag=null;event.preventDefault();
  if(editorTool==='move'){editorSelection=pickEditorObject(q);if(editorSelection){pushEditorUndo();editorDrag={dx:q.x-editorSelection.object.x,dy:q.y-editorSelection.object.y};updateEditorProperties();}else editorMessage('Коснись объекта, чтобы переместить его.');return;}
  if(editorTool==='delete'){
    const picked=pickEditorObject(q);if(!picked)return;if(picked.type==='hero'){editorMessage('Герой нужен уровню. Его можно переместить.');return;}pushEditorUndo();
    const arrays={enemy:targets,rock:rocks,bomb:bombs,laser:hazards,hive:hives};arrays[picked.type].splice(arrays[picked.type].indexOf(picked.object),1);refreshHiveBees();editorSelection=null;editorChanged=true;return;
  }
  pushEditorUndo();editorChanged=true;
  if(editorTool==='paint'){paintEditorGround(q,q,+el('brush-size').value);return;}
  if(editorTool==='erase'){dig(q,q,+el('brush-size').value);particles=[];return;}
  const limits={enemy:20,rock:16,bomb:12,laser:12,hive:4},arrays={enemy:targets,rock:rocks,bomb:bombs,laser:hazards,hive:hives};
  if(limits[editorTool]&&arrays[editorTool].length>=limits[editorTool]){editorMessage('Для этого объекта достигнут лимит.');return;}
  const r=['hero','enemy','rock'].includes(editorTool)?+el('object-size').value:editorTool==='hive'?24:13,p=keepInWorld(q,r);let object;
  if(editorTool==='hero'){ball=makeCreature(p.x,p.y,r,true);object=ball;}
  if(editorTool==='enemy'){object=makeCreature(p.x,p.y,r);targets.push(object);}
  if(editorTool==='rock'){object=makeRock(p.x,p.y,r);rocks.push(object);}
  if(editorTool==='bomb'){object=makeBomb(p.x,p.y);bombs.push(object);}
  if(editorTool==='laser'){const dir={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[el('laser-direction').value];object={...p,r:13,dx:dir[0],dy:dir[1],static:true,vx:0,vy:0};hazards.push(object);}
  if(editorTool==='hive'){object={...p,r:24};hives.push(object);}
  editorSelection={type:editorTool,object};clearObjectPocket(editorSelection);if(editorTool==='laser')editorDrag={aim:true,x:p.x,y:p.y};targetTotal=targets.length;
}
function editorPointerMove(event){
  if(event.pointerId!==activePointer)return;const q=worldPoint(event);event.preventDefault();
  if(editorTool==='laser'&&editorDrag?.aim&&editorSelection){const dx=q.x-editorDrag.x,dy=q.y-editorDrag.y;if(Math.hypot(dx,dy)>=8){const b=editorSelection.object;b.dx=Math.abs(dx)>=Math.abs(dy)?Math.sign(dx):0;b.dy=Math.abs(dy)>Math.abs(dx)?Math.sign(dy):0;el('laser-direction').value=b.dx<0?'left':b.dx>0?'right':b.dy<0?'up':'down';editorChanged=true;}}
  else if(editorTool==='paint'){paintEditorGround(lastPoint,q,+el('brush-size').value);editorChanged=true;}
  else if(editorTool==='erase'){dig(lastPoint,q,+el('brush-size').value);particles=[];editorChanged=true;}
  else if(editorTool==='move'&&editorDrag&&editorSelection){const b=editorSelection.object,p=keepInWorld({x:q.x-editorDrag.dx,y:q.y-editorDrag.dy},b.r);b.x=p.x;b.y=p.y;editorChanged=true;if(editorSelection.type==='hive')refreshHiveBees();}
  lastPoint=q;
}
function editorPointerUp(event){
  if(event.pointerId!==activePointer)return;if(editorChanged&&editorDrag&&editorSelection)clearObjectPocket(editorSelection);
  activePointer=null;lastPoint=null;editorDrag=null;if(editorChanged)persistDraft();beams=hazards.map(traceLaser);
}
function resizeEditorSelection(){
  el('object-size-output').textContent=el('object-size').value;
  if(editorTool==='move'&&editorSelection&&['hero','enemy','rock'].includes(editorSelection.type)){
    pushEditorUndo();const b=editorSelection.object;b.r=+el('object-size').value;b.visualR=b.r;Object.assign(b,keepInWorld(b,b.r));clearObjectPocket(editorSelection);persistDraft();
  }
}
function rotateEditorSelection(){if(editorTool==='move'&&editorSelection?.type==='laser'){pushEditorUndo();const dir={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[el('laser-direction').value];editorSelection.object.dx=dir[0];editorSelection.object.dy=dir[1];persistDraft();}}
function newEditorLevel(){
  pushEditorUndo();const map=new Uint8Array(COLS*ROWS);for(let y=225;y<ROWS;y++)for(let x=0;x<COLS;x++)map[y*COLS+x]=1;
  draft={version:1,width:W,height:H,cell:CELL,name:'Новый уровень',terrain:packTerrain(map),hero:{x:95,y:100,r:17},targets:[{x:280,y:662,r:13}],rocks:[],bombs:[],lasers:[],hives:[]};draftId=null;draftBase=null;loadLevelData(draft);el('level-name').value=draft.name;editorSelection=null;persistDraft();editorMessage('Нарисуй платформы и расставь объекты.');updateEditorProperties();
}
function testEditorLevel(){
  try{persistDraft();const data=validateForPlay(draft);activeCustomLevel=data;editorTesting=true;editorMode=false;showEditorUI(false);resetLevel();editorMessage('');}
  catch(error){editorMessage(error.message);}
}
function savedLevels(){try{const values=JSON.parse(localStorage.getItem(LEVELS_KEY)||'[]');if(!Array.isArray(values))return[];return values.slice(0,30).flatMap(row=>{try{return typeof row.id==='string'?[{id:row.id,level:validateLevelData(row.level)}]:[];}catch{return[];}});}catch{return[];}}
async function saveEditorLevel(){
  try{persistDraft();const level=validateForPlay(draft),list=savedLevels();if(!draftId)draftId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
    const index=list.findIndex(row=>row.id===draftId),row={id:draftId,level};if(index>=0)list[index]=row;else{if(list.length>=30)throw Error('Сохранено 30 уровней. Удали один или используй экспорт.');list.push(row);}localStorage.setItem(LEVELS_KEY,JSON.stringify(list));draftBase=JSON.stringify(level);persistDraft();levelCatalogue=mergeCatalogue(levelCatalogue.filter(v=>v.level&&v.id!==draftId));selectedLevelId=draftId;localStorage.setItem(SELECTED_KEY,draftId);returnLevel=builtinIndex(draftId)>=0?null:level;returnIndex=builtinIndex(draftId)>=0?builtinIndex(draftId):levelIndex;editorMessage('Публикую уровень…');await publishLevel(row);await refreshCatalogue();editorMessage('Сохранено и добавлено в выбор уровней игры.');
  }catch(error){editorMessage(error.name==='QuotaExceededError'?'Память браузера заполнена. Используй экспорт.':error.message);}
}
function renderLibrary(){
  el('saved-levels').replaceChildren();el('library-message').textContent='';const levels=savedLevels();
  if(!levels.length){const p=document.createElement('p');p.textContent='Здесь появятся сохранённые уровни.';p.className='library-note';el('saved-levels').append(p);}
  for(const row of levels){const wrap=document.createElement('div');wrap.className='saved-row';const name=document.createElement('strong');name.textContent=row.level.name;const actions=document.createElement('div');
    for(const [label,action] of [['Открыть',()=>{pushEditorUndo();draft=row.level;draftId=row.id;loadLevelData(draft);el('level-name').value=draft.name;editorSelection=null;persistDraft();updateEditorProperties();el('level-library').close();}],['Играть',()=>{try{activeCustomLevel=validateForPlay(row.level);draft=row.level;draftId=row.id;loadLevelData(draft);el('level-name').value=draft.name;persistDraft();editorTesting=false;editorMode=false;showEditorUI(false);el('level-library').close();levelCatalogue=mergeCatalogue(levelCatalogue.filter(v=>v.level));selectGameLevel(row.id);}catch(error){el('library-message').textContent=error.message;}}],['Удалить',async()=>{try{await levelRequest('/'+encodeURIComponent(row.id),{method:'DELETE'});localStorage.setItem(LEVELS_KEY,JSON.stringify(savedLevels().filter(v=>v.id!==row.id)));if(draftId===row.id){draftId=null;persistDraft();}await refreshCatalogue();renderLibrary();}catch{el('library-message').textContent='Не удалось удалить уровень.';}}]]){const button=document.createElement('button');button.textContent=label;button.onclick=action;actions.append(button);}wrap.append(name,actions);el('saved-levels').append(wrap);}
}
function exportEditorLevel(){
  persistDraft();const data=validateLevelData(draft),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=(data.name.replace(/[^\p{L}\p{N}_-]+/gu,'-')||'level')+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);el('library-message').textContent='Файл уровня подготовлен.';
}
async function importEditorLevel(file){
  if(!file)return;try{if(file.size>200000)throw Error('Файл слишком большой.');const data=validateLevelData(JSON.parse(await file.text()));pushEditorUndo();draft=data;draftId=null;draftBase=null;loadLevelData(draft);el('level-name').value=draft.name;editorSelection=null;persistDraft();updateEditorProperties();el('level-library').close();editorMessage('Импортировано. Можно проверить и сохранить.');}
  catch(error){el('library-message').textContent=error instanceof SyntaxError?'Не удалось прочитать JSON-файл.':error.message;}finally{el('import-file').value='';}
}
function drawEditorScene(){
  clockTime+=Math.min(deltaTime/1000,.05);background('#c9f4e6');image(terrain,0,0);
  for(const beam of hazards.map(traceLaser))drawLaser(beam);for(const rock of rocks)drawRock(rock);for(const bomb of bombs)drawBomb(bomb);for(const bee of bees)drawBee(bee);for(const b of [ball,...targets])drawCreature(b);
  if(editorSelection){const b=editorSelection.object;noFill();stroke('#ffffff');strokeWeight(2);drawingContext.setLineDash([4,4]);circle(b.x,b.y,(b.r+6)*2);drawingContext.setLineDash([]);}
}

async function levelRequest(path='',options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{const response=await fetch('/api/hungry-balls/levels'+path,{...options,signal:controller.signal,cache:'no-store',headers:{'Content-Type':'application/json'}});
    if(!response.ok)throw Error('Не удалось сохранить уровень на сервере.');return await response.json();
  }catch{throw Error('Сервер недоступен. Копия уровня сохранена в браузере.');}finally{clearTimeout(timer);}
}
async function publishLevel(row){await levelRequest('',{method:'POST',body:JSON.stringify(row)});}
function mergeCatalogue(shared){
  const rows=new Map();
  for(const row of shared)try{const level=validateLevelData(row.level);if(level.targets.length)rows.set(row.id,{id:row.id,level});}catch{}
  for(const row of savedLevels())if(row.level.targets.length&&!rows.has(row.id))rows.set(row.id,row);
  const result=[];for(let i=1;i<=3;i++){const id='builtin-'+i;result.push(rows.get(id)||{id,level:null});rows.delete(id);}
  return [...result,...rows.values()];
}
async function refreshCatalogue(){
  try{const shared=await levelRequest();if(!Array.isArray(shared))throw Error();levelCatalogue=mergeCatalogue(shared);return true;}
  catch{levelCatalogue=mergeCatalogue(levelCatalogue.filter(row=>row.level));return false;}
}
function selectGameLevel(id){
  const row=levelCatalogue.find(row=>row.id===id)||levelCatalogue[0];selectedLevelId=row.id;
  const index=builtinIndex(row.id);if(index>=0){levelIndex=index;activeCustomLevel=null;}else activeCustomLevel=row.level;
  editorTesting=false;editorMode=false;showEditorUI(false);draft=null;draftId=null;editorUndo=[];el('editor-undo').disabled=true;
  try{localStorage.setItem(SELECTED_KEY,row.id);}catch{}resetLevel();
}
async function advanceGameLevel(){
  el('again').disabled=true;await refreshCatalogue();const index=levelCatalogue.findIndex(row=>row.id===selectedLevelId);selectGameLevel(levelCatalogue[(index+1)%levelCatalogue.length].id);el('again').disabled=false;
}
async function openGameLevels(){
  const dialog=el('game-levels'),list=el('game-level-list');list.replaceChildren();el('game-level-message').textContent='Загружаю уровни…';dialog.showModal();
  const online=await refreshCatalogue();el('game-level-message').textContent=online?'Выбери уровень.':'Сервер недоступен. Доступны уровни этого браузера.';
  for(const row of levelCatalogue){const button=document.createElement('button');button.className='game-level-row';button.textContent=row.level?.name||'Уровень '+(builtinIndex(row.id)+1);button.onclick=()=>{selectGameLevel(row.id);dialog.close();};list.append(button);}
}
