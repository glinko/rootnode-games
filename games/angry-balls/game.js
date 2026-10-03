'use strict';
// World units stay identical on every phone; only the display is scaled.
const W=390,H=700,CELL=3,COLS=Math.ceil(W/CELL),ROWS=Math.ceil(H/CELL);
let ground,terrain,ball,targets,particles,hazards,rocks=[],bombs=[],explosions=[],bees=[],hives=[],beams=[],beeNav=null,beeNavTimer=0,state='ready',accumulator=0,activePointer=null,lastPoint=null,levelIndex=0,trail=0,clockTime=0,meals=[],resultWait=0;
const AIR_DRAG=.6,SURFACE_DRAG=1.5,BOMB_DROP=44,BOMB_BLAST=38;
const BEE_R=3.3,BEE_SPEED=76,NAV_STEP=6,NAV_COLS=Math.ceil(W/NAV_STEP),NAV_ROWS=Math.ceil(H/NAV_STEP);
const palettes=['#f9d64d','#f5c544','#ffdc62'];
let editorMode=false,editorTesting=false,activeCustomLevel=null,targetTotal=3;
function setup(){
  pixelDensity(Math.min(window.devicePixelRatio||1,2));
  const canvas=createCanvas(W,H);canvas.parent('stage');
  terrain=createGraphics(W,H);terrain.pixelDensity(1);
  const fit=()=>{const r=document.querySelector('#stage').getBoundingClientRect(),s=Math.min(r.width/W,r.height/H);canvas.elt.style.width=`${editorMode?W*s:r.width}px`;canvas.elt.style.height=`${editorMode?H*s:r.height}px`;};
  new ResizeObserver(fit).observe(document.querySelector('#stage'));fit();
  canvas.elt.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||activePointer!==null)return;if(editorMode){editorPointerDown(e,canvas.elt);return;}if(state==='won'||state==='lost'||ball.swallowedBy)return;activePointer=e.pointerId;canvas.elt.setPointerCapture(e.pointerId);const q=worldPoint(e);lastPoint=q;dig(q,q);state='playing';e.preventDefault();});
  canvas.elt.addEventListener('pointermove',e=>{if(editorMode){editorPointerMove(e);return;}if(e.pointerId!==activePointer||ball.swallowedBy)return;const q=worldPoint(e);dig(lastPoint,q);lastPoint=q;e.preventDefault();});
  const release=e=>{if(editorMode)editorPointerUp(e);if(e.pointerId===activePointer){activePointer=null;lastPoint=null;}};
  canvas.elt.addEventListener('pointerup',release);canvas.elt.addEventListener('pointercancel',release);canvas.elt.addEventListener('lostpointercapture',release);
  document.querySelector('#restart').onclick=()=>{document.querySelector('#game-menu').close();resetLevel();};
  document.querySelector('#again').onclick=()=>{if(editorTesting){openEditor();return;}if(state==='won'){advanceGameLevel();return;}resetLevel();};
  document.addEventListener('visibilitychange',()=>{accumulator=0;activePointer=null;lastPoint=null;});
  resetLevel();
  initEditor();
}
function worldPoint(e){const r=document.querySelector('canvas').getBoundingClientRect();return{x:constrain((e.clientX-r.left)*W/r.width,0,W),y:constrain((e.clientY-r.top)*H/r.height,0,H)};}
function makeCreature(x,y,r,hero=false){return{x,y,r,visualR:r,vx:0,vy:0,angle:0,hero,alive:true,squash:0,squashV:0,lean:0,leanV:0,mouth:0,faceX:1,faceY:0,busy:false,swallowedBy:null,units:hero?0:1,phase:x*.03};}
function makeRock(x,y,r){return{x,y,r,vx:0,vy:0,angle:0,rigid:true,seed:x*.13};}
function makeBomb(x,y){return{...makeRock(x,y,13),bomb:true,alive:true,fallStartY:y,landingImpact:0};}
function rigidBodies(){return[...rocks,...bombs.filter(b=>b.alive)];}
function applySurfaceFriction(body,dt){if(body.grounded)body.vx*=Math.exp(-SURFACE_DRAG*dt);if(Math.abs(body.vx)<.35&&body.grounded)body.vx=0;}
function resetLevel(){
  if(activeCustomLevel){loadLevelData(activeCustomLevel);return;}
  const replacement=levelCatalogue.find(row=>row.id==='builtin-'+(levelIndex+1))?.level;if(replacement){loadLevelData(replacement);return;}
  targetTotal=3;
  ground=new Uint8Array(COLS*ROWS);particles=[];meals=[];explosions=[];bees=[];hives=[];beeNav=null;beeNavTimer=0;resultWait=0;clockTime=0;accumulator=0;state='ready';trail=0;activePointer=null;lastPoint=null;
  const flip=levelIndex===1;const left=flip?295:95,right=flip?100:280;
  ball=makeCreature(left,109,17,true);
  const sizes=[[13,15,21],[12,16,21],[14,17,23]][levelIndex];
  targets=[makeCreature(right,312-sizes[0],sizes[0]),makeCreature(left,492-sizes[1],sizes[1]),makeCreature(right,675-sizes[2],sizes[2])];
  hazards=[{x:flip?15:375,y:185,dx:flip?1:-1,dy:0,r:13,static:true,vx:0,vy:0},{x:flip?375:15,y:365,dx:flip?-1:1,dy:0,r:13,static:true,vx:0,vy:0}];
  rocks=[makeRock(flip?75:315,185,22),makeRock(flip?310:80,365,22)];
  bombs=[makeBomb(flip?345:45,299),makeBomb(flip?45:345,479)];
  hives=[{x:flip?345:45,y:170,r:24}];
  terrain.clear();terrain.noStroke();terrain.fill(palettes[levelIndex]);
  for(const [y,h] of [[126,104],[310,100],[490,100],[674,26]]){
    terrain.rect(0,y,W,h);
    for(let gy=Math.ceil(y/CELL);gy<Math.ceil((y+h)/CELL);gy++)for(let gx=0;gx<COLS;gx++)ground[gy*COLS+gx]=1;
    terrain.fill('#d9a42b');terrain.rect(0,y+h-5,W,5);terrain.fill(palettes[levelIndex]);
  }
  // Texture is visual only, and is erased together with the terrain.
  terrain.randomSeed(34+levelIndex);terrain.fill('#dfaf303d');
  terrain.drawingContext.save();terrain.drawingContext.beginPath();
  for(const [y,h] of [[126,104],[310,100],[490,100],[674,26]])terrain.drawingContext.rect(0,y,W,h);
  terrain.drawingContext.clip();
  for(let i=0;i<45;i++){const x=terrain.random(W),y=terrain.random(H);if(solid(x,y))terrain.circle(x,y,terrain.random(18,65));}
  terrain.drawingContext.restore();
  // Small chambers show the buried emitter and its stone shield. Their
  // floor remains intact until the player erases the support.
  for(let i=0;i<rocks.length;i++){
    const emitter=hazards[i],rock=rocks[i];dig({x:emitter.x,y:emitter.y},{x:rock.x,y:rock.y},24);
    // A flat chamber floor keeps the shield at rest rather than letting it
    // slide on the rounded corners of the brush-created cavity.
    const x0=Math.max(0,Math.min(emitter.x,rock.x)-24),x1=Math.min(W,Math.max(emitter.x,rock.x)+24);
    terrain.erase();terrain.noStroke();terrain.rect(x0,emitter.y,x1-x0,25);terrain.noErase();
    for(let gy=Math.floor(emitter.y/CELL);gy<Math.ceil((emitter.y+25)/CELL);gy++)for(let gx=Math.floor(x0/CELL);gx<Math.ceil(x1/CELL);gx++)ground[gy*COLS+gx]=0;
  }
  for(const hive of hives){
    dig(hive,hive,hive.r);
    for(let i=0;i<4;i++){const hx=hive.x+(i%2?8:-8),hy=hive.y+(i<2?-8:8);bees.push(makeBee(hx,hy,i));}
  }
  particles=[];trail=0;
  beams=hazards.map(traceLaser);
  document.querySelector('#result').hidden=true;document.querySelector('#level').textContent=`LEVEL ${String(levelIndex+1).padStart(2,'0')}`;
  
}
function solid(x,y){if(x<0||x>=W||y<0||y>=H)return false;return ground[Math.floor(y/CELL)*COLS+Math.floor(x/CELL)]===1;}
function dig(a,b,brushRadius=null){
  beeNavTimer=0;
  const radius=brushRadius??Math.max(27,ball.r+5),dist=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(dist/5));
  terrain.erase();terrain.strokeWeight(radius*2);terrain.stroke(0);terrain.line(a.x,a.y,b.x,b.y);terrain.noStroke();terrain.circle(a.x,a.y,radius*2);terrain.circle(b.x,b.y,radius*2);terrain.noErase();
  for(let s=0;s<=steps;s++){const t=s/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
    for(let gy=Math.max(0,Math.floor((y-radius)/CELL));gy<=Math.min(ROWS-1,Math.ceil((y+radius)/CELL));gy++)for(let gx=Math.max(0,Math.floor((x-radius)/CELL));gx<=Math.min(COLS-1,Math.ceil((x+radius)/CELL));gx++){
      const dx=(gx+.5)*CELL-x,dy=(gy+.5)*CELL-y;if(dx*dx+dy*dy<=radius*radius){const idx=gy*COLS+gx;if(ground[idx]&&Math.random()<.025)particles.push({x:gx*CELL,y:gy*CELL,vx:random(-45,45),vy:random(-70,0),life:.5,color:'#e7b834',r:random(2,4)});ground[idx]=0;}
    }
  }
  trail++;
}
function makeBee(x,y,id=0){return{x,y,r:BEE_R,vx:0,vy:0,homeX:x,homeY:y,phase:id*1.8,alive:true,chasing:false};}
function beeFree(x,y,obstacles=[...rigidBodies(),...hazards]){
  const r=BEE_R+.3;if(x<r||x>W-r||y<r||y>H-r)return false;
  for(let gy=Math.floor((y-r)/CELL);gy<=Math.floor((y+r)/CELL);gy++)for(let gx=Math.floor((x-r)/CELL);gx<=Math.floor((x+r)/CELL);gx++){
    if(!ground[gy*COLS+gx])continue;const dx=x-constrain(x,gx*CELL,(gx+1)*CELL),dy=y-constrain(y,gy*CELL,(gy+1)*CELL);
    if(dx*dx+dy*dy<r*r)return false;
  }
  for(const obstacle of obstacles)if((obstacle.x-x)**2+(obstacle.y-y)**2<(obstacle.r+r)**2)return false;
  return true;
}
function beeLineClear(a,b,obstacles=[...rigidBodies(),...hazards]){
  const d=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(d/3));
  for(let i=0;i<=steps;i++)if(!beeFree(lerp(a.x,b.x,i/steps),lerp(a.y,b.y,i/steps),obstacles))return false;
  return true;
}
function buildBeeNavigation(obstacles=[...rigidBodies(),...hazards]){
  // One shared distance field guides the whole swarm around walls. Clearance
  // includes the bee's radius, and diagonals cannot cut a solid corner.
  const count=NAV_COLS*NAV_ROWS,open=new Uint8Array(count),distance=new Int16Array(count);distance.fill(-1);
  for(let y=0;y<NAV_ROWS;y++)for(let x=0;x<NAV_COLS;x++)open[y*NAV_COLS+x]=beeFree((x+.5)*NAV_STEP,(y+.5)*NAV_STEP,obstacles)?1:0;
  const tx=constrain(Math.floor(ball.x/NAV_STEP),0,NAV_COLS-1),ty=constrain(Math.floor(ball.y/NAV_STEP),0,NAV_ROWS-1);
  let goal=ty*NAV_COLS+tx;
  if(!open[goal]){let best=Infinity;goal=-1;for(let y=Math.max(0,ty-2);y<=Math.min(NAV_ROWS-1,ty+2);y++)for(let x=Math.max(0,tx-2);x<=Math.min(NAV_COLS-1,tx+2);x++){const idx=y*NAV_COLS+x,d=(x-tx)**2+(y-ty)**2;if(open[idx]&&d<best){best=d;goal=idx;}}}
  if(goal<0)return{open,distance};
  const queue=new Int32Array(count);let head=0,tail=1;queue[0]=goal;distance[goal]=0;
  while(head<tail){const idx=queue[head++],x=idx%NAV_COLS,y=Math.floor(idx/NAV_COLS);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||nx>=NAV_COLS||ny<0||ny>=NAV_ROWS)continue;
      const ni=ny*NAV_COLS+nx;if(!open[ni]||distance[ni]>=0)continue;
      if(dx&&dy&&(!open[y*NAV_COLS+nx]||!open[ny*NAV_COLS+x]))continue;
      distance[ni]=distance[idx]+1;queue[tail++]=ni;
    }
  }
  return{open,distance};
}
function updateBees(dt){
  if(!bees.some(b=>b.alive))return;
  const obstacles=[...rigidBodies(),...hazards];
  beeNavTimer-=dt;if(!beeNav||beeNavTimer<=0){beeNav=buildBeeNavigation(obstacles);beeNavTimer=.16;}
  for(const bee of bees)if(bee.alive){
    const cx=constrain(Math.floor(bee.x/NAV_STEP),0,NAV_COLS-1),cy=constrain(Math.floor(bee.y/NAV_STEP),0,NAV_ROWS-1),idx=cy*NAV_COLS+cx;
    let target=null,best=beeNav.distance[idx]>=0?beeNav.distance[idx]:Infinity;
    bee.chasing=best!==Infinity;
    if(bee.chasing&&beeLineClear(bee,ball,obstacles))target=ball;
    else if(bee.chasing){
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=cx+dx,ny=cy+dy;if(nx<0||nx>=NAV_COLS||ny<0||ny>=NAV_ROWS||(!dx&&!dy))continue;
        const ni=ny*NAV_COLS+nx,d=beeNav.distance[ni];if(d<0||d>=best)continue;
        if(dx&&dy&&(!beeNav.open[cy*NAV_COLS+nx]||!beeNav.open[ny*NAV_COLS+cx]))continue;
        best=d;target={x:(nx+.5)*NAV_STEP,y:(ny+.5)*NAV_STEP};
      }
    }
    if(!target)target={x:bee.homeX+Math.sin(clockTime*2.4+bee.phase)*3,y:bee.homeY+Math.cos(clockTime*2+bee.phase)*3};
    const dx=target.x-bee.x,dy=target.y-bee.y,d=Math.hypot(dx,dy),speed=bee.chasing?BEE_SPEED:Math.min(20,d*6),turn=1-Math.exp(-8*dt);
    bee.vx=lerp(bee.vx,dx/Math.max(1,d)*speed,turn);bee.vy=lerp(bee.vy,dy/Math.max(1,d)*speed,turn);
    if(beeFree(bee.x+bee.vx*dt,bee.y,obstacles))bee.x+=bee.vx*dt;else bee.vx*=-.15;
    if(beeFree(bee.x,bee.y+bee.vy*dt,obstacles))bee.y+=bee.vy*dt;else bee.vy*=-.15;
    if(state==='playing'&&ball.alive&&!ball.swallowedBy&&Math.hypot(bee.x-ball.x,bee.y-ball.y)<bee.r+ball.r&&beeLineClear(bee,ball,obstacles)){ball.alive=false;finish(false,'bee');return;}
  }
}
function collideTerrain(body=ball){
  // Circle vs nearby cell boxes. Repeat projection to settle corners.
  let impact=0;
  // Treat a continuous row as one flat surface, avoiding sideways impulses
  // from the internal corners between adjacent grid cells.
  if(body.vy>=0){
    const bottomRow=Math.min(ROWS-1,Math.floor((body.y+body.r)/CELL));
    for(let gy=Math.max(0,Math.floor(body.y/CELL));gy<=bottomRow;gy++){
      const top=gy*CELL;if(top<body.y||top>body.y+body.r)continue;
      let flat=true;
      for(let gx=Math.floor((body.x-body.r*.65)/CELL);gx<=Math.floor((body.x+body.r*.65)/CELL);gx++){
        if(gx<0||gx>=COLS||!ground[gy*COLS+gx]||(gy>0&&ground[(gy-1)*COLS+gx])){flat=false;break;}
      }
      if(flat){impact=body.vy;body.supported=true;body.landingImpact=Math.max(body.landingImpact||0,body.vy);body.y=top-body.r;body.vy=0;break;}
    }
  }
  for(let iter=0;iter<4;iter++){
    let contacts=0;
    const minX=Math.max(0,Math.floor((body.x-body.r)/CELL)),maxX=Math.min(COLS-1,Math.floor((body.x+body.r)/CELL));
    const minY=Math.max(0,Math.floor((body.y-body.r)/CELL)),maxY=Math.min(ROWS-1,Math.floor((body.y+body.r)/CELL));
    for(let gy=minY;gy<=maxY;gy++)for(let gx=minX;gx<=maxX;gx++){
      if(!ground[gy*COLS+gx])continue;
      const cx=constrain(body.x,gx*CELL,(gx+1)*CELL),cy=constrain(body.y,gy*CELL,(gy+1)*CELL);
      let dx=body.x-cx,dy=body.y-cy,d=Math.hypot(dx,dy);if(d>=body.r)continue;
      if(d<.0001){dx=0;dy=-1;d=1;}
      const nx=dx/d,ny=dy/d,penetration=body.r-d;
      if(ny<-.3)body.supported=true;
      body.x+=nx*penetration;body.y+=ny*penetration;
      const vn=body.vx*nx+body.vy*ny;if(vn<0){impact=Math.max(impact,-vn);if(ny<-.3)body.landingImpact=Math.max(body.landingImpact||0,-vn);body.vx-=vn*nx;body.vy-=vn*ny;}
      contacts++;
    }
    if(!contacts)break;
  }
  if(body.x<body.r){body.x=body.r;impact=Math.max(impact,-body.vx);body.vx=Math.max(0,body.vx);}if(body.x>W-body.r){body.x=W-body.r;impact=Math.max(impact,body.vx);body.vx=Math.min(0,body.vx);}
  body.grounded=body.supported||solid(body.x,body.y+body.r+1);
  if(impact>35&&!body.rigid)body.squashV+=Math.min(impact/55,8);
}
function bodies(){return[ball,...targets].filter(b=>b.alive&&!b.swallowedBy);}
function jellyShape(b){const sx=1+b.squash+Math.sin(clockTime*2.6+b.phase)*.035,sy=1/sx;return{sx,sy,offset:b.swallowedBy?0:b.r-b.visualR*sy};}
function mouthPosition(eater){const {sx,sy,offset}=jellyShape(eater),r=eater.visualR;return{x:eater.x+(eater.faceX*r*.28+eater.lean*(r*.34+eater.faceY*r*.15))*sx,y:eater.y+offset+(r*.34+eater.faceY*r*.15)*sy};}
function traceLaser(emitter){
  const dx=emitter.dx,dy=emitter.dy,ox=emitter.x+dx*15,oy=emitter.y+dy*15;
  const limit=Math.min(dx>0?(W-ox)/dx:dx<0?-ox/dx:Infinity,dy>0?(H-oy)/dy:dy<0?-oy/dy:Infinity);
  let length=Math.max(0,limit),hit='edge',blocker=null;
  // Trace the same solid grid as physics; even a thin remaining wall stops it.
  for(let t=0;t<length;t+=1){const x=ox+dx*t,y=oy+dy*t;if(solid(x,y)||solid(x-dy*2,y+dx*2)||solid(x+dy*2,y-dx*2)){length=t;hit='ground';break;}}
  for(const rock of rocks){
    const rx=rock.x-ox,ry=rock.y-oy,along=rx*dx+ry*dy,perp2=rx*rx+ry*ry-along*along,r=rock.r+2;
    if(perp2>r*r||along+r<0)continue;
    const entry=Math.max(0,along-Math.sqrt(Math.max(0,r*r-perp2)));
    if(entry<=length){length=entry;hit='rock';blocker=rock;}
  }
  return{ox,oy,ex:ox+dx*length,ey:oy+dy*length,length,hit,blocker,emitter};
}
function touchesBeam(body,beam){if(beam.length<1)return false;const dx=beam.ex-beam.ox,dy=beam.ey-beam.oy,t=constrain(((body.x-beam.ox)*dx+(body.y-beam.oy)*dy)/(dx*dx+dy*dy),0,1);return Math.hypot(body.x-beam.ox-dx*t,body.y-beam.oy-dy*t)<body.r+2;}
function collideRigid(a,b){
  const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),overlap=a.r+b.r-d;
  if(overlap>=0){if(a.bomb&&a.alive&&(b.static||b.rigid&&!b.bomb))a.contactDetonation=true;if(b.bomb&&b.alive&&(a.static||a.rigid&&!a.bomb))b.contactDetonation=true;}
  if(overlap<=0)return;
  const nx=d>.01?dx/d:1,ny=d>.01?dy/d:0;
  if(ny>.3&&!a.static)a.supported=true;
  if(ny<-.3&&!b.static)b.supported=true;
  const invA=a.static?0:1/(a.r**3*(a.rigid?5:1)),invB=b.static?0:1/(b.r**3*(b.rigid?5:1)),total=invA+invB;if(!total)return;
  a.x-=nx*overlap*invA/total;a.y-=ny*overlap*invA/total;b.x+=nx*overlap*invB/total;b.y+=ny*overlap*invB/total;
  const closing=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
  if(closing<0){const impulse=-closing/total;a.vx-=impulse*nx*invA;a.vy-=impulse*ny*invA;b.vx+=impulse*nx*invB;b.vy+=impulse*ny*invB;
    if(ny>.3){a.landingImpact=Math.max(a.landingImpact||0,-closing);a.grounded=true;}
    if(ny<-.3){b.landingImpact=Math.max(b.landingImpact||0,-closing);b.grounded=true;}
    for(const jelly of [a,b])if(!jelly.rigid&&!jelly.static){jelly.squashV+=Math.min(-closing/90,4);jelly.leanV+=nx*Math.min(-closing/180,2);}
  }
}
function beginMeal(eater,prey){
  eater.busy=true;prey.swallowedBy=eater;eater.faceX=(prey.x-eater.x)/Math.max(1,Math.hypot(prey.x-eater.x,prey.y-eater.y));eater.faceY=(prey.y-eater.y)/Math.max(1,Math.hypot(prey.x-eater.x,prey.y-eater.y));
  meals.push({eater,prey,x:prey.x,y:prey.y,r:prey.visualR,time:0});
  if(prey.hero){activePointer=null;lastPoint=null;}
}
function updateMeals(dt){
  for(let i=meals.length-1;i>=0;i--){const meal=meals[i];meal.time+=dt;const t=Math.min(1,meal.time/.65),ease=t*t*(3-2*t),mouth=mouthPosition(meal.eater);
    meal.prey.x=lerp(meal.x,mouth.x,ease);meal.prey.y=lerp(meal.y,mouth.y,ease);meal.prey.visualR=meal.r*Math.pow(1-t,1.2);
    if(t<1)continue;
    // Spherical volume is additive: r_new^3 = r_eater^3 + r_prey^3.
    meal.eater.r=Math.cbrt(meal.eater.r**3+meal.prey.r**3);meal.eater.units+=meal.prey.units;meal.eater.squashV+=1.8;meal.eater.busy=false;meal.prey.alive=false;meals.splice(i,1);
    if(meal.prey.hero){finish(false,'eaten');return;}
  }
}
function detonateContactBombs(){
  let detonated=false;
  for(const bomb of bombs)if(bomb.alive&&(bomb.contactDetonation||[...bodies(),...rocks,...hazards].some(b=>Math.hypot(b.x-bomb.x,b.y-bomb.y)<=b.r+bomb.r))){
    explodeBomb(bomb);detonated=true;
  }
  return detonated;
}
function simulate(dt){
  clockTime+=dt;
  detonateContactBombs();if(state==='lost')return;
  for(const rock of rigidBodies()){
    rock.landingImpact=0;rock.supported=false;if(rock.bomb&&!rock.grounded)rock.fallStartY=Math.min(rock.fallStartY,rock.y);
    rock.vy=Math.min(rock.vy+680*dt,420);rock.vx*=Math.exp(-AIR_DRAG*dt);rock.x+=rock.vx*dt;rock.y+=rock.vy*dt;collideTerrain(rock);rock.angle+=rock.vx*dt/rock.r;
  }
  for(const b of bodies()){
    b.landingImpact=0;b.supported=false;b.vy=Math.min(b.vy+540*dt,360);b.vx*=Math.exp(-AIR_DRAG*dt);
    b.x+=b.vx*dt;b.y+=b.vy*dt;collideTerrain(b);b.angle+=b.vx*dt/b.r;
    const stretch=b.grounded?.055:-Math.min(.2,Math.max(0,b.vy)/1700);
    b.squashV+=(-48*(b.squash-stretch)-4.8*b.squashV)*dt;b.squash=constrain(b.squash+b.squashV*dt,-.28,.55);
    const leanTarget=constrain(-b.vx/450,-.3,.3);
    b.leanV+=(-28*(b.lean-leanTarget)-4.5*b.leanV)*dt;b.lean=constrain(b.lean+b.leanV*dt,-.4,.4);
    b.visualR=lerp(b.visualR,b.r,1-Math.exp(-6*dt));
    let near=null,nearest=Infinity;
    if(!b.busy)for(const other of bodies()){if(other===b||other.r>=b.r-.15)continue;const d=Math.hypot(other.x-b.x,other.y-b.y);if(d<nearest){nearest=d;near=other;}}
    const open=b.busy?1:near?constrain(1-(nearest-b.r-near.r)/65,0,1):0;
    b.mouth=lerp(b.mouth,open,1-Math.exp(-13*dt));
    if(near&&!b.busy&&open>.05){b.faceX=(near.x-b.x)/Math.max(1,nearest);b.faceY=(near.y-b.y)/Math.max(1,nearest);}
  }
  detonateContactBombs();if(state==='lost')return;
  for(let iter=0;iter<3;iter++){
    const rigid=rigidBodies();for(let i=0;i<rigid.length;i++)for(let j=i+1;j<rigid.length;j++)collideRigid(rigid[i],rigid[j]);
    for(const rock of rigid)for(const emitter of hazards)collideRigid(rock,emitter);
    for(const b of bodies()){for(const rock of rigid)collideRigid(b,rock);for(const emitter of hazards)collideRigid(b,emitter);collideTerrain(b);}
    for(const rock of rigid)collideTerrain(rock);
    detonateContactBombs();if(state==='lost')return;
  }
  for(const body of [...rigidBodies(),...bodies()])applySurfaceFriction(body,dt);
  for(const bomb of bombs)if(bomb.alive){
    if(bomb.landingImpact>180&&bomb.y-bomb.fallStartY>=BOMB_DROP)explodeBomb(bomb);
    else if(bomb.landingImpact>0)bomb.fallStartY=bomb.y;
  }
  beams=hazards.map(traceLaser);
  if(state==='ready'||state==='playing')updateBees(dt);
  if(state!=='playing')return;
  if(!ball.swallowedBy&&beams.some(beam=>touchesBeam(ball,beam))){finish(false);return;}
  if(targets.some(t=>t.alive&&!t.swallowedBy&&beams.some(beam=>touchesBeam(t,beam)))){finish(false,'targetLaser');return;}
  const alive=bodies();
  for(let i=0;i<alive.length;i++)for(let j=i+1;j<alive.length;j++){
    const a=alive[i],b=alive[j];if(a.swallowedBy||b.swallowedBy)continue;
    const d=Math.hypot(a.x-b.x,a.y-b.y);if(d>a.r+b.r+3)continue;
    const eater=a.r>=b.r?a:b,prey=eater===a?b:a;
    if(eater.r-prey.r>.15&&!eater.busy&&!prey.busy)beginMeal(eater,prey);
    else if(d<a.r+b.r){const nx=d>.01?(b.x-a.x)/d:1,ny=d>.01?(b.y-a.y)/d:0,overlap=a.r+b.r-d;a.x-=nx*overlap*.5;a.y-=ny*overlap*.5;b.x+=nx*overlap*.5;b.y+=ny*overlap*.5;}
  }
  updateMeals(dt);if(state!=='playing')return;
  if(ball.units===targetTotal&&!meals.length){finish(true);return;}
  if(ball.y>H+30&&!ball.swallowedBy)finish(false,'fall');
  if(targets.some(t=>t.alive&&!t.swallowedBy&&t.y>H+60))finish(false,'escaped');
}
function explodeBomb(bomb){
  if(!bomb.alive)return;bomb.alive=false;
  const x=bomb.x,y=bomb.y;dig({x,y},{x,y},BOMB_BLAST);
  explosions.push({x,y,r:BOMB_BLAST,time:0});
  for(let i=0;i<26;i++){const a=random(TWO_PI),speed=random(32,115);particles.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:random(.3,.65),color:i%3?'#f7ae36':'#fff2ba',r:random(2,4)});}
  const inBlast=body=>Math.hypot(body.x-x,body.y-y)<=BOMB_BLAST+body.r;
  for(const body of [...rocks,...hazards])if(inBlast(body))for(let i=0;i<12;i++){
    const a=random(TWO_PI),speed=random(35,100);particles.push({x:body.x,y:body.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:random(.35,.7),color:body.static?'#427884':'#9a917b',r:random(2,4)});
  }
  rocks=rocks.filter(body=>!inBlast(body));hazards=hazards.filter(body=>!inBlast(body));beeNav=null;beeNavTimer=0;
  let killedHero=false,killedEnemy=false;
  for(const victim of [ball,...targets])if(victim.alive&&Math.hypot(victim.x-x,victim.y-y)<=BOMB_BLAST+victim.r){victim.alive=false;if(victim.hero)killedHero=true;else killedEnemy=true;}
  for(const nearby of bombs)if(nearby.alive&&Math.hypot(nearby.x-x,nearby.y-y)<=BOMB_BLAST+nearby.r)explodeBomb(nearby);
  if(killedHero||killedEnemy){meals=[];finish(false,killedHero?'bombHero':'bombEnemy');}
  beams=hazards.map(traceLaser);
}

function finish(win,reason='hazard'){
  state=win?'won':'lost';activePointer=null;lastPoint=null;
  const bombLoss=reason==='bombHero'||reason==='bombEnemy';resultWait=bombLoss?.55:0;
  document.querySelector('#result').hidden=resultWait>0;
  document.querySelector('#result-icon').textContent=win?'✦':bombLoss?'💥':reason==='bee'?'🐝':reason==='eaten'?'◉':'ϟ';
  const messages={
    eaten:['You got eaten!','Eat smaller balls first to grow before meeting a bigger one.'],
    hazard:['Hit by a laser!','Cheese and rocks block the beam. Leave a wall or put a rock in its path.'],
    targetLaser:['An enemy hit a laser!','Cheese and rocks block the beam. Leave a wall or put a rock in its path.'],
    bombHero:['Caught in an explosion!','Bombs explode on contact with balls, rocks, or lasers, or after a long fall.'],
    bombEnemy:['An enemy was caught in the blast!','Keep every green ball alive until you eat it to win.'],
    bee:['Stung by a bee!','Keep bee chambers sealed. Bees fly toward you through open passages.'],
    fall:['A ball fell out!','Leave some cheese beneath the balls to keep them from falling out.'],
    escaped:['A ball fell out!','Leave some cheese beneath the balls to keep them from falling out.']
  };
  const [title,copy]=win?['A tasty victory!','All green balls eaten. Look how much you have grown!']:messages[reason];
  document.querySelector('#result-title').textContent=title;document.querySelector('#result-copy').textContent=copy;
  document.querySelector('#again').textContent=editorTesting?'Back to editor':win?'Next level':'Try again';
}
function draw(){
  if(editorMode){drawEditorScene();return;}
  background('#c9f4e6');
  noStroke();fill('#ffffff30');for(let i=0;i<8;i++)circle((i*73+20)%W,(i*139+40)%H,80);
  const dt=Math.min(deltaTime/1000,.05);
  if(!document.hidden&&!document.getElementById('game-levels').open&&!document.getElementById('game-menu').open&&(state==='playing'||state==='ready')){accumulator+=dt;while(accumulator>=1/120&&(state==='playing'||state==='ready')){simulate(1/120);accumulator-=1/120;}}
  else if(!document.hidden){clockTime+=dt;for(const b of bodies()){b.visualR=lerp(b.visualR,b.r,1-Math.exp(-6*dt));b.squashV+=(-48*(b.squash-.055)-4.8*b.squashV)*dt;b.squash=constrain(b.squash+b.squashV*dt,-.28,.55);}}
  if(resultWait>0){resultWait=Math.max(0,resultWait-dt);if(resultWait===0)document.querySelector('#result').hidden=false;}
  image(terrain,0,0);
  for(const beam of beams)drawLaser(beam);
  for(const rock of rocks)drawRock(rock);
  for(const bomb of bombs)if(bomb.alive)drawBomb(bomb);
  for(const bee of bees)if(bee.alive)drawBee(bee);
  for(const b of bodies()){fill('#43776120');ellipse(b.x,b.y+b.r+2,b.r*1.7,5);}
  for(const t of targets)if(t.alive&&!t.swallowedBy)drawCreature(t);
  if(ball.alive&&!ball.swallowedBy)drawCreature(ball);
  // Prey is drawn last so it visibly shrinks into the eater's open mouth.
  for(const meal of meals)drawCreature(meal.prey);
  for(let i=explosions.length-1;i>=0;i--){const blast=explosions[i];blast.time+=dt;drawExplosion(blast);if(blast.time>.85)explosions.splice(i,1);}
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.vy+=360*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;fill(p.color);circle(p.x,p.y,p.r*2);if(p.life<=0)particles.splice(i,1);}
}
function drawCreature(b){
  const r=b.visualR;if(r<.2)return;
  const {sx,sy,offset}=jellyShape(b);
  const danger=!b.hero&&b.r>ball.r+.15;
  push();translate(b.x,b.y+offset);scale(sx,sy);applyMatrix(1,0,b.lean,1,0,0);
  stroke(b.hero?'#167656':danger?'#65742f':'#376f42');strokeWeight(Math.min(2.5,r*.12));fill(b.hero?'#69d58d':danger?'#94af50':'#62aa65');
  beginShape();for(let i=-1;i<=33;i++){const a=i*TWO_PI/32,wobble=1+Math.sin(a*3+clockTime*4+b.phase+b.angle)*(.025+Math.abs(b.squash)*.12)+Math.sin(a*2-clockTime*3+b.phase)*Math.abs(b.lean)*.06;curveVertex(Math.cos(a)*r*wobble,Math.sin(a)*r*wobble);}endShape(CLOSE);
  noStroke();fill(b.hero?'#b9ffb866':'#d7efa044');ellipse(-r*.28,-r*.4,r*.95,r*.55);fill('#ffffff99');ellipse(-r*.35,-r*.5,r*.25,r*.12);
  // The face stays readable while the jelly skin rolls and ripples.
  const gaze=constrain(b.faceX,-1,1)*r*.12;
  fill('#fffef0');ellipse(-r*.15,-r*.24,r*.88,r*.93);fill('#263d31');ellipse(-r*.1+gaze,-r*.2,r*.45,r*.52);fill('white');circle(-r*.17+gaze,-r*.3,r*.14);
  const mx=b.faceX*r*.28,my=r*.34+b.faceY*r*.15;
  if(b.mouth>.07){fill('#254936');ellipse(mx,my,r*(.35+b.mouth*.6),r*(.09+b.mouth*.66));fill('#df8f98');ellipse(mx,my+r*b.mouth*.2,r*.36,r*b.mouth*.18);fill('#f6ffe7');ellipse(mx,my-r*b.mouth*.22,r*.28,r*.1);}
  else{noFill();stroke('#2d6744');strokeWeight(Math.min(2,r*.1));arc(mx,my,r*.48,r*.27,0,PI);}
  pop();
}
function drawBomb(bomb){
  push();translate(bomb.x,bomb.y);rotate(bomb.angle);stroke('#273132');strokeWeight(2);fill(bomb.vy>200?'#794232':'#3e4b4c');circle(0,0,bomb.r*2);noStroke();fill('#718181');ellipse(-4,-5,10,6);fill('#c18a48');rect(-4,-bomb.r-3,8,5,2);noFill();stroke('#77543b');strokeWeight(2.5);bezier(0,-bomb.r-2,1,-bomb.r-11,9,-bomb.r-11,8,-bomb.r-6);noStroke();fill('#ffc859');circle(8,-bomb.r-6,4+Math.sin(clockTime*11));fill('#ff97344d');circle(8,-bomb.r-6,10);pop();
}
function drawBee(bee){
  push();translate(bee.x,bee.y);const moving=Math.hypot(bee.vx,bee.vy)>3;rotate(moving?Math.atan2(bee.vy,bee.vx):Math.atan2(ball.y-bee.y,ball.x-bee.x));
  noStroke();fill('#ffffffc9');const flap=1+Math.sin(clockTime*65+bee.phase)*.45;ellipse(-1,-3.4,5,5*flap);ellipse(-1,3.4,5,5*flap);
  stroke('#5b4d27');strokeWeight(.8);fill('#f9c54b');ellipse(0,0,8.5,5.8);noStroke();fill('#4b4735');rect(-2,-2.5,1.7,5);rect(.7,-2.5,1.5,5);fill('#fffcef');circle(3,-.7,2.3);fill('#303f32');circle(3.4,-.6,1.2);fill('#5b4d27');triangle(-4,-1,-6,0,-4,1);stroke('#5b4d27');strokeWeight(.7);line(3,-2.1,4.8,-3.8);pop();
}
function drawExplosion(blast){
  const t=constrain(blast.time/.85,0,1),radius=blast.r*(1-Math.pow(1-t,3));
  noStroke();fill(255,205,94,(1-t)*45);circle(blast.x,blast.y,radius*2);
  noFill();stroke(255,170,48,(1-t)*230);strokeWeight(5*(1-t)+1);circle(blast.x,blast.y,radius*2);
  stroke(255,245,191,(1-t)*210);strokeWeight(2);circle(blast.x,blast.y,radius*1.68);
  if(t<.18){noStroke();fill(255,245,192,(1-t/.18)*210);circle(blast.x,blast.y,blast.r*(.6+t));}
}
function drawLaser(beam){
  const h=beam.emitter;
  if(beam.length>0){for(const [weight,color] of [[13,'#f66db82a'],[7,'#ff6cba80'],[3,'#fa67b8'],[1.2,'#fff9ff']]){stroke(color);strokeWeight(weight);line(beam.ox,beam.oy,beam.ex,beam.ey);}
    noStroke();fill('#fff3fa');circle(beam.ex,beam.ey,3+Math.sin(clockTime*18));fill('#ff80bb55');circle(beam.ex,beam.ey,9);
  }
  push();translate(h.x,h.y);rotate(Math.atan2(h.dy,h.dx));rectMode(CENTER);stroke('#244b60');strokeWeight(2);fill('#497b88');rect(0,0,24,30,5);noStroke();fill('#85bdc2');rect(-3,-8,13,4,2);fill('#244b60');rect(12,0,8,17,2);fill('#ef78ad');rect(16,0,3,12,1);fill('#c1e5dd');circle(-6,7,3);circle(3,7,3);pop();
}
function drawRock(rock){
  push();translate(rock.x,rock.y);rotate(rock.angle);stroke('#68635b');strokeWeight(2.5);fill('#a49c86');beginShape();for(let i=0;i<14;i++){const a=i*TWO_PI/14,r=rock.r*(.96+.04*Math.sin(i*5+rock.seed));vertex(Math.cos(a)*r,Math.sin(a)*r);}endShape(CLOSE);
  noStroke();fill('#c9c0a3');beginShape();vertex(-rock.r*.65,-rock.r*.4);vertex(-rock.r*.1,-rock.r*.8);vertex(rock.r*.4,-rock.r*.5);vertex(0,0);endShape(CLOSE);fill('#857d6a');triangle(0,0,rock.r*.7,-rock.r*.1,rock.r*.3,rock.r*.65);stroke('#777161');strokeWeight(1.5);line(-rock.r*.55,rock.r*.2,-rock.r*.1,rock.r*.1);line(-rock.r*.1,rock.r*.1,rock.r*.1,rock.r*.3);pop();
}
