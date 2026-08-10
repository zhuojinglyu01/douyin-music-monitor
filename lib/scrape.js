// 抓一个音乐人主页的近期作品。
// 只信抖音自己的作品接口(aweme/post 返回的 JSON)——digg_count / create_time / desc 都是精确值。
// 接口没出来(通常是被风控判高风险、页面显示“服务异常”)时，如实返回 blocked，绝不用 DOM 瞎猜。
export async function scrapeArtist(context, artist, { timeoutMs = 25000, debug = false } = {}) {
  const page = await context.newPage();
  const byId = new Map();
  let apiHit = false;
  let nickname = null;

  page.on("response", async (resp) => {
    const url = resp.url();
    // 只认「作品」接口 /aweme/post/。绝不碰 favorite（喜欢=点赞过的别人视频）/mix，那不是本人新作。
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
      /* 非 JSON / 被拦，忽略 */
    }
  });

  let blocked = false;
  try {
    await page.goto(artist.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // 等作品接口回来；同时盯页面是不是弹了“服务异常/登录”
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (apiHit) break;
      const txt = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (/服务异常|登录后即可|扫码登录/.test(txt) && !apiHit) blocked = true;
      // 轻轻滚一下，触发作品懒加载
      await page.mouse.wheel(0, 900).catch(() => {});
      await page.waitForTimeout(1500);
    }
  } catch (e) {
    if (debug) console.log(`   [nav] ${e.message}`);
  } finally {
    await page.close().catch(() => {});
  }

  const videos = [...byId.values()];
  return { artist: artist.name, nickname, viaApi: apiHit, blocked: blocked && !apiHit, videos };
}

// 在搜索页把「筛选」面板里的某个选项点上（如 最新发布 / 一周内）。
// 面板是 hover「筛选」展开的，所以先移到筛选、再移到选项点击。找不到就返回 false（不致命）。
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

// 搜一个话题词，抓搜索结果里的视频。截获 /general/search/single/ 的 data 数组。
// 只保留标签(text_extra)真的命中该词的视频（含 #新歌上线 这类包含匹配）。
// 会把搜索设成「最新发布 + 一周内」，让近期新视频浮上来。
export async function scrapeHashtag(context, term, { timeoutMs = 25000, debug = false, recentDays = 0 } = {}) {
  const page = await context.newPage();
  const byId = new Map();
  let apiHit = false;
  const now = Date.now();
  const maxAgeMs = recentDays > 0 ? recentDays * 86400000 : Infinity;

  page.on("response", async (resp) => {
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
        // 命中：标签里有包含该词的，或 desc 里出现 #该词
        const hit = tags.some((t) => t.includes(term)) || desc.includes(`#${term}`);
        if (!hit) continue;
        // 只留近 recentDays 天内发布的（拿不到发布时间的也排除，无法确认新旧）
        const ct = a.create_time ? a.create_time * 1000 : null;
        if (maxAgeMs !== Infinity && (ct == null || now - ct > maxAgeMs)) continue;
        byId.set(a.aweme_id, {
          videoId: a.aweme_id,
          title: desc,
          likes: a?.statistics?.digg_count ?? null,
          createTime: a.create_time ? a.create_time * 1000 : null,
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
  });

  try {
    await page.goto(`https://www.douyin.com/search/${encodeURIComponent(term)}`, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForTimeout(3500);
    // 设「最多点赞 + 一周内」：盯近一周内点赞势头最猛的视频（这些才可能日增破 5000；
    // 「最新发布」抓到的都是刚发、点赞几十的新生儿，永远够不到阈值）。
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
    await page.close().catch(() => {});
  }

  return { term, viaApi: apiHit, videos: [...byId.values()] };
}

// 逐条量：打开一条视频页，截获 /aweme/detail/，拿它此刻的精确点赞数。
// 这是新架构地基——发现过的视频不必再靠搜索复现，直接量它自己。
export async function measureVideo(context, awemeId, { timeoutMs = 15000 } = {}) {
  const page = await context.newPage();
  let result = null;
  page.on("response", async (resp) => {
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
  });
  try {
    await page.goto(`https://www.douyin.com/video/${awemeId}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const start = Date.now();
    while (Date.now() - start < timeoutMs && !result) await page.waitForTimeout(1200);
  } catch {
    /* 打不开就算了 */
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}
