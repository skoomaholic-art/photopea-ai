
const $=id=>document.getElementById(id),qs=(s,r=document)=>r.querySelector(s),qsa=(s,r=document)=>[...r.querySelectorAll(s)];
window.APP={
 cfg:{tmdb:localStorage.getItem("skooma.tmdb")||"",fanart:localStorage.getItem("skooma.fanart")||"",jina:localStorage.getItem("skooma.jina")||""},
 activate(id){qsa(".view").forEach(v=>v.classList.toggle("active",v.id===id));qsa(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===id));const v=$(id),f=qs("iframe[data-src]",v);if(f&&!f.getAttribute("src"))f.src=f.dataset.src;if(id==="studioView"&&window.Studio)setTimeout(()=>Studio.fit(),40)}
};
qsa(".tab").forEach(t=>t.onclick=()=>APP.activate(t.dataset.view));
qsa(".ext-open").forEach(b=>b.onclick=()=>window.open(b.dataset.url,"_blank","noopener"));
async function refreshPuter(){try{$("puterState").textContent=puter.auth.isSignedIn()?"Puter: авторизован":"Puter: без входа"}catch{$("puterState").textContent="Puter: готов"}}
$("puterLoginBtn").onclick=async()=>{try{await puter.auth.signIn();refreshPuter()}catch{}};
$("settingsBtn").onclick=()=>{$("tmdbToken").value=APP.cfg.tmdb;$("fanartKey").value=APP.cfg.fanart;$("jinaKey").value=APP.cfg.jina;$("settings").classList.add("open")};
$("closeSettings").onclick=()=>$("settings").classList.remove("open");
$("saveSettings").onclick=()=>{APP.cfg.tmdb=$("tmdbToken").value.trim();APP.cfg.fanart=$("fanartKey").value.trim();APP.cfg.jina=$("jinaKey").value.trim();localStorage.setItem("skooma.tmdb",APP.cfg.tmdb);localStorage.setItem("skooma.fanart",APP.cfg.fanart);localStorage.setItem("skooma.jina",APP.cfg.jina);$("settings").classList.remove("open");if(window.Media)Media.status("Настройки сохранены.","ok")};
refreshPuter();
