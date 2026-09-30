import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { app, fixture, settle } from "./dom-harness.mjs";

test("new header library opens all existing and poster shelves", async t => {
  const a = await app(t);
  a.w.eval(fs.readFileSync(new URL("../poster-ambient.js", import.meta.url), "utf8"));
  a.w.document.dispatchEvent(new a.w.Event("DOMContentLoaded"));

  const button = which => a.w.document.querySelector('[data-library-open="' + which + '"]');
  assert.ok(button("works"));
  assert.ok(button("logos"));
  assert.ok(button("posters"));

  button("posters").click();
  await settle();
  assert.equal(a.el("posterLibraryModal").hidden, false);
  assert.match(a.el("posterLibraryStatus").textContent, /пуст/i);
  a.el("posterLibraryClose").click();
  assert.equal(a.el("posterLibraryModal").hidden, true);

  await a.file("posterFileInput", fixture(500, 750), "film-poster.png");
  button("posters").click();
  for (let i=0;i<25 && !a.el("posterLibraryGallery").querySelector(".poster-library-item");i++) await settle();
  const card = a.el("posterLibraryGallery").querySelector(".poster-library-item");
  assert.ok(card);
  assert.match(card.textContent,/film-poster/);
  assert.equal(card.querySelectorAll(".poster-library-actions>button").length,4);
  a.el("posterLibraryClose").click();

  button("logos").click();
  for(let i=0;i<10 && a.el("logoArchiveModal").hidden;i++) await settle();
  assert.equal(a.el("logoArchiveModal").hidden, false);
  assert.deepEqual(a.errors, []);
});

test("cinematic empty state is UI-only and disappears for a standalone logo", async t => {
  const a = await app(t);
  a.w.eval(fs.readFileSync(new URL("../poster-ambient.js", import.meta.url), "utf8"));
  a.w.document.dispatchEvent(new a.w.Event("DOMContentLoaded"));
  assert.ok(a.el("posterEmpty").querySelector(".pixel-canvas"));
  assert.ok(a.w.document.querySelector("#trainCanvasShell .pixel-stage-overlay"));
  assert.ok(a.w.document.querySelector("#top10CanvasShell .pixel-stage-overlay"));
  await a.file("logoFileInput",fixture(300,100,{logo:true}),"film-logo.png");
  await settle();
  assert.equal(a.el("posterEmpty").hidden,true,"logo alone should hide the decorative scene");
  await a.click("removePosterLogoBtn");
  await settle();
  assert.equal(a.el("posterEmpty").hidden,false,"empty workspace should restore the decorative scene");
  assert.equal(a.el("generateBtn").disabled,true,"paid generation must remain blocked");
  assert.deepEqual(a.errors,[]);
});
