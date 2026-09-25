import { test, expect } from "@playwright/test";

test.describe("Real Photopea layered integration", () => {
  test.skip(!process.env.REAL_PHOTOPEA, "Set REAL_PHOTOPEA=1 to run against photopea.com");
  test.setTimeout(120000);

  test("master document contains independent Background and Poster layers", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.PhotopeaBridge && !!window.PosterApp);

    const diagnostics=[];
    page.on("requestfailed",req=>{if(req.url().includes("photopea.com"))diagnostics.push({path:new URL(req.url()).pathname,error:req.failure()?.errorText});});
    page.on("response",res=>{if(res.url().includes("photopea.com")&&res.status()>=400)diagnostics.push({path:new URL(res.url()).pathname,status:res.status()});});
    const result=await page.evaluate(async () => {
      const c=document.createElement("canvas");
      c.width=32;c.height=48;
      const ctx=c.getContext("2d");
      ctx.fillStyle="#d03030";ctx.fillRect(0,0,32,48);
      ctx.fillStyle="#ffffff";ctx.fillRect(8,10,16,28);
      const src=c.toDataURL("image/png");
      await window.PhotopeaBridge.openLayeredDocument({
        version:1,
        workspace:"vertical",
        document:{name:"REAL PHOTOPEA TEST",width:800,height:1200,background:"#000000"},
        layers:[
          {id:"background",name:"Background",type:"background",color:"#000000",x:400,y:600,width:800,height:1200,opacity:1,visible:true,locked:true,zIndex:0},
          {id:"poster",name:"Poster",type:"image",sourceDataUrl:src,x:400,y:600,width:800,height:1200,rotation:0,opacity:1,visible:true,locked:false,zIndex:1}
        ]
      });
      return window.PhotopeaBridge.inspectActiveDocument();
    }).catch(async error=>{
      const frame=page.frames().find(f=>f.url().includes("photopea.com"));
      const message=frame?await frame.locator("body").innerText({timeout:2000}).catch(()=>"Frame content unavailable"):"No Photopea frame";
      throw new Error(error.message+"\nPhotopea diagnostics: "+JSON.stringify(diagnostics)+"\nFrame: "+message.slice(0,1000));
    });

    expect(result.error).toBeUndefined();
    expect(Math.round(result.width)).toBe(800);
    expect(Math.round(result.height)).toBe(1200);
    expect(result.layers).toContain("Background");
    expect(result.layers).toContain("Poster");
    expect(result.layers.length).toBeGreaterThanOrEqual(2);
  });
});
