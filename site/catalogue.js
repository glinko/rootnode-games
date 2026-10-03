'use strict';
(async()=>{
  try{
    const response=await fetch('/games.json',{cache:'no-store'});if(!response.ok)throw Error();
    const games=await response.json();if(!Array.isArray(games))throw Error();
    for(const game of games){
      if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(game.slug))continue;
      const card=document.createElement('a');card.className='game';card.href='/'+game.slug+'/';card.setAttribute('aria-label','Играть в '+game.title);
      const image=document.createElement('img');image.className='art';image.src='/'+game.slug+'/'+game.cover;image.alt=game.title;image.loading='lazy';
      const body=document.createElement('div');body.className='description';
      const tag=document.createElement('span');tag.className='tag';tag.textContent=game.category+' · '+game.platform;
      const title=document.createElement('h2');title.textContent=game.title;
      const description=document.createElement('p');description.textContent=game.description;
      const play=document.createElement('span');play.className='play';play.textContent='▶ Играть';
      body.append(tag,title,description,play);card.append(image,body);document.getElementById('games').append(card);
    }
  }catch{document.getElementById('catalogue-error').hidden=false;}
})();
