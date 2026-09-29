import {test} from "node:test";
import assert from "node:assert/strict";
import {app,fixture,settle} from "./dom-harness.mjs";

async function waitFor(check,message){
  for(let index=0;index<100;index++){
    if(await check()) return;
    await settle();
  }
  assert.fail(message);
}

test("PNG logo archive saves automatically, deduplicates and restores into every editor",async t=>{
  const a=await app(t);
  const png=fixture(360,120,{logo:true,color:"#ffffff"});

  await a.file("logoFileInput",png,"main-logo.png");
  let items=await a.w.LogoArchive.list();
  assert.equal(items.length,1);
  assert.equal(items[0].mimeType,"image/png");
  assert.equal(items[0].archiveKind,"logo");
  assert.match(items[0].fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(items[0].title,"main-logo.png");

  await a.file("logoFileInput",png,"same-pixels.png");
  items=await a.w.LogoArchive.list();
  assert.equal(items.length,1,"the same PNG pixels must not create a second archive card");
  assert.ok(items[0].useCount>=2);
  await a.w.LogoArchive.rememberDataUrl(a.w.PosterApp.getState().vertical.logo,{title:"stale-autosave-name.png",countUse:false});
  items=await a.w.LogoArchive.list();
  assert.equal(items[0].title,"same-pixels.png","restoring an older autosave must not rename the latest archive entry");

  await a.w.LogoArchive.open("top10");
  assert.equal(a.el("logoArchiveModal").hidden,false);
  assert.equal(a.el("logoArchiveList").querySelectorAll(".logo-archive-item").length,1);
  a.el("logoArchiveList").querySelector(".logo-archive-actions .primary").click();
  await waitFor(()=>a.w.Top10Editor.getState().logoName==="same-pixels.png","TOP10 did not receive the archived logo");
  assert.equal(a.el("logoArchiveModal").hidden,true);

  await a.w.LogoArchive.open("train");
  a.el("logoArchiveList").querySelector(".logo-archive-actions .primary").click();
  await waitFor(()=>a.w.TrainEditor.serialize().canvas.objects.some(object=>object.kind==="logo"&&object.name==="same-pixels.png"),"Train editor did not receive the archived logo");
  await waitFor(()=>a.el("logoArchiveModal").hidden,"Train archive operation did not finish");

  a.w.PosterApp.switchWorkspace("horizontal");
  await a.w.LogoArchive.open("poster");
  a.el("logoArchiveList").querySelector(".logo-archive-actions .primary").click();
  await waitFor(()=>a.w.PosterApp.getState().horizontal.logoName==="same-pixels.png","Horizontal poster did not receive the archived logo");
  assert.equal(a.w.PosterApp.getState().vertical.logoName,"same-pixels.png");
  assert.deepEqual(a.errors,[]);
});

test("logo archive search and empty state are understandable",async t=>{
  const a=await app(t);
  await a.w.LogoArchive.open("poster");
  assert.match(a.el("logoArchiveList").textContent,/Архив пока пуст/);
  await a.file("logoFileInput",fixture(240,90,{logo:true}),"FREEDOM.png");
  await a.w.LogoArchive.open("poster");
  await a.input("logoArchiveSearch","missing");
  assert.match(a.el("logoArchiveList").textContent,/ничего не найдено/);
  await a.input("logoArchiveSearch","freedom");
  assert.equal(a.el("logoArchiveList").querySelectorAll(".logo-archive-item").length,1);
  assert.deepEqual(a.errors,[]);
});
