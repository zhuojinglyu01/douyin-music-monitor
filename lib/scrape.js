// 抓取全部复用【同一个 page】(导航它，不开新标签)——配合窗口最小化，才能全程藏在 Dock 里不弹屏幕。
// 每个函数挂响应监听 → 用完就摘(off)，避免监听器累积/串台。

// 抓一个音乐人主页的近期作品。只信 /aweme/post/ 接口的精确 digg_count。
export async function scrapeArtist(page, artist, { timeoutMs = 25000, debug = false } = {}) {
  const byId = new Map();
  let apiHit = false;
  let nickname = null;

  const onResp = async (resp) => {
    const url = resp.url();
    if (!url.includes("/aweme/post/")) return;
    try {
      const json = await resp.json();
      const list = json?.aweme_list || [];
      if (debug) console.log(`   [api] ${url.split("?")[0]} -> ${list.length} 条`);
      for (const a of list) {
        if (!nickname && a?.author?.nickname) nickname = a.author.nickname;
        byId.set(a.aweme_id, {
          videoId: a.aweme_id,
          title: a.desc || "",
          likes: a?.statistics?.digg_count ?? null,
          createTime: a.create_time ? a.create_time * 1000 : null,
          url: `https://www.douyin.com/video/${a.aweme_id}`,
        });
      }
      if (list.length) apiHit = true;
    } catch {
      /* 非 JSON */
    }
  };
  page.on("response", onResp);

  let blocked = false;
  try {
    await page.goto(artist.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (apiHit) break;
      const txt = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (/服务异常|登录后即可|扫码登录/.test(txt) && !apiHit) blocked = true;
      await page.mouse.wheel(0, 900).catch(() => {});
      await page.waitForTimeout(1500);
    }
  } catch (e) {
    if (debug) console.log(`   [nav] ${e.message}`);
  } finally {
    page.off("response", onResp);
  }

  return { artist: artist.name, nickname, viaApi: apiHit, blocked: blocked && !apiHit, videos: [...byId.values()] };
}

// 在搜索页把「筛选」面板里的某个选项点上（最多点赞 / 一周内）。面板 hover「筛选」展开。
async function pickFilter(page, optionLabel) {
  const find = (t) =>
    page.evaluate((tt) => {
      for (const el of document.querySelectorAll("span,div,button")) {
        if ((el.innerText || "").trim() === tt) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }
      }
      return null;
    }, t);
  const f = await find("筛选");
  if (!f) return false;
  await page.mouse.move(f.x, f.y);
  await page.waitForTimeout(800);
  const o = await find(optionLabel);
  if (!o) return false;
  await page.mouse.move(o.x, o.y);
  await page.waitForTimeout(200);
  await page.mouse.click(o.x, o.y);
  await page.waitForTimeout(1600);
  return true;
}

// 搜一个话题词，截获 /general/search/single/。只留标签真命中该词、且近 recentDays 天内发布的视频。
export async function scrapeHashtag(page, term, { timeoutMs = 25000, debug = false, recentDays = 0 } = {}) {
  const byId = new Map();
  let apiHit = false;
  const now = Date.now();
  const maxAgeMs = recentDays > 0 ? recentDays * 86400000 : Infinity;

  const onResp = async (resp) => {
    if (!resp.url().includes("/general/search/single/")) return;
    try {
      const json = await resp.json();
      const data = json?.data || [];
      let got = 0;
      for (const d of data) {
        const a = d?.aweme_info || (d?.aweme_id ? d : null);
        if (!a?.aweme_id) continue;
        const tags = (a.text_extra || []).map((t) => t.hashtag_name).filter(Boolean);
        const desc = a.desc || "";
        const hit = tags.some((t) => t.includes(term)) || desc.includes(`#${term}`);
        if (!hit) continue;
        const ct = a.create_time ? a.create_time * 1000 : null;
        if (maxAgeMs !== Infinity && (ct == null || now - ct > maxAgeMs)) continue;
        byId.set(a.aweme_id, {
          videoId: a.aweme_id,
          title: desc,
          likes: a?.statistics?.digg_count ?? null,
          createTime: ct,
          author: a?.author?.nickname || "",
          tags,
          url: `https://www.douyin.com/video/${a.aweme_id}`,
        });
        got++;
      }
      if (got) apiHit = true;
      if (debug) console.log(`   [search:${term}] +${got} 命中（本响应 ${data.length} 条）`);
    } catch {
      /* 非 JSON */
    }
  };
  page.on("response", onResp);

  try {
    await page.goto(`https://www.douyin.com/search/${encodeURIComponent(term)}`, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForTimeout(3500);
    const sortOk = await pickFilter(page, "最多点赞").catch(() => false);
    const dateOk = await pickFilter(page, "一周内").catch(() => false);
    if (debug) console.log(`   [filter:${term}] 最多点赞=${sortOk} 一周内=${dateOk}`);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await page.mouse.wheel(0, 1600).catch(() => {});
      await page.waitForTimeout(2500);
    }
  } catch (e) {
    if (debug) console.log(`   [search:${term} nav] ${e.message}`);
  } finally {
    page.off("response", onResp);
  }

  return { term, viaApi: apiHit, videos: [...byId.values()] };
}

// 逐条量：导航到一条视频页，截获 /aweme/detail/ 拿此刻精确点赞数。复用传入的 page。
export async function measureVideo(page, awemeId, { timeoutMs = 15000 } = {}) {
  let result = null;
  const onResp = async (resp) => {
    if (!resp.url().includes("/aweme/detail/")) return;
    try {
      const j = await resp.json();
      const d = j?.aweme_detail;
      if (d?.aweme_id === awemeId && d?.statistics?.digg_count != null) {
        result = {
          likes: d.statistics.digg_count,
          createTime: d.create_time ? d.create_time * 1000 : null,
          title: d.desc || "",
          author: d?.author?.nickname || "",
        };
      }
    } catch {
      /* 非 JSON */
    }
  };
  page.on("response", onResp);
  try {
    await page.goto(`https://www.douyin.com/video/${awemeId}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const start = Date.now();
    while (Date.now() - start < timeoutMs && !result) await page.waitForTimeout(1200);
  } catch {
    /* 打不开就算了 */
  } finally {
    page.off("response", onResp);
  }
  return result;
}
