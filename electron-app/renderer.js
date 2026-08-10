const $ = (id) => document.getElementById(id);

async function loadConfig() {
  const c = await window.api.getConfig();
  $("hashtags").value = (c.hashtags || []).join("\n");
  const t = (c.hashtagSurge && c.hashtagSurge.tiers) || {};
  $("alertGain24h").value = t.alertGain24h ?? 2000;
  $("breakingGain24h").value = t.breakingGain24h ?? 5000;
  $("recentDays").value = (c.hashtagSurge && c.hashtagSurge.recentDays) ?? 7;
  $("pollIntervalMinutes").value = c.pollIntervalMinutes ?? 90;
  $("sendkey").value = (c.push && c.push.serverchan && c.push.serverchan.sendkey) || "";
}

async function refreshStatus() {
  const s = await window.api.getStatus();
  const pill = $("statusPill");
  pill.textContent = s.running ? "运行中" : "已停止";
  pill.className = "pill " + (s.running ? "on" : "off");
  $("meta").textContent = `· 每 ${(await window.api.getConfig()).pollIntervalMinutes || 90} 分钟 · ${s.hashtags} 个话题`;
}

async function refreshRising() {
  const r = await window.api.getRising();
  $("risingTime").textContent = r.updatedAt && r.updatedAt !== "-" ? "更新于 " + r.updatedAt : "";
  const items = r.items || [];
  const body = $("risingBody");
  body.innerHTML = "";
  $("risingEmpty").style.display = items.length ? "none" : "block";
  for (const it of items.slice(0, 30)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="tier">${(it.tier || "").replace(/[^\w一-龥 ]/g, "").trim()}</td>
      <td class="gain">+${it.gain24h ?? 0}</td>
      <td>${it.accel || "-"}×</td>
      <td>${(it.likes ?? 0).toLocaleString()}</td>
      <td><div>${it.author || "?"}</div><a href="${it.url}" target="_blank">${(it.title || "").slice(0, 28)}</a></td>`;
    body.appendChild(tr);
  }
}

async function refreshLog() {
  const box = $("logBox");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.textContent = await window.api.getLog();
  if (nearBottom) box.scrollTop = box.scrollHeight; // 贴着底就自动跟随
}

$("loginBtn").onclick = async () => { await window.api.login(); };
$("startBtn").onclick = async () => { await window.api.start(); setTimeout(refreshStatus, 800); };
$("stopBtn").onclick = async () => { await window.api.stop(); setTimeout(refreshStatus, 800); };
$("saveBtn").onclick = async () => {
  await window.api.saveConfig({
    hashtags: $("hashtags").value.split("\n").map((s) => s.trim()).filter(Boolean),
    alertGain24h: $("alertGain24h").value,
    breakingGain24h: $("breakingGain24h").value,
    recentDays: $("recentDays").value,
    pollIntervalMinutes: $("pollIntervalMinutes").value,
    sendkey: $("sendkey").value.trim(),
  });
  const m = $("savedMsg"); m.classList.add("show"); setTimeout(() => m.classList.remove("show"), 2000);
  refreshStatus();
};

(async function init() {
  await loadConfig();
  await refreshStatus();
  await refreshRising();
  await refreshLog();
  setInterval(refreshStatus, 5000);
  setInterval(refreshRising, 5000);
  setInterval(refreshLog, 3000);
})();
