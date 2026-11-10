const { app, BrowserWindow, shell, dialog, ipcMain, session } = require("electron");
const http = require("node:http");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const fs = require("node:fs");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { spawn } = require("node:child_process");
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".ico":"image/x-icon", ".png":"image/png", ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml" };
let localServer;
let mainWindow;
let globalCountryCache = null;
let globalCountryCacheAt = 0;
const globalChannelCache = new Map();
let globalCatalogCache = null;
let globalCatalogCacheAt = 0;
const spinnStationCache = new Map();
let spinnMoviesCache = null;
let spinnMoviesCacheAt = 0;
const youtubeAvailabilityCache = new Map();
const JAMENDO_CLIENT_ID = "6e98aa54"; // ORBIT Jamendo application

app.setAppUserModelId("com.orbit.radio");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

if (hasSingleInstanceLock) {
  app.on("second-instance", focusMainWindow);
}

const OFFLINE_HOSTS = ["archive.org","audius.co","api.audius.co","stream.audius.co","librivox.org","libsyn.com","buzzsprout.com","simplecast.com","megaphone.fm","podbean.com","transistor.fm","anchor.fm","spotifycdn.com","scdn.co","mzstatic.com","podtrac.com","chtbl.com","art19.com","acast.com","omny.fm","soundcloud.com","sndcdn.com","itunes.apple.com","audio-ssl.itunes.apple.com","podcasts.apple.com","feeds.megaphone.fm","traffic.megaphone.fm","cloudfront.net","akamaized.net","fastly.net","amazonaws.com","sndcdn.com"];
function offlineDirectory(){const dir=path.join(app.getPath("userData"),"offline-media");fs.mkdirSync(dir,{recursive:true});return dir;}
function offlineManifestPath(){return path.join(offlineDirectory(),"library.json");}
function readOfflineManifest(){try{return JSON.parse(fs.readFileSync(offlineManifestPath(),"utf8"));}catch{return[];}}
function writeOfflineManifest(items){fs.writeFileSync(offlineManifestPath(),JSON.stringify(items,null,2),"utf8");}
function isAllowedMediaUrl(value){
  try{
    const u=new URL(value),host=u.hostname.toLowerCase();
    if(u.protocol!=="https:"||u.username||u.password||!host||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||require("node:net").isIP(host))return false;
    return true;
  }catch{return false;}
}
ipcMain.handle("orbit:offline-list",()=>readOfflineManifest());
ipcMain.handle("orbit:offline-download",async(_event,item)=>{
  if(!item||typeof item.url!=="string"||!isAllowedMediaUrl(item.url))throw new Error("This provider does not permit downloads through ORBIT.");
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new Error("Download timed out. Try again on a stronger connection.")),10*60*1000);
  let tempPath="";
  try{
    const response=await fetch(item.url,{redirect:"follow",signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 ORBIT/1.0","Accept":"audio/*,video/*,application/octet-stream,*/*"}});
    if(!response.ok)throw new Error("The media provider returned HTTP "+response.status+".");
    if(!response.body)throw new Error("The provider returned an empty response.");
    const audiusStream=/^https:\/\/api\.audius\.co\/v1\/tracks\/\d+\/stream(?:\?|$)/i.test(item.url);
    const finalUrl=new URL(response.url);
    const trustedFinalHost=isAllowedMediaUrl(response.url)||(audiusStream&&finalUrl.protocol==="https:"&&!finalUrl.username&&!finalUrl.password&&!require("node:net").isIP(finalUrl.hostname));
    if(!trustedFinalHost)throw new Error("The provider redirected the download to a host ORBIT does not trust.");
    const declared=Number(response.headers.get("content-length")||0);
    if(declared>500*1024*1024)throw new Error("This file is larger than ORBIT's 500 MB offline limit.");
    const id=require("node:crypto").randomUUID();
    tempPath=path.join(offlineDirectory(),id+".part");
    let bytes=0;
    const limiter=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(bytes>500*1024*1024){callback(new Error("This file is larger than ORBIT's 500 MB offline limit."));return;}callback(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),limiter,fs.createWriteStream(tempPath));
    const contentType=(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
    const previewBuffer=Buffer.alloc(Math.min(512,bytes));
    const fd=fs.openSync(tempPath,"r");try{fs.readSync(fd,previewBuffer,0,previewBuffer.length,0);}finally{fs.closeSync(fd);}
    const preview=previewBuffer.toString("utf8").trimStart().toLowerCase();
    if(contentType==="text/html"||contentType==="application/xhtml+xml"||preview.startsWith("<!doctype html")||preview.startsWith("<html")||preview.startsWith(String.fromCharCode(123,34)+"error"+String.fromCharCode(34))||preview.startsWith(String.fromCharCode(123,34)+"message"+String.fromCharCode(34)))throw new Error("The provider returned a webpage or API message, not a media file. This link cannot be downloaded directly.");
    const disposition=response.headers.get("content-disposition")||"";
    const dispositionName=(disposition.match(/filename\*?=(?:UTF-8''|\\")?([^\\";]+)/i)||[])[1]||"";
    let ext=path.extname(finalUrl.pathname).toLowerCase()||path.extname(dispositionName).toLowerCase();
    const known={"audio/mpeg":".mp3","audio/mp3":".mp3","audio/mp4":".m4a","audio/aac":".aac","audio/ogg":".ogg","application/ogg":".ogg","audio/wav":".wav","audio/x-wav":".wav","video/mp4":".mp4","video/webm":".webm"};
    if(![".mp3",".m4a",".aac",".ogg",".wav",".mp4",".webm",".m4v"].includes(ext))ext=known[contentType]||"";
    if(!ext){
      const b=previewBuffer;
      if(b.length>4&&b.subarray(0,3).toString()==="ID3")ext=".mp3";
      else if(b.length>12&&b.subarray(4,8).toString()==="ftyp")ext=".mp4";
      else if(b.length>4&&b.subarray(0,4).toString()==="OggS")ext=".ogg";
      else if(b.length>12&&b.subarray(0,4).toString()==="RIFF")ext=".wav";
      else if(b.length>2&&b[0]===0xff&&(b[1]&0xe0)===0xe0)ext=".mp3";
    }
    if(!ext)throw new Error("The provider returned an unsupported media format ("+(contentType||"unknown type")+").");
    const filename=id+ext;
    fs.renameSync(tempPath,path.join(offlineDirectory(),filename));tempPath="";
    const record={id,filename,title:String(item.title||"Offline media").slice(0,180),kind:String(item.kind||"media").slice(0,24),contentType,bytes,savedAt:new Date().toISOString(),artwork:typeof item.artwork==="string"?item.artwork.slice(0,1500):""};
    const list=readOfflineManifest();list.unshift(record);writeOfflineManifest(list);
    return record;
  }catch(error){
    if(tempPath){try{fs.unlinkSync(tempPath);}catch{}}
    if(controller.signal.aborted)throw new Error("Download timed out. Try again on a stronger connection.");
    throw error;
  }finally{clearTimeout(timeout);}
});
ipcMain.handle("orbit:offline-delete",(_event,id)=>{
  const list=readOfflineManifest();
  const item=list.find(x=>x.id===id);
  if(!item)return false;
  const dir=offlineDirectory();
  const filename=typeof item.filename==="string"?path.basename(item.filename):"";
  if(!filename||filename!==item.filename||filename==="."||filename==="..")throw new Error("Invalid offline download filename.");
  const target=path.resolve(dir,filename);
  if(path.dirname(target)!==path.resolve(dir))throw new Error("Download path is outside ORBIT storage.");
  try{fs.unlinkSync(target);}catch(error){if(error.code!=="ENOENT")throw error;}
  writeOfflineManifest(list.filter(x=>x.id!==id));
  return true;
});

function createLocalServer(root) {
  return http.createServer(async (req, res) => {
    const origin=req.headers.origin||"";
    if(["capacitor://localhost","http://localhost","https://localhost","ionic://localhost"].includes(origin)){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","GET,HEAD,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type,Range");}
    if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
    let requestUrl;
    try { requestUrl = new URL(req.url, "http://127.0.0.1"); }
    catch { res.writeHead(400).end("Bad request"); return; }

    if (requestUrl.pathname === "/auth/spotify/callback") {
      const params=new URLSearchParams();
      for(const key of ["code","state","error"]){const value=requestUrl.searchParams.get(key);if(value)params.set(key==="code"?"spotify_code":key==="state"?"spotify_state":"spotify_error",value.slice(0,4096));}
      res.writeHead(302,{"Location":"/?"+params.toString(),"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});res.end();return;
    }

    if (requestUrl.pathname === "/api/radio-stations") {
      const allowed = new Set(["name","tag","countrycode","language","limit","offset","order","reverse","hidebroken"]);
      const params = new URLSearchParams();
      for (const [key,value] of requestUrl.searchParams) if (allowed.has(key) && value.length <= 100) params.set(key,value);
      if (!params.has("limit")) params.set("limit","80");
      if (!params.has("hidebroken")) params.set("hidebroken","true");
      const cacheKey=params.toString();
      const cached=spinnStationCache.get(cacheKey);
      if(cached && Date.now()-cached.at<120000){
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=60","X-Content-Type-Options":"nosniff"});
        res.end(JSON.stringify(cached.data));return;
      }
      try{
        const upstream=await fetch("https://spinnradio.com/api/stations?"+cacheKey,{
          headers:{"User-Agent":"ORBIT Desktop/1.2 (radio globe integration)","Accept":"application/json"},
          signal:AbortSignal.timeout(25000)
        });
        if(!upstream.ok)throw new Error("Spinn Radio station catalogue returned HTTP "+upstream.status);
        const data=await upstream.json();
        if(!Array.isArray(data))throw new Error("Spinn Radio returned an unexpected station catalogue");
        const safe=data.filter(station=>station&&station.stationuuid&&station.name&&
          [station.url_resolved,station.url].some(value=>{try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}));
        spinnStationCache.set(cacheKey,{data:safe,at:Date.now()});
        if(spinnStationCache.size>100)spinnStationCache.delete(spinnStationCache.keys().next().value);
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=60","X-Content-Type-Options":"nosniff"});
        res.end(JSON.stringify(safe));
      }catch(error){
        if(cached && Date.now()-cached.at<7*60*1000){
          res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","X-ORBIT-Stale":"1","X-Content-Type-Options":"nosniff"});
          res.end(JSON.stringify(cached.data));return;
        }
        res.writeHead(502,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"}).end(error.message||"Spinn Radio station catalogue unavailable");
      }
      return;
    }

    if (requestUrl.pathname === "/api/spinn-movies") {
      if(spinnMoviesCache && Date.now()-spinnMoviesCacheAt<60*60*1000){
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=1800","X-Content-Type-Options":"nosniff"});
        res.end(JSON.stringify(spinnMoviesCache));return;
      }
      try{
        const upstream=await fetch("https://spinnradio.com/api/movies",{
          headers:{"User-Agent":"ORBIT Desktop/1.2 (TMDB movie catalogue)","Accept":"application/json"},
          signal:AbortSignal.timeout(30000)
        });
        if(!upstream.ok)throw new Error("Spinn Radio TMDB catalogue returned HTTP "+upstream.status);
        const data=await upstream.json();
        if(!data||!Array.isArray(data.rows))throw new Error("TMDB catalogue response was not valid");
        spinnMoviesCache=data;spinnMoviesCacheAt=Date.now();
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=1800","X-Content-Type-Options":"nosniff"});
        res.end(JSON.stringify(data));
      }catch(error){
        if(spinnMoviesCache){
          res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","X-ORBIT-Stale":"1","X-Content-Type-Options":"nosniff"});
          res.end(JSON.stringify(spinnMoviesCache));return;
        }
        res.writeHead(502,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"}).end(error.message||"TMDB movie catalogue unavailable");
      }
      return;
    }

    if (requestUrl.pathname === "/api/tv-proxy" || requestUrl.pathname === "/api/radio-proxy") {
      try {
        const target = new URL(requestUrl.searchParams.get("url") || "");
        const isPublicHost = host => {
          const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
          if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return false;
          const net = require("node:net");
          if (!net.isIP(h)) return true;
          if (h.includes(":")) return !(/^::1$|^::$|^fc|^fd|^fe80:/i.test(h));
          const p = h.split(".").map(Number);
          return !(p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] === 169 && p[1] === 254 || p[0] === 192 && p[1] === 168 || p[0] === 172 && p[1] >= 16 && p[1] <= 31);
        };
        if (!["http:", "https:"].includes(target.protocol) || !isPublicHost(target.hostname) || target.username || target.password) {
          res.writeHead(400).end("Invalid TV stream address"); return;
        }
        const isRadio = requestUrl.pathname === "/api/radio-proxy";
        const headers = {
          "Accept": isRadio ? "audio/*,application/ogg,application/octet-stream,*/*" : "*/*",
          "User-Agent": (requestUrl.searchParams.get("ua") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 ORBIT/1.0").slice(0, 300)
        };
        if (isRadio) headers["Icy-MetaData"] = "0";
        const referrer = requestUrl.searchParams.get("ref") || "";
        try { const ref = new URL(referrer); if (ref.protocol === "http:" || ref.protocol === "https:") headers.Referer = ref.toString().slice(0, 1000); } catch {}
        if (req.headers.range) headers.Range = req.headers.range;
        // Bound only the connection/redirect phase. Never time out the live audio body:
        // a radio stream is expected to remain open for hours.
        const connectController = new AbortController();
        const connectTimer = setTimeout(() => connectController.abort(), isRadio ? 30000 : 35000);
        let upstream;
        try {
          upstream = await fetch(target, { headers, redirect: "follow", signal: connectController.signal });
        } finally {
          clearTimeout(connectTimer);
        }
        if (isRadio) res.once("close", () => { if (!res.writableEnded) connectController.abort(); });
        if (!upstream.ok || !upstream.body) { res.writeHead(upstream.status || 502).end("TV broadcaster stream unavailable"); return; }
        const finalUrl = new URL(upstream.url);
        if (!isPublicHost(finalUrl.hostname) || !["http:", "https:"].includes(finalUrl.protocol)) { res.writeHead(502).end("TV stream redirected to an invalid host"); return; }
        const type = (upstream.headers.get("content-type") || "").toLowerCase();
        const isPlaylist = type.includes("mpegurl") || type.includes("scpls") || /\.(m3u8?|pls)(?:$|\?)/i.test(finalUrl.pathname);
        if (isPlaylist) {
          let body = await upstream.text();
          const isHlsPlaylist = body.includes("#EXT-X-");
          const proxyPath = isRadio ? "/api/radio-proxy" : "/api/tv-proxy";
          const proxy = value => {
            const absolute = new URL(value, finalUrl).toString();
            const params = new URLSearchParams({ url: absolute });
            if (referrer) params.set("ref", referrer);
            if (headers["User-Agent"]) params.set("ua", headers["User-Agent"]);
            return proxyPath + "?" + params.toString();
          };
          if (isRadio && !isHlsPlaylist) {
            const lines = body.split("\n").map(line => line.trim());
            let streamUrl = "";
            for (const line of lines) {
              if (!line || line.startsWith("#")) continue;
              const value = line.includes("=") ? line.slice(line.indexOf("=") + 1).trim() : line;
              if (value.startsWith("http://") || value.startsWith("https://")) { streamUrl = value; break; }
            }
            if (!streamUrl) { res.writeHead(502).end("The station playlist did not contain a playable stream URL"); return; }
            res.writeHead(302, { "Location": proxy(streamUrl), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
            res.end(); return;
          }
          body = body.split(/\r?\n/).map(line => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, uri) => 'URI="' + proxy(uri) + '"');
            return proxy(trimmed);
          }).join("\n");
          res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" });
          res.end(body); return;
        }
        const responseHeaders = { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
        for (const name of ["content-length", "content-range", "accept-ranges"]) { const v = upstream.headers.get(name); if (v) responseHeaders[name] = v; }
        res.writeHead(upstream.status, responseHeaders);
        Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
      } catch (error) {
        if (!res.headersSent) { res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }).end(error.message || "TV stream proxy failed"); }
        else res.destroy();
      }
      return;
    }

    if (requestUrl.pathname === "/api/global-search") {
      try {
        const query=(requestUrl.searchParams.get("q")||"").trim().toLowerCase().slice(0,80);
        if(query.length<2){res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"}).end(JSON.stringify({channels:[],streams:[]}));return;}
        if(!globalCatalogCache||Date.now()-globalCatalogCacheAt>6*60*60*1000){
          const [channelResponse,streamResponse]=await Promise.all([
            fetch("https://iptv-org.github.io/api/channels.json",{headers:{"User-Agent":"ORBIT/1.0"},signal:AbortSignal.timeout(60000)}),
            fetch("https://iptv-org.github.io/api/streams.json",{headers:{"User-Agent":"ORBIT/1.0"},signal:AbortSignal.timeout(60000)})
          ]);
          if(!channelResponse.ok||!streamResponse.ok)throw new Error("Global TV search directory unavailable");
          const [channels,streams]=await Promise.all([channelResponse.json(),streamResponse.json()]);
          globalCatalogCache={channels,streams};globalCatalogCacheAt=Date.now();
        }
        if(!globalCountryCache){
          try{const cr=await fetch("https://dearbulut.github.io/iptv/api/v1/countries.json",{headers:{"User-Agent":"ORBIT/1.0"},signal:AbortSignal.timeout(20000)});if(cr.ok)globalCountryCache=(await cr.json()).filter(c=>c&&c.code&&c.name);}catch{}
        }
        const countryCodes=new Set((globalCountryCache||[]).filter(c=>(c.name||"").toLowerCase().includes(query)).map(c=>String(c.code).toLowerCase()));
        let matches=globalCatalogCache.channels.filter(ch=>ch&&ch.id&&(
          [ch.name,ch.network,ch.country,...(ch.alt_names||[])].join(" ").toLowerCase().includes(query)||countryCodes.has(String(ch.country||"").toLowerCase())
        ));
        const fallbackCodes=countryCodes.size?[...countryCodes]:(/^(gtv|joy news|joynews|tv3 ghana)$/i.test(query)?["gh"]:[]);
        const fallbackChannels=[];
        for(const code of fallbackCodes.slice(0,3)){
          try{
            const response=await fetch("https://dearbulut.github.io/iptv/api/v1/by-country/"+code+".json.gz",{headers:{"User-Agent":"ORBIT/1.0"},signal:AbortSignal.timeout(30000)});
            if(!response.ok)continue;
            const packed=Buffer.from(await response.arrayBuffer());let list;
            try{list=JSON.parse(gunzipSync(packed).toString("utf8"));}catch{list=JSON.parse(packed.toString("utf8"));}
            const selected=list.filter(ch=>ch&&ch.id&&Array.isArray(ch.streams)&&ch.streams.length&&(
              countryCodes.size||[ch.name,...(ch.alt_names||[])].join(" ").toLowerCase().includes(query)
            ));
            fallbackChannels.push(...selected);
          }catch{}
        }
        const byId=new Map();for(const ch of [...matches,...fallbackChannels])if(ch&&ch.id&&!byId.has(ch.id))byId.set(ch.id,ch);
        matches=[...byId.values()].sort((a,b)=>{
          const an=(a.name||"").toLowerCase(),bn=(b.name||"").toLowerCase();
          const as=an===query?0:an.startsWith(query)?1:2,bs=bn===query?0:bn.startsWith(query)?1:2;
          return as-bs||an.localeCompare(bn);
        }).slice(0,20);
        const ids=new Set(matches.map(ch=>ch.id));
        const streams=globalCatalogCache.streams.filter(st=>st&&ids.has(st.channel)&&st.url);
        for(const ch of matches)for(const st of ch.streams||[])if(st&&st.url&&!streams.some(x=>x.url===st.url))streams.push({...st,channel:ch.id});
        const output=matches.map(ch=>({...ch,streams:streams.filter(st=>st.channel===ch.id)}));
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
        res.end(JSON.stringify({channels:output,streams}));
      } catch(error) {
        res.writeHead(502,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"}).end(error.message||"Global TV search unavailable");
      }
      return;
    }

    if (requestUrl.pathname === "/api/global-countries") {
      try {
        if (!globalCountryCache || Date.now() - globalCountryCacheAt > 24 * 60 * 60 * 1000) {
          let countries=[];
          try{
            const upstream=await fetch("https://dearbulut.github.io/iptv/api/v1/countries.json",{headers:{"User-Agent":"ORBIT/1.0","Accept":"application/json"},signal:AbortSignal.timeout(30000)});
            if(upstream.ok)countries=await upstream.json();
          }catch{}
          if(!Array.isArray(countries)||!countries.length){
            const fallback=await fetch("https://iptv-org.github.io/api/countries.json",{headers:{"User-Agent":"ORBIT/1.0"},signal:AbortSignal.timeout(30000)});
            if(!fallback.ok)throw new Error("Both country directories are unavailable");
            countries=await fallback.json();
          }
          globalCountryCache=countries.filter(x=>x&&x.code&&x.name);
          globalCountryCacheAt=Date.now();
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify(globalCountryCache));
      } catch (error) {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        res.end("Country directory unavailable: " + (error.message || "upstream request failed"));
      }
      return;
    }
    if (requestUrl.pathname === "/api/global-channels") {
      try {
        const country = (requestUrl.searchParams.get("country") || "").toLowerCase();
        if (!/^[a-z]{2}$/.test(country)) { res.writeHead(400).end("Choose a valid country code"); return; }
        let data = globalChannelCache.get(country);
        if (!data || Date.now() - data.cachedAt > 6 * 60 * 60 * 1000) {
          let channels=null;
          try{
            const upstream=await fetch("https://dearbulut.github.io/iptv/api/v1/by-country/"+country+".json.gz",{headers:{"User-Agent":"ORBIT/1.0","Accept":"application/gzip"},signal:AbortSignal.timeout(45000)});
            if(upstream.ok){
              const packed=Buffer.from(await upstream.arrayBuffer());
              try{channels=JSON.parse(gunzipSync(packed).toString("utf8"));}
              catch{channels=JSON.parse(packed.toString("utf8"));}
            }
          }catch{}
          if(!Array.isArray(channels)||!channels.length||!channels.some(ch=>Array.isArray(ch.streams)&&ch.streams.some(st=>st&&st.url))){
            const [channelResponse,streamResponse]=await Promise.all([
              fetch("https://iptv-org.github.io/api/channels.json",{headers:{"User-Agent":"ORBIT/1.0"},signal:AbortSignal.timeout(60000)}),
              fetch("https://iptv-org.github.io/api/streams.json",{headers:{"User-Agent":"ORBIT/1.0"},signal:AbortSignal.timeout(60000)})
            ]);
            if(!channelResponse.ok||!streamResponse.ok)throw new Error("Both TV channel catalogues are unavailable for "+country.toUpperCase());
            const [allChannels,allStreams]=await Promise.all([channelResponse.json(),streamResponse.json()]);
            const ids=new Set(allChannels.filter(ch=>ch&&ch.id&&String(ch.country||"").toLowerCase()===country).map(ch=>ch.id));
            const byChannel=new Map();
            for(const st of allStreams){if(st&&ids.has(st.channel)&&st.url){if(!byChannel.has(st.channel))byChannel.set(st.channel,[]);byChannel.get(st.channel).push(st);}}
            channels=allChannels.filter(ch=>ch&&ids.has(ch.id)).map(ch=>({...ch,streams:byChannel.get(ch.id)||[]}));
          }
          const normalised = channels.filter(x => x && x.id && x.name).map(ch => ({
            ...ch,
            streams: Array.isArray(ch.streams) ? ch.streams : []
          }));
          const streams = normalised.flatMap(ch => ch.streams.filter(st => st && st.url && /^https?:\/\//i.test(st.url)).map(st => ({
            ...st, channel: ch.id
          })));
          data = { channels: normalised, streams, cachedAt: Date.now() };
          globalChannelCache.set(country, data);
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify({ channels: data.channels, streams: data.streams }));
      } catch (error) {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        res.end("Channel directory unavailable for this country: " + (error.message || "upstream request failed"));
      }
      return;
    }

    if (requestUrl.pathname === "/api/offline-list") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(readOfflineManifest().map(({id,title,kind,contentType,bytes,savedAt,artwork})=>({id,title,kind,contentType,bytes,savedAt,artwork}))));
      return;
    }
    if (requestUrl.pathname === "/api/offline-file") {
      const id=requestUrl.searchParams.get("id")||"";
      const item=readOfflineManifest().find(x=>x.id===id);
      if(!item){res.writeHead(404).end("Offline item not found");return;}
      const file=path.join(offlineDirectory(),path.basename(item.filename));
      fs.stat(file,(statErr,stat)=>{
        if(statErr||!stat.isFile()){res.writeHead(404).end("Offline file missing");return;}
        const size=stat.size;
        const type=item.contentType||"application/octet-stream";
        const rangeHeader=req.headers.range;
        const headers={"Content-Type":type,"Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"};
        if(rangeHeader){
          const match=/^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
          if(!match){res.writeHead(416,{"Content-Range":"bytes */"+size,"Accept-Ranges":"bytes"}).end();return;}
          let start,end;
          if(match[1]===""){
            const suffix=Number(match[2]);
            if(!Number.isSafeInteger(suffix)||suffix<=0){res.writeHead(416,{"Content-Range":"bytes */"+size}).end();return;}
            start=Math.max(0,size-suffix);end=size-1;
          }else{
            start=Number(match[1]);end=match[2]===""?size-1:Number(match[2]);
          }
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){
            res.writeHead(416,{"Content-Range":"bytes */"+size,"Accept-Ranges":"bytes"}).end();return;
          }
          end=Math.min(end,size-1);
          headers["Content-Range"]="bytes "+start+"-"+end+"/"+size;
          headers["Content-Length"]=end-start+1;
          res.writeHead(206,headers);
          if(req.method==="HEAD"){res.end();return;}
          const stream=fs.createReadStream(file,{start,end});
          stream.on("error",()=>{if(!res.headersSent)res.writeHead(500);res.destroy();});
          stream.pipe(res);
          return;
        }
        headers["Content-Length"]=size;
        res.writeHead(200,headers);
        if(req.method==="HEAD"){res.end();return;}
        const stream=fs.createReadStream(file);
        stream.on("error",()=>{if(!res.headersSent)res.writeHead(500);res.destroy();});
        stream.pipe(res);
      });
      return;
    }

    if (requestUrl.pathname === "/api/music-search") {
      try {
        const query = (requestUrl.searchParams.get("q") || "trending").trim().slice(0, 100);
        const trending = !query || query.toLowerCase() === "trending";
        const headers = { "User-Agent": "ORBIT/1.0", "Accept": "application/json" };
        const jobs = [];
        jobs.push((async () => {
          const u = new URL("https://api.audius.co/v1/" + (trending ? "tracks/trending" : "tracks/search"));
          u.searchParams.set("limit", "30"); u.searchParams.set("app_name", "ORBIT");
          if (!trending) u.searchParams.set("query", query);
          const r = await fetch(u, { headers, signal: AbortSignal.timeout(16000) });
          if (!r.ok) throw Error("Audius unavailable");
          const p = await r.json();
          return (p.data || []).filter(t => t && t.track_id && t.is_streamable === true && t.is_available !== false && t.is_stream_gated !== true && t.is_unlisted !== true && t.is_delete !== true && t.access?.stream !== false).map(t => ({
            id: "audius:" + t.track_id, providerId: String(t.track_id), source: "Audius", title: t.title || "Untitled track",
            artist: t.user?.name || t.user?.handle || "Independent artist", duration: Number(t.duration) || 0,
            genre: t.genre || "", artwork: t.artwork?.["480x480"] || t.artwork?.["150x150"] || "",
            permalink: t.permalink || "", playbackUrl: "", previewOnly: false, canDownload: true
          }));
        })());
        if (JAMENDO_CLIENT_ID) jobs.push((async () => {
          const u = new URL("https://api.jamendo.com/v3.0/tracks/");
          u.searchParams.set("client_id", JAMENDO_CLIENT_ID); u.searchParams.set("format", "json");
          u.searchParams.set("limit", "24"); u.searchParams.set("audioformat", "mp31");
          u.searchParams.set("order", "popularity_total");
          if (!trending) u.searchParams.set("search", query);
          const r = await fetch(u, { headers, signal: AbortSignal.timeout(16000) });
          if (!r.ok) throw Error("Jamendo unavailable");
          const p = await r.json();
          return (p.results || []).filter(t => t.id && t.audio).map(t => ({
            id: "jamendo:" + t.id, providerId: String(t.id), source: "Jamendo", title: t.name || "Untitled track",
            artist: t.artist_name || "Independent artist", duration: Number(t.duration) || 0,
            genre: (t.musicinfo?.tags?.genres || [])[0] || "", artwork: t.album_image || "",
            permalink: t.shareurl || "", playbackUrl: t.audio, previewOnly: false, canDownload: false
          }));
        })());
        const settled = await Promise.allSettled(jobs);
        const output = settled.filter(x => x.status === "fulfilled").flatMap(x => x.value);
        const seen = new Set();
        const unique = output.filter(t => { const k=(t.title+"|"+t.artist).toLowerCase().replace(/[^a-z0-9]+/g,""); if(seen.has(k))return false;seen.add(k);return true; });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify({ tracks: unique, providers: { audius: settled[0]?.status === "fulfilled", jamendo: !!JAMENDO_CLIENT_ID, spotify: false, soundcloud: false, audiomack: false } }));
      } catch { res.writeHead(502).end("Could not retrieve music catalogue"); }
      return;
    }

    if (requestUrl.pathname === "/api/itunes-search") {
      try {
        const term=(requestUrl.searchParams.get("term")||"top podcasts").trim().slice(0,100);
        const kind=requestUrl.searchParams.get("kind")||"podcast";
        const entity=kind==="podcast"?"podcast":kind==="music"?"song":kind==="movies"?"movie":"podcast";
        const apiUrl=new URL("https://itunes.apple.com/search");apiUrl.searchParams.set("term",term);apiUrl.searchParams.set("entity",entity);apiUrl.searchParams.set("limit","24");
        const upstream=await fetch(apiUrl,{headers:{"User-Agent":"ORBIT/1.0","Accept":"application/json"},signal:AbortSignal.timeout(20000)});
        if(!upstream.ok)throw new Error("Apple catalogue HTTP "+upstream.status);
        const payload=await upstream.json();res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=300","Access-Control-Allow-Origin":"*","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(payload));
      }catch(error){res.writeHead(502,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}).end(JSON.stringify({error:"Apple catalogue unavailable",detail:error.message}));}
      return;
    }
    if (requestUrl.pathname === "/api/podcast-episodes") {
      try {
        const id = requestUrl.searchParams.get("id") || "";
        if (!/^\d{1,16}$/.test(id)) { res.writeHead(400).end("Invalid podcast"); return; }
        const apiUrl = new URL("https://itunes.apple.com/lookup");
        apiUrl.searchParams.set("id", id);
        apiUrl.searchParams.set("entity", "podcastEpisode");
        apiUrl.searchParams.set("limit", "80");
        const upstream = await fetch(apiUrl, { headers: { "User-Agent": "ORBIT/1.0" }, signal: AbortSignal.timeout(18000) });
        if (!upstream.ok) { res.writeHead(502).end("Podcast episodes unavailable"); return; }
        const payload = await upstream.json();
        const episodes = (payload.results || []).filter(x => x.wrapperType === "podcastEpisode" && String(x.episodeUrl || "").startsWith("https://")).map(x => ({
          id: String(x.trackId || ""),
          title: x.trackName || "Podcast episode",
          date: x.releaseDate || "",
          duration: Number(x.trackTimeMillis) || 0,
          audio: x.episodeUrl,
          artwork: x.artworkUrl600 || x.artworkUrl160 || ""
        }));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify(episodes));
      } catch { res.writeHead(502).end("Could not retrieve podcast episodes"); }
      return;
    }

    if (requestUrl.pathname === "/api/audius-stream") {
      try {
        const id = requestUrl.searchParams.get("id") || "";
        if (!/^\d{1,16}$/.test(id)) { res.writeHead(400).end("Invalid track"); return; }
        const headers = { "User-Agent": "ORBIT/1.0" };
        if (req.headers.range) headers.Range = req.headers.range;
        const upstream = await fetch("https://api.audius.co/v1/tracks/" + id + "/stream?app_name=ORBIT", {
          headers, signal: AbortSignal.timeout(25000), redirect: "follow"
        });
        if (!upstream.ok || !upstream.body) { res.writeHead(upstream.status || 502).end("This track cannot be streamed right now"); return; }
        const responseHeaders = {
          "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
          "Cache-Control": "no-store",
          "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
          "X-Content-Type-Options": "nosniff"
        };
        for (const name of ["content-length", "content-range"]) {
          const value = upstream.headers.get(name);
          if (value) responseHeaders[name] = value;
        }
        res.writeHead(upstream.status, responseHeaders);
        Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
      } catch { if (!res.headersSent) res.writeHead(502).end("Music stream unavailable"); else res.destroy(); }
      return;
    }

    if (requestUrl.pathname === "/api/movie-trailers") {
      try {
        const title = (requestUrl.searchParams.get("title") || "").trim().slice(0, 100);
        const year = (requestUrl.searchParams.get("year") || "").replace(/[^0-9]/g, "").slice(0, 4);
        if (title.length < 2) { res.writeHead(400).end("A movie title is required"); return; }
        const cleanTitle = title.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
        const headers = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        };
        const parseSearch = async query => {
          const searchUrl = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
          const upstream = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(18000) });
          if (!upstream.ok) return [];
          const html = await upstream.text();
          const match = html.match(/ytInitialData\s*=\s*(\{.*?\})\s*;\s*<\/script>/s);
          if (!match) return [];
          const data = JSON.parse(match[1]);
          const found = [];
          const walk = value => {
            if (!value || typeof value !== "object" || found.length >= 35) return;
            if (value.videoRenderer) {
              const v = value.videoRenderer;
              const videoTitle = v.title?.runs?.map(x => x.text || "").join("") || v.title?.simpleText || "";
              const author = v.ownerText?.runs?.map(x => x.text || "").join("") || v.shortBylineText?.runs?.map(x => x.text || "").join("") || "YouTube";
              const thumbnails = v.thumbnail?.thumbnails || [];
              const length = v.lengthText?.simpleText || "";
              const seconds = length.split(":").reduce((n, part) => n * 60 + (Number(part) || 0), 0);
              if (v.videoId && /^[A-Za-z0-9_-]{11}$/.test(v.videoId) && seconds >= 45 && /\b(trailer|teaser)\b/i.test(videoTitle) && !/reaction|review|explained|recap|fan.?made|parody|compilation/i.test(videoTitle)) {
                found.push({ videoId: v.videoId, title: videoTitle.slice(0, 180), author: author.slice(0, 100), length, thumbnail: thumbnails.at(-1)?.url || "" });
              }
              return;
            }
            if (Array.isArray(value)) for (const item of value) walk(item);
            else for (const item of Object.values(value)) walk(item);
          };
          walk(data);
          return found;
        };
        const yearPart = year ? " " + year : "";
        const netflixResults = await parseSearch('"' + cleanTitle + '"' + yearPart + " official trailer Netflix");
        const netflixOnly = netflixResults.filter(v => /^Netflix(?:\s|$|:)/i.test(v.author) || /^Netflix\b/i.test(v.author));
        let otherResults = [];
        if (netflixOnly.length < 3) {
          otherResults = await parseSearch('"' + cleanTitle + '"' + yearPart + " official trailer");
        }
        const seen = new Set();
        const trailers = [...netflixOnly.map(v => ({...v, source: "Netflix channel"})), ...otherResults.map(v => ({...v, source: "YouTube result"}))]
          .filter(v => {
            if (seen.has(v.videoId)) return false;
            seen.add(v.videoId);
            const titleMatch = v.title.toLowerCase().includes(cleanTitle.toLowerCase()) || cleanTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3).some(w => v.title.toLowerCase().includes(w));
            return titleMatch;
          }).slice(0, 8).map(v => ({
            youtubeId: v.videoId, title: v.title, thumbnail: v.thumbnail,
            channel: v.author, source: v.source
          }));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=1800", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify({ title: cleanTitle, trailers }));
      } catch (error) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify({ title: "", trailers: [], message: "Trailer search is temporarily unavailable." }));
      }
      return;
    }

    if (requestUrl.pathname === "/api/mobile-info") { const os=require("node:os");const addresses=Object.entries(os.networkInterfaces()).flatMap(([iface,items])=>(items||[]).filter(x=>x&&x.family==="IPv4"&&!x.internal).map(x=>({iface,address:x.address})));res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify({port:requestUrl.port||51731,addresses,lanEnabled:process.env.ORBIT_LAN_TEST==="1"}));return;}
    if (requestUrl.pathname === "/api/mobile-qr") { const value=requestUrl.searchParams.get("url")||"";let target;try{target=new URL(value);}catch{res.writeHead(400).end("Invalid QR URL");return;}if(!["http:","https:"].includes(target.protocol)||target.username||target.password||value.length>2048){res.writeHead(400).end("Invalid QR URL");return;}try{const svg=await require("qrcode").toString(value,{type:"svg",width:220,margin:2});res.writeHead(200,{"Content-Type":"image/svg+xml; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(svg);}catch(error){res.writeHead(500).end("QR generation failed");}return;}
    if (requestUrl.pathname === "/api/film-download-url") {
      try {
        const id=requestUrl.searchParams.get("id")||"";
        if(!/^[A-Za-z0-9._-]{1,180}$/.test(id)){res.writeHead(400).end("Invalid film");return;}
        const upstream=await fetch("https://archive.org/metadata/"+encodeURIComponent(id),{signal:AbortSignal.timeout(18000)});
        if(!upstream.ok){res.writeHead(502).end("Film metadata unavailable");return;}
        const meta=await upstream.json();
        const file=(meta.files||[]).filter(f=>f.name&&[".mp4",".m4v",".webm"].some(ext=>f.name.toLowerCase().endsWith(ext))).sort((a,b)=>(Number(b.size)||0)-(Number(a.size)||0))[0];
        if(!file){res.writeHead(404).end("No downloadable video file is listed");return;}
        const url="https://archive.org/download/"+encodeURIComponent(id)+"/"+file.name.split("/").map(encodeURIComponent).join("/");
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","X-Content-Type-Options":"nosniff"});
        res.end(JSON.stringify({url,title:meta.metadata?.title||id}));
      } catch {res.writeHead(502).end("Could not locate a downloadable film file");}
      return;
    }

    if (requestUrl.pathname === "/api/films") {
      try {
        const term = (requestUrl.searchParams.get("q") || "").trim().slice(0, 80);
        const safe = term.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
        const license = 'https://creativecommons.org/publicdomain/mark/1.0/';
        let query = 'mediatype:movies AND collection:feature_films AND licenseurl:"' + license + '"';
        if (safe && safe.toLowerCase() !== "popular") {
          const phrase = safe.replace(/\\/g, " ").replace(/"/g, " ");
          query += ' AND (title:"' + phrase + '" OR creator:"' + phrase + '" OR subject:"' + phrase + '")';
        }
        const apiUrl = new URL("https://archive.org/advancedsearch.php");
        apiUrl.searchParams.set("q", query);
        for (const field of ["identifier", "title", "year", "creator", "licenseurl", "subject", "description"]) apiUrl.searchParams.append("fl[]", field);
        apiUrl.searchParams.set("rows", "32");
        apiUrl.searchParams.set("page", "1");
        apiUrl.searchParams.set("output", "json");
        apiUrl.searchParams.append("sort[]", "downloads desc");
        const upstream = await fetch(apiUrl, { headers: { "User-Agent": "ORBIT/1.0" }, signal: AbortSignal.timeout(20000) });
        if (!upstream.ok) { res.writeHead(502).end("Film catalogue unavailable"); return; }
        const payload = await upstream.json();
        const blockedTitle = /(sex|erotic|porn|xxx|nude|nudity|adult|hardcore|fetish|pervers|lust|orgasm|hentai|strip|playboy|pleasure|super.?girls|for love|sexy|sensual|bikini|bedroom|seduction|pecas|guy maria)/i;
        const docs = (payload.response?.docs || []).filter(x => x.identifier && x.licenseurl === license && !blockedTitle.test([x.title, x.creator, x.description, ...(Array.isArray(x.subject) ? x.subject : [x.subject || ""])].join(" ")));
        const output = docs.map(x => ({
          id: x.identifier,
          title: x.title || x.identifier,
          year: x.year || "",
          creator: Array.isArray(x.creator) ? x.creator.slice(0, 2).join(", ") : (x.creator || "Not listed"),
          artwork: "https://archive.org/services/img/" + encodeURIComponent(x.identifier)
        }));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify(output));
      } catch { res.writeHead(502).end("Could not retrieve public-domain films"); }
      return;
    }
    if (requestUrl.pathname === "/api/youtube-search") {
      try {
        const query = (requestUrl.searchParams.get("q") || "").trim().slice(0, 120);
        if (!query) { res.writeHead(400).end("A search term is required"); return; }
        const searchUrl = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
        const upstream = await fetch(searchUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(20000)
        });
        if (!upstream.ok) { res.writeHead(upstream.status).end("YouTube search unavailable"); return; }
        const html = await upstream.text();
        const match = html.match(/ytInitialData\s*=\s*(\{.*?\})\s*;\s*<\/script>/s);
        if (!match) { res.writeHead(502).end("YouTube did not return searchable results"); return; }
        const data = JSON.parse(match[1]);
        const found = [];
        const walk = value => {
          if (!value || typeof value !== "object" || found.length >= 30) return;
          if (value.videoRenderer) {
            const v = value.videoRenderer;
            const title = v.title?.runs?.map(x => x.text || "").join("") || v.title?.simpleText || "";
            const author = v.ownerText?.runs?.map(x => x.text || "").join("") || v.shortBylineText?.runs?.map(x => x.text || "").join("") || "YouTube";
            const thumbnails = v.thumbnail?.thumbnails || [];
            const length = v.lengthText?.simpleText || "";
            const seconds = length.split(":").reduce((n, part) => n * 60 + (Number(part) || 0), 0);
            if (v.videoId && title && seconds >= 60) found.push({ videoId: v.videoId, title, author, length, thumbnail: thumbnails.at(-1)?.url || "" });
            return;
          }
          if (Array.isArray(value)) { for (const item of value) walk(item); }
          else { for (const item of Object.values(value)) walk(item); }
        };
        walk(data);
        const candidates = found.slice(0, 30);
        const playable = [];
        let checksCompleted = 0;
        const verifyVideo = async video => {
          const cached = youtubeAvailabilityCache.get(video.videoId);
          if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
            checksCompleted++;
            return cached.playable ? { ...video, ...(cached.details || {}) } : null;
          }
          try {
            const check = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-Youtube-Client-Name": "3",
                "X-Youtube-Client-Version": "20.10.38",
                "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip"
              },
              body: JSON.stringify({
                videoId: video.videoId,
                context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 35, hl: "en", gl: "GH" } }
              }),
              signal: AbortSignal.timeout(10000)
            });
            if (!check.ok) return null;
            const payload = await check.json();
            const status = payload.playabilityStatus;
            const details = payload.videoDetails;
            if (!status || !details) return null;
            const canPlayInsideOrbit = (status.status === "OK" || status.playableInEmbed === true) &&
              details.videoId === video.videoId &&
              details.isPrivate !== true &&
              details.isLiveContent !== true;
            checksCompleted++;
            const safeDetails = canPlayInsideOrbit ? {
              title: typeof details.title === "string" && details.title ? details.title : video.title,
              author: typeof details.author === "string" && details.author ? details.author : video.author
            } : null;
            youtubeAvailabilityCache.set(video.videoId, { playable: canPlayInsideOrbit, details: safeDetails, at: Date.now() });
            if (youtubeAvailabilityCache.size > 500) youtubeAvailabilityCache.delete(youtubeAvailabilityCache.keys().next().value);
            return canPlayInsideOrbit ? { ...video, ...safeDetails } : null;
          } catch {
            return null;
          }
        };
        for (let i = 0; i < candidates.length && playable.length < 16; i += 4) {
          const batch = await Promise.all(candidates.slice(i, i + 4).map(verifyVideo));
          playable.push(...batch.filter(Boolean));
        }
        if (candidates.length && checksCompleted === 0) throw new Error("YouTube playback verification is temporarily unavailable");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify(playable.slice(0, 16)));
      } catch { res.writeHead(502).end("Could not retrieve YouTube search results"); }
      return;
    }
    if (requestUrl.pathname === "/api/librivox") {
      try {
        const apiUrl = new URL(requestUrl.searchParams.get("url") || "");
        if (apiUrl.protocol !== "https:" || apiUrl.hostname !== "librivox.org" || apiUrl.pathname !== "/api/feed/audiobooks/") {
          res.writeHead(400).end("Only the LibriVox audiobook catalogue is supported"); return;
        }
        const upstream = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
        if (!upstream.ok) { res.writeHead(upstream.status).end("Catalogue unavailable"); return; }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        res.end(await upstream.text());
      } catch { res.writeHead(502).end("Could not retrieve LibriVox catalogue"); }
      return;
    }

    if (requestUrl.pathname === "/api/rss") {
      try {
        const feedUrl = new URL(requestUrl.searchParams.get("url") || "");
        if (feedUrl.protocol !== "https:" || !/(^|\.)librivox\.org$/i.test(feedUrl.hostname)) {
          res.writeHead(400).end("Only LibriVox RSS feeds are supported"); return;
        }
        const upstream = await fetch(feedUrl, { signal: AbortSignal.timeout(12000) });
        if (!upstream.ok) { res.writeHead(upstream.status).end("Feed unavailable"); return; }
        res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        res.end(await upstream.text());
      } catch { res.writeHead(502).end("Could not retrieve audiobook feed"); }
      return;
    }

    let pathname;
    try { pathname = decodeURIComponent(requestUrl.pathname); }
    catch { res.writeHead(400).end("Bad request"); return; }
    if (pathname === "/") pathname = "/index.html";
    const target = path.resolve(root, "." + pathname);
    const relativePath = path.relative(root, target).replace(/\\/g, "/");
    const allowedAsset = ["index.html","styles.css","orbit-feature-additions.css","orbit-ui-fixes-20261109.css","orbit-mobile.css","orbit-mobile-polish.css","orbit-mobile-landing.css","orbit-mobile-hero.svg","mobile-bridge.js","app.js","manifest.webmanifest","sw.js"].includes(relativePath) || /^icons\/[A-Za-z0-9._-]+\.png$/i.test(relativePath);
    if (!target.startsWith(root + path.sep) || !allowedAsset) {
      res.writeHead(404).end("Not found"); return;
    }
    fs.readFile(target, (err, data) => {
      if (err) { res.writeHead(404).end("Not found"); return; }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(target)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      });
      res.end(data);
    });
  });
}

async function startLocalServer() {
  const root = path.resolve(__dirname);
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });
  const portFile = path.join(userData, "local-port.json");
  let preferred = 51731;
  try {
    const saved = JSON.parse(fs.readFileSync(portFile, "utf8")).port;
    if (Number.isInteger(saved) && saved >= 1024 && saved <= 65535) preferred = saved;
  } catch {}
  const candidates = [preferred, ...Array.from({ length: 12 }, (_, i) => 51731 + i).filter(p => p !== preferred)];
  for (const port of candidates) {
    const server = createLocalServer(root);
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, process.env.ORBIT_LAN_TEST === "1" ? "0.0.0.0" : "127.0.0.1");
      });
      localServer = server;
      fs.writeFileSync(portFile, JSON.stringify({ port }), "utf8");
      return port;
    } catch (error) {
      try { server.close(); } catch {}
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No free local port was available for ORBIT.");
}

function registerOmniSaveDownloads() {
  const omniSession = session.fromPartition("persist:orbit-omnisave");
  if (omniSession.__orbitDownloadHandler) return;
  omniSession.__orbitDownloadHandler = true;
  const report = data => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("orbit:omni-download", data);
  };
  omniSession.on("will-download", (_event, item) => {
    const originalName = path.basename(item.getFilename() || "download");
    const sourceExt = path.extname(originalName).toLowerCase();
    const mimeType = String(item.getMimeType() || "").toLowerCase();
    const allowed = new Set([".mp4", ".webm", ".m4v", ".mov", ".mkv", ".avi"]);
    const isVideo = mimeType.startsWith("video/") || allowed.has(sourceExt);
    const label = path.basename(originalName, sourceExt).slice(0, 100) || "OmniSave download";
    report({ state: "started", title: label, message: isVideo ? "Video download startedÃ¢â‚¬Â¦" : "Download detected. This file type is not added to Offline Movies." });
    if (!isVideo) return;
    const safeBase = label.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ") || "ORBIT video";
    const finalExt = allowed.has(sourceExt) ? sourceExt : (mimeType.includes("webm") ? ".webm" : ".mp4");
    const target = path.join(offlineDirectory(), safeBase + " " + Date.now() + finalExt);
    try { item.setSavePath(target); }
    catch (error) { report({ state: "error", title: safeBase, message: "ORBIT could not choose a save location: " + error.message }); return; }
    item.on("updated", (_updateEvent, state) => {
      if (state === "progressing") {
        const total = item.getTotalBytes();
        const received = item.getReceivedBytes();
        const percent = total > 0 ? Math.min(100, Math.round(received * 100 / total)) : null;
        report({ state: "progress", title: safeBase, received, total, percent, message: percent === null ? "Downloading " + safeBase + "Ã¢â‚¬Â¦" : "Downloading " + safeBase + " Ã¢â‚¬â€ " + percent + "%" });
      } else if (state === "interrupted") {
        report({ state: "error", title: safeBase, message: "Download interrupted. Try again from OmniSave." });
      }
    });
    item.once("done", (_doneEvent, state) => {
      if (state !== "completed") {
        try { fs.unlinkSync(target); } catch {}
        report({ state: "error", title: safeBase, message: "Download did not complete (" + state + ")." });
        return;
      }
      try {
        const stat = fs.statSync(target);
        if (!stat.size) { fs.unlinkSync(target); report({ state: "error", title: safeBase, message: "The downloaded file was empty." }); return; }
        const id = require("node:crypto").randomUUID();
        const record = { id, filename: path.basename(target), title: safeBase, kind: "video", contentType: mimeType.startsWith("video/") ? mimeType : (finalExt === ".webm" ? "video/webm" : "video/mp4"), bytes: stat.size, savedAt: new Date().toISOString(), artwork: "" };
        const list = readOfflineManifest();
        list.unshift(record);
        writeOfflineManifest(list);
        report({ state: "completed", title: safeBase, message: "Saved to ORBIT Downloads: " + safeBase });
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("orbit:offline-updated", { title: safeBase });
      } catch (error) {
        console.error("ORBIT could not add downloaded video to offline library:", error);
        report({ state: "error", title: safeBase, message: "Downloaded, but ORBIT could not add it to Downloads." });
      }
    });
  });
}

let spotifyWindow = null;
ipcMain.handle("orbit:spotify-open", async () => {
  if (spotifyWindow && !spotifyWindow.isDestroyed()) {
    spotifyWindow.show();
    spotifyWindow.focus();
    return true;
  }
  spotifyWindow = new BrowserWindow({
    width: 1280, height: 850, minWidth: 900, minHeight: 620,
    title: "Spotify Ã‚Â· ORBIT",
    backgroundColor: "#121212",
    autoHideMenuBar: true,
    webPreferences: {
      partition: "persist:orbit-spotify",
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  spotifyWindow.setMenuBarVisibility(false);
  spotifyWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(?:[a-z0-9-]+\.)*spotify\.com\//i.test(url) || /^https:\/\/accounts\.google\.com\//i.test(url)) return { action: "allow" };
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  spotifyWindow.webContents.on("will-navigate", (event, url) => {
    if (!/^https:\/\/(?:[a-z0-9-]+\.)*spotify\.com\//i.test(url) && !/^https:\/\/accounts\.google\.com\//i.test(url)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  spotifyWindow.on("closed", () => { spotifyWindow = null; });
  await spotifyWindow.loadURL("https://open.spotify.com/");
  return true;
});

async function createWindow(port) {
  const localOrigin = "http://127.0.0.1:" + port;
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 650,
    show: false, backgroundColor: "#0d151e",
    title: "ORBIT, sound without borders",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: true
    }
  });
  // Allow Chromium to send the genuine ORBIT Referer and Origin; do not spoof youtube.com identity headers.


  mainWindow.once("ready-to-show", () => { mainWindow.maximize(); mainWindow.show(); });
  mainWindow.webContents.on("did-attach-webview", (_event, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(?:[a-z0-9-]+\.)*spotify\.com\//i.test(url) || /^https:\/\/accounts\.google\.com\//i.test(url)) return { action: "allow" };
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    // For the YouTube webview partition: strip X-Frame-Options and CSP so the full watch page renders correctly
    try {
      const ytUrls = ["*://*.youtube.com/*", "*://*.youtu.be/*", "*://*.googlevideo.com/*", "*://*.ggpht.com/*", "*://*.ytimg.com/*"];
      webContents.session.webRequest.onHeadersReceived({ urls: ytUrls }, (details, callback) => {
        const h = Object.assign({}, details.responseHeaders);
        delete h["x-frame-options"]; delete h["X-Frame-Options"];
        delete h["content-security-policy"]; delete h["Content-Security-Policy"];
        delete h["content-security-policy-report-only"]; delete h["Content-Security-Policy-Report-Only"];
        callback({ responseHeaders: h });
      });
    } catch (_e) { /* non-YouTube webview session, skip */ }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const spotifyAuthPage=/^https:\/\/(accounts|login)\.spotify\.com\//i.test(url)||/^https:\/\/accounts\.google\.com\//i.test(url);
    if (!url.startsWith(localOrigin + "/") && !spotifyAuthPage) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  await mainWindow.loadURL(localOrigin + "/");
  mainWindow.on("closed", () => { mainWindow = null; });
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    try {
      const port = await startLocalServer();
      registerOmniSaveDownloads();
      await createWindow(port);
      app.on("activate", async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createWindow(port);
      });
    } catch (error) {
      dialog.showErrorBox("ORBIT could not start", error.message || String(error));
      app.quit();
    }
  });
}

app.on("before-quit", () => { if (localServer) localServer.close(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

