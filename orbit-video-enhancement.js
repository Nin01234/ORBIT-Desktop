
// ORBIT desktop video display enhancement (native video only; never touches audio/music).
function attachOrbitVideoEnhancement(video){
 if(!video||!document.documentElement.classList.contains("orbit-desktop-app")||video.dataset.orbitEnhancementReady==="1")return;
 video.dataset.orbitEnhancementReady="1";
 const host=video.parentElement;if(!host)return;
 const panel=document.createElement("div");panel.className="orbit-video-enhance-controls";
 const label=document.createElement("label");label.textContent="Picture quality";
 const select=document.createElement("select");select.setAttribute("aria-label","Video picture quality mode");
 [
  ["original","Original source"],
  ["clarity","Clarity boost"],
  ["4k","4K display upscale"],
  ["8k","8K display upscale"]
 ].forEach(([value,text])=>{const o=document.createElement("option");o.value=value;o.textContent=text;select.appendChild(o);});
 const note=document.createElement("small");note.className="orbit-video-enhance-note";
 const source=document.createElement("span");source.className="orbit-video-source-resolution";
 const updateInfo=()=>{
  const w=video.videoWidth||0,h=video.videoHeight||0;
  source.textContent=w&&h?"Source: "+w+" Ã— "+h:"Source: waiting for video";
  const maxW=Math.round((window.screen?.width||0)*(window.devicePixelRatio||1));
  const maxH=Math.round((window.screen?.height||0)*(window.devicePixelRatio||1));
  const mode=select.value;
  const target=mode==="4k"?"4K":mode==="8k"?"8K":"";
  note.textContent=target
   ?target+" display scaling selected. Your screen and GPU set the actual output; this does not create missing source detail."
   :mode==="clarity"?"Lightweight picture filter enabled. Source resolution and audio remain unchanged."
   :"Original picture. No enhancement filter is applied.";
  if(target&&maxW&&maxH&&Math.min(maxW,maxH)<(mode==="8k"?4320:2160))note.textContent+=" Current display is below "+target+".";
 };
 select.addEventListener("change",()=>{
  const mode=select.value;
  video.style.filter=mode==="clarity"?"contrast(1.08) saturate(1.06) brightness(1.015)":mode==="4k"?"contrast(1.035) saturate(1.025)":"";
  // 8K/4K are honest display-scaling targets; the browser scales to the available display.
  updateInfo();
 });
 video.addEventListener("loadedmetadata",updateInfo);
 video.addEventListener("resize",updateInfo);
 label.appendChild(select);panel.append(label,source,note);
 host.insertBefore(panel,video.nextSibling);
 updateInfo();
}
