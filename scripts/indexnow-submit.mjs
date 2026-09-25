// Tell Bing (and other IndexNow engines) about pentra.dev's pages. Bing's index
// also feeds AI answers such as Copilot. Usage: node scripts/indexnow-submit.mjs
// The key file lives at https://pentra.dev/0a621f060525be9f5b4d3bff6cb849b1.txt (public/, by design public).
const KEY = "0a621f060525be9f5b4d3bff6cb849b1";
const HOST = "pentra.dev";
const xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).filter(url => new URL(url).hostname === HOST);
if (urlList.length === 0) throw new Error("No sitemap URLs found");
const keyCheck = await fetch(`https://${HOST}/${KEY}.txt`);
if (!keyCheck.ok || (await keyCheck.text()).trim() !== KEY) throw new Error("The IndexNow key file is not live yet");
const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
});
console.log(JSON.stringify({ submitted: urlList.length, status: response.status }));
