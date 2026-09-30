(() => {
  const $=id=>document.getElementById(id);
  const menu=$("libraryMenu");
  const toggle=$("libraryBtn");
  const modalIds=["archiveModal","logoArchiveModal","posterArchiveModal"];
  function closeMenu(){menu.hidden=true;toggle.setAttribute("aria-expanded","false");}
  function destination(){
    const selected=document.querySelector(".workspace-tab.active")?.dataset.workspace || "vertical";
    return ["vertical","horizontal","train","top10"].includes(selected)?selected:"vertical";
  }
  async function navigate(target) {
    closeMenu();
    // Close any other library window before opening the requested section.
    for(const id of modalIds)if($(id))$(id).hidden=true;
    document.body.classList.remove("modal-open");
    const workspace=destination();
    if(target==="works"){
      if(!window.WorkArchive?.openArchive)throw new Error("Архив работ недоступен.");
      return WorkArchive.openArchive(workspace);
    }
    if(target==="logos"){
      if(!window.LogoArchive?.open)throw new Error("Архив логотипов недоступен.");
      return LogoArchive.open(workspace==="train"?"train":workspace==="top10"?"top10":"poster");
    }
    if(target==="posters"){
      if(!window.PosterArchive?.open)throw new Error("Архив постеров недоступен.");
      return PosterArchive.open();
    }
  }
  toggle?.addEventListener("click",()=>{
    menu.hidden=!menu.hidden;toggle.setAttribute("aria-expanded",String(!menu.hidden));
    if(!menu.hidden)menu.querySelector("button")?.focus();
  });
  document.addEventListener("click",event=>{
    const btn=event.target.closest("[data-library-go]");
    if(btn){
      void navigate(btn.dataset.libraryGo).catch(error=>{
        closeMenu();
        const status=$("projectToolsStatus");if(status)status.textContent=error.message||"Не удалось открыть библиотеку.";
      });
      return;
    }
    if(!event.target.closest(".library-menu-wrap"))closeMenu();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape" && !menu.hidden){event.preventDefault();closeMenu();toggle.focus();}
  });
  window.EditorLibrary={navigate};
})();