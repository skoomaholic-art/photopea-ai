import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { app, fixture, settle } from "./dom-harness.mjs";

async function until(check,message){
  for(let n=0;n<70;n++){if(await check())return;await settle();}
  assert.fail(message);
}
function load(w,name){w.eval(fs.readFileSync(new URL("../"+name,import.meta.url),"utf8"));}

test("poster archive renames, searches and removes cards without breaking open poster",async t=>{
  const a=await app(t);
  load(a.w,"poster-archive.js");
  const png=fixture(360,540,{pattern:true});
  await a.file("posterFileInput",png,"my-poster.png");
  await a.w.PosterArchive.open();
  assert.equal(a.el("posterArchiveList").querySelectorAll(".logo-archive-item").length,1);
  const card=a.el("posterArchiveList").querySelector(".logo-archive-item");
  card.querySelectorAll(".logo-archive-actions button")[2].click();
  const form=card.querySelector(".logo-archive-edit");
  form.querySelector("input").value="Крёстный отец";
  form.dispatchEvent(new a.w.Event("submit",{cancelable:true,bubbles:true}));
  await until(()=>a.el("posterArchiveList").textContent.includes("Крёстный отец"),"new filename missing");
  await a.input("posterArchiveSearch","крёстный");
  assert.equal(a.el("posterArchiveList").querySelectorAll(".logo-archive-item").length,1);
  a.w.confirm=()=>true;
  a.el("posterArchiveList").querySelector(".logo-archive-delete-button").click();
  await until(()=>a.el("posterArchiveList").querySelectorAll(".logo-archive-item").length===0,"deleted card remained");
  assert.ok(a.w.PosterApp.getState().vertical.poster,"deletion must not alter the current working image");
  assert.equal((await a.w.AssetManager.list()).filter(x=>x.imageType==="poster"&&x.hiddenFromPosterArchive).length,1);
  await a.w.PosterArchive.close();
  await a.w.PosterArchive.open();
  assert.equal(a.el("posterArchiveList").querySelectorAll(".logo-archive-item").length,0);
  assert.deepEqual(a.errors,[]);
});

test("pixel-art scene belongs to empty UI only, never the saved project",async t=>{
  const a=await app(t);
  a.w.matchMedia=()=>({matches:true});
  load(a.w,"empty-pixel-art.js");
  assert.equal(a.el("stage").querySelectorAll(".pixel-idle").length,1);
  assert.equal(a.el("trainCanvasShell").querySelectorAll(".pixel-idle").length,1);
  assert.equal(a.el("top10CanvasShell").querySelectorAll(".pixel-idle").length,1);
  assert.equal(a.el("stage").querySelector(".pixel-idle").hidden,false);
  await a.file("logoFileInput",fixture(300,115,{logo:true}),"film-logo.png");
  a.w.EmptyPixelArt.sync();
  await until(()=>a.el("stage").querySelector(".pixel-idle").hidden,"scene stayed visible with a logo");
  assert.equal(JSON.stringify(a.w.PosterApp.serialize()).includes("pixel-idle"),false);
  a.w.PosterApp.resetWorkspace && await a.w.PosterApp.resetWorkspace("vertical");
  a.w.EmptyPixelArt.sync();
  assert.equal(a.el("stage").querySelector(".pixel-idle").hidden,false);
  assert.deepEqual(a.errors,[]);
});

test("offline ZIP library export and import restore original poster bytes",async t=>{
  const a=await app(t);
  load(a.w,"library-transfer.js");
  const png=fixture(140,220,{pattern:true});
  await a.file("posterFileInput",png,"library.png");
  let zip;
  const original=a.w.ZipStore.download;
  a.w.ZipStore.download=(blob,name)=>{zip=blob;assert.match(name,/poster-editor-all-archive/);};
  await a.w.LibraryTransfer.exportLibrary();
  assert.ok(zip && zip.size>png.length);
  await a.w.SkoomaStore.clearAssets();
  assert.equal((await a.w.AssetManager.list()).length,0);
  a.w.confirm=()=>true;
  const file=new a.w.File([await zip.arrayBuffer()],"backup.zip",{type:"application/zip"});
  const report=await a.w.LibraryTransfer.importLibrary(file);
  assert.ok(report.assets>=1);
  const restored=(await a.w.AssetManager.list()).find(x=>x.imageType==="poster");
  assert.ok(restored?.originalAsset);
  assert.equal(Buffer.compare(Buffer.from(await restored.originalAsset.arrayBuffer()),png),0);
  a.w.ZipStore.download=original;
  assert.deepEqual(a.errors,[]);
});
