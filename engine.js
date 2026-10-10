// LUDO rules engine - shared by browser and server (pure, JSON state)
(function(root){
'use strict';
const START=[0,13,26,39];                 // abs start index per colour: 0 red,1 green,2 yellow,3 blue
const SAFE=[0,8,13,21,26,34,39,47];       // start squares + stars (abs index)
const FINISH=56;
// main track (col,row) on 15x15 grid, clockwise from red start
const PATH=[];
(function(){const a=(c,r)=>PATH.push([c,r]);
 for(let x=1;x<=5;x++)a(x,6);for(let y=5;y>=0;y--)a(6,y);a(7,0);for(let y=0;y<=5;y++)a(8,y);
 for(let x=9;x<=14;x++)a(x,6);a(14,7);for(let x=14;x>=9;x--)a(x,8);for(let y=9;y<=14;y++)a(8,y);
 a(7,14);for(let y=14;y>=9;y--)a(6,y);for(let x=5;x>=0;x--)a(x,8);a(0,7);a(0,6);})();
const COLORS=['red','green','yellow','blue'];
const PREF=[3,1,0,2];                      // colour order when seats are handed out
function colorSet(n){return n===2?[1,3]:n===3?[0,1,3]:[0,1,2,3]}
function absOf(color,rel){return (START[color]+rel)%52}
function tileOf(color,rel){ // returns [col,row] for rel 0..55 (track + home column)
 if(rel<=50)return PATH[absOf(color,rel)];
 const k=rel-50; // 1..5
 if(color===0)return [k,7]; if(color===1)return [7,k]; if(color===2)return [14-k,7]; return [7,14-k];
}
function newGame(players,rng){ // players: [{color,name,kind}] sorted by colour
 const ps=players.slice().sort((a,b)=>a.color-b.color).map(p=>({color:p.color,name:p.name||COLORS[p.color],kind:p.kind||'human'}));
 return {players:ps,pos:ps.map(()=>[-1,-1,-1,-1]),turn:0,phase:'roll',dice:0,sixes:0,legal:[],ranks:[],over:false};
}
function legalMoves(s){
 const p=s.pos[s.turn],d=s.dice,out=[];
 for(let i=0;i<4;i++){const q=p[i];
  if(q===-1){if(d===6)out.push(i)}
  else if(q<FINISH&&q+d<=FINISH)out.push(i);}
 return out;
}
function nextSeat(s){
 const n=s.players.length;let t=s.turn;
 for(let k=0;k<n;k++){t=(t+1)%n;if(!s.ranks.includes(t))return t}
 return s.turn;
}
function endTurn(s,ev,again){
 s.sixes=again?s.sixes:0;
 if(!again)s.turn=nextSeat(s);
 s.dice=0;s.legal=[];s.phase='roll';
 ev.push({e:'turn',seat:s.turn,again:!!again});
}
function applyRoll(s,v,ev){
 ev=ev||[];
 if(s.over||s.phase!=='roll')return ev;
 s.dice=v;ev.push({e:'roll',seat:s.turn,v});
 if(v===6){s.sixes++;if(s.sixes>=3){ev.push({e:'triple',seat:s.turn});endTurn(s,ev,false);return ev}}
 s.legal=legalMoves(s);
 if(!s.legal.length){ev.push({e:'nomove',seat:s.turn});endTurn(s,ev,v===6);return ev}
 s.phase='move';return ev;
}
function threatened(s,seat,abs){ // how many opponent pieces sit 1..6 squares behind abs on the main track
 let c=0;
 s.players.forEach((pl,o)=>{if(o===seat)return;s.pos[o].forEach(q=>{if(q>=0&&q<=50){const d=(abs-absOf(pl.color,q)+52)%52;if(d>=1&&d<=6)c++}})});
 return c;
}
function applyMove(s,i,ev){
 ev=ev||[];
 if(s.over||s.phase!=='move'||!s.legal.includes(i))return ev;
 const seat=s.turn,me=s.players[seat],from=s.pos[seat][i],to=from===-1?0:from+s.dice;
 s.pos[seat][i]=to;ev.push({e:'move',seat,i,from,to});
 let bonus=s.dice===6;
 if(to<=50){const ab=absOf(me.color,to);
  if(!SAFE.includes(ab)){
   s.players.forEach((pl,o)=>{if(o===seat)return;s.pos[o].forEach((q,j)=>{if(q>=0&&q<=50&&absOf(pl.color,q)===ab){s.pos[o][j]=-1;ev.push({e:'capture',seat:o,i:j,by:seat});bonus=true}})});
  }}
 if(to===FINISH){bonus=true;ev.push({e:'home',seat,i});
  if(s.pos[seat].every(q=>q===FINISH)){s.ranks.push(seat);ev.push({e:'win',seat,rank:s.ranks.length});
   if(s.ranks.length>=s.players.length-1){const last=s.players.findIndex((_,k)=>!s.ranks.includes(k));if(last>=0)s.ranks.push(last);s.over=true;s.phase='over';ev.push({e:'over',ranks:s.ranks.slice()});return ev}
   bonus=false;}}
 endTurn(s,ev,bonus&&!s.ranks.includes(seat));
 return ev;
}
// ---- bot ----
function chooseMove(s,level,rng){
 rng=rng||Math.random;const seat=s.turn,me=s.players[seat];
 const opts=s.legal.slice();if(level==='easy')return opts[(rng()*opts.length)|0];
 let best=-1e9,pick=opts[0];
 opts.forEach(i=>{const from=s.pos[seat][i],to=from===-1?0:from+s.dice;let sc=to*0.3+(rng()*3);
  if(to===FINISH)sc+=100;
  if(from===-1)sc+=45;
  if(to>50){sc+=20;}
  else{const ab=absOf(me.color,to);
   if(SAFE.includes(ab))sc+=25;
   s.players.forEach((pl,o)=>{if(o===seat)return;s.pos[o].forEach(q=>{if(q>=0&&q<=50&&absOf(pl.color,q)===ab&&!SAFE.includes(ab))sc+=90+to*0.5})});
   if(!SAFE.includes(ab))sc-=threatened(s,seat,ab)*28;}
  if(from>=0&&from<=50){const fa=absOf(me.color,from);if(!SAFE.includes(fa)&&threatened(s,seat,fa))sc+=(level==='hard'?30:18);}
  if(sc>best){best=sc;pick=i}});
 return pick;
}
function rollDie(rng){return 1+(((rng||Math.random)()*6)|0)}
const API={START,SAFE,FINISH,PATH,COLORS,PREF,colorSet,absOf,tileOf,newGame,legalMoves,applyRoll,applyMove,chooseMove,rollDie,nextSeat};
if(typeof module!=='undefined')module.exports=API;else root.LudoEngine=API;
})(typeof window!=='undefined'?window:this);
