import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { io } from "socket.io-client";

// ==========================================
// KONFIGURACJA SERWERA ONLINE
// ==========================================
const SERVER_URL = "https://beki-server.onrender.com"; 
let socket = null;

const FW=22,FD=16,FH=5,GW=5.0,GH=2.6,GD=1.2,BR=0.32,PR=0.46;
const hw=FW/2,hd=FD/2;
const BUMP_R=1.0;
const BUMPERS=[[-hw+2.5,0],[hw-2.5,0]];
const BOT_CFG={
  nowicjusz:   {spd: 3.5, pred: 0.0, kickR: 1.0, reactDelay: 0.60, jumpP: 0.00},
  sredni:      {spd: 6.0, pred: 0.3, kickR: 1.5, reactDelay: 0.20, jumpP: 0.15},
  zaawansowany:{spd: 8.5, pred: 0.6, kickR: 2.0, reactDelay: 0.05, jumpP: 0.50},
  hardcore:    {spd:11.0, pred: 0.9, kickR: 2.8, reactDelay: 0.00, jumpP: 0.85},
};

const DASH_DURATION=0.18,DASH_SPEED=22,DASH_COOLDOWN=2.2;
const CONTACT_STIFFNESS=420,CONTACT_DAMPING=18,BALL_MASS=1.0,PLAYER_MASS=2.5;

// ==========================================
// TŁUMACZENIA (i18n)
// ==========================================
const i18n = {
  en: {
    playBot: "▶ Play vs Bot", playLocal: "▶ Local Multiplayer",
    playOnlineCreate: "🌐 Create ONLINE Game", playOnlineJoin: "🌐 Join ONLINE Game",
    botDiff: "Bot Difficulty", players: "Format:",
    nowicjusz: "Novice", sredni: "Medium", zaawansowany: "Advanced", hardcore: "Hardcore",
    controls: "Controls", mouseKbd: "Mouse (PC)", kbdOnly: "Keyboard / Touch",
    color: "Your Color:", limit: "Play to:", goals: "Goals",
    joinCode: "Room Code", joinBtn: "JOIN", backBtn: "Back", cancel: "Cancel",
    controlsMapMouse: [['WASD','Move'],['Mouse','Aim'],['LMB (Tap)','Flick (Lob)'],['LMB (Hold)','Straight Power Shot'],['RMB (Hold+Swipe)','Curve Shot'],['Space','Jump'],['Shift','Sprint']],
    controlsMapKbd: [['WASD','Move'],['F (Tap)','Flick (Lob)'],['F (Hold)','Straight Power Shot'],['Q (Hold) + A/D','Curve Shot'],['Space','Jump'],['Shift','Sprint']],
    waitOpponent: "Waiting for players...", giveCode: "Give this code to the players:",
    offlineErr: "Servers are offline - please try again later!",
    leave: "← Leave", host: "You (Host)", client: "You (Joined)", opponent: "Opponent",
    p1: "Player 1", p2: "Player 2", p3: "Player 3", p4: "Player 4", bot: "Bot",
    dashReady: "Dash Ready!", dashWait: "Dash",
    gameOver: "Game Over!", rematch: "🔁 Rematch",
    winnerYou: "You Won!", loserYou: "You Lost!", winnerOpp: "Opponent Wins!",
    winnerTeamA: "Blue Team Wins!", winnerTeamB: "Red Team Wins!",
    chatPlaceholder: "Type a message...",
    p2LocalHint: "* P2 (Local): Arrows + Num0(Shoot), Num1(Curve), Num2(Flick), RShift(Jump), Enter(Dash)"
  },
  pl: {
    playBot: "▶ Gra vs Bot", playLocal: "▶ Lokalny multiplayer",
    playOnlineCreate: "🌐 Stwórz grę ONLINE", playOnlineJoin: "🌐 Dołącz do gry ONLINE",
    botDiff: "Trudność bota", players: "Format:",
    nowicjusz: "Nowicjusz", sredni: "Średni", zaawansowany: "Zaawansowany", hardcore: "Hardcore",
    controls: "Sterowanie", mouseKbd: "Myszka (PC)", kbdOnly: "Klawiatura / Dotyk",
    color: "Twój kolor:", limit: "Graj do:", goals: "Goli",
    joinCode: "Kod pokoju", joinBtn: "DOŁĄCZ", backBtn: "Wróć", cancel: "Anuluj",
    controlsMapMouse: [['WASD','Ruch'],['Myszka','Celowanie'],['LPM (Klik)','Krótka podcinka'],['LPM (Trzymaj)','Prosty Strzał'],['PPM (Trzym.+Machnij)','Podkręcony Strzał'],['Spacja','Skok'],['Shift','Sprint']],
    controlsMapKbd: [['WASD','Ruch'],['F (Klik)','Krótka podcinka'],['F (Trzymaj)','Prosty Strzał'],['Q (Trzymaj) + A/D','Podkręcony Strzał'],['Spacja','Skok'],['Shift','Sprint']],
    waitOpponent: "Oczekiwanie na graczy...", giveCode: "Podaj ten kod graczom:",
    offlineErr: "Serwery są offline - spróbuj za chwilę!",
    leave: "← Wyjdź", host: "Ty (Host)", client: "Ty (Dołączyłeś)", opponent: "Przeciwnik",
    p1: "Gracz 1", p2: "Gracz 2", p3: "Gracz 3", p4: "Gracz 4", bot: "Bot",
    dashReady: "Sprint Gotowy!", dashWait: "Sprint",
    gameOver: "Koniec meczu!", rematch: "🔁 Rewanż",
    winnerYou: "Wygrałeś!", loserYou: "Przegrałeś!", winnerOpp: "Przeciwnik Wygrywa!",
    winnerTeamA: "Drużyna 1 Wygrywa!", winnerTeamB: "Drużyna 2 Wygrywa!",
    chatPlaceholder: "Napisz wiadomość...",
    p2LocalHint: "* P2 (Lokalnie): Strzałki + Num0(Strzał), Num1(Rogal), Num2(Podcinka), RShift(Skok), Enter(Sprint)"
  }
};

function Menu({onStart, lang, setLang}){
  const t = i18n[lang];
  const [diff,setDiff]=useState('sredni');
  const [controls, setControls] = useState('mouse'); 
  const [playerColor, setPlayerColor] = useState('#00dd55'); 
  const [scoreLimit, setScoreLimit] = useState(5); 
  const [is2v2, setIs2v2] = useState(false);
  const [hov,setHov]=useState(null);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  
  const [isWaiting, setIsWaiting] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [role, setRole] = useState("p1");
  const [lobbyStatus, setLobbyStatus] = useState({ joined: 1, max: 1 });

  useEffect(() => {
    if (!socket) socket = io(SERVER_URL);
    socket.on('roomCreated', (data) => { setRoomId(data.roomId); setRole(data.role); setIsWaiting(true); setLobbyStatus({joined:1, max: is2v2?4:2}); });
    socket.on('joinedRoom', (data) => { setRoomId(data.roomId); setRole(data.role); });
    socket.on('lobbyUpdate', (data) => { setLobbyStatus(data); });
    socket.on('gameStarted', (data) => { 
      const limit = data?.limit || scoreLimit;
      const remote2v2 = data?.is2v2 || false;
      onStart({ mode: isWaiting ? 'online-host' : 'online-client', role, roomId: roomId || joinCode, controls, difficulty: diff, playerColor, scoreLimit: limit, is2v2: isWaiting ? is2v2 : remote2v2 }); 
    });
    socket.on('errorMsg', (msg) => { alert(msg); setIsWaiting(false); });
    return () => { socket.off('roomCreated'); socket.off('joinedRoom'); socket.off('lobbyUpdate'); socket.off('gameStarted'); socket.off('errorMsg'); };
  }, [isWaiting, joinCode, onStart, roomId, role, controls, diff, playerColor, scoreLimit, is2v2]);

  const handleCreateOnline = () => { if (!socket || !socket.connected) return alert(t.offlineErr); socket.emit('createRoom', {limit: scoreLimit, is2v2}); };
  const handleJoinOnline = () => { if (!socket || !socket.connected) return alert(t.offlineErr); if(joinCode) socket.emit('joinRoom', { roomId: joinCode }); };

  if (isWaiting) return (
    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'#e8e8e8',display:'flex',justifyContent:'center',alignItems:'center',fontFamily:'Tahoma,Geneva,sans-serif'}}>
      <div style={{background:'#fff',padding:40,textAlign:'center',boxShadow:'0 2px 12px rgba(0,0,0,0.12)', borderRadius:8}}>
        <h2>{t.waitOpponent} <span style={{color:'#9b1c9b'}}>{lobbyStatus.joined}/{lobbyStatus.max}</span></h2>
        <p>{t.giveCode}</p>
        <h1 style={{fontSize:48, letterSpacing:4, color:'#cc2200'}}>{roomId}</h1>
        <button onClick={()=>{setIsWaiting(false); socket.disconnect(); socket=null;}} style={{marginTop:20, padding:'8px 16px', cursor:'pointer', border:'1px solid #aaa', background:'#eee', borderRadius:4}}>{t.cancel}</button>
      </div>
    </div>
  );

  return(
    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'#e8e8e8',fontFamily:'Tahoma,Geneva,sans-serif', overflow:'auto'}}>
      <div style={{position:'absolute', top: 20, right: 20, display:'flex', gap: 8}}>
        <button onClick={()=>setLang('en')} style={{fontWeight: lang==='en'?'bold':'normal', padding:'4px 8px', cursor:'pointer', background:lang==='en'?'#333':'#fff', color:lang==='en'?'#fff':'#333', border:'1px solid #ccc', borderRadius:4}}>EN</button>
        <button onClick={()=>setLang('pl')} style={{fontWeight: lang==='pl'?'bold':'normal', padding:'4px 8px', cursor:'pointer', background:lang==='pl'?'#333':'#fff', color:lang==='pl'?'#fff':'#333', border:'1px solid #ccc', borderRadius:4}}>PL</button>
      </div>

      <div style={{position:'absolute', top:'50%',left:'50%', transform:'translate(-50%,-50%)', width:'90%', maxWidth: 520, background:'#fff', border:'1px solid #bbb', padding:'30px 40px', boxShadow:'0 2px 12px rgba(0,0,0,0.12)', borderRadius:12}}>
        <div style={{textAlign:'center',marginBottom:28}}><div style={{fontSize:52,fontWeight:'bold',color:'#111',lineHeight:1,letterSpacing:2}}>Beki.io</div></div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom: 20}}>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            <span style={{fontSize:11,color:'#999',textTransform:'uppercase',letterSpacing:1}}>{t.color}</span>
            <input type="color" value={playerColor} onChange={(e) => setPlayerColor(e.target.value)} style={{cursor: 'pointer', border: '1px solid #aaa', width: '100%', height: 36, padding: 0, background: 'none', borderRadius:4}} />
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            <span style={{fontSize:11,color:'#999',textTransform:'uppercase',letterSpacing:1}}>{t.limit}</span>
            <select value={scoreLimit} onChange={(e)=>setScoreLimit(Number(e.target.value))} style={{height:36, padding:'0 10px', fontSize:14, border:'1px solid #aaa', borderRadius:4}}>
              <option value={3}>3 {t.goals}</option><option value={5}>5 {t.goals}</option><option value={10}>10 {t.goals}</option>
            </select>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            <span style={{fontSize:11,color:'#999',textTransform:'uppercase',letterSpacing:1}}>{t.players}</span>
            <select value={is2v2 ? '2v2' : '1v1'} onChange={(e)=>setIs2v2(e.target.value === '2v2')} style={{height:36, padding:'0 10px', fontSize:14, border:'1px solid #aaa', borderRadius:4, fontWeight:'bold'}}>
              <option value="1v1">1 vs 1</option><option value="2v2">2 vs 2</option>
            </select>
          </div>
        </div>

        <div style={{marginBottom: 20}}>
          <div style={{fontSize:11,color:'#999',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>{t.botDiff}</div>
          <div style={{display:'flex', borderRadius:4, overflow:'hidden', border:'1px solid #ccc'}}>
            {['nowicjusz','sredni','zaawansowany','hardcore'].map((d,i)=>(
              <button key={d} onClick={()=>setDiff(d)} style={{ flex:1,padding:'6px 0',fontSize:10,fontFamily:'inherit',cursor:'pointer', fontWeight:diff===d?'bold':'normal', background:diff===d?'#333':'#fff', color:diff===d?'#fff':'#555', border:'none', borderRight:i<3?'1px solid #ccc':'none', transition:'all 0.1s' }}>{t[d]}</button>
            ))}
          </div>
        </div>

        <div style={{marginBottom: 20}}>
          <div style={{fontSize:11,color:'#999',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>{t.controls}</div>
          <div style={{display:'flex', borderRadius:4, overflow:'hidden', border:'1px solid #ccc'}}>
            {[['mouse', t.mouseKbd],['keyboard', t.kbdOnly]].map(([c,label])=>(
              <button key={c} onClick={()=>setControls(c)} style={{flex:1,padding:'10px 0',fontSize:12,fontFamily:'inherit',cursor:'pointer', fontWeight:controls===c?'bold':'normal', background:controls===c?'#333':'#fff', color:controls===c?'#fff':'#555', border:'none', transition:'all 0.1s' }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{borderTop:'1px solid #eee',marginBottom:20}}/>

        {!showJoin ? (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
            {[ {id:'bot',label:t.playBot,color:'#2a7a2a',onClick:()=>onStart({mode:'bot',difficulty:diff,controls,playerColor,scoreLimit,is2v2,role:'p1'})}, 
               {id:'multi',label:t.playLocal,color:'#1a44bb',onClick:()=>onStart({mode:'multi',difficulty:diff,controls,playerColor,scoreLimit,is2v2,role:'p1'})}, 
               {id:'online_create',label:t.playOnlineCreate,color:'#9b1c9b',onClick:handleCreateOnline}, 
               {id:'online_join',label:t.playOnlineJoin,color:'#9b1c9b',onClick:()=>setShowJoin(true)}
            ].map(({id,label,color,onClick})=>(
              <button key={id} onMouseEnter={()=>setHov(id)} onMouseLeave={()=>setHov(null)} onClick={onClick} style={{width:'100%',padding:'11px 0',fontSize:13,fontWeight:'bold',fontFamily:'inherit',cursor:'pointer',border:`2px solid ${color}`, borderRadius:6, background:hov===id?color:'#fff',color:hov===id?'#fff':color, transition:'all 0.1s'}}>{label}</button>
            ))}
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:28}}>
            <input placeholder={t.joinCode} value={joinCode} onChange={(e)=>setJoinCode(e.target.value)} style={{padding:10, fontSize:18, textAlign:'center', textTransform:'uppercase', borderRadius:4, border:'1px solid #999'}} maxLength={4} />
            <button onClick={handleJoinOnline} style={{padding:'10px', background:'#9b1c9b', color:'#fff', fontWeight:'bold', border:'none', borderRadius:4, cursor:'pointer'}}>{t.joinBtn}</button>
            <button onClick={()=>setShowJoin(false)} style={{padding:'10px', background:'#eee', color:'#333', border:'1px solid #ccc', borderRadius:4, cursor:'pointer'}}>{t.backBtn}</button>
          </div>
        )}

        <div style={{borderTop:'1px solid #eee',marginBottom:16}}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'5px 32px', marginBottom:8}}>
          {(controls === 'mouse' ? t.controlsMapMouse : t.controlsMapKbd).map(([k,v])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0',borderBottom:'1px solid #f5f5f5'}}>
              <span style={{fontWeight:'bold',color:'#222'}}>{k}</span> <span style={{color:'#999',textAlign:'right'}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{fontSize:10, color:'#888', textAlign:'center'}}>{t.p2LocalHint}</div>
      </div>
    </div>
  );
}

function Game({mode, difficulty, roomId, role, controls, playerColor, scoreLimit, is2v2, onBack, lang}){
  const t = i18n[lang];
  const mountRef=useRef(null);
  const scoreRef=useRef(null);
  const msgRef=useRef(null);
  const chargeRef=useRef(null);
  const dashBarRef=useRef(null);
  const dashLblRef=useRef(null);
  
  const [gameOver, setGameOver] = useState(null); 
  const [isMobile, setIsMobile] = useState(false);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const isTyping = useRef(false);

  const touchInputs = useRef({ mx: 0, mz: 0, aimX: 0, aimZ: 1, chargeStraight: false, chargeCurve: false, jump: false, dash: false, spinCharge: 0 });
  const rightStickBase = useRef({ x: 0, y: 0 });
  const rightStickCurrent = useRef({ x: 0, y: 0 });

  useEffect(()=>{
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);

    const mount=mountRef.current; if(!mount) return;
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x06090f);
    const W=mount.clientWidth,H=mount.clientHeight;
    
    const camera=new THREE.PerspectiveCamera(58,W/H,0.1,300);
    const baseCamPos = new THREE.Vector3(0, 23, 21);
    camera.position.copy(baseCamPos); 
    camera.lookAt(0,0,0);
    let shakeTime = 0, shakeIntensity = 0;
    renderer.setSize(W,H);

    scene.add(new THREE.AmbientLight(0x1a2d44,1.6));
    const sun=new THREE.DirectionalLight(0xffffff,1.1);
    sun.position.set(4,24,10); sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.left=-18; sun.shadow.camera.right=18;
    sun.shadow.camera.top=14; sun.shadow.camera.bottom=-14; sun.shadow.camera.far=60;
    scene.add(sun);
    const bL=new THREE.PointLight(0x2255ff,3,24); bL.position.set(0,4,-8); scene.add(bL);
    const rL=new THREE.PointLight(0xff2211,3,24); rL.position.set(0,4,8); scene.add(rL);
    const tL=new THREE.PointLight(0xffffff,0.8,30); tL.position.set(0,12,0); scene.add(tL);

    const fl=new THREE.Mesh(new THREE.PlaneGeometry(FW,FD),new THREE.MeshLambertMaterial({color:0x1a6035}));
    fl.rotation.x=-Math.PI/2; fl.receiveShadow=true; scene.add(fl);
    for(let i=0;i<4;i++){
      const s=new THREE.Mesh(new THREE.PlaneGeometry(FW,FD/8),new THREE.MeshLambertMaterial({color:0x175c30}));
      s.rotation.x=-Math.PI/2; s.position.set(0,0.001,-hd+FD/16+i*(FD/4)); scene.add(s);
    }
    const lm=new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.5});
    const lmB=new THREE.LineBasicMaterial({color:0x44aaff,transparent:true,opacity:1.0});
    const addLine=(mat,...pts)=>scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x,z])=>new THREE.Vector3(x,0.04,z))),mat));
    addLine(lm,[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd],[-hw,-hd]); addLine(lmB,[-hw,0],[hw,0]);
    for(let i=0;i<=64;i++){const a0=(i-1)/64*Math.PI*2,a1=i/64*Math.PI*2;addLine(lm,[Math.cos(a0)*3.5,Math.sin(a0)*3.5],[Math.cos(a1)*3.5,Math.sin(a1)*3.5]);}
    addLine(lm,[-3.2,-hd],[-3.2,-hd+2.5],[3.2,-hd+2.5],[3.2,-hd]); addLine(lm,[-3.2,hd],[-3.2,hd-2.5],[3.2,hd-2.5],[3.2,hd]);
    const midPlane=new THREE.Mesh(new THREE.PlaneGeometry(FW,0.12),new THREE.MeshBasicMaterial({color:0x1144cc,transparent:true,opacity:0.4}));
    midPlane.rotation.x=-Math.PI/2; midPlane.position.y=0.05; scene.add(midPlane);

    const bumpMat=new THREE.MeshPhongMaterial({color:0xffaa00,shininess:160,emissive:0x442200});
    BUMPERS.forEach(([bx,bz])=>{
      const bm=new THREE.Mesh(new THREE.SphereGeometry(BUMP_R,24,18),bumpMat.clone()); bm.scale.set(1,0.55,1); bm.position.set(bx,0,bz); bm.castShadow=true; scene.add(bm);
      const glow=new THREE.Mesh(new THREE.SphereGeometry(BUMP_R*1.4,20,14),new THREE.MeshBasicMaterial({color:0xff8800,transparent:true,opacity:0.18,side:THREE.BackSide})); glow.scale.set(1,0.55,1); glow.position.set(bx,0,bz); scene.add(glow);
      const ring=new THREE.Mesh(new THREE.RingGeometry(BUMP_R,BUMP_R+0.25,32),new THREE.MeshBasicMaterial({color:0xffcc44,side:THREE.DoubleSide,transparent:true,opacity:0.6})); ring.rotation.x=-Math.PI/2; ring.position.set(bx,0.06,bz); scene.add(ring);
      const pillar=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,FH*0.5,8),new THREE.MeshPhongMaterial({color:0xffaa00,emissive:0x331100})); pillar.position.set(bx,FH*0.25,bz); scene.add(pillar);
    });

    const wm=new THREE.MeshPhongMaterial({color:0x4477aa,transparent:true,opacity:0.08,side:THREE.DoubleSide});
    const addWall=(w,h,d,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),wm.clone());m.position.set(x,y,z);scene.add(m);};
    addWall(0.1,FH,FD,-hw,FH/2,0); addWall(0.1,FH,FD,hw,FH/2,0);
    const ew=(FW-GW)/2;
    [-hd,hd].forEach(z=>{addWall(ew,FH,0.1,-hw+ew/2,FH/2,z);addWall(ew,FH,0.1,hw-ew/2,FH/2,z);addWall(GW,FH-GH,0.1,0,GH+(FH-GH)/2,z);});

    const mkGoal=(z,color)=>{
      const dir=z<0?-1:1;
      const nm=new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.16,side:THREE.DoubleSide});
      const pm=new THREE.MeshLambertMaterial({color:0xe8e8e8});
      const addNet=(geo,x,y,oz)=>{const m=new THREE.Mesh(geo,nm.clone());m.position.set(x,y,z+dir*oz);scene.add(m);};
      addNet(new THREE.PlaneGeometry(GW,GH),0,GH/2,GD);
      const sL=new THREE.Mesh(new THREE.PlaneGeometry(GD,GH),nm.clone()); sL.rotation.y=Math.PI/2; sL.position.set(-GW/2,GH/2,z+dir*GD/2); scene.add(sL);
      const sR=sL.clone(); sR.position.x=GW/2; scene.add(sR);
      const top=new THREE.Mesh(new THREE.PlaneGeometry(GW,GD),nm.clone()); top.rotation.x=Math.PI/2; top.position.set(0,GH,z+dir*GD/2); scene.add(top);
      for(const px of[-GW/2,GW/2]){const p=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,GH,8),pm.clone());p.position.set(px,GH/2,z);p.castShadow=true;scene.add(p);}
      const bar=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,GW+0.14,8),pm.clone()); bar.rotation.z=Math.PI/2; bar.position.set(0,GH,z); scene.add(bar);
    };
    mkGoal(-hd,0x2255ff); mkGoal(hd,0xff2211);

    const ballM=new THREE.Mesh(new THREE.SphereGeometry(BR,28,28),new THREE.MeshPhongMaterial({color:0xffffff,shininess:120,specular:0xbbbbbb})); ballM.castShadow=true; scene.add(ballM);
    const ballGlowMat = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0});
    const ballGlow = new THREE.Mesh(new THREE.SphereGeometry(BR*1.2, 16, 16), ballGlowMat); scene.add(ballGlow);
    const ballSh=new THREE.Mesh(new THREE.CircleGeometry(BR*1.4,20),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.4,depthWrite:false})); ballSh.rotation.x=-Math.PI/2; scene.add(ballSh);

    const kickoffRing = new THREE.Mesh(new THREE.RingGeometry(BR*1.5, BR*1.8, 32), new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0}));
    kickoffRing.rotation.x = -Math.PI/2; scene.add(kickoffRing);

    const trajPtsArr=[]; for(let i=0;i<24;i++) trajPtsArr.push(new THREE.Vector3());
    const trajGeo=new THREE.BufferGeometry().setFromPoints(trajPtsArr);
    const trajLine=new THREE.Line(trajGeo,new THREE.LineBasicMaterial({color:0x00ffaa,transparent:true,opacity:0})); scene.add(trajLine);

    const p1Range=new THREE.Mesh(new THREE.RingGeometry(1.4,1.6,36),new THREE.MeshBasicMaterial({color:0x00ff88,side:THREE.DoubleSide,transparent:true,opacity:0})); p1Range.rotation.x=-Math.PI/2; p1Range.position.y=0.05; scene.add(p1Range);
    const arrowGroup=new THREE.Group(); arrowGroup.position.y=0.1; scene.add(arrowGroup);
    const arrowShaft=new THREE.Mesh(new THREE.PlaneGeometry(0.14,0.9),new THREE.MeshBasicMaterial({color:0x00ff88,transparent:true,opacity:0,side:THREE.DoubleSide})); arrowShaft.rotation.x=-Math.PI/2; arrowShaft.position.z=-0.45; arrowGroup.add(arrowShaft);
    const arrowHead=new THREE.Mesh(new THREE.ConeGeometry(0.24,0.5,8),new THREE.MeshBasicMaterial({color:0x00ff88,transparent:true,opacity:0})); arrowHead.rotation.x=Math.PI/2; arrowHead.position.z=-1.1; arrowGroup.add(arrowHead);

    const mkPlayer=(colorHex)=>{
      const g=new THREE.Group(); scene.add(g);
      const body=new THREE.Mesh(new THREE.SphereGeometry(PR,22,22),new THREE.MeshPhongMaterial({color: colorHex,shininess:90})); body.castShadow=true; g.add(body);
      const top=new THREE.Mesh(new THREE.ConeGeometry(0.16,0.4,8),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.75})); top.position.y=PR+0.5; g.add(top);
      const ring=new THREE.Mesh(new THREE.RingGeometry(PR*0.9,PR+0.12,24),new THREE.MeshBasicMaterial({color: colorHex,side:THREE.DoubleSide,transparent:true,opacity:0.5})); ring.rotation.x=-Math.PI/2; ring.position.y=0.03; g.add(ring);
      return g;
    };
    
    // KOLORY DRUŻYN
    const myColorHex = parseInt((playerColor || '#00dd55').replace('#', ''), 16);
    const oppColorHex = 0xff2222;
    
    const myTeam = (role === 'p1' || role === 'p3') ? 'A' : 'B';
    const teamAColor = myTeam === 'A' ? myColorHex : oppColorHex;
    const teamBColor = myTeam === 'B' ? myColorHex : oppColorHex;

    const p1G=mkPlayer(teamAColor); 
    const p2G=mkPlayer(teamBColor);
    const p3G=mkPlayer(teamAColor); 
    const p4G=mkPlayer(teamBColor);

    const trailMat=new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:0,depthWrite:false});
    const trailMesh=new THREE.Mesh(new THREE.SphereGeometry(PR*0.7,10,10),trailMat); scene.add(trailMesh);
    const chargeRingMesh=new THREE.Mesh(new THREE.RingGeometry(PR+0.18,PR+0.42,32,1,0,0.001),new THREE.MeshBasicMaterial({color:0xffff00,side:THREE.DoubleSide,transparent:true,opacity:0})); chargeRingMesh.rotation.x=-Math.PI/2; chargeRingMesh.position.y=0.08; scene.add(chargeRingMesh);

    const mkAgent=(id, team)=>({id, team, pos:new THREE.Vector3(),vel:new THREE.Vector3(),onGround:false,chargeT:0,chargingStraight:false,chargingCurve:false,dir:new THREE.Vector3(0,0,1),dashCD:0,dashT:0,dashDirX:0,dashDirZ:0, kickCD:0, lobCD:0, spinCharge:0, lastAimAngle:0});
    const ball={pos:new THREE.Vector3(),vel:new THREE.Vector3(), spin: 0};
    
    const p1=mkAgent('p1', 'A'); p1.dir.set(0,0,-1);
    const p2=mkAgent('p2', 'B'); p2.dir.set(0,0,1);
    const p3=mkAgent('p3', 'A'); p3.dir.set(0,0,-1);
    const p4=mkAgent('p4', 'B'); p4.dir.set(0,0,1);
    
    const agents = is2v2 ? [p1, p2, p3, p4] : [p1, p2];
    const score={a:0,b:0};
    
    let goalTimer=0, msgText='', animId, lastT=performance.now();
    let netTick = 0; 
    const NETWORK_RATE = 0.033; 
    let isMatchOver = false;
    let currentKickoff = 'neutral';
    let pendingReset = null;
    
    const cfg=BOT_CFG[difficulty] || BOT_CFG['sredni'];

    const mouse = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const mouseAim = new THREE.Vector3(0, 0, -1);
    let lmbDown = false;
    let rmbDown = false;
    let lastMouseX = 0;
    let mouseLobTrigger = false;

    let remoteInputs = {
      p2: { mx: 0, mz: 0, aimX: 0, aimZ: 1, jump: false, kick: false, chargeStraight: false, chargeCurve: false, dash: false, spinReq: 0 },
      p3: { mx: 0, mz: 0, aimX: 0, aimZ: -1, jump: false, kick: false, chargeStraight: false, chargeCurve: false, dash: false, spinReq: 0 },
      p4: { mx: 0, mz: 0, aimX: 0, aimZ: 1, jump: false, kick: false, chargeStraight: false, chargeCurve: false, dash: false, spinReq: 0 }
    };
    
    let serverState = null;

    if (socket) {
      socket.on('opponentInput', ({ role: r, input }) => { if(remoteInputs[r]) remoteInputs[r] = input; });
      socket.on('gameState', (st) => { serverState = st; });
      socket.on('chatMessage', (msgObj) => { setChatMessages(prev => [...prev, msgObj].slice(-10)); });
      socket.on('triggerEvent', ({type, power}) => {
        if (type === 'kick') playKickSound(power);
        if (type === 'shake') triggerShake(0.5, power);
        if (type === 'rematch') resetMatch();
      });
    }

    const playKickSound = (power) => {
      const audio = new Audio('/ballkick.mp3');
      audio.volume = clamp(power * 0.3, 0.2, 1.0);
      audio.playbackRate = clamp(1.2 - power * 0.1, 0.8, 1.2); 
      audio.play().catch(()=>{});
    };

    const triggerShake = (duration, intensity) => {
      shakeTime = duration; shakeIntensity = intensity;
    };

    const reset=(whoScored)=>{
      ball.pos.set(0,BR,0); ball.vel.set(0,0,0); ball.spin = 0;
      p1.pos.set(is2v2?-2:0, PR, 4.8); p1.vel.set(0,0,0); p1.onGround=true; p1.chargeT=0; p1.chargingStraight=false; p1.chargingCurve=false; p1.dashT=0; p1.spinCharge=0; p1.lobCD=0; p1.kickCD=0;
      p2.pos.set(is2v2? 2:0, PR,-4.8); p2.vel.set(0,0,0); p2.onGround=true; p2.chargeT=0; p2.chargingStraight=false; p2.chargingCurve=false; p2.dashT=0; p2.spinCharge=0; p2.lobCD=0; p2.kickCD=0;
      p3.pos.set(is2v2? 2:0, PR, 4.8); p3.vel.set(0,0,0); p3.onGround=true; p3.chargeT=0; p3.chargingStraight=false; p3.chargingCurve=false; p3.dashT=0; p3.spinCharge=0; p3.lobCD=0; p3.kickCD=0;
      p4.pos.set(is2v2?-2:0, PR,-4.8); p4.vel.set(0,0,0); p4.onGround=true; p4.chargeT=0; p4.chargingStraight=false; p4.chargingCurve=false; p4.dashT=0; p4.spinCharge=0; p4.lobCD=0; p4.kickCD=0;
      
      if(!is2v2){ p3.pos.y = -100; p4.pos.y = -100; }
      
      agents.forEach(ag => { ag.botDelay = 1.0; }); // Opóźnienie dla botów
      
      if (whoScored === 'A') currentKickoff = 'B';
      else if (whoScored === 'B') currentKickoff = 'A';
      else currentKickoff = 'neutral';
    };
    reset(null);

    const resetMatch = () => {
      score.a = 0; score.b = 0;
      isMatchOver = false;
      setGameOver(null);
      reset(null);
      if(scoreRef.current)scoreRef.current.textContent=`0 : 0`;
    };

    window.handleRematch = () => {
      if (socket && mode === 'online-host') socket.emit('gameEvent', { roomId, type: 'rematch', power: 0 });
      resetMatch();
    };

    const keys={};
    const keyDown=e=>{ 
      if (isTyping.current) return; 
      keys[e.code]=true;
      if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const keyUp=e=>{ if(isTyping.current) return; keys[e.code]=false; };
    
    const onMouseMove = (e) => {
      if(controls!=='mouse' || isMobile) return;
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    const onMouseDown = (e) => {
      if(controls!=='mouse' || isMobile || isTyping.current) return;
      if (e.button === 0) lmbDown = true;
      if (e.button === 2) { rmbDown = true; lastMouseX = mouse.x; mouseLobTrigger = true; } 
    };
    const onMouseUp = (e) => {
      if(controls!=='mouse' || isMobile) return;
      if (e.button === 0) lmbDown = false;
      if (e.button === 2) rmbDown = false;
    };
    const onContextMenu = (e) => { if(controls==='mouse') e.preventDefault(); };

    window.addEventListener('keydown',keyDown); window.addEventListener('keyup',keyUp);
    window.addEventListener('mousemove', onMouseMove); window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp); window.addEventListener('contextmenu', onContextMenu);

    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

    const softContact=(ball,agent,dt)=>{
      if (agent.lobCD > 0) return; 
      if (currentKickoff !== 'neutral' && currentKickoff !== agent.team) return; 

      const dx=ball.pos.x-agent.pos.x,dy=ball.pos.y-agent.pos.y,dz=ball.pos.z-agent.pos.z;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz),minDist=BR+PR;
      
      if(dist<minDist&&dist>0.001){
        const nx=dx/dist,ny=dy/dist,nz=dz/dist,pen=minDist-dist;
        const relVn=(ball.vel.x-agent.vel.x)*nx+(ball.vel.y-agent.vel.y)*ny+(ball.vel.z-agent.vel.z)*nz;
        const force=CONTACT_STIFFNESS*pen-CONTACT_DAMPING*Math.min(relVn,0);
        const bs=PLAYER_MASS/(BALL_MASS+PLAYER_MASS),as=BALL_MASS/(BALL_MASS+PLAYER_MASS);
        ball.vel.x+=nx*force*bs*dt; ball.vel.y+=ny*force*bs*dt; ball.vel.z+=nz*force*bs*dt;
        agent.vel.x-=nx*force*as*dt*0.3; agent.vel.z-=nz*force*as*dt*0.3;
        const c=pen*0.35;
        ball.pos.x+=nx*c*bs; ball.pos.y+=ny*c*bs; ball.pos.z+=nz*c*bs;
        
        if (currentKickoff === agent.team) currentKickoff = 'neutral';
      }
      
      const flatDx = ball.pos.x - agent.pos.x;
      const flatDz = ball.pos.z - agent.pos.z;
      const flatDist = Math.sqrt(flatDx*flatDx + flatDz*flatDz);
      const speed = Math.sqrt(agent.vel.x**2 + agent.vel.z**2);
      const bSpeed = Math.sqrt(ball.vel.x**2 + ball.vel.z**2);
      
      const canDribble = (!agent.chargingStraight && !agent.chargingCurve);

      if (canDribble && flatDist < minDist + 0.4 && speed > 0.5 && agent.onGround && ball.pos.y < BR + 0.5 && bSpeed < speed + 4.0) {
        const dirX = flatDx / flatDist;
        const dirZ = flatDz / flatDist;
        const idealX = agent.pos.x + dirX * (minDist + 0.01);
        const idealZ = agent.pos.z + dirZ * (minDist + 0.01);
        
        ball.pos.x += (idealX - ball.pos.x) * dt * 18.0;
        ball.pos.z += (idealZ - ball.pos.z) * dt * 18.0;
        ball.vel.x += (agent.vel.x - ball.vel.x) * dt * 15.0;
        ball.vel.z += (agent.vel.z - ball.vel.z) * dt * 15.0;
        
        if (currentKickoff === agent.team) currentKickoff = 'neutral';
      }
    };

    const bumperHit=(obj,r)=>{
      BUMPERS.forEach(([bx,bz])=>{
        const dx=obj.pos.x-bx,dz=obj.pos.z-bz,dist=Math.sqrt(dx*dx+dz*dz),minD=BUMP_R+r;
        if(dist<minD&&dist>0.001){
          const nx=dx/dist,nz=dz/dist,dot=obj.vel.x*nx+obj.vel.z*nz;
          if(dot<0){obj.vel.x-=2.2*dot*nx; obj.vel.z-=2.2*dot*nz;}
          obj.pos.x=bx+nx*(minD+0.02); obj.pos.z=bz+nz*(minD+0.02);
        }
      });
    };

    const playerContact=(A,B,dt)=>{
      const dx=A.pos.x-B.pos.x,dy=A.pos.y-B.pos.y,dz=A.pos.z-B.pos.z;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz),minD=PR+PR;
      if(dist>=minD||dist<0.001) return;
      const nx=dx/dist,nz=dz/dist,pen=minD-dist,force=500*pen,h=dt*0.5;
      A.vel.x+=nx*force*h; A.vel.z+=nz*force*h; B.vel.x-=nx*force*h; B.vel.z-=nz*force*h;
      A.pos.x+=nx*pen*0.5; A.pos.z+=nz*pen*0.5; B.pos.x-=nx*pen*0.5; B.pos.z-=nz*pen*0.5;
    };

    const doKick=(agent,power,type,spinReq)=>{
      if (currentKickoff !== 'neutral' && currentKickoff !== agent.team) return false;

      const toBall=ball.pos.clone().sub(agent.pos);
      const dist2D=Math.sqrt(toBall.x*toBall.x+toBall.z*toBall.z);
      if(dist2D>(agent.onGround?PR+BR+1.5:PR+BR+2.8)) return false;
      
      const dirBall=toBall.clone().normalize();
      let dx = dirBall.x * 0.15 + agent.dir.x * 0.85;
      let dz = dirBall.z * 0.15 + agent.dir.z * 0.85;
      const len=Math.sqrt(dx*dx+dz*dz)||1;
      let fX = dx / len; let fZ = dz / len;
      
      if (type === 'flick') {
        ball.pos.x += fX * 0.3;
        ball.pos.z += fZ * 0.3;
        ball.pos.y = Math.max(ball.pos.y, PR + 0.1);
        
        ball.vel.x = agent.vel.x * 0.1 + fX * 2.5; 
        ball.vel.z = agent.vel.z * 0.1 + fZ * 2.5; 
        ball.vel.y = 8.5; 
        ball.spin = 0; 
      } else if (type === 'curve') {
        ball.vel.x = fX * 17 * power; ball.vel.z = fZ * 17 * power; 
        ball.vel.y = agent.onGround ? 5 + power * 2.5 : 8 + power * 3;
        ball.spin = spinReq * power; 
      } else {
        ball.vel.x = fX * 17 * power; ball.vel.z = fZ * 17 * power; 
        ball.vel.y = agent.onGround ? 5 + power * 2.5 : 8 + power * 3;
        ball.spin = 0; 
      }
      
      const audioPower = type === 'flick' ? 0.4 : power;
      playKickSound(audioPower);
      if(type !== 'flick' && power > 1.2) triggerShake(0.15, power * 0.15); 
      
      if (socket && mode === 'online-host') {
        socket.emit('gameEvent', { roomId, type: 'kick', power: audioPower });
        if (type !== 'flick' && power > 1.2) socket.emit('gameEvent', { roomId, type: 'shake', power: power*0.15 });
      }
      
      if (currentKickoff === agent.team) currentKickoff = 'neutral';
      return true;
    };

    const moveAgent=(agent,mx,mz,aimX,aimZ,jump,kick,chargeStraight,chargeCurve,dashPressed,spinReq,spd,halfSign,dt)=>{
      const ml=Math.sqrt(mx*mx+mz*mz);
      const aimL = Math.sqrt(aimX*aimX + aimZ*aimZ);
      
      if (aimL > 0.01) { agent.dir.x = aimX / aimL; agent.dir.z = aimZ / aimL; } 
      else if(ml>0.1)  { agent.dir.x = mx/ml; agent.dir.z = mz/ml; }

      agent.dashCD = Math.max(0,agent.dashCD-dt);
      agent.kickCD = Math.max(0,agent.kickCD-dt);
      agent.lobCD = Math.max(0,agent.lobCD-dt);
      
      if(agent.dashT>0){
        agent.dashT=Math.max(0,agent.dashT-dt); agent.vel.x=agent.dashDirX*DASH_SPEED; agent.vel.z=agent.dashDirZ*DASH_SPEED;
      } else {
        const acc=agent.onGround?20:3; agent.vel.x+=(mx*spd-agent.vel.x)*Math.min(acc*dt,1); agent.vel.z+=(mz*spd-agent.vel.z)*Math.min(acc*dt,1);
      }
      if(dashPressed&&agent.dashCD<=0&&ml>0.1&&agent.onGround){
        agent.dashT=DASH_DURATION; agent.dashCD=DASH_COOLDOWN; agent.dashDirX=mx/ml; agent.dashDirZ=mz/ml;
      }
      if(jump&&agent.onGround){agent.vel.y=12.5; agent.onGround=false;}
      
      if (chargeStraight) {
        agent.chargeT = Math.min(agent.chargeT + dt*1.2, 1.5);
        agent.chargingStraight = true;
      } else if (agent.chargingStraight) {
        if (agent.chargeT < 0.25) {
            if(doKick(agent, 1.0, 'flick', 0)) agent.lobCD = 0.3; 
        } else {
            doKick(agent, 1.0 + agent.chargeT*1.5, 'straight', 0);
        }
        agent.chargeT = 0; agent.chargingStraight = false;
      }

      if (chargeCurve) {
        agent.chargeT = Math.min(agent.chargeT + dt*1.2, 1.5);
        agent.chargingCurve = true;
      } else if (agent.chargingCurve) {
        doKick(agent, 1.0 + agent.chargeT*1.5, 'curve', spinReq);
        agent.chargeT = 0; agent.chargingCurve = false;
      }

      if(kick && !agent.chargingStraight && !agent.chargingCurve) {
         if(doKick(agent, 1.0, 'flick', 0)) agent.lobCD = 0.3;
      }
      
      agent.vel.y+=-22*dt;
      agent.pos.x+=agent.vel.x*dt; agent.pos.y+=agent.vel.y*dt; agent.pos.z+=agent.vel.z*dt;
      if(agent.pos.y<=PR){agent.pos.y=PR;agent.vel.y=0;agent.onGround=true;}else agent.onGround=false;
      if(Math.abs(agent.pos.x)>hw-PR){agent.pos.x=Math.sign(agent.pos.x)*(hw-PR);agent.vel.x*=-0.15;agent.dashT=0;}
      if(halfSign>0&&agent.pos.z<0.1){agent.pos.z=0.1;if(agent.vel.z<0){agent.vel.z=0;agent.dashT=0;}}
      if(halfSign<0&&agent.pos.z>-0.1){agent.pos.z=-0.1;if(agent.vel.z>0){agent.vel.z=0;agent.dashT=0;}}
      if(Math.abs(agent.pos.z)>hd-PR){agent.pos.z=Math.sign(agent.pos.z)*(hd-PR);agent.vel.z*=-0.15;agent.dashT=0;}
      bumperHit(agent,PR);
    };

    const runBot = (agent, isTeamA, dt) => {
        if (agent.botDelay === undefined) agent.botDelay = 0;
        if (agent.botInp === undefined) agent.botInp = { mx: 0, mz: 0, aimX: 0, aimZ: isTeamA ? -1 : 1, j: false, kick: false, chargeStraight: false, d: false };

        agent.botDelay -= dt;
        if (agent.botDelay <= 0) {
            const enemyKickoff = currentKickoff !== 'neutral' && currentKickoff !== agent.team;
            if (enemyKickoff) {
                let dz = (isTeamA ? 4.0 : -4.0) - agent.pos.z;
                let dx = 0.0 - agent.pos.x;
                let dd = Math.sqrt(dx*dx+dz*dz);
                agent.botInp.mx = dd > 0.5 ? dx/dd : 0;
                agent.botInp.mz = dd > 0.5 ? dz/dd : 0;
                agent.botInp.aimX = agent.botInp.mx || 0;
                agent.botInp.aimZ = agent.botInp.mz || (isTeamA ? -1 : 1);
                agent.botInp.chargeStraight = false; agent.botInp.kick = false; agent.botInp.d = false; agent.botInp.j = false;
            } else {
                let txb=ball.pos.x+ball.vel.x*cfg.pred, tzb=ball.pos.z+ball.vel.z*cfg.pred, tx,tz;
                const defendingZ = isTeamA ? hd : -hd;
                const attackingZ = isTeamA ? -hd : hd;

                if ( (isTeamA && ball.pos.z > 0) || (!isTeamA && ball.pos.z < 0) ) {
                    tx=clamp(txb,-hw+PR,hw-PR);
                    tz=clamp(tzb + (isTeamA ? 1.2 : -1.2), -hd+PR, hd-PR);
                } else {
                    const xOffset = agent === p3 ? 3 : (agent === p4 ? -3 : 0);
                    tx=clamp(ball.pos.x*0.4 + xOffset, -GW/2+0.5, GW/2-0.5);
                    tz=clamp(defendingZ - (isTeamA ? 3.5 : -3.5), -hd+PR, hd-PR);
                }
                let dx=tx-agent.pos.x, dz=tz-agent.pos.z, dd=Math.sqrt(dx*dx+dz*dz);
                
                if(dd>0.2){ agent.botInp.mx = dx/dd; agent.botInp.mz = dz/dd; } else { agent.botInp.mx=0; agent.botInp.mz=0; }
                agent.botInp.aimX = agent.botInp.mx || 0; agent.botInp.aimZ = agent.botInp.mz || (isTeamA ? -1 : 1);
                
                agent.botInp.j = (agent.onGround&&ball.pos.y>1.5&&Math.abs(ball.pos.x-agent.pos.x)<4.0&&Math.abs(ball.pos.z-agent.pos.z)<5.0&&Math.random()<cfg.jumpP);
                
                const d2b=ball.pos.clone().sub(agent.pos).length(); 
                if (difficulty === 'hardcore' && d2b < PR+BR+3.0 && d2b > PR+BR+0.5) {
                    agent.botInp.chargeStraight = true; agent.botInp.kick = false;
                } else if (d2b < PR+BR+cfg.kickR) {
                    agent.botInp.chargeStraight = false; agent.botInp.kick = true;
                } else {
                    agent.botInp.chargeStraight = false; agent.botInp.kick = false;
                }
                agent.botInp.d = (difficulty!=='nowicjusz' && dd>3.0 && agent.dashCD<=0);
            }
            agent.botDelay = cfg.reactDelay + Math.random()*0.1;
        }
        moveAgent(agent, agent.botInp.mx, agent.botInp.mz, agent.botInp.aimX, agent.botInp.aimZ, agent.botInp.j, agent.botInp.kick, agent.botInp.chargeStraight, false, agent.botInp.d, 0, cfg.spd, isTeamA ? 1 : -1, dt);
        agent.botInp.kick = false;
    };

    const physicsTick=(dt)=>{
      const sdt=dt/4;
      for(let s=0;s<4;s++){
        ball.vel.y+=-22*sdt;
        const onFloor=ball.pos.y<=BR+0.05;
        
        if (Math.abs(ball.spin) > 0.05) {
          const speed2D = Math.sqrt(ball.vel.x**2 + ball.vel.z**2);
          if (speed2D > 1.0) {
            const pX = -ball.vel.z / speed2D; 
            const pZ = ball.vel.x / speed2D;
            ball.vel.x += pX * ball.spin * sdt * 20.0;
            ball.vel.z += pZ * ball.spin * sdt * 20.0;
            ball.spin *= onFloor ? Math.pow(0.92, sdt*60) : Math.pow(0.985, sdt*60);
          }
        }

        ball.vel.x*=onFloor?Math.pow(0.78,sdt*60):Math.pow(0.997,sdt*60);
        ball.vel.z*=onFloor?Math.pow(0.78,sdt*60):Math.pow(0.997,sdt*60);
        ball.pos.x+=ball.vel.x*sdt; ball.pos.y+=ball.vel.y*sdt; ball.pos.z+=ball.vel.z*sdt;
        if(ball.pos.y<=BR){ball.pos.y=BR;if(ball.vel.y<-0.8)ball.vel.y*=-0.48;else ball.vel.y=0;}
        if(ball.pos.y>=FH-BR){ball.pos.y=FH-BR;ball.vel.y*=-0.5;}
        if(Math.abs(ball.pos.x)>=hw-BR){ball.pos.x=Math.sign(ball.pos.x)*(hw-BR);ball.vel.x*=-0.72;}
        
        agents.forEach(ag => softContact(ball, ag, sdt));
        for(let i=0; i<agents.length; i++) {
          for(let j=i+1; j<agents.length; j++) {
            playerContact(agents[i], agents[j], sdt);
          }
        }
        bumperHit(ball,BR);
      }
    };

    const update=(dt)=>{
      if (isMatchOver) return;
      dt=Math.min(dt,0.045);
      netTick += dt;
      
      if (shakeTime > 0) {
        shakeTime -= dt;
        camera.position.set(baseCamPos.x + (Math.random() - 0.5) * shakeIntensity, baseCamPos.y + (Math.random() - 0.5) * shakeIntensity, baseCamPos.z + (Math.random() - 0.5) * shakeIntensity);
      } else { camera.position.copy(baseCamPos); }

      if (goalTimer > 0) {
        goalTimer -= dt;
        const fade = Math.max(0, goalTimer/2.5);
        scene.background.setRGB(0.02+fade*0.25, 0.04+fade*0.12, 0.06);
        
        if(msgRef.current){
            msgRef.current.textContent = msgText;
            msgRef.current.style.opacity = String(Math.min(goalTimer*2, 1));
        }

        if (goalTimer <= 0) {
          if(msgRef.current) msgRef.current.style.opacity = '0';
          if (score.a >= scoreLimit || score.b >= scoreLimit) {
            isMatchOver = true;
            let label = score.a >= scoreLimit ? (mode==='multi'? t.winnerP1 : t.winnerYou) : (mode==='multi'? t.winnerP2 : t.loserYou);
            if (is2v2 && mode !== 'online-client') label = score.a >= scoreLimit ? t.winnerTeamA : t.winnerTeamB;
            if (mode === 'online-client') {
                const myTeam = role === 'p1' || role === 'p3' ? 'a' : 'b';
                const won = score[myTeam] >= scoreLimit;
                label = won ? t.winnerYou : t.winnerOpp;
            }
            setGameOver({ winnerLabel: label });
          } else {
            scene.background.setHex(0x06090f);
            reset(pendingReset);
            pendingReset = null;
          }
        }
        
        if (mode === 'online-host' && socket && netTick >= NETWORK_RATE) {
          let stateObj = {
              ball: { pos: ball.pos, vel: ball.vel, spin: ball.spin },
              p1: { pos: p1.pos, vel: p1.vel, chargeT: p1.chargeT, dashT: p1.dashT, dashCD: p1.dashCD, dir: p1.dir, onGround: p1.onGround },
              p2: { pos: p2.pos, vel: p2.vel, chargeT: p2.chargeT, dashT: p2.dashT, dashCD: p2.dashCD, dir: p2.dir, onGround: p2.onGround },
              score: { a: score.a, b: score.b }, goalTimer, msgText, currentKickoff, pendingReset
          };
          if (is2v2) {
              stateObj.p3 = { pos: p3.pos, vel: p3.vel, chargeT: p3.chargeT, dashT: p3.dashT, dashCD: p3.dashCD, dir: p3.dir, onGround: p3.onGround };
              stateObj.p4 = { pos: p4.pos, vel: p4.vel, chargeT: p4.chargeT, dashT: p4.dashT, dashCD: p4.dashCD, dir: p4.dir, onGround: p4.onGround };
          }
          socket.emit('hostState', { roomId, state: stateObj });
          netTick = 0;
        }
        if (mode === 'online-client' && serverState) {
          if (serverState.goalTimer > 0) { goalTimer = serverState.goalTimer; msgText = serverState.msgText; }
          score.a = serverState.score.a; score.b = serverState.score.b;
          if (serverState.currentKickoff) currentKickoff = serverState.currentKickoff;
          serverState = null;
        }
        return; 
      } else {
        scene.background.setHex(0x06090f);
        if(msgRef.current) msgRef.current.style.opacity = '0';
      }

      let mxLocal=0, mzLocal=0, jumpL=false, dashL=false;
      let chargeStraightL = false, chargeCurveL = false, kickL = false;
      let aimX=0, aimZ=1;
      const myP = agents.find(a => a.id === role) || p1;

      if (isMobile) {
        const ti = touchInputs.current;
        mxLocal = ti.mx; mzLocal = ti.mz;
        aimX = ti.aimX; aimZ = ti.aimZ;
        chargeStraightL = ti.chargeStraight; chargeCurveL = ti.chargeCurve; 
        jumpL = ti.jump; dashL = ti.dash;
        
        if (chargeCurveL) myP.spinCharge += ti.spinCharge * 15.0 * dt; 
        if(ti.flick) {
           chargeStraightL = true; 
           setTimeout(() => { touchInputs.current.chargeStraight = false; }, 50); 
           ti.flick = false;
        }
        ti.spinCharge = 0; 
      } else {
        mxLocal=(keys['KeyD']?1:0)-(keys['KeyA']?1:0); mzLocal=(keys['KeyS']?1:0)-(keys['KeyW']?1:0);
        jumpL = !!keys['Space']; dashL = !!keys['ShiftLeft'];
        
        if (controls === 'mouse') {
          chargeStraightL = lmbDown; 
          chargeCurveL = rmbDown; 
          if(mouseLobTrigger) { kickL = true; mouseLobTrigger = false; }
          
          raycaster.setFromCamera(mouse, camera);
          const targetPoint = new THREE.Vector3();
          raycaster.ray.intersectPlane(groundPlane, targetPoint);
          if (targetPoint) mouseAim.copy(targetPoint).sub(myP.pos).normalize();
          aimX = mouseAim.x; aimZ = mouseAim.z;
          
          if (chargeCurveL) {
            let currentAimAngle = Math.atan2(aimX, aimZ);
            if (myP.chargeT === 0) { myP.lastAimAngle = currentAimAngle; } 
            else {
                let diff = currentAimAngle - myP.lastAimAngle;
                while(diff > Math.PI) diff -= Math.PI*2;
                while(diff < -Math.PI) diff += Math.PI*2;
                myP.spinCharge += diff * 12.0; 
                myP.lastAimAngle = currentAimAngle;
            }
          }
        } else {
          chargeStraightL = !!keys['KeyF']; chargeCurveL = !!keys['KeyQ'];
          if(keys['KeyE'] && !chargeStraightL && !chargeCurveL && myP.chargeT === 0) {
             doKick(myP, 1.0, 'flick', 0, myP.team); myP.lobCD = 0.3;
          }

          if (mxLocal !== 0 || mzLocal !== 0) {
            const l = Math.sqrt(mxLocal*mxLocal + mzLocal*mzLocal);
            aimX = mxLocal / l; aimZ = mzLocal / l;
          } else { aimX = myP.dir.x; aimZ = myP.dir.z; }
          
          if (chargeCurveL) {
            if (keys['KeyA']) myP.spinCharge -= dt * 8;
            if (keys['KeyD']) myP.spinCharge += dt * 8;
          }
        }
      }

      myP.spinCharge = clamp(myP.spinCharge, -2.5, 2.5);
      let spinReq = myP.spinCharge;
      if (!chargeCurveL) myP.spinCharge = 0;

      if (mode === 'online-client') {
        if (serverState) {
          ball.pos.copy(serverState.ball.pos); ball.vel.copy(serverState.ball.vel); ball.spin = serverState.ball.spin || 0;
          p1.pos.copy(serverState.p1.pos); p1.vel.copy(serverState.p1.vel);
          p1.chargeT = serverState.p1.chargeT; p1.dashT = serverState.p1.dashT; p1.dashCD = serverState.p1.dashCD; p1.dir.copy(serverState.p1.dir); p1.onGround = serverState.p1.onGround;
          p2.pos.copy(serverState.p2.pos); p2.vel.copy(serverState.p2.vel);
          p2.chargeT = serverState.p2.chargeT; p2.dashT = serverState.p2.dashT; p2.dashCD = serverState.p2.dashCD; p2.dir.copy(serverState.p2.dir); p2.onGround = serverState.p2.onGround;
          if (is2v2 && serverState.p3 && serverState.p4) {
             p3.pos.copy(serverState.p3.pos); p3.dir.copy(serverState.p3.dir);
             p4.pos.copy(serverState.p4.pos); p4.dir.copy(serverState.p4.dir);
          }
          score.a = serverState.score.a; score.b = serverState.score.b;
          if (serverState.currentKickoff) currentKickoff = serverState.currentKickoff;
          serverState = null;
        }
        
        moveAgent(myP, mxLocal, mzLocal, aimX, aimZ, jumpL, kickL, chargeStraightL, chargeCurveL, dashL, spinReq, 9, myP.team==='A'?1:-1, dt);
        agents.forEach(ag => { if(ag !== myP) moveAgent(ag, 0,0, ag.dir.x, ag.dir.z, false, false, false, false, false, 0, 9, ag.team==='A'?1:-1, dt); });
        
        physicsTick(dt);
      } 
      else {
        // HOST LUB LOCAL
        moveAgent(p1, mxLocal, mzLocal, aimX, aimZ, jumpL, kickL, chargeStraightL, chargeCurveL, dashL, spinReq, 9, +1, dt);
        
        if (mode === 'online-host') {
          const runOpp = (ag) => {
             const inp = remoteInputs[ag.id];
             if(inp) moveAgent(ag, inp.mx, inp.mz, inp.aimX, inp.aimZ, inp.jump, inp.kick, inp.chargeStraight, inp.chargeCurve, inp.dash, inp.spinReq, 9, ag.team==='A'?1:-1, dt);
             else moveAgent(ag, 0,0, ag.dir.x, ag.dir.z, false, false, false, false, false, 0, 9, ag.team==='A'?1:-1, dt);
          };
          runOpp(p2);
          if (is2v2) { runOpp(p3); runOpp(p4); }
        } else if(mode === 'multi') {
          const mx2=(keys['ArrowRight']?1:0)-(keys['ArrowLeft']?1:0), mz2=(keys['ArrowDown']?1:0)-(keys['ArrowUp']?1:0);
          let l2 = Math.sqrt(mx2*mx2 + mz2*mz2) || 1;
          let aimX2 = mx2, aimZ2 = mz2;
          if (mx2 === 0 && mz2 === 0) { aimX2 = p2.dir.x; aimZ2 = p2.dir.z; } else { aimX2 /= l2; aimZ2 /= l2; }

          let spinReq2 = 0;
          if (keys['Numpad1']) {
             if (keys['ArrowLeft']) spinReq2 -= dt * 8;
             if (keys['ArrowRight']) spinReq2 += dt * 8;
          }
          p2.spinCharge = clamp(p2.spinCharge + spinReq2, -2.5, 2.5);
          if (!keys['Numpad1']) p2.spinCharge = 0;

          moveAgent(p2, mx2, mz2, aimX2, aimZ2, !!keys['ShiftRight'], !!keys['Numpad2'], !!keys['Numpad0'], !!keys['Numpad1'], !!keys['Enter'], p2.spinCharge, 9, -1, dt);
          
          if (is2v2) { runBot(p3, true, dt); runBot(p4, false, dt); }
        } else {
          runBot(p2, false, dt);
          if (is2v2) { runBot(p3, true, dt); runBot(p4, false, dt); }
        }
        
        physicsTick(dt);

        const inGX=Math.abs(ball.pos.x)<GW/2,inGY=ball.pos.y<GH;
        if(ball.pos.z<=-hd+BR){
          if(inGX&&inGY){ score.a++; msgText='GOL!'; goalTimer=2.5; pendingReset='A'; triggerShake(0.5, 0.8); if(socket&&mode==='online-host') socket.emit('gameEvent',{roomId, type:'shake', power:0.8}); } else { ball.pos.z=-hd+BR; ball.vel.z*=-0.72; }
        }
        if(ball.pos.z>=hd-BR){
          if(inGX&&inGY){ score.b++; msgText='GOL!'; goalTimer=2.5; pendingReset='B'; triggerShake(0.5, 0.8); if(socket&&mode==='online-host') socket.emit('gameEvent',{roomId, type:'shake', power:0.8}); } else { ball.pos.z=hd-BR; ball.vel.z*=-0.72; }
        }
      }

      if (mode.startsWith('online') && socket && netTick >= NETWORK_RATE) {
        if (mode === 'online-client') {
          socket.emit('clientInput', { roomId, role, input: { mx: mxLocal, mz: mzLocal, aimX, aimZ, jump: jumpL, kick: kickL, chargeStraight: chargeStraightL, chargeCurve: chargeCurveL, dash: dashL, spinReq } });
        } else {
          let stateObj = {
              ball: { pos: ball.pos, vel: ball.vel, spin: ball.spin },
              p1: { pos: p1.pos, vel: p1.vel, chargeT: p1.chargeT, dashT: p1.dashT, dashCD: p1.dashCD, dir: p1.dir, onGround: p1.onGround },
              p2: { pos: p2.pos, vel: p2.vel, chargeT: p2.chargeT, dashT: p2.dashT, dashCD: p2.dashCD, dir: p2.dir, onGround: p2.onGround },
              score: { a: score.a, b: score.b }, goalTimer, msgText, currentKickoff, pendingReset
          };
          if (is2v2) {
              stateObj.p3 = { pos: p3.pos, vel: p3.vel, chargeT: p3.chargeT, dashT: p3.dashT, dashCD: p3.dashCD, dir: p3.dir, onGround: p3.onGround };
              stateObj.p4 = { pos: p4.pos, vel: p4.vel, chargeT: p4.chargeT, dashT: p4.dashT, dashCD: p4.dashCD, dir: p4.dir, onGround: p4.onGround };
          }
          socket.emit('hostState', { roomId, state: stateObj });
        }
        netTick = 0;
      }

      if(scoreRef.current)scoreRef.current.textContent=`${score.a} : ${score.b}`;
      
      ballM.position.copy(ball.pos); ballSh.position.set(ball.pos.x,0.02,ball.pos.z); ballSh.material.opacity=clamp(0.4*(1-ball.pos.y/6),0,0.42);
      
      const bspd2D=Math.sqrt(ball.vel.x**2 + ball.vel.z**2); 
      if(bspd2D>0.1 && ball.vel.y>-20) {
        // Fix matematyczny na NaN: dodano zabezpieczenie przed obrotem przy zerowym wektorze
        ballM.rotateOnWorldAxis(new THREE.Vector3(-ball.vel.z,0,ball.vel.x).normalize(), bspd2D*dt*1.1);
      }
      if (Math.abs(ball.spin) > 0.1) ballM.rotateOnWorldAxis(new THREE.Vector3(0,1,0), ball.spin * dt * -6);

      ballGlow.position.copy(ball.pos); ballGlow.material.opacity = clamp((bspd2D - 15) / 20, 0, 0.6);
      
      p1G.position.copy(p1.pos); p2G.position.copy(p2.pos);
      p1G.children[1].position.set(p1.dir.x * 0.15, PR + 0.5, p1.dir.z * 0.15); 
      p2G.children[1].position.set(p2.dir.x * 0.15, PR + 0.5, p2.dir.z * 0.15);
      
      if (is2v2) {
         p3G.position.copy(p3.pos); p3G.children[1].position.set(p3.dir.x * 0.15, PR + 0.5, p3.dir.z * 0.15);
         p4G.position.copy(p4.pos); p4G.children[1].position.set(p4.dir.x * 0.15, PR + 0.5, p4.dir.z * 0.15);
      } else {
         p3G.position.y = -100; p4G.position.y = -100;
      }

      if(myP.dashT>0){trailMesh.position.set(myP.pos.x,myP.pos.y,myP.pos.z);trailMesh.material.opacity=myP.dashT/DASH_DURATION*0.55;} else trailMesh.material.opacity=0;

      if(dashBarRef.current){
        const ready=myP.dashCD<=0,pct=ready?100:Math.round((1-myP.dashCD/DASH_COOLDOWN)*100);
        dashBarRef.current.style.width=pct+'%'; dashBarRef.current.style.background=ready?(myP.dashT>0?'#22aa88':'#338855'):'#aaa';
        if(dashLblRef.current) dashLblRef.current.textContent=ready?(myP.dashT>0?t.dashWait:t.dashReady):`${t.dashWait} ${pct}%`;
      }

      if (currentKickoff === 'A') {
          kickoffRing.material.color.setHex(teamAColor);
          kickoffRing.material.opacity = 0.8;
          kickoffRing.position.set(ball.pos.x, 0.05, ball.pos.z);
      } else if (currentKickoff === 'B') {
          kickoffRing.material.color.setHex(teamBColor);
          kickoffRing.material.opacity = 0.8;
          kickoffRing.position.set(ball.pos.x, 0.05, ball.pos.z);
      } else {
          kickoffRing.material.opacity = 0;
      }

      const distToBall2D=Math.sqrt((ball.pos.x-myP.pos.x)**2+(ball.pos.z-myP.pos.z)**2);
      const kickRadius=myP.onGround?PR+BR+1.5:PR+BR+2.8;
      const inRange=distToBall2D<kickRadius+0.5;
      p1Range.position.set(myP.pos.x,0.05,myP.pos.z);
      p1Range.geometry.dispose(); p1Range.geometry=new THREE.RingGeometry(kickRadius-0.1,kickRadius+0.12,36);
      p1Range.material.opacity=inRange?0.55:clamp(0.45-distToBall2D*0.07,0,0.25);
      p1Range.material.color.setHex(inRange?0x00ff88:0x225533);

      if(inRange){
        let ax = myP.dir.x; let az = myP.dir.z;
        const al=Math.sqrt(ax*ax+az*az)||1;
        arrowGroup.position.set(ball.pos.x,0.1,ball.pos.z); arrowGroup.rotation.y=Math.atan2(ax/al,az/al);
        arrowShaft.material.opacity=0.85; arrowHead.material.opacity=0.85;
      } else {arrowShaft.material.opacity=0; arrowHead.material.opacity=0;}

      if(myP.chargeT>0.1&&inRange){
        const power=1.0+myP.chargeT*1.5;
        let ax = myP.dir.x; let az = myP.dir.z;
        const al=Math.sqrt(ax*ax+az*az)||1;
        const vx=ax/al*17*power, vy=5+myP.chargeT*3.5, vz=az/al*17*power, newPts=[];
        
        const spinPreview = (myP.chargingCurve ? myP.spinCharge : 0) * power;
        const speed2DT = Math.sqrt(vx*vx + vz*vz) || 1;
        const pX = -vz / speed2DT; const pZ = vx / speed2DT;

        for(let i=0;i<24;i++){
            const ti=i*0.07;
            const curveOffset = spinPreview * 10.0 * ti * ti; 
            newPts.push(new THREE.Vector3(
                ball.pos.x + vx*ti + pX * curveOffset,
                Math.max(0.1, ball.pos.y + vy*ti - 11*ti*ti),
                ball.pos.z + vz*ti + pZ * curveOffset
            ));
        }
        trajGeo.setFromPoints(newPts); trajLine.material.opacity=0.6; trajLine.material.color.setHex(power>2.5?0xff4400:0x00ffaa);
      } else trajLine.material.opacity=0;

      chargeRingMesh.position.set(myP.pos.x,0.08,myP.pos.z);
      chargeRingMesh.geometry.dispose(); chargeRingMesh.geometry=new THREE.RingGeometry(PR+0.18,PR+0.42,32,1,0,Math.max(0.001,myP.chargeT/1.5*Math.PI*2));
      chargeRingMesh.material.opacity=myP.chargeT>0?0.9:0; chargeRingMesh.material.color.setHex(myP.chargeT>1.0?0xff3300:0xffff00);
      if(chargeRef.current){chargeRef.current.style.width=Math.round(myP.chargeT/1.5*100)+'%';chargeRef.current.style.background=myP.chargeT>1.0?'#e53':'#e90';chargeRef.current.style.opacity=myP.chargeT>0?'1':'0';}
    };

    const loop=()=>{animId=requestAnimationFrame(loop);const now=performance.now();update((now-lastT)/1000);lastT=now;renderer.render(scene,camera);};
    loop();
    const onResize=()=>{const w=mount.clientWidth,h=mount.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
    window.addEventListener('resize',onResize); setTimeout(onResize,30);
    return()=>{
      cancelAnimationFrame(animId); 
      if(socket) { socket.off('opponentInput'); socket.off('gameState'); socket.off('triggerEvent'); socket.off('chatMessage'); }
      window.removeEventListener('keydown',keyDown); window.removeEventListener('keyup',keyUp); window.removeEventListener('resize',onResize);
      window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mousedown', onMouseDown); window.removeEventListener('mouseup', onMouseUp); window.removeEventListener('contextmenu', onContextMenu);
      renderer.dispose(); if(mount.contains(renderer.domElement))mount.removeChild(renderer.domElement);
    };
  },[mode, difficulty, roomId, role, controls, playerColor, scoreLimit, is2v2, lang, t]);

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) { isTyping.current = false; return; }
    const pRoleLabel = role ? t[role] || role : (mode==='online-client' ? t.p2 : t.p1);
    const msg = { text: chatInput.trim(), sender: pRoleLabel, roomId };
    if (socket && mode.startsWith('online')) socket.emit('chatMessage', msg);
    else setChatMessages(prev => [...prev, msg].slice(-10));
    setChatInput("");
    isTyping.current = false;
  };

  const handleLeftTouchMove = (e) => {
    const touch = e.targetTouches[0]; const rect = e.target.getBoundingClientRect();
    const cx = rect.left + rect.width/2; const cy = rect.top + rect.height/2;
    let dx = touch.clientX - cx; let dy = touch.clientY - cy;
    const dist = Math.sqrt(dx*dx+dy*dy); const maxR = rect.width/2;
    if(dist>0) { touchInputs.current.mx = dx/dist * Math.min(dist/maxR,1); touchInputs.current.mz = dy/dist * Math.min(dist/maxR,1); }
  };
  const handleLeftTouchEnd = () => { touchInputs.current.mx = 0; touchInputs.current.mz = 0; };

  const handleRightTouchStart = (e) => {
    const touch = e.targetTouches[0]; const rect = e.target.getBoundingClientRect();
    rightStickBase.current = { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
    rightStickCurrent.current = { x: touch.clientX, y: touch.clientY };
    touchInputs.current.chargeCurve = true; 
  };
  const handleRightTouchMove = (e) => {
    const touch = e.targetTouches[0];
    const prevX = rightStickCurrent.current.x;
    rightStickCurrent.current = { x: touch.clientX, y: touch.clientY };
    let dx = touch.clientX - rightStickBase.current.x; let dy = touch.clientY - rightStickBase.current.y;
    const dist = Math.sqrt(dx*dx+dy*dy);
    if(dist>10) { touchInputs.current.aimX = dx/dist; touchInputs.current.aimZ = dy/dist; }
    touchInputs.current.spinCharge += (touch.clientX - prevX) * 0.05;
  };
  const handleRightTouchEnd = () => { touchInputs.current.chargeCurve = false; };

  let rightLabel = is2v2 ? `${t.bot} & ${t.bot}` : `${t.bot} (${BOT_CFG[difficulty] ? t[difficulty] || difficulty : ''})`;
  if (mode === 'multi') rightLabel = is2v2 ? `${t.bot} & ${t.bot}` : t.p2;
  if (mode.startsWith('online')) rightLabel = t.opponent;
  let leftLabel = mode === 'online-client' ? t.client : t.host;
  if (mode === 'bot') leftLabel = is2v2 ? `Ty & ${t.bot}` : 'Ty';
  if (mode === 'multi') leftLabel = is2v2 ? `P1 & P2` : t.p1;

  const currentControls = controls === 'mouse' ? t.controlsMapMouse : t.controlsMapKbd;

  return(
    <div style={{width:'100vw',height:'100vh',display:'flex',flexDirection:'column',background:'#06090f',fontFamily:'Tahoma,Geneva,sans-serif',overflow:'hidden', cursor: controls==='mouse' ? 'crosshair' : 'default'}}>
      <div style={{background:'#1a1a1a',borderBottom:'1px solid #333',padding:'0 14px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0,height:36}}>
        <button onClick={() => { if(socket) socket.disconnect(); window.location.reload(); }} style={{background:'none',border:'1px solid #444',color:'#aaa',cursor:'pointer',fontFamily:'inherit',fontSize:11,padding:'2px 10px'}}>{t.leave}</button>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <span style={{color:'#3c3',fontSize:12,fontWeight:'bold'}}>{leftLabel}</span>
          <span ref={scoreRef} style={{color:'#fff',fontSize:24,fontWeight:'bold',letterSpacing:8,minWidth:90,textAlign:'center'}}>0 : 0</span>
          <span style={{color:mode==='multi'?'#f80':'#e44',fontSize:12,fontWeight:'bold'}}>{rightLabel}</span>
        </div>
        <span style={{fontSize:10,color:'#555'}}>{t.limit} {scoreLimit}</span>
      </div>

      <div style={{flex:1,position:'relative',overflow:'hidden'}}>
        <div ref={mountRef} style={{width:'100%',height:'100%'}}/>
        <div ref={msgRef} style={{position:'absolute',top:'40%',left:'50%',transform:'translate(-50%,-50%)',color:'#fff',fontSize:42,fontWeight:'bold',background:'rgba(0,0,0,0.6)',padding:'14px 40px',opacity:0,transition:'opacity 0.2s',pointerEvents:'none',whiteSpace:'nowrap', borderRadius:8}}/>
        <div style={{position:'absolute',bottom:42,left:12,right:12,height:3,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
          <div ref={chargeRef} style={{height:'100%',width:'0%',background:'#e90',opacity:0,transition:'background 0.08s'}}/>
        </div>
        <div style={{position:'absolute',bottom:10,left:12,display:'flex',alignItems:'center',gap:8}}>
          <span ref={dashLblRef} style={{fontSize:10,color:'#7c7',minWidth:90}}>{t.dashReady}</span>
          <div style={{width:80,height:5,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
            <div ref={dashBarRef} style={{height:'100%',width:'100%',background:'#338855',transition:'background 0.15s'}}/>
          </div>
        </div>

        {gameOver && (
          <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',display:'flex',justifyContent:'center',alignItems:'center',zIndex:100}}>
             <div style={{background:'#fff',padding:'40px 60px',textAlign:'center',borderRadius:12}}>
               <h2 style={{fontSize:32, color:'#222', marginBottom:10}}>{gameOver.winnerLabel}</h2>
               <p style={{color:'#666', marginBottom:28}}>{t.gameOver} ({t.limit} {scoreLimit})</p>
               <div style={{display:'flex', gap:12}}>
                 <button onClick={()=>window.handleRematch()} style={{flex:1, padding:'12px', fontSize:14, fontWeight:'bold', background:'#2a7a2a', color:'#fff', border:'none', borderRadius:4, cursor:'pointer'}}>{t.rematch}</button>
                 <button onClick={()=>window.location.reload()} style={{flex:1, padding:'12px', fontSize:14, fontWeight:'bold', background:'#ddd', color:'#333', border:'none', borderRadius:4, cursor:'pointer'}}>{t.leave}</button>
               </div>
             </div>
          </div>
        )}

        {!isMobile && (
          <div style={{position:'absolute', bottom: 50, left: 12, width: 300, pointerEvents: 'none', display:'flex', flexDirection:'column', gap: 4}}>
            <div style={{display:'flex', flexDirection:'column', gap:2, textShadow:'1px 1px 0 #000'}}>
              {chatMessages.map((msg, i) => (
                <div key={i} style={{fontSize:12, color:'#fff'}}><span style={{color:'#aaa'}}>{msg.sender}:</span> {msg.text}</div>
              ))}
            </div>
            <form onSubmit={sendChat} style={{pointerEvents: 'auto', marginTop: 6}}>
              <input 
                type="text" placeholder={t.chatPlaceholder} value={chatInput} 
                onChange={e => setChatInput(e.target.value)} 
                onFocus={() => isTyping.current = true} onBlur={() => isTyping.current = false}
                onKeyDown={e => e.stopPropagation()}
                style={{width: '100%', background:'rgba(0,0,0,0.5)', border:'1px solid #444', color:'#fff', padding:'6px 10px', borderRadius: 4, outline:'none', fontSize:12}}
              />
            </form>
          </div>
        )}

        {isMobile && !gameOver && (
          <>
            <div onTouchStart={handleLeftTouchMove} onTouchMove={handleLeftTouchMove} onTouchEnd={handleLeftTouchEnd}
                 style={{position:'absolute',bottom:40,left:40,width:130,height:130,borderRadius:'50%',background:'rgba(255,255,255,0.1)',border:'2px solid rgba(255,255,255,0.3)'}}>
                 <span style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',color:'#fff',opacity:0.5,fontSize:10}}>MOVE</span>
            </div>
            
            <div onTouchStart={handleRightTouchStart} onTouchMove={handleRightTouchMove} onTouchEnd={handleRightTouchEnd}
                 style={{position:'absolute',bottom:40,right:40,width:130,height:130,borderRadius:'50%',background:'rgba(255,255,255,0.1)',border:'2px solid rgba(255,255,255,0.3)'}}>
                 <span style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',color:'#fff',opacity:0.5,fontSize:10}}>CURVE/KICK</span>
            </div>

            <button onTouchStart={()=> { touchInputs.current.chargeStraight = true; setTimeout(()=>touchInputs.current.chargeStraight=false, 50); }} style={{position:'absolute',bottom:180,right:60,width:50,height:50,borderRadius:'50%',background:'rgba(255,160,0,0.3)',color:'#fff',border:'none'}}>FLICK</button>
            <button onTouchStart={()=>touchInputs.current.jump=true} onTouchEnd={()=>touchInputs.current.jump=false} style={{position:'absolute',bottom:180,right:120,width:50,height:50,borderRadius:'50%',background:'rgba(0,160,255,0.3)',color:'#fff',border:'none'}}>JUMP</button>
            <button onTouchStart={()=>touchInputs.current.dash=true} onTouchEnd={()=>touchInputs.current.dash=false} style={{position:'absolute',bottom:120,right:180,width:50,height:50,borderRadius:'50%',background:'rgba(0,255,100,0.3)',color:'#fff',border:'none'}}>DASH</button>
          </>
        )}
      </div>

      {!isMobile && (
        <div style={{background:'#1a1a1a',borderTop:'1px solid #333',padding:'0 16px',flexShrink:0,height:32,display:'flex',gap:18,justifyContent:'center',alignItems:'center',flexWrap:'wrap'}}>
          {currentControls.map(([k,v])=>(
            <span key={k} style={{color:'#666',fontSize:10}}>
              <span style={{color:'#bbb',marginRight:3}}>{k}</span>{v}
            </span>
          ))}
          {mode === 'multi' && <span style={{color:'#888',fontSize:10, marginLeft: 20}}>{t.p2LocalHint}</span>}
        </div>
      )}
    </div>
  );
}

export default function App(){
  const [screen,setScreen]=useState('menu');
  const [cfg,setCfg]=useState({mode:'bot',difficulty:'medium'});
  const [lang, setLang] = useState('en'); 

  if(screen==='menu') return <Menu onStart={c=>{setCfg(c);setScreen('game');}} lang={lang} setLang={setLang} />;
  return <Game {...cfg} lang={lang} onBack={()=>setScreen('menu')}/>;
} 
