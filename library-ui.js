(() => {
  const $=id=>document.getElementById(id);
  const menu=$("libraryMenu");
  const toggle=$("libraryBtn");
  const modalIds=["archiveModal","logoArchiveModal","posterArchiveModal"];
  function closeMenu(){menu.hidden=true;toggle.setAttribute("aria-expanded","false");}
  async function refreshServerStatus(){
    const badge=$("libraryServerBadge");if(!badge)return;
    badge.textContent="Проверка...";badge.className="library-server-badge";
    try{
      const info=await window.ServerLibrary?.status?.();
      const ok=Boolean(info?.server);
      badge.textContent=ok?"Сервер подключён":"Сервер не настроен";
      badge.className="library-server-badge "+(ok?"ok":"error");
      badge.title=ok?"Архив работ и логотипов хранится на сервере.":"Проверьте Cloud Storage / LIBRARY_BUCKET.";
    }catch(error){
      badge.textContent="Сервер недоступен";badge.className="library-server-badge error";badge.title=error.message||"Ошибка серверного архива";
    }
  }
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
      return WorkArchive.openArchive("all");
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
    if(!menu.hidden){void refreshServerStatus();menu.querySelector("button")?.focus();}
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
  document.addEventListener("click",event=>{
    const btn=event.target.closest("[data-library-export]");
    if(!btn)return;
    btn.disabled=true;
    void LibraryTransfer.exportLibrary(btn.dataset.libraryExport).catch(error=>{
      const toast=$("toast");toast.textContent=error.message||"Не удалось экспортировать архив.";toast.className="toast error";toast.hidden=false;
    }).finally(()=>{btn.disabled=false;});
  });
  $("libraryExportBtn")?.addEventListener("click", async()=>{
    closeMenu();
    try{await LibraryTransfer.exportLibrary();}
    catch(error){const toast=$("toast");toast.textContent=error.message||"Не удалось экспортировать библиотеку.";toast.className="toast error";toast.hidden=false;}
  });
  $("libraryImportFile")?.addEventListener("change",async event=>{
    const file=event.target.files?.[0];if(!file)return;
    closeMenu();
    try{await LibraryTransfer.importLibrary(file);}
    catch(error){const toast=$("toast");toast.textContent=error.message||"Не удалось импортировать библиотеку.";toast.className="toast error";toast.hidden=false;}
    finally{event.target.value="";}
  });
  $("libraryCopyKeyBtn")?.addEventListener("click",async()=>{
    closeMenu();
    try{
      const key=await ServerLibrary.copyKey();
      const toast=$("toast");toast.textContent="Ключ синхронизации скопирован. Сохраните его, чтобы открыть этот же серверный архив на другом устройстве.";toast.className="toast ok";toast.hidden=false;
    }catch(error){const toast=$("toast");toast.textContent=error.message||"Не удалось скопировать ключ.";toast.className="toast error";toast.hidden=false;}
  });
  $("librarySetKeyBtn")?.addEventListener("click",()=>{
    closeMenu();
    const value=window.prompt("Введите ключ синхронизации серверного архива:");
    if(value===null)return;
    try{ServerLibrary.setKey(value);}catch(error){const toast=$("toast");toast.textContent=error.message;toast.className="toast error";toast.hidden=false;}
  });
  void refreshServerStatus();
  window.EditorLibrary={navigate,refreshServerStatus};
})();