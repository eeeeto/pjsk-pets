/* ===== 世界计划 桌宠模拟器 - 主逻辑 ===== */
/* 模型资源来自 sekai.best (Sekai Viewer) 公开的 Project Sekai SD Spine 资源，同人性质使用 */

const STORE_KEY = "pjsk-pet-settings-v1";

const defaultStore = () => ({
  mode: "oshi", // oshi=推角模式（双人）| yume=梦向模式（仅角色1+聊天）
  c1: { id: null, flip: false, drag: true, scale: 1, fx: 0.5, fy: 0.8, accessories: [] },
  c2: null, // { id, spine, flip, drag, scale, fx, fy, accessories }
  theme: "cream",
  bgImage: null, // dataURL
  ui: "#f28ab2",
  decoLibrary: [], // 挂件库 [{ name, src }]，全角色共用
  charQuotes: {},  // 每角色词条库 { [charId]: [词条] }
  loveQuotes: true, // 恋爱向词条分组（爱心/亲亲颜文字），默认开启
  bgm: { on: true, volume: 0.4, custom: false }, // 背景音乐（两种模式通用；custom=已导入自定义 MP3）
  tableDeco: { type: "emoji", value: "☕" }, // 桌上小物：emoji 或导入图片（dataURL）
  layoutMode: false, // 家具布局模式（可拖动/缩放家具）
  furniture: {},     // 自定义家具位置 { window|poster|rug|sofa|table: { left, top|bottom, s } }
  posterImage: null, // 海报图片 dataURL（null=默认 assets/poster.png）
});

let store = defaultStore();
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY));
  if (saved && saved.c1 && typeof saved.c1.id === "number") store = Object.assign(defaultStore(), saved);
} catch (e) { /* ignore */ }

// 归一化旧存档：补齐 accessories / 挂件库 / 每角色词条库
function normalizeStore() {
  for (const cfg of [store.c1, store.c2]) {
    if (cfg && !Array.isArray(cfg.accessories)) cfg.accessories = [];
    if (cfg) cfg.accessories = cfg.accessories.filter((a) => a && a.src);
    // 默认涂鸦挂件已移除，清理引用旧路径的挂件
    if (cfg) cfg.accessories = cfg.accessories.filter((a) => !/^assets\/decos\//.test(a.src));
  }
  if (!Array.isArray(store.decoLibrary)) store.decoLibrary = [];
  store.decoLibrary = store.decoLibrary.filter((d) => d && d.src);
  if (!store.charQuotes || typeof store.charQuotes !== "object") store.charQuotes = {};
  // 恋爱向开关：老存档没有该字段时默认开启
  if (typeof store.loveQuotes !== "boolean") store.loveQuotes = true;
  // BGM 设置兜底
  if (!store.bgm || typeof store.bgm !== "object") store.bgm = { on: true, volume: 0.4, custom: false };
  if (typeof store.bgm.on !== "boolean") store.bgm.on = true;
  if (typeof store.bgm.volume !== "number") store.bgm.volume = 0.4;
  store.bgm.volume = Math.min(1, Math.max(0, store.bgm.volume));
  if (typeof store.bgm.custom !== "boolean") store.bgm.custom = false;
  // 桌上小物兜底
  if (!store.tableDeco || typeof store.tableDeco !== "object" || !store.tableDeco.value) {
    store.tableDeco = { type: "emoji", value: "☕" };
  }
  if (store.tableDeco.type !== "emoji" && store.tableDeco.type !== "image") {
    store.tableDeco = { type: "emoji", value: "☕" };
  }
  // 家具布局兜底
  if (typeof store.layoutMode !== "boolean") store.layoutMode = false;
  if (!store.furniture || typeof store.furniture !== "object") store.furniture = {};
  if (typeof store.posterImage !== "string" && store.posterImage !== null) store.posterImage = null;
  // 模式：非法值回落推角模式；梦向模式只能有角色1
  if (store.mode !== "oshi" && store.mode !== "yume") store.mode = "oshi";
  if (store.mode === "yume") store.c2 = null;
  // 角色 id 统一成数字（旧存档可能是字符串，会导致"同角色"判断失效）
  for (const cfg of [store.c1, store.c2]) {
    if (cfg && cfg.id != null && cfg.id !== "") cfg.id = +cfg.id;
  }
  // 同一角色（含同一套/不同服装）绝不能双人同时出场
  if (store.c2 && store.c2.id && (!CHARACTERS.some((c) => c.id === store.c2.id) || (store.c1 && store.c2.id === store.c1.id))) {
    store.c2 = null;
  }
  // 服装存档迁移：cfg.spine 缺失或不属于该角色时，回落到该角色第一套服装
  for (const cfg of [store.c1, store.c2]) {
    if (cfg && cfg.id) {
      const char = CHARACTERS.find((c) => c.id === cfg.id);
      if (char) {
        const ok = char.costumes.some((x) => x.spine === cfg.spine);
        if (!ok) cfg.spine = char.costumes[0].spine;
      }
    }
  }
  // 旧版全局词条迁移：若用户自定义过，则并入当前生效角色的词条库
  if (Array.isArray(store.quotes) && store.quotes.length) {
    const isDefault = JSON.stringify(store.quotes) === JSON.stringify(DEFAULT_QUOTES) ||
                      (typeof LEGACY_DEFAULT_QUOTES !== "undefined" &&
                       JSON.stringify(store.quotes) === JSON.stringify(LEGACY_DEFAULT_QUOTES));
    if (!isDefault) {
      for (const cfg of [store.c1, store.c2]) {
        if (cfg && cfg.id && !store.charQuotes[cfg.id]) {
          // 旧版自定义词条迁移：只保留用户自己添加的词条
          store.charQuotes[cfg.id] = [...store.quotes];
        }
      }
    }
    delete store.quotes;
  }
  // 旧存档清理：已有词条库移除角色自带台词，只保留颜文字与用户自定义词条
  for (const [cid, list] of Object.entries(store.charQuotes)) {
    if (!Array.isArray(list)) { delete store.charQuotes[cid]; continue; }
    const char = CHARACTERS.find((c) => c.id === +cid);
    if (char && Array.isArray(char.quotes) && char.quotes.length) {
      const persona = new Set(char.quotes);
      const cleaned = list.filter((q) => !persona.has(q));
      if (cleaned.length !== list.length) store.charQuotes[cid] = cleaned;
    }
  }
}
normalizeStore();

/* ---------- 角色 / 服装索引 ---------- */
// CHARACTERS 中每个角色带 costumes: [{ spine, costume }]，展开成全服装列表供选人页使用
const COSTUME_LIST = [];
CHARACTERS.forEach((c) => {
  c.costumes.forEach((ct) => COSTUME_LIST.push({ char: c, spine: ct.spine, costume: ct.costume }));
});
const charById = (id) => CHARACTERS.find((c) => c.id === id);
const costumeEntryOf = (cfg) => {
  const char = cfg && charById(cfg.id);
  if (!char) return null;
  return char.costumes.find((x) => x.spine === cfg.spine) || char.costumes[0];
};

/* 每角色词条库 */
function getQuotes(charId) {
  if (!store.charQuotes[charId]) {
    // 初始词条库只包含颜文字
    store.charQuotes[charId] = [...DEFAULT_QUOTES];
    saveStore();
  }
  return store.charQuotes[charId];
}

/* 角色槽位唯一性校验：角色1 与角色2 不能是同一角色（同一套/不同服装都不行）
   返回 true 表示做了修正（角色2 被移除），调用方可据此刷新 UI */
function sanitizeRoster() {
  let changed = false;
  if (store.c1 && store.c1.id != null && store.c1.id !== "") store.c1.id = +store.c1.id;
  if (store.c2) {
    if (store.c2.id != null && store.c2.id !== "") store.c2.id = +store.c2.id;
    if (!store.c2.id || !CHARACTERS.some((c) => c.id === store.c2.id)) { store.c2 = null; changed = true; }
  }
  if (store.mode === "yume" && store.c2) { store.c2 = null; changed = true; }
  if (store.c2 && store.c1 && store.c1.id && store.c2.id === store.c1.id) {
    store.c2 = null; changed = true;
  }
  return changed;
}

function saveStore() {
  sanitizeRoster();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
}

/* ---------- 工具 ---------- */
const $ = (s) => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function weightedPick(items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.w; if (r <= 0) return it; }
  return items[items.length - 1];
}

/* ---------- PIXI 初始化 ---------- */
const SKEL_URL = "assets/sd_main.skel";
let skelBuf = null;
let app = null;

/* 渲染器安全创建：部分手机系统浏览器（X5/夸克/UC 等内核）WebGL 创建会失败，
   依次尝试：WebGL(抗锯齿) → WebGL(无抗锯齿) → Canvas 兜底 */
function createPixiAppSafe(opts) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const tries = [
    { preference: "webgl", antialias: true, resolution: dpr },
    { preference: "webgl", antialias: false, resolution: 1 },
    { preference: "canvas", antialias: false, resolution: 1 },
  ];
  let lastErr = null;
  for (const extra of tries) {
    try {
      const a = new PIXI.Application(Object.assign({}, opts, extra));
      if (a && a.renderer) return a;
    } catch (e) { lastErr = e; }
  }
  throw (lastErr || new Error("无法初始化渲染器"));
}

/* WebGL 能力检测：小人动画依赖 WebGL（spine 骨骼网格），Canvas 渲染器无法替代 */
function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch (e) { return false; }
}

function initPixi() {
  const stageEl = $("#stage");
  app = createPixiAppSafe({
    backgroundAlpha: 0,
    autoDensity: true,
    width: stageEl.clientWidth,
    height: stageEl.clientHeight,
  });
  stageEl.appendChild(app.view);
  app.ticker.add(tickerUpdate);
  window.addEventListener("resize", onResize);
  // 显存被系统回收/上下文丢失时自动恢复
  app.view.addEventListener &&
    app.view.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      toast("显示组件被系统中断，正在恢复…");
      setTimeout(() => location.reload(), 900);
    });
}

function onResize() {
  const stageEl = $("#stage");
  app.renderer.resize(stageEl.clientWidth, stageEl.clientHeight);
  for (const slot of [1, 2]) {
    const pet = pets[slot];
    if (pet && pet.spine) applyPetLayout(pet);
  }
}

/* ---------- 模型加载 ---------- */
const baseTextureCache = new Map();
const atlasTextCache = new Map();

async function loadAtlas(spineName) {
  const txtUrl = `assets/chibis/${spineName}/sekai_atlas.atlas.txt`;
  const pngUrl = `assets/chibis/${spineName}/sekai_atlas.png`;
  const emc = getEmbed() && getEmbed().chibis && getEmbed().chibis[spineName];
  let txt = atlasTextCache.get(spineName);
  if (!txt) {
    txt = emc ? emc.atlas : await (await fetch(txtUrl)).text();
    atlasTextCache.set(spineName, txt);
  }
  let bt = baseTextureCache.get(spineName);
  if (!bt) {
    const img = new Image();
    img.src = emc ? emc.png : pngUrl;
    await img.decode();
    bt = new PIXI.BaseTexture(img);
    baseTextureCache.set(spineName, bt);
  }
  const atlas = new PIXI.spine.TextureAtlas(txt, (page, cb) => cb(bt));
  return atlas;
}

function buildSkeletonData(atlas) {
  const loader = new PIXI.spine.AtlasAttachmentLoader(atlas);
  const bin = new PIXI.spine.SkeletonBinary(loader);
  return bin.readSkeletonData(new Uint8Array(skelBuf));
}

function prefixFor(char) { return PERSONALITY_PREFIX[char.personality] || PERSONALITY_PREFIX.normal; }

/* ---------- file:// 离线支持 ----------
   file:// 协议下浏览器会拦截 fetch 与本地图片进 WebGL，
   因此离线打开时动态加载 assets/embed.js（资源内嵌包，由 tools/build_embed.py 生成）。 */
function getEmbed() { return window.PJSK_EMBED || null; }

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("加载 " + src + " 失败"));
    document.head.appendChild(s);
  });
}

async function ensureEmbed() {
  if (location.protocol !== "file:" || getEmbed()) return;
  $("#sel-status").textContent = "离线模式：加载内嵌资源包…";
  await loadScript("assets/embed.js");
  if (!getEmbed()) throw new Error("离线资源包 assets/embed.js 缺失（请运行 tools/build_embed.py 生成），或改用本地服务器访问");
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function animName(data, prefix, key) {
  const cands = {
    idle: ["idle01_f", "idle01_f_v2"],
    idle2: ["idle02_f_v2", "idle02_f"],
    laugh: ["laugh01_f_v2", "laugh01_f"],
    listen: ["listen01_f_v2", "listen01_f"],
    doubt: ["doubt01_f_v2", "doubt01_f"],
    surprise: ["surprise01_f_v2", "surprise01_f"],
    talk: ["talk01_f_v2", "talk01_f"],
    joy: ["joy01_f_v2", "joy01_f"],
    angry: ["angry01_f_v2", "angry01_f"],
    sad: ["sad01_f_v2", "sad01_f"],
    walk: ["n_general_walk_01_f_v2", "n_general_walk_01_f"],
    wait: ["n_general_wait_01_f_v2", "n_general_wait_01_f"],
  }[key].map((n) => prefix + n).concat({ wait: ["n_general_wait_01_f"], walk: ["n_general_walk_01_f"] }[key] || []);
  for (const n of cands) if (data.animations.find((a) => a.name === n)) return n;
  return null;
}

function buildActionPool(data, prefix) {
  const pool = [];
  const add = (key, w) => { const n = animName(data, prefix, key); if (n) pool.push({ key, anim: n, w }); };
  add("idle", 4);
  add("idle2", 2);
  add("laugh", 2);
  add("listen", 2);
  add("doubt", 1);
  add("surprise", 1);
  add("talk", 1);
  add("joy", 1);
  add("angry", 0.5);
  add("sad", 0.5);
  const walk = animName(data, prefix, "walk");
  if (walk) pool.push({ key: "walk", anim: walk, w: 2 });
  return pool;
}

/* ---------- 小人对象 ---------- */
const pets = { 1: null, 2: null };
const GROUND_MIN = 0.72, GROUND_MAX = 0.9;

/* 生成代数：每次 spawnPet 递增；等待期间若代数变化，说明已有更新的生成任务，
   旧任务必须放弃，否则会把未登记的 spine 残留在舞台上（角色出现多个小人的根源） */
const spawnGen = { 1: 0, 2: 0 };

async function spawnPet(slot) {
  const cfg = slot === 1 ? store.c1 : store.c2;
  if (!cfg || !cfg.id) return;
  // 保险：角色2 绝不能与角色1 是同一角色（同一套或不同服装都不行）
  if (slot === 2 && store.c1 && store.c1.id && +cfg.id === +store.c1.id) return;
  const char = charById(cfg.id);
  const ct = costumeEntryOf(cfg);
  cfg.spine = ct.spine; // 回写，保证存档一致
  const stageEl = $("#stage");
  const W = stageEl.clientWidth, H = stageEl.clientHeight;

  const gen = ++spawnGen[slot];
  destroyPet(slot);
  const atlas = await loadAtlas(ct.spine);
  if (gen !== spawnGen[slot]) return null; // 等待模型期间已被更新的任务取代
  const data = buildSkeletonData(atlas);
  const spine = new PIXI.spine.Spine(data);

  const pet = {
    slot, char, cfg, spine, data,
    prefix: prefixFor(char),
    unitBounds: null, fitScale: 1,
    busy: false, pendingIdle: false,
    walkTarget: null,
    actionTimer: null,
    bubbleUntil: 0,
  };
  pets[slot] = pet;

  spine.eventMode = "static";
  spine.cursor = "pointer";
  spine.state.data.defaultMix = 0.15;
  app.stage.addChild(spine);

  // 记录默认动作完成后的回调
  spine.state.addListener({
    complete: () => {
      if (pet.pendingIdle) { pet.pendingIdle = false; playAnim(pet, animName(data, pet.prefix, "idle"), true); }
    },
  });

  // 计算单位包围盒（scale=1 时）
  const idleAnim = animName(data, pet.prefix, "idle");
  spine.state.setAnimation(0, idleAnim, true);
  spine.update(0.05);
  const b = spine.getBounds();
  pet.unitBounds = b;
  pet.fitScale = (H * 0.34) / b.height;

  applyPetLayout(pet);

  // 交互：拖动 + 点击
  setupDrag(pet);

  // 播放第一个随机动作并排程
  scheduleNextAction(pet, rand(2500, 6000));
  // 挂载挂件
  await mountAccessories(pet);
  if (gen !== spawnGen[slot]) { destroyPet(slot); return null; } // 挂挂件期间又被重建
  return pet;
}

/* ---------- 挂件 ---------- */
// 挂件作为 spine 子对象会随骨骼容器一起缩放（fitScale*cfg.scale），
// 因此这里按"角色身高的固定比例"反算本地缩放，保证挂件与角色大小成比例。
const decoTextureCache = new Map();

async function getDecoTexture(src) {
  let bt = decoTextureCache.get(src);
  if (!bt) {
    const img = new Image();
    img.src = src;
    await img.decode();
    bt = new PIXI.BaseTexture(img);
    decoTextureCache.set(src, bt);
  }
  return new PIXI.Texture(bt);
}

function accSpriteScale(pet, texH, acc) {
  const unitH = pet.unitBounds ? pet.unitBounds.height : 766;
  return (unitH * 0.38 * (acc.scale || 1)) / texH;
}

async function mountAccessories(pet) {
  if (pet.accSprites) pet.accSprites.forEach((s) => s.destroy());
  pet.accSprites = [];
  for (const acc of (pet.cfg.accessories || [])) {
    if (!acc || !acc.src) continue;
    try {
      const tex = await getDecoTexture(acc.src);
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.scale.set(accSpriteScale(pet, tex.height, acc));
      sp.position.set(acc.dx != null ? acc.dx : 0, acc.dy != null ? acc.dy : -600);
      sp.eventMode = "static";
      sp.cursor = "grab";
      sp.on("pointerdown", (e) => { e.stopPropagation(); startAccDrag(pet, sp, acc); });
      pet.spine.addChild(sp);
      pet.accSprites.push(sp);
    } catch (err) { console.warn("挂件加载失败", acc, err); }
  }
}

function startAccDrag(pet, sp, acc) {
  const move = (ev) => {
    const local = pet.spine.toLocal(ev.global);
    acc.dx = local.x; acc.dy = local.y;
    sp.position.set(local.x, local.y);
    pet.accDragged = true;
  };
  const up = () => {
    sp.off("globalpointermove", move);
    sp.off("pointerup", up);
    sp.off("pointerupoutside", up);
    if (pet.accDragged) { pet.accDragged = false; saveStore(); }
  };
  sp.on("globalpointermove", move);
  sp.on("pointerup", up);
  sp.on("pointerupoutside", up);
}

function defaultAccPos(pet) {
  if (!pet || !pet.unitBounds) return { dx: 0, dy: -600 };
  const b = pet.unitBounds;
  return { dx: 0, dy: b.y + b.height * 0.08 }; // 头顶
}

async function addAccessory(slot, acc) {
  const cfg = getCfg(slot);
  if (!cfg) { toast("请先在设置里选择该角色，再挂挂件～"); return; }
  const pet = pets[slot];
  // 没有小人在场上：直接按默认位置挂上
  if (!pet || !pet.spine) {
    cfg.accessories.push(Object.assign({ scale: 1, dx: 0, dy: -600 }, acc));
    saveStore(); renderAccList(slot);
    toast(`已挂上「${acc.name}」`);
    return;
  }
  // 有小人在场上：进入"拖动摆放"模式，点确定后才锁定
  cancelPlacement();
  closeModal();
  const temp = Object.assign({ scale: 1 }, defaultAccPos(pet), acc);
  let tex;
  try {
    tex = await getDecoTexture(acc.src);
  } catch (err) {
    toast(`「${acc.name}」图片加载失败，已跳过`);
    $("#settings-modal").classList.remove("hidden");
    return;
  }
  const sp = new PIXI.Sprite(tex);
  sp.anchor.set(0.5);
  sp.scale.set(accSpriteScale(pet, tex.height, temp));
  sp.position.set(temp.dx, temp.dy);
  sp.eventMode = "static";
  sp.cursor = "grab";
  sp.on("pointerdown", (e) => { e.stopPropagation(); dragPlacementSprite(pet, sp, temp); });
  pet.spine.addChild(sp);
  pet.busy = true; // 摆放期间角色原地待机不乱走
  playIdle(pet);
  pendingPlacement = { slot, acc: temp, sprite: sp, pet };
  showPlacementBar(slot, acc.name);
  toast("拖动挂件摆好位置，点「确定」挂稳～");
}

/* ---------- 挂件摆放确认 ---------- */
let pendingPlacement = null;

function dragPlacementSprite(pet, sp, acc) {
  const move = (ev) => {
    const local = pet.spine.toLocal(ev.global);
    acc.dx = local.x; acc.dy = local.y;
    sp.position.set(local.x, local.y);
  };
  const up = () => {
    sp.off("globalpointermove", move);
    sp.off("pointerup", up);
    sp.off("pointerupoutside", up);
  };
  sp.on("globalpointermove", move);
  sp.on("pointerup", up);
  sp.on("pointerupoutside", up);
}

function showPlacementBar(slot, name) {
  const bar = $("#place-bar");
  if (!bar) return;
  $("#place-tip").textContent = `拖动「${name}」放到 ${slot === 1 ? "角色1" : "角色2"} 身上`;
  bar.classList.remove("hidden");
}

function hidePlacementBar() {
  const bar = $("#place-bar");
  if (bar) bar.classList.add("hidden");
}

async function confirmPlacement() {
  const p = pendingPlacement;
  if (!p) return;
  pendingPlacement = null;
  hidePlacementBar();
  if (p.sprite && !p.sprite.destroyed) p.sprite.destroy();
  p.pet.busy = false;
  // 角色在摆放期间被更换/移除时不再挂载
  if (pets[p.slot] !== p.pet) { $("#settings-modal").classList.remove("hidden"); return; }
  const cfg = getCfg(p.slot);
  cfg.accessories.push(p.acc);
  saveStore();
  await mountAccessories(p.pet);
  renderAccList(p.slot);
  $("#settings-modal").classList.remove("hidden"); // 回到设置面板
  toast(`「${p.acc.name}」挂稳啦！`);
}

function cancelPlacement() {
  const p = pendingPlacement;
  if (!p) return;
  pendingPlacement = null;
  hidePlacementBar();
  if (p.sprite && !p.sprite.destroyed) p.sprite.destroy();
  p.pet.busy = false;
}

async function removeAccessory(slot, idx) {
  const cfg = getCfg(slot);
  cfg.accessories.splice(idx, 1);
  saveStore();
  if (pets[slot]) await mountAccessories(pets[slot]);
  renderAccList(slot);
}

function applyPetLayout(pet) {
  const stageEl = $("#stage");
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  const s = pet.fitScale * (pet.cfg.scale || 1);
  const sgn = pet.cfg.flip ? -1 : 1;
  pet.spine.scale.set(sgn * s, s);
  const b = pet.unitBounds;
  const centerX = ((b.x + (b.x + b.width)) / 2) * (pet.cfg.flip ? -1 : 1);
  pet.spine.x = pet.cfg.fx * W - centerX * s;
  pet.spine.y = pet.cfg.fy * H - (b.y + b.height) * s;
}

function destroyPet(slot) {
  const pet = pets[slot];
  if (!pet) return;
  // 若该角色正处于挂件摆放中，静默放弃摆放
  if (pendingPlacement && pendingPlacement.slot === slot) {
    pendingPlacement = null;
    hidePlacementBar();
  }
  if (pet.actionTimer) clearTimeout(pet.actionTimer);
  if (pet.tapTimer) clearTimeout(pet.tapTimer);
  if (pet.spine) { pet.spine.destroy(); }
  pets[slot] = null;
  hideBubble(slot);
}

/* ---------- 动作调度 ---------- */
function playAnim(pet, name, loop) {
  if (!name) return;
  pet.currentAnim = name;
  pet.spine.state.setAnimation(0, name, loop);
}

function playIdle(pet) {
  pet.walkTarget = null;
  playAnim(pet, animName(pet.data, pet.prefix, "idle"), true);
}

function scheduleNextAction(pet, delay) {
  if (pet.actionTimer) clearTimeout(pet.actionTimer);
  pet.actionTimer = setTimeout(() => doRandomAction(pet), delay != null ? delay : rand(5000, 15000));
}

function doRandomAction(pet) {
  if (!pets[pet.slot]) return;
  if (pet.walkTarget != null) { scheduleNextAction(pet, 3000); return; } // 走路中不打断
  if (pet.busy) { scheduleNextAction(pet, 3000); return; }
  const pool = pet.actionPool || (pet.actionPool = buildActionPool(pet.data, pet.prefix));
  const act = weightedPick(pool);
  if (act.key === "walk") {
    startWalk(pet);
    return;
  }
  if (act.key === "idle" || act.key === "idle2") {
    playAnim(pet, act.anim, true);
    pet.pendingIdle = false;
  } else {
    playAnim(pet, act.anim, false);
    pet.pendingIdle = true;
  }
  scheduleNextAction(pet);
}

function startWalk(pet) {
  const walkAnim = animName(pet.data, pet.prefix, "walk");
  // 默认朝向即前进方向：未翻转向左走，水平翻转后向右走
  let dir = pet.cfg.flip ? 1 : -1;
  // 已经贴着边界时改为朝屏幕内侧走
  if (dir < 0 && pet.cfg.fx < 0.24) dir = 1;
  if (dir > 0 && pet.cfg.fx > 0.76) dir = -1;
  // 偶尔（20%）反向走
  if (Math.random() < 0.2) dir = -dir;
  pet.walkLegs = 0;
  pet.walkAnim = walkAnim;
  beginWalkLeg(pet, dir);
  playAnim(pet, walkAnim, true);
}

// 开始一段行走：走到当前方向的屏幕边缘
function beginWalkLeg(pet, dir) {
  pet.walkDir = dir;
  pet.walkTarget = dir < 0 ? 0.06 : 0.94;
  pet.walkFy = 0.82; // 走路时回到地面基准线，不乱飘
  // 朝向：向右走时镜像翻转（叠加在用户的水平反转设置上）
  const needMirror = (dir > 0) !== !!pet.cfg.flip;
  const s = pet.fitScale * (pet.cfg.scale || 1);
  pet.spine.scale.x = (needMirror ? -1 : 1) * s;
}

// 把小人当前位置写回配置（走完/停下后待在原地）
function capturePetPos(pet) {
  const stageEl = $("#stage");
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  const s = pet.fitScale * (pet.cfg.scale || 1);
  const b = pet.unitBounds;
  const centerX = ((b.x + (b.x + b.width)) / 2) * (pet.cfg.flip ? -1 : 1);
  pet.cfg.fx = Math.max(0.06, Math.min(0.94, (pet.spine.x + centerX * s) / W));
  pet.cfg.fy = Math.max(GROUND_MIN - 0.06, Math.min(GROUND_MAX + 0.04, (pet.spine.y + (b.y + b.height) * s) / H));
}

function speak(slot, text, mood) {
  const pet = pets[slot];
  const bubble = $(`#bubble-${slot}`);
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  bubble.dataset.mood = mood || "normal";
  pet.bubbleUntil = performance.now() + Math.max(2200, text.length * 180);
  positionBubble(slot);
}

function hideBubble(slot) {
  const bubble = $(`#bubble-${slot}`);
  if (bubble) bubble.classList.add("hidden");
}

function positionBubble(slot) {
  const pet = pets[slot];
  if (!pet || !pet.spine) return;
  const bubble = $(`#bubble-${slot}`);
  const roomRect = $("#room").getBoundingClientRect();
  const s = pet.fitScale * (pet.cfg.scale || 1);
  const b = pet.unitBounds;
  const headY = pet.spine.y + ((b.y + b.height) - b.height) * s;
  const cx = pet.spine.x - ((b.x + (b.x + b.width)) / 2) * (pet.cfg.flip ? -1 : 1) * s;
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  let left = cx - roomRect.left - bw / 2;
  left = Math.max(8, Math.min(left, roomRect.width - bw - 8));
  // 气泡位置低一点：底部沉到头顶以下约半个气泡高度
  let top = headY - roomRect.top - bh * 0.55;
  top = Math.max(4, top);
  bubble.style.left = left + "px";
  bubble.style.top = top + "px";
}

/* ---------- 交互（拖动 / 点击） ---------- */
function setupDrag(pet) {
  const spine = pet.spine;
  let down = false, moved = false, sx = 0, sy = 0;
  spine.on("pointerdown", (e) => {
    // 无论是否允许拖动都要记录按下，点击（tap）才能生效
    down = true; moved = false;
    sx = e.global.x; sy = e.global.y;
    if (pet.cfg.drag) spine.alpha = 0.85;
  });
  spine.on("globalpointermove", (e) => {
    if (!down || !pet.cfg.drag) return;
    const dx = e.global.x - sx, dy = e.global.y - sy;
    if (!moved && Math.hypot(dx, dy) > 6) moved = true;
    if (moved) {
      pet.walkTarget = null; // 拖动时中断走路
      if (pet.actionTimer) { clearTimeout(pet.actionTimer); scheduleNextAction(pet); }
      const stageEl = $("#stage");
      const W = stageEl.clientWidth, H = stageEl.clientHeight;
      pet.cfg.fx = Math.max(0.06, Math.min(0.94, pet.cfg.fx + dx / W));
      pet.cfg.fy = Math.max(GROUND_MIN - 0.06, Math.min(GROUND_MAX + 0.04, pet.cfg.fy + dy / H));
      applyPetLayout(pet);
      sx = e.global.x; sy = e.global.y;
    }
  });
  const endDrag = () => {
    if (!down) return;
    down = false;
    spine.alpha = 1;
    if (!moved) onPetTap(pet);
    else saveStore();
  };
  spine.on("pointerup", endDrag);
  spine.on("pointerupoutside", endDrag);
}

function onPetTap(pet) {
  if (pet.busy) return;
  const now = Date.now();
  // 生气持续期（10~60秒随机）：点它只会得到生气反应
  if (pet.angryUntil) {
    if (now < pet.angryUntil) {
      speak(pet.slot, pick(TAP_ANGRY_QUOTES));
      const angry = animName(pet.data, pet.prefix, "angry");
      if (angry && !pet.walkTarget) { playAnim(pet, angry, false); pet.pendingIdle = true; capOneShot(pet, angry, 3200); }
      return;
    }
    pet.angryUntil = null; // 恢复正常
    toast(`${pet.char.name} 气消啦～`);
  }
  // 一分钟内被点 3 次以上 → 生气，并持续 10~60 秒
  pet.tapLog = (pet.tapLog || []).filter((t) => now - t < 60000);
  pet.tapLog.push(now);
  if (pet.tapLog.length >= 3) {
    pet.tapLog = [];
    pet.angryUntil = now + rand(10000, 60000);
    speak(pet.slot, pick(TAP_ANGRY_QUOTES));
    const angry = animName(pet.data, pet.prefix, "angry");
    if (angry && !pet.walkTarget) { playAnim(pet, angry, false); pet.pendingIdle = true; capOneShot(pet, angry, 3200); }
    return;
  }
  // 说一句该角色词条库里的话；恋爱向开启时有概率说爱心/亲亲颜文字
  if (store.loveQuotes && Math.random() < 0.3) {
    speak(pet.slot, pick(LOVE_QUOTES), "love");
  } else {
    speak(pet.slot, pick(getQuotes(pet.char.id)));
  }
  // 播放说话动作（动画较长，超时自动回到待机，保证下次点击有新反应）
  const talk = animName(pet.data, pet.prefix, "talk");
  if (talk && !pet.walkTarget) { playAnim(pet, talk, false); pet.pendingIdle = true; capOneShot(pet, talk, 2800); }
}

// 单次动作最长播放 ms 毫秒后自动回到待机（防止超长动画卡住交互）
function capOneShot(pet, animNameStr, ms) {
  if (pet.tapTimer) clearTimeout(pet.tapTimer);
  pet.tapTimer = setTimeout(() => {
    pet.tapTimer = null;
    if (pets[pet.slot] !== pet) return;
    const cur = pet.spine.state.getCurrent(0);
    if (cur && cur.animation.name === animNameStr && !pet.walkTarget && !pet.busy) playIdle(pet);
  }, ms);
}

/* ---------- ticker ---------- */
function tickerUpdate() {
  const stageEl = $("#stage");
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  const now = performance.now();
  for (const slot of [1, 2]) {
    const pet = pets[slot];
    if (!pet || !pet.spine) continue;
    // 行走移动（贴地走向目标点，方向由 walkDir 决定）
    if (pet.walkTarget != null) {
      // 走路动画被打断或停止时，立即停止位移，待在原地
      const cur = pet.spine.state.getCurrent(0);
      if (!cur || cur.animation.name !== pet.walkAnim) {
        pet.walkTarget = null;
        capturePetPos(pet);
        applyPetLayout(pet);
        playIdle(pet);
        scheduleNextAction(pet);
      } else {
        const speed = W * 0.055 * (app.ticker.deltaMS / 1000);
        const tx = pet.walkTarget * W;
        const dx = tx - pet.spine.x;
        // 走路期间逐渐回到地面高度
        if (pet.walkFy != null) {
          const stepY = H * 0.05 * (app.ticker.deltaMS / 1000);
          const dy = pet.walkFy * H - pet.spine.y;
          if (Math.abs(dy) > stepY) pet.spine.y += Math.sign(dy) * stepY;
        }
        if (Math.abs(dx) < speed) {
          // 走到目标边缘：停在原地（位置写回配置），待在走到的地方
          pet.spine.x = tx;
          pet.walkTarget = null;
          capturePetPos(pet);
          pet.walkLegs = (pet.walkLegs || 0) + 1;
          // 到达屏幕边缘后翻转朝向、往相反方向走；偶尔（35%）停下休息，最多连走4段
          if (pet.walkLegs < 4 && Math.random() > 0.35) {
            beginWalkLeg(pet, -(pet.walkDir || 1));
            playAnim(pet, animName(pet.data, pet.prefix, "walk"), true);
            scheduleNextAction(pet, rand(5000, 15000));
          } else {
            applyPetLayout(pet); // 恢复用户设置的朝向
            playIdle(pet);
            scheduleNextAction(pet);
          }
        } else {
          pet.spine.x += Math.sign(dx) * speed;
          // 保持朝向
          const s = pet.fitScale * (pet.cfg.scale || 1);
          const needMirror = (pet.walkDir > 0) !== !!pet.cfg.flip;
          pet.spine.scale.x = (needMirror ? -1 : 1) * s;
        }
      }
    }
    // 对话框跟随 + 超时隐藏
    const bubble = $(`#bubble-${slot}`);
    if (!bubble.classList.contains("hidden")) {
      if (now > pet.bubbleUntil) hideBubble(slot);
      else positionBubble(slot);
    }
  }
  // 图层顺序：y 坐标越靠下（值越大）的小人显示在上层
  updatePetZ();
}

// 两只小人在走动/拖动时按 y 排序：更靠下（近处）的在上层
function updatePetZ() {
  const a = pets[1], b = pets[2];
  if (!a || !a.spine || !b || !b.spine) return;
  if (a.spine.y === b.spine.y) return;
  const under = a.spine.y < b.spine.y ? a : b; // y 小 = 屏幕上方 = 远处 = 下层
  const over = a.spine.y < b.spine.y ? b : a;
  const ui = app.stage.getChildIndex(under.spine);
  const oi = app.stage.getChildIndex(over.spine);
  if (ui > oi) {
    app.stage.setChildIndex(under.spine, oi);
    app.stage.setChildIndex(over.spine, ui);
  }
}

/* ---------- 表情/粒子特效 ---------- */
function spawnFx(slot, emojis, count) {
  const pet = pets[slot];
  if (!pet) return;
  const fxLayer = $("#fx-layer");
  const roomRect = $("#room").getBoundingClientRect();
  const s = pet.fitScale * (pet.cfg.scale || 1);
  const b = pet.unitBounds;
  const headY = pet.spine.y + ((b.y + b.height) - b.height) * s;
  const cx = pet.spine.x - ((b.x + (b.x + b.width)) / 2) * (pet.cfg.flip ? -1 : 1) * s;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "fx-item";
    el.textContent = pick(emojis);
    el.style.left = cx - roomRect.left + rand(-40, 40) + "px";
    el.style.top = headY - roomRect.top + rand(-10, 20) + "px";
    el.style.animationDuration = rand(1.1, 1.8) + "s";
    el.style.fontSize = rand(18, 30) + "px";
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
}

/* ---------- 喂食 ---------- */
function feed(slot, food, liked) {
  const pet = pets[slot];
  if (!pet || pet.busy) return;
  pet.busy = true;
  const animKey = liked ? (Math.random() < 0.5 ? "joy" : "laugh") : (Math.random() < 0.5 ? "sad" : "angry");
  const anim = animName(pet.data, pet.prefix, animKey);
  playAnim(pet, anim, false);
  pet.pendingIdle = true;
  const tpl = liked ? pick(LIKE_LINES) : pick(DISLIKE_LINES);
  speak(slot, tpl.replace(/\{food\}/g, food.name), liked ? "happy" : "sad");
  spawnFx(slot, liked ? ["❤️", "✨", "💖", "🎵"] : ["💧", "💦", "🌀"], liked ? 6 : 5);
  setTimeout(() => { if (pets[slot]) pets[slot].busy = false; }, 3500);
}

/* ---------- 拍照 ---------- */
async function photo(slot) {
  const pet = pets[slot] || pets[1] || pets[2];
  if (!pet) { toast("先选个角色再拍照吧～"); return; }
  const stageEl = $("#stage");
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  // 截取整个舞台（含所有小人），并合成房间底色/背景图
  const rt = PIXI.RenderTexture.create({ width: W, height: H });
  app.renderer.render(app.stage, { renderTexture: rt });
  const ex = app.renderer.extract.canvas(rt);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  const theme = THEMES[store.theme] || THEMES.cream;
  if (store.bgImage) {
    const img = new Image();
    img.src = store.bgImage;
    await img.decode().catch(() => {});
    // cover
    const r = Math.max(W / img.width, H / img.height);
    ctx.drawImage(img, (W - img.width * r) / 2, (H - img.height * r) / 2, img.width * r, img.height * r);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.wall);
    grad.addColorStop(0.7, theme.wallDark);
    grad.addColorStop(0.7, theme.floor);
    grad.addColorStop(1, theme.floorDark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // 预加载海报图（与屏幕一致，含自定义海报）
    let posterImg = null;
    try {
      posterImg = new Image();
      posterImg.src = store.posterImage || "assets/poster.png";
      await posterImg.decode().catch(() => {});
    } catch (e) { posterImg = null; }
    drawRoomFurniture(ctx, W, H, theme, posterImg);
  }
  ctx.drawImage(ex, 0, 0, W, H);
  // 水印
  ctx.font = `${Math.round(H * 0.024)}px sans-serif`;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillText("♪ PJSK 桌宠模拟器", 12, H - 12);

  out.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pjsk-pet-${pet.char.name}-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`已保存 ${pet.char.name} 的照片！📷`);
  }, "image/png");
}

/* ---------- 拍照：按屏幕上家具的实际位置合成（自动跟随布局） ---------- */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function drawRoomFurniture(ctx, W, H, theme, posterImg) {
  const room = $("#room").getBoundingClientRect();
  // 取屏幕上家具的实际位置（含用户自定义布局），映射到照片坐标系
  const R = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left - room.left, y: r.top - room.top, w: r.width, h: r.height };
  };

  // 地毯
  const rug = R("#rug");
  if (rug) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = theme.rugDark || theme.rug;
    ctx.beginPath();
    ctx.ellipse(rug.x + rug.w / 2, rug.y + rug.h / 2, rug.w / 2, rug.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.rug;
    ctx.beginPath();
    ctx.ellipse(rug.x + rug.w / 2, rug.y + rug.h / 2, rug.w * 0.28, rug.h * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 海报（挂在墙上）
  const po = R("#poster");
  if (po) {
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    rr(ctx, po.x + 3, po.y + 5, po.w, po.h, 8);
    ctx.fillStyle = "#fff";
    rr(ctx, po.x - 4, po.y - 4, po.w + 8, po.h + 8, 8);
    if (posterImg && posterImg.naturalWidth > 0) {
      const r = Math.max(po.w / posterImg.naturalWidth, po.h / posterImg.naturalHeight);
      const dw = posterImg.naturalWidth * r, dh = posterImg.naturalHeight * r;
      ctx.save();
      ctx.beginPath();
      rr(ctx, po.x, po.y, po.w, po.h, 4);
      ctx.clip();
      ctx.drawImage(posterImg, po.x + (po.w - dw) / 2, po.y + (po.h - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#e8e0d4";
      rr(ctx, po.x, po.y, po.w, po.h, 4);
    }
    ctx.strokeStyle = theme.wood || "#c98d5f";
    ctx.lineWidth = 5;
    ctx.strokeRect(po.x - 2, po.y - 2, po.w + 4, po.h + 4);
  }

  // 窗户
  const win = R("#window");
  if (win) {
    const wx = win.x, wy = win.y, winW = win.w, winH = win.h;
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    rr(ctx, wx + 3, wy + 5, winW, winH, 12);
    const sky = ctx.createLinearGradient(wx, wy, wx + winW, wy + winH);
    sky.addColorStop(0, "#bfe3f2");
    sky.addColorStop(0.6, "#dff2fb");
    sky.addColorStop(1, "#eef8fd");
    ctx.fillStyle = sky;
    rr(ctx, wx, wy, winW, winH, 10);
    ctx.strokeStyle = theme.wood || "#c98d5f";
    ctx.lineWidth = 6;
    ctx.strokeRect(wx + 3, wy + 3, winW - 6, winH - 6);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(wx + winW / 2, wy + 3);
    ctx.lineTo(wx + winW / 2, wy + winH - 3);
    ctx.stroke();
    const cw = Math.max(18, winW * 0.2);
    ctx.fillStyle = "#fff";
    rr(ctx, wx - 10, wy - 8, cw, winH * 0.8, 8);
    rr(ctx, wx + winW + 10 - cw, wy - 8, cw, winH * 0.8, 8);
  }

  // 沙发
  const sf = R("#sofa");
  if (sf) {
    const k = sf.w / 220; // 缩放系数（基准宽 220px）
    const sx = sf.x + 10 * k, sy = sf.y + 14 * k, sw = sf.w - 20 * k, sh = sf.h;
    ctx.fillStyle = theme.sofa;
    rr(ctx, sx, sy, sw, sh * 0.72, 24 * k);
    ctx.fillStyle = theme.sofaDark;
    rr(ctx, sx, sy + sh * 0.72 - 8 * k, sw, 8 * k, 4 * k);
    ctx.fillStyle = theme.sofa;
    rr(ctx, sx + 8 * k, sy + sh * 0.57, sw - 16 * k, sh * 0.32, 12 * k);
    ctx.fillStyle = theme.sofaDark;
    rr(ctx, sx + 8 * k, sy + sh * 0.85, sw - 16 * k, 6 * k, 3 * k);
    ctx.fillStyle = theme.sofaDark;
    rr(ctx, sx - 10 * k, sy + sh * 0.46, 34 * k, 49 * k, 14 * k);
    rr(ctx, sx + sw - 24 * k, sy + sh * 0.46, 34 * k, 49 * k, 14 * k);
    ctx.save();
    ctx.translate(sx + sw * 0.31, sy + sh * 0.34); ctx.rotate(-0.1);
    ctx.fillStyle = "#fff3c9"; rr(ctx, -22 * k, -22 * k, 44 * k, 44 * k, 10 * k);
    ctx.restore();
    ctx.save();
    ctx.translate(sx + sw * 0.69, sy + sh * 0.34); ctx.rotate(0.12);
    ctx.fillStyle = "#fdd9c4"; rr(ctx, -22 * k, -22 * k, 44 * k, 44 * k, 10 * k);
    ctx.restore();
  }

  // 桌子
  const tb = R("#table");
  if (tb) {
    const k = tb.w / 130; // 缩放系数（基准宽 130px）
    const tx = tb.x, ty = tb.y, tw = tb.w, th = tb.h;
    const wood = theme.wood || "#c98d5f";
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    rr(ctx, tx + tw / 2 - 40 * k, ty + th - 8 * k, 80 * k, 10 * k, 6 * k);
    ctx.fillStyle = wood;
    rr(ctx, tx + tw / 2 - 7 * k, ty + 18 * k, 14 * k, th - 22 * k, 5 * k);
    rr(ctx, tx + tw / 2 - 40 * k, ty + th - 14 * k, 80 * k, 10 * k, 6 * k);
    ctx.beginPath();
    ctx.ellipse(tx + tw / 2, ty + 13 * k, tw / 2, 13 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 桌上小物（跟随桌子的实际位置）
  const deco = R("#table-deco");
  const td = store.tableDeco || { type: "emoji", value: "☕" };
  if (deco) {
    if (td.type === "image" && tableDecoImg && tableDecoImg.complete && tableDecoImg.naturalWidth > 0) {
      ctx.drawImage(tableDecoImg, deco.x, deco.y, deco.w, deco.h);
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(14, Math.round(deco.h * 0.85))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(td.value || "☕", deco.x + deco.w / 2, deco.y + deco.h * 0.85);
      ctx.textAlign = "start";
    }
  }
}


let thumbApp = null;
async function makeThumb(entry) {
  if (!thumbApp) {
    thumbApp = createPixiAppSafe({
      width: 180, height: 200, backgroundAlpha: 0, autoStart: false,
    });
  }
  const atlas = await loadAtlas(entry.spine);
  const data = buildSkeletonData(atlas);
  const spine = new PIXI.spine.Spine(data);
  const prefix = prefixFor(entry.char);
  const idle = animName(data, prefix, "idle") || animName(data, prefix, "wait");
  spine.state.setAnimation(0, idle || data.animations[0].name, true);
  spine.update(0.05);
  thumbApp.stage.addChild(spine);
  const b = spine.getBounds();
  const s = Math.min(140 / b.width, 165 / b.height);
  spine.scale.set(s);
  spine.x = 90 - ((b.x + (b.x + b.width)) / 2) * s;
  spine.y = 190 - (b.y + b.height) * s;
  thumbApp.render();
  const rt = PIXI.RenderTexture.create({ width: 180, height: 200 });
  thumbApp.renderer.render(thumbApp.stage, { renderTexture: rt });
  const ex = thumbApp.renderer.extract.canvas(rt);
  const url = ex.toDataURL("image/png");
  thumbApp.stage.removeChild(spine);
  spine.destroy();
  return url;
}

/* ---------- 选人界面（按服装展示） ---------- */
const selectState = { target: 1, thumbs: {}, queue: [], busy: false };

async function initSelectScreen() {
  const grid = $("#thumb-grid");
  grid.innerHTML = "";
  for (const entry of COSTUME_LIST) {
    const card = document.createElement("div");
    card.className = "char-card";
    card.dataset.spine = entry.spine;
    card.innerHTML = `
      <div class="thumb-box"><div class="thumb-loading">…</div></div>
      <div class="char-name">${entry.char.name}</div>
      <div class="char-costume">${entry.costume}</div>
      <div class="char-unit">${entry.char.unit}</div>`;
    card.addEventListener("click", () => onCardClick(entry, card));
    grid.appendChild(card);
  }
  // 缩略图懒加载：卡片进入视口才渲染，避免首屏一次性加载全部模型
  const io = new IntersectionObserver((infos) => {
    for (const info of infos) {
      if (!info.isIntersecting) continue;
      const card = info.target;
      io.unobserve(card);
      const entry = COSTUME_LIST.find((x) => x.spine === card.dataset.spine);
      if (entry) selectState.queue.push({ entry, card });
    }
    pumpThumbQueue();
  }, { root: $("#select-screen"), rootMargin: "200px" });
  grid.querySelectorAll(".char-card").forEach((c) => io.observe(c));

  async function pumpThumbQueue() {
    if (selectState.busy) return;
    selectState.busy = true;
    while (selectState.queue.length) {
      const { entry, card } = selectState.queue.shift();
      if (selectState.thumbs[entry.spine]) {
        card.querySelector(".thumb-box").innerHTML = `<img src="${selectState.thumbs[entry.spine]}" alt="${entry.char.name} ${entry.costume}">`;
        continue;
      }
      try {
        const url = await makeThumb(entry);
        selectState.thumbs[entry.spine] = url;
        card.querySelector(".thumb-box").innerHTML = `<img src="${url}" alt="${entry.char.name} ${entry.costume}">`;
      } catch (e) {
        card.querySelector(".thumb-box").textContent = "😵";
      }
      const done = Object.keys(selectState.thumbs).length;
      $("#sel-status").textContent = `正在生成模型预览 ${done}/${COSTUME_LIST.length} …`;
      await new Promise((r) => setTimeout(r, 0));
    }
    selectState.busy = false;
    $("#sel-status").textContent = "加载完成！选择服装后开始吧 ♪";
    refreshCardSelection();
  }
  refreshCardSelection();
}

function onCardClick(entry, card) {
  if (selectState.target === 1) {
    store.c1.id = entry.char.id;
    store.c1.spine = entry.spine;
    // 新的角色1若与角色2是同一个角色（含不同服装），移除角色2
    if (store.c2 && store.c2.id === entry.char.id) {
      store.c2 = null;
      toast("角色2与新的角色1相同，已移除");
    }
    // 选完角色1后自动切换到角色2
    selectState.target = 2;
    document.querySelector('input[name="target"][value="2"]').checked = true;
  } else {
    // 角色2：必须先有角色1
    if (!store.c1.id) { toast("请先给角色1选一套服装～"); return; }
    // 同一个角色不能同时出场（同一套服装、不同服装都不行）
    if (entry.char.id === store.c1.id) {
      toast("同一个角色不能同时出场两套服装哦！");
      card.classList.remove("shake");
      void card.offsetWidth;
      card.classList.add("shake");
      setTimeout(() => card.classList.remove("shake"), 420);
      return;
    }
    // 再次点击同一套服装则取消
    if (store.c2 && store.c2.spine === entry.spine) store.c2 = null;
    else store.c2 = { id: entry.char.id, spine: entry.spine, flip: false, drag: true, scale: 1, fx: 0.68, fy: 0.8, accessories: [] };
  }
  sanitizeRoster();
  saveStore();
  refreshCardSelection();
}

function refreshCardSelection() {
  const s1 = store.c1.spine || (store.c1.id && costumeEntryOf(store.c1) ? costumeEntryOf(store.c1).spine : null);
  const s2 = store.c2 ? (store.c2.spine || (store.c2.id && costumeEntryOf(store.c2) ? costumeEntryOf(store.c2).spine : null)) : null;
  document.querySelectorAll(".char-card").forEach((card) => {
    const sp = card.dataset.spine;
    card.classList.toggle("sel-1", sp === s1);
    card.classList.toggle("sel-2", sp === s2);
    // 选角色2时，角色1的同角色服装一律锁住（不能同时出场）
    const entry = COSTUME_LIST.find((x) => x.spine === sp);
    const locked = selectState.target === 2 && !!store.c1.id && entry && entry.char.id === store.c1.id;
    card.classList.toggle("same-char", !!locked);
    card.setAttribute("aria-disabled", locked ? "true" : "false");
  });
  $("#btn-start").disabled = !s1;
}

/* ---------- 主界面 ---------- */
async function enterMain() {
  // 保险：梦向模式下只有角色1；同一角色（含不同服装）不能同时出场
  if (sanitizeRoster()) {
    saveStore();
    toast("角色2 与角色1 是同一个角色，已自动移除");
  }
  $("#select-screen").classList.add("hidden");
  $("#main-screen").classList.remove("hidden");
  try {
    initPixi();
  } catch (e) {
    showFatal("渲染组件初始化失败：" + (e && e.message || e) + "。你的浏览器可能不支持 WebGL，请尝试换 Chrome / Via 等浏览器打开。");
  }
  applyTheme();
  // 布局：单人居中，双人左右
  if (store.c2 && store.c2.id) {
    if (!store.c1.customPos) store.c1.fx = 0.32;
    if (!store.c2.customPos) store.c2.fx = 0.68;
  } else {
    store.c1.fx = 0.5;
  }
  try {
    await spawnPet(1);
    if (store.c2 && store.c2.id) await spawnPet(2);
  } catch (e) {
    showFatal("模型加载失败：" + (e && e.message || e) + "。请检查网络后刷新重试。");
  }
  buildPanels();
}

function buildPanels() {
  const panels = $("#panels");
  panels.innerHTML = "";
  const yume = store.mode === "yume";
  // 独立聊天条已废弃：梦向模式用面板内输入框，推角模式无聊天输入
  $("#chat-bar").classList.add("hidden");
  for (const slot of [1, 2]) {
    const pet = pets[slot];
    if (!pet) continue;
    if (yume && slot === 1) {
      // 梦向模式：两行输入框独占面板，下方「喂食 / 发送」两个按钮
      const panel = document.createElement("div");
      panel.className = "panel yume-panel";
      panel.innerHTML = `
        <textarea class="chat-area" rows="2" maxlength="120" placeholder="和 TA 说点什么吧…"></textarea>
        <div class="panel-btns yume-btns">
          <button class="btn feed-btn">🍪 喂食</button>
          <button class="btn send-btn">发送</button>
        </div>`;
      panel.querySelector(".feed-btn").addEventListener("click", () => openFeedModal(slot));
      const area = panel.querySelector(".chat-area");
      const sendReply = () => {
        const text = area.value.trim();
        if (!text) return;
        if (chatReply(text)) area.value = "";
      };
      panel.querySelector(".send-btn").addEventListener("click", sendReply);
      area.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } });
      panels.appendChild(panel);
      continue;
    }
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="panel-title"><span class="slot-tag">角色${slot}</span>${pet.char.name}（${(costumeEntryOf(pet.cfg) || {}).costume || ""}）</div>
      <div class="panel-btns">
        <button class="btn feed-btn">🍪 喂食</button>
      </div>`;
    panel.querySelector(".feed-btn").addEventListener("click", () => openFeedModal(slot));
    panels.appendChild(panel);
  }
}

function openFeedModal(slot) {
  const pet = pets[slot];
  if (!pet) return;
  const modal = $("#feed-modal");
  const likeBox = modal.querySelector(".food-list.like");
  const dislikeBox = modal.querySelector(".food-list.dislike");
  modal.querySelector(".feed-char-name").textContent = pet.char.name;
  likeBox.innerHTML = "";
  pet.char.like.forEach((f) => {
    const b = document.createElement("button");
    b.className = "food-btn";
    b.innerHTML = `<span class="food-emoji">${f.emoji}</span>${f.name}`;
    b.addEventListener("click", () => { closeModal(); feed(slot, f, true); });
    likeBox.appendChild(b);
  });
  dislikeBox.innerHTML = "";
  if (pet.char.dislike.length === 0) {
    const note = pet.char.like.find((f) => f.note);
    dislikeBox.innerHTML = `<span class="food-empty">${note ? note.note : "没有讨厌的食物"}</span>`;
  } else {
    pet.char.dislike.forEach((f) => {
      const b = document.createElement("button");
      b.className = "food-btn";
      b.innerHTML = `<span class="food-emoji">${f.emoji}</span>${f.name}`;
      b.addEventListener("click", () => { closeModal(); feed(slot, f, false); });
      dislikeBox.appendChild(b);
    });
  }
  modal.classList.remove("hidden");
}

function closeModal() {
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
}

/* ---------- 主题 ---------- */
function applyTheme() {
  const theme = THEMES[store.theme] || THEMES.cream;
  const room = $("#room");
  for (const [k, v] of Object.entries(theme)) {
    if (k === "name") continue;
    room.style.setProperty(`--${k}`, v);
  }
  room.classList.toggle("custom-bg", !!store.bgImage);
  room.style.backgroundImage = store.bgImage ? `url("${store.bgImage}")` : "";
  document.documentElement.style.setProperty("--ui", store.ui);
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 2400);
}

/* ---------- 设置面板 ---------- */
/* ---------- 模式切换 ---------- */
const MODE_DESC = {
  oshi: "推角模式：角色1 + 角色2 双人房间，点击小人会随机说话。",
  yume: "梦向模式：只有角色1陪着你，用房间下方的输入框和 TA 聊天吧。",
};

function applyModeUI() {
  const yume = store.mode === "yume";
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === store.mode;
    const label = r.closest(".mode-opt");
    if (label) label.classList.toggle("active", r.checked);
  });
  const desc = $("#mode-desc");
  if (desc) desc.textContent = MODE_DESC[store.mode] || "";
  const c2sec = $("#c2-settings");
  if (c2sec) c2sec.classList.toggle("hidden", yume);
}

function initModeSwitch() {
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener("change", async (e) => {
      if (!e.target.checked || store.mode === e.target.value) return;
      store.mode = e.target.value;
      if (store.mode === "yume") {
        const hadC2 = !!(store.c2 && store.c2.id);
        store.c2 = null;
        saveStore();
        toast(hadC2 ? "已切换到梦向模式：角色2回家了，只剩角色1陪着你 ♡" : "已切换到梦向模式 ♡");
      } else {
        saveStore();
        toast("已切换到推角模式");
      }
      syncSettingsUI();
      await rebuildPets();
      buildPanels();
    });
  });
}

/* ---------- 房间聊天输入框 ---------- */
// 发送一句话：随机（或梦向唯一）角色思考 1~2 秒后回复
function chatReply(text) {
  const active = [1, 2].filter((s) => pets[s]);
  if (!active.length) { toast("还没有角色在房间里哦"); return false; }
  // 多人时随机选一位回复；梦向模式只有角色1
  const slot = active.length === 1 ? active[0] : pick(active);
  const pet = pets[slot];
  // 思考中 …（1~2 秒后回复）
  speak(slot, "…", "think");
  setTimeout(() => {
    if (pets[slot] !== pet) return;
    const list = getQuotes(pet.char.id);
    if (!list.length) { speak(slot, "……"); return; }
    const n = randInt(1, Math.min(3, list.length));
    const pool = [...list];
    const chosen = [];
    for (let i = 0; i < n; i++) chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    speak(slot, chosen.join("，"));
    const talk = animName(pet.data, pet.prefix, "talk");
    if (talk && !pet.walkTarget) { playAnim(pet, talk, false); pet.pendingIdle = true; capOneShot(pet, talk, 2800); }
  }, rand(1000, 2000));
  return true;
}

function initChat() {
  const input = $("#chat-input");
  const send = $("#chat-send");
  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    if (chatReply(text)) input.value = "";
  };
  send.addEventListener("click", doSend);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
}

/* ---------- BGM（两种模式通用） ---------- */
let bgmAudio = null;
let bgmUrl = null;

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("pjsk-pet", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => { res(); db.close(); };
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readonly");
    const rq = tx.objectStore("kv").get(key);
    rq.onsuccess = () => { res(rq.result); db.close(); };
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").delete(key);
    tx.oncomplete = () => { res(); db.close(); };
    tx.onerror = () => rej(tx.error);
  });
}

// 设置音源：优先用户导入的 MP3（IndexedDB），否则默认内置曲
async function bgmSetSource() {
  if (bgmUrl && bgmUrl.startsWith("blob:")) URL.revokeObjectURL(bgmUrl);
  bgmUrl = null;
  if (store.bgm.custom) {
    try {
      const blob = await idbGet("bgm");
      if (blob) bgmUrl = URL.createObjectURL(blob);
    } catch (e) { /* 读不到就回落默认 */ }
  }
  if (!bgmUrl) bgmUrl = "assets/bgm_daily.mp3";
  if (bgmAudio) bgmAudio.src = bgmUrl;
}

function bgmPlay() {
  if (!bgmAudio) return;
  bgmAudio.volume = store.bgm.volume;
  if (store.bgm.on && bgmAudio.paused) {
    const p = bgmAudio.play();
    if (p && p.then) p.catch(() => {});
  }
}
function bgmStop() { if (bgmAudio && !bgmAudio.paused) bgmAudio.pause(); }

function updateBgmBtn() {
  const b = $("#btn-bgm");
  if (!b || !bgmAudio) return;
  b.textContent = bgmAudio.paused ? "🔇" : "🎵";
}

function initBGM() {
  if (bgmAudio) return;
  bgmAudio = new Audio();
  bgmAudio.loop = true;
  bgmAudio.preload = "auto";
  bgmAudio.setAttribute("playsinline", "");
  bgmAudio.addEventListener("play", updateBgmBtn);
  bgmAudio.addEventListener("pause", updateBgmBtn);
  bgmSetSource();
  // 浏览器自动播放限制：任意交互（pointerdown/touchend/click）后持续尝试，直到真正播响才停止监听
  const tryStart = () => {
    if (store.bgm.on) bgmPlay();
    if (!store.bgm.on || !bgmAudio.paused) {
      window.removeEventListener("pointerdown", tryStart, true);
      window.removeEventListener("touchend", tryStart, true);
      document.removeEventListener("click", tryStart, true);
    }
  };
  window.addEventListener("pointerdown", tryStart, true);
  window.addEventListener("touchend", tryStart, true);
  document.addEventListener("click", tryStart, true);
  bgmPlay(); // 部分环境允许直接播放
}

/* ---------- 桌上小物（通用） ---------- */
let tableDecoImg = null;

// 把导入图片压缩到 maxSize 以内的 PNG dataURL，避免撑爆 localStorage
function compressImageToDataUrl(file, maxSize) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    img.src = url;
  });
}

function applyTableDeco() {
  const el = $("#table-deco");
  if (!el) return;
  const d = store.tableDeco || { type: "emoji", value: "☕" };
  el.classList.toggle("img-mode", d.type === "image");
  if (d.type === "image") {
    el.textContent = "";
    el.style.backgroundImage = `url("${d.value}")`;
    // 预解码，供拍照合成使用
    tableDecoImg = new Image();
    tableDecoImg.src = d.value;
  } else {
    el.style.backgroundImage = "";
    el.textContent = d.value || "☕";
    tableDecoImg = null;
  }
}

/* ---------- 家具布局模式（通用） ---------- */
// 窗户/海报锚定墙面上方（top%），沙发/桌子/地毯锚定地面（bottom%）
const FURN_KEYS = ["window", "poster", "rug", "sofa", "table"];
const FURN_ANCHOR = { window: "top", poster: "top", rug: "top", sofa: "bottom", table: "bottom" };
const FURN_MOBILE_SCALE = { sofa: 1.5, table: 1.5 };

function furnEl(key) { return key === "window" ? $("#window") : $("#" + key); }

// 首次拖动/缩放时，从当前渲染位置生成布局条目
function seedEntry(key) {
  const el = furnEl(key);
  const rect = el.getBoundingClientRect();
  const room = $("#room").getBoundingClientRect();
  const e = { s: window.innerWidth <= 768 && FURN_MOBILE_SCALE[key] ? FURN_MOBILE_SCALE[key] : 1 };
  if (FURN_ANCHOR[key] === "bottom") {
    e.left = ((rect.left - room.left) / room.width) * 100;
    e.bottom = ((room.bottom - rect.bottom) / room.height) * 100;
  } else {
    e.left = ((rect.left - room.left) / room.width) * 100;
    e.top = ((rect.top - room.top) / room.height) * 100;
  }
  store.furniture[key] = e;
  return e;
}

function applyFurnitureLayout() {
  const fl = store.furniture || {};
  for (const key of FURN_KEYS) {
    const el = furnEl(key);
    if (!el) continue;
    const e = fl[key];
    if (!e) {
      el.style.left = el.style.top = el.style.bottom = el.style.right = el.style.transform = "";
      continue;
    }
    el.style.right = "";
    el.style.left = e.left + "%";
    if (FURN_ANCHOR[key] === "bottom") {
      el.style.top = "";
      el.style.bottom = e.bottom + "%";
    } else {
      el.style.bottom = "";
      el.style.top = e.top + "%";
    }
    let tf = key === "rug" ? "translate(-50%, -50%)" : "";
    tf += (tf ? " " : "") + `scale(${e.s})`;
    el.style.transform = tf;
  }
  const pi = $("#poster-img");
  if (pi) pi.src = store.posterImage || "assets/poster.png";
}

function setLayoutMode(on) {
  store.layoutMode = !!on;
  saveStore();
  $("#room").classList.toggle("layout-mode", !!on);
  if (on) toast("布局模式：拖动移动家具，＋/－ 缩放，点海报可换图");
}

function setupFurniture() {
  for (const key of FURN_KEYS) {
    const el = furnEl(key);
    if (!el || el.dataset.furnInit) continue;
    el.dataset.furnInit = "1";
    // 缩放徽标（＋/－）
    const badge = document.createElement("div");
    badge.className = "f-badge";
    const minus = document.createElement("button");
    minus.textContent = "−";
    const plus = document.createElement("button");
    plus.textContent = "＋";
    badge.append(minus, plus);
    el.appendChild(badge);
    const getS = () => (store.furniture[key] ? store.furniture[key].s : (window.innerWidth <= 768 && FURN_MOBILE_SCALE[key] ? FURN_MOBILE_SCALE[key] : 1));
    const setS = (s) => {
      const e = store.furniture[key] || seedEntry(key);
      e.s = Math.max(0.4, Math.min(3, s));
      saveStore();
      applyFurnitureLayout();
    };
    minus.addEventListener("click", (ev) => { ev.stopPropagation(); setS(getS() - 0.1); });
    plus.addEventListener("click", (ev) => { ev.stopPropagation(); setS(getS() + 0.1); });

    // 拖动（仅布局模式生效）
    let st = null;
    el.addEventListener("pointerdown", (e) => {
      if (!store.layoutMode) return;
      if (e.target.closest(".f-badge")) return;
      // 注意：不要 preventDefault，否则会吞掉后续 click（海报点击换图依赖它）；
      // 滚动/选中已由 CSS touch-action 与 user-select 禁用
      const room = $("#room").getBoundingClientRect();
      st = { px: e.clientX, py: e.clientY, rect: el.getBoundingClientRect(), room, moved: false, entry: store.furniture[key] || seedEntry(key) };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    el.addEventListener("pointermove", (e) => {
      if (!st) return;
      const dx = e.clientX - st.px, dy = e.clientY - st.py;
      if (!st.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      st.moved = true;
      el.dataset.dragMoved = "1";
      const { room, rect, entry } = st;
      entry.left = Math.max(-10, Math.min(96, ((rect.left - room.left + dx) / room.width) * 100));
      if (FURN_ANCHOR[key] === "bottom") {
        entry.bottom = Math.max(-5, Math.min(90, ((room.bottom - (rect.bottom + dy)) / room.height) * 100));
      } else {
        entry.top = Math.max(-5, Math.min(92, ((rect.top - room.top + dy) / room.height) * 100));
      }
      saveStore();
      applyFurnitureLayout();
    });
    const endDrag = () => { st = null; };
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", () => { st = null; });
    // 点海报 → 换图（click 事件带用户激活手势，才能打开文件选择框）
    el.addEventListener("click", () => {
      if (!store.layoutMode || key !== "poster") return;
      if (el.dataset.dragMoved === "1") { delete el.dataset.dragMoved; return; }
      $("#poster-file").click();
    });
  }
}

async function importPosterFile(file) {
  if (!file) return;
  try {
    const dataUrl = await compressImageToDataUrl(file, 600);
    store.posterImage = dataUrl;
    saveStore();
    applyFurnitureLayout();
    syncSettingsUI();
    toast("海报已更新！");
  } catch (err) {
    toast("导入失败，请换一张试试");
  }
}

function initSettings() {
  const modal = $("#settings-modal");
  $("#btn-settings").addEventListener("click", () => { syncSettingsUI(); modal.classList.remove("hidden"); });
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  // 挂件摆放确认条
  $("#place-ok").addEventListener("click", confirmPlacement);
  $("#place-cancel").addEventListener("click", () => { cancelPlacement(); modal.classList.remove("hidden"); });

  // 挂件与词条库
  renderAccTools(1); renderAccTools(2);
  renderAccList(1); renderAccList(2);
  renderQuoteSections();
  // 角色1
  fillCharSelect($("#set-c1-char"), false);
  $("#set-c1-char").addEventListener("change", async (e) => {
    store.c1.id = +e.target.value;
    store.c1.spine = null; // 回落到该角色第一套服装
    if (store.c2 && store.c2.id === store.c1.id) { store.c2 = null; toast("角色2已被移除（不能重复）"); }
    saveStore();
    await rebuildPets();
    buildPanels();
    syncSettingsUI();
  });
  // 服装切换
  $("#set-c1-costume").addEventListener("change", async (e) => {
    if (!store.c1.id || !e.target.value) return;
    store.c1.spine = e.target.value;
    saveStore();
    await rebuildPets();
    buildPanels();
    syncSettingsUI();
  });
  bindSlotToggles(1);
  fillCharSelect($("#set-c2-char"), true, store.c1.id || 0);
  $("#set-c2-char").addEventListener("change", async (e) => {
    const v = +e.target.value;
    if (!v) store.c2 = null;
    else {
      if (v === store.c1.id) { toast("不能和角色1相同哦！"); e.target.value = store.c2 ? store.c2.id : 0; return; }
      if (store.c2) store.c2.id = v, store.c2.spine = null;
      else store.c2 = { id: v, spine: null, flip: false, drag: true, scale: 1, fx: 0.68, fy: 0.8, accessories: [] };
    }
    saveStore();
    await rebuildPets();
    buildPanels();
    syncSettingsUI();
  });
  // 服装切换
  $("#set-c2-costume").addEventListener("change", async (e) => {
    if (!store.c2 || !e.target.value) return;
    store.c2.spine = e.target.value;
    saveStore();
    await rebuildPets();
    buildPanels();
    syncSettingsUI();
  });
  bindSlotToggles(2);

  // 模式切换
  initModeSwitch();
  // 恋爱向词条开关
  $("#set-love").addEventListener("change", (e) => {
    store.loveQuotes = e.target.checked;
    saveStore();
    toast(store.loveQuotes ? "恋爱向词条已开启 ♡" : "恋爱向词条已关闭");
  });

  // BGM（通用）
  initBGM();
  // 主界面快捷按钮：点击即播放/暂停（自身手势可直接解锁音频）
  $("#btn-bgm").addEventListener("click", () => {
    if (!bgmAudio) initBGM();
    if (bgmAudio.paused) {
      store.bgm.on = true; saveStore(); bgmPlay();
      toast("BGM 已开启 ♪");
    } else {
      store.bgm.on = false; saveStore(); bgmStop();
      toast("BGM 已关闭");
    }
    updateBgmBtn();
  });
  $("#set-bgm-on").addEventListener("change", (e) => {
    store.bgm.on = e.target.checked;
    saveStore();
    if (store.bgm.on) bgmPlay(); else bgmStop();
    updateBgmBtn();
    toast(store.bgm.on ? "BGM 已开启 ♪" : "BGM 已关闭");
  });
  $("#set-bgm-vol").addEventListener("input", (e) => {
    store.bgm.volume = +e.target.value;
    if (bgmAudio) bgmAudio.volume = store.bgm.volume;
    saveStore();
  });
  $("#set-bgm-import").addEventListener("click", () => $("#bgm-file").click());
  $("#bgm-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 60 * 1024 * 1024) { toast("文件太大啦（超过 60MB）"); e.target.value = ""; return; }
    try {
      await idbSet("bgm", f);
      store.bgm.custom = true;
      saveStore();
      await bgmSetSource();
      if (store.bgm.on) bgmPlay();
      syncSettingsUI();
      toast("BGM 已更新 ♪");
    } catch (err) {
      // IndexedDB 不可用（如隐私模式）：退化为仅本次会话生效
      if (bgmUrl && bgmUrl.startsWith("blob:")) URL.revokeObjectURL(bgmUrl);
      bgmUrl = URL.createObjectURL(f);
      if (bgmAudio) bgmAudio.src = bgmUrl;
      if (store.bgm.on) bgmPlay();
      toast("已使用该音乐（仅本次会话生效）");
    }
    updateBgmBtn();
    e.target.value = "";
  });
  $("#set-bgm-reset").addEventListener("click", async () => {
    try { await idbDel("bgm"); } catch (e2) { /* 忽略 */ }
    store.bgm.custom = false;
    saveStore();
    await bgmSetSource();
    if (store.bgm.on) bgmPlay();
    syncSettingsUI();
    toast("已恢复默认 BGM");
  });

  // 桌上小物（通用）
  $("#set-tabledeco-emoji").addEventListener("change", (e) => {
    const v = e.target.value.trim();
    if (!v) return;
    store.tableDeco = { type: "emoji", value: v };
    saveStore();
    applyTableDeco();
    syncSettingsUI();
    toast("桌上小物已更新！");
  });
  $("#set-tabledeco-import").addEventListener("click", () => $("#tabledeco-file").click());
  $("#tabledeco-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const dataUrl = await compressImageToDataUrl(f, 160);
      store.tableDeco = { type: "image", value: dataUrl };
      saveStore();
      applyTableDeco();
      syncSettingsUI();
      toast("桌上小物已更新！");
    } catch (err) {
      const im = new Image();
      im.onload = () => {
        const rd = new FileReader();
        rd.onload = () => {
          store.tableDeco = { type: "image", value: rd.result };
          saveStore(); applyTableDeco(); syncSettingsUI();
          toast("桌上小物已更新！");
        };
        rd.readAsDataURL(f);
      };
      im.onerror = () => toast("导入失败，请换一张试试");
      im.src = URL.createObjectURL(f);
    }
    e.target.value = "";
  });
  $("#set-tabledeco-reset").addEventListener("click", () => {
    store.tableDeco = { type: "emoji", value: "☕" };
    saveStore();
    applyTableDeco();
    syncSettingsUI();
    toast("已恢复默认 ☕");
  });

  // 家具布局（通用）
  setupFurniture();
  applyFurnitureLayout();
  $("#room").classList.toggle("layout-mode", !!store.layoutMode);
  $("#set-layout").addEventListener("change", (e) => setLayoutMode(e.target.checked));
  $("#set-layout-reset").addEventListener("click", () => {
    store.furniture = {};
    saveStore();
    applyFurnitureLayout();
    syncSettingsUI();
    toast("家具布局已恢复默认");
  });
  $("#set-poster-import").addEventListener("click", () => $("#poster-file").click());
  $("#poster-file").addEventListener("change", (e) => {
    importPosterFile(e.target.files[0]);
    e.target.value = "";
  });
  $("#set-poster-reset").addEventListener("click", () => {
    store.posterImage = null;
    saveStore();
    applyFurnitureLayout();
    syncSettingsUI();
    toast("已恢复默认海报");
  });

  // 背景
  const themeBox = $("#theme-swatches");
  for (const [key, t] of Object.entries(THEMES)) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.dataset.theme = key;
    b.title = t.name;
    b.style.background = `linear-gradient(${t.wall} 70%, ${t.floor} 70%)`;
    b.addEventListener("click", () => {
      store.theme = key; store.bgImage = null; saveStore(); applyTheme(); syncSettingsUI();
      toast(`背景已切换：${t.name}`);
    });
    themeBox.appendChild(b);
  }
  $("#set-bgfile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { store.bgImage = reader.result; saveStore(); applyTheme(); syncSettingsUI(); toast("背景图已应用！"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  });
  $("#btn-reset-bg").addEventListener("click", () => {
    store.bgImage = null; store.theme = "cream"; saveStore(); applyTheme(); syncSettingsUI(); toast("已恢复默认背景");
  });

  // UI 颜色
  const uiBox = $("#ui-swatches");
  UI_COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.className = "swatch ui-swatch";
    b.title = c.name;
    b.style.background = c.color;
    b.addEventListener("click", () => { store.ui = c.color; saveStore(); applyTheme(); syncSettingsUI(); });
    uiBox.appendChild(b);
  });
  $("#set-uicolor").addEventListener("input", (e) => {
    store.ui = e.target.value; saveStore(); applyTheme();
  });
}

function fillCharSelect(sel, optional, excludeId) {
  sel.innerHTML = optional ? `<option value="0">（不使用）</option>` : "";
  CHARACTERS.forEach((c) => {
    // 角色2 的下拉里直接去掉角色1 的角色：从根上避免"同一角色两套服装"
    if (excludeId && c.id === excludeId) return;
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name}（${c.unit}）`;
    sel.appendChild(opt);
  });
}

// 按当前角色填充服装下拉
function fillCostumeSelect(sel, charId, currentSpine) {
  sel.innerHTML = "";
  const char = charById(charId);
  if (!char) {
    sel.disabled = true;
    sel.innerHTML = `<option value="">（未选择角色）</option>`;
    return;
  }
  sel.disabled = false;
  char.costumes.forEach((ct) => {
    const opt = document.createElement("option");
    opt.value = ct.spine;
    opt.textContent = ct.costume;
    sel.appendChild(opt);
  });
  const cur = char.costumes.find((x) => x.spine === currentSpine) || char.costumes[0];
  sel.value = cur.spine;
}

function bindSlotToggles(slot) {
  const p = `#set-c${slot}`;
  $(`${p}-flip`).addEventListener("change", (e) => {
    getCfg(slot).flip = e.target.checked; saveStore();
    const pet = pets[slot]; if (pet) applyPetLayout(pet);
  });
  $(`${p}-drag`).addEventListener("change", (e) => {
    getCfg(slot).drag = e.target.checked; saveStore();
  });
  $(`${p}-scale`).addEventListener("input", (e) => {
    getCfg(slot).scale = +e.target.value; saveStore();
    const pet = pets[slot]; if (pet) applyPetLayout(pet);
  });
}

function getCfg(slot) { return slot === 1 ? store.c1 : store.c2; }

/* ---------- 设置：挂件 UI ---------- */
function renderAccTools(slot) {
  const box = $(`#acc-tools-${slot}`);
  if (!box) return;
  box.innerHTML = "";
  const lib = store.decoLibrary || [];
  // 挂件库（全角色共用，点击挂载）
  if (!lib.length) {
    const tip = document.createElement("span");
    tip.className = "acc-empty-lib";
    tip.textContent = "挂件库是空的，导入 PNG 开始吧～";
    box.appendChild(tip);
  }
  lib.forEach((d, idx) => {
    const b = document.createElement("button");
    b.className = "acc-pick";
    b.title = `挂上「${d.name}」`;
    b.innerHTML = `<img src="${d.src}" alt="${d.name}">`;
    const del = document.createElement("span");
    del.className = "acc-lib-del";
    del.textContent = "✕";
    del.title = "从挂件库删除";
    del.addEventListener("click", (e) => { e.stopPropagation(); removeFromLibrary(idx); });
    b.appendChild(del);
    b.addEventListener("click", () => addAccessory(slot, { name: d.name, src: d.src }));
    box.appendChild(b);
  });
  // 导入 PNG：先存入挂件库，再进入摆放模式
  const label = document.createElement("label");
  label.className = "btn small acc-import";
  label.textContent = "＋ 导入PNG";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/*";
  file.multiple = true;
  file.style.display = "none";
  file.addEventListener("change", async () => {
    const files = [...file.files];
    if (!files.length) return;
    const added = [];
    for (const f of files) {
      try {
        const src = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = () => rej(new Error("读取失败"));
          reader.readAsDataURL(f);
        });
        // 校验是有效图片再入库
        const img = new Image();
        img.src = src;
        await img.decode();
        const item = { name: f.name.replace(/\.[^.]+$/, ""), src };
        store.decoLibrary.push(item);
        added.push(item);
      } catch (err) {
        toast(`「${f.name}」不是有效图片，已跳过`);
      }
    }
    if (added.length) {
      saveStore();
      renderAccTools(1); renderAccTools(2);
      if (store.decoLibrary.length + (store.c1.accessories.length + (store.c2 ? store.c2.accessories.length : 0)) > 12) {
        toast("提示：挂件图片存在浏览器里，太多可能存不下哦");
      }
      // 进入摆放模式（最后一个导入的）
      addAccessory(slot, added[added.length - 1]);
    }
    file.value = "";
  });
  label.appendChild(file);
  box.appendChild(label);
}

function removeFromLibrary(idx) {
  store.decoLibrary.splice(idx, 1);
  saveStore();
  renderAccTools(1); renderAccTools(2);
  toast("已从挂件库移除");
}

function renderAccList(slot) {
  const box = $(`#acc-list-${slot}`);
  if (!box) return;
  box.innerHTML = "";
  const cfg = getCfg(slot);
  const active = slot === 1 ? !!store.c1.id : !!(store.c2 && store.c2.id);
  if (!active) { box.innerHTML = `<div class="acc-empty">（先选择该角色）</div>`; return; }
  if (!cfg.accessories.length) { box.innerHTML = `<div class="acc-empty">（还没有挂件）</div>`; return; }
  cfg.accessories.forEach((acc, idx) => {
    const item = document.createElement("div");
    item.className = "acc-item";
    item.innerHTML = `
      <img src="${acc.src}" alt="">
      <span class="acc-name">${acc.name || "挂件"}</span>
      <label class="acc-size">大小<input type="range" min="0.3" max="3" step="0.1" value="${acc.scale || 1}"></label>
      <button class="acc-del" title="取下挂件">✕</button>`;
    item.querySelector("input").addEventListener("input", (e) => {
      acc.scale = +e.target.value;
      const pet = pets[slot];
      if (pet && pet.accSprites && pet.accSprites[idx]) {
        pet.accSprites[idx].scale.set(accSpriteScale(pet, pet.accSprites[idx].texture.height, acc));
      }
      saveStore();
    });
    item.querySelector(".acc-del").addEventListener("click", () => removeAccessory(slot, idx));
    box.appendChild(item);
  });
}

/* ---------- 设置：词条库 UI ---------- */
/* 每个生效角色一个词条库区块；charKey = "1" / "2"（面板位） */
function renderQuoteSections() {
  const box = $("#quote-sections");
  if (!box) return;
  box.innerHTML = "";
  const slots = [1, 2].filter((s) => {
    const cfg = s === 1 ? store.c1 : store.c2;
    return cfg && cfg.id;
  });
  if (!slots.length) {
    box.innerHTML = `<div class="acc-empty">（先选择角色，才能编辑它的词条库）</div>`;
    return;
  }
  slots.forEach((slot) => {
    const cfg = slot === 1 ? store.c1 : store.c2;
    const char = CHARACTERS.find((c) => c.id === cfg.id);
    const sec = document.createElement("div");
    sec.className = "qsec";
    sec.innerHTML = `
      <h4>${slot === 1 ? "角色1" : "角色2"} · ${char.name}</h4>
      <div class="quote-chips"></div>
      <textarea class="quote-input" rows="4" placeholder="给 ${char.name} 添加新词条～&#10;可以写多行，每一行会分成一条词条"></textarea>
      <div class="row">
        <button class="btn small q-add">添加</button>
        <button class="btn small ghost q-reset">恢复默认词条</button>
      </div>`;
    const chips = sec.querySelector(".quote-chips");
    const input = sec.querySelector(".quote-input");
    const quotes = getQuotes(char.id);
    const render = () => {
      chips.innerHTML = "";
      const list = getQuotes(char.id);
      if (!list.length) { chips.innerHTML = `<span class="food-empty">词条库空了，添加几个吧～</span>`; return; }
      list.forEach((q, idx) => {
        const chip = document.createElement("span");
        chip.className = "quote-chip";
        chip.textContent = q;
        const del = document.createElement("button");
        del.textContent = "✕";
        del.title = "删除这条词条";
        del.addEventListener("click", () => { list.splice(idx, 1); saveStore(); render(); });
        chip.appendChild(del);
        chips.appendChild(chip);
      });
    };
    const add = () => {
      // 每一行是一条词条；空行忽略
      const lines = input.value.split("\n").map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return;
      const list = getQuotes(char.id);
      if (list.length + lines.length > 1000) { toast("词条太多啦（上限 1000 条），先删掉一些吧"); return; }
      list.push(...lines);
      input.value = "";
      saveStore(); render();
      toast(lines.length > 1 ? `已添加 ${lines.length} 条词条，点小人试试！` : `${char.name} 的词条已添加，点它试试！`);
    };
    sec.querySelector(".q-add").addEventListener("click", add);
    sec.querySelector(".q-reset").addEventListener("click", () => {
      store.charQuotes[char.id] = [...DEFAULT_QUOTES];
      saveStore(); render(); toast(`${char.name} 的词条已恢复默认`);
    });
    render();
    box.appendChild(sec);
  });
}

function syncSettingsUI() {
  const c1 = store.c1, c2 = store.c2 || { id: 0, flip: false, drag: true, scale: 1 };
  fillCharSelect($("#set-c2-char"), true, c1.id || 0); // 每次同步都排除角色1
  $("#set-c1-char").value = c1.id || "";
  fillCostumeSelect($("#set-c1-costume"), c1.id, c1.spine);
  $("#set-c1-flip").checked = !!c1.flip;
  $("#set-c1-drag").checked = !!c1.drag;
  $("#set-c1-scale").value = c1.scale || 1;
  $("#set-c2-char").value = c2.id || 0;
  fillCostumeSelect($("#set-c2-costume"), c2.id || 0, c2.spine);
  $("#set-c2-flip").checked = !!c2.flip;
  $("#set-c2-drag").checked = c2.drag !== false;
  $("#set-c2-scale").value = c2.scale || 1;
  document.querySelectorAll("#theme-swatches .swatch").forEach((b) => b.classList.toggle("active", b.dataset.theme === store.theme && !store.bgImage));
  document.querySelectorAll("#ui-swatches .swatch").forEach((b) => b.classList.toggle("active", b.title && UI_COLORS.find((c) => c.color === store.ui && c.name === b.title)));
  $("#set-uicolor").value = store.ui;
  $("#set-love").checked = !!store.loveQuotes;
  $("#set-bgm-on").checked = !!store.bgm.on;
  $("#set-bgm-vol").value = store.bgm.volume;
  $("#set-bgm-reset").hidden = !store.bgm.custom;
  // 桌上小物
  const tdEmoji = $("#set-tabledeco-emoji");
  tdEmoji.value = store.tableDeco.type === "emoji" ? store.tableDeco.value : "";
  tdEmoji.placeholder = store.tableDeco.type === "image" ? "（当前为导入图片）" : "输入 emoji，如 🍰";
  $("#set-tabledeco-reset").hidden = store.tableDeco.type === "emoji" && store.tableDeco.value === "☕";
  // 家具布局
  $("#set-layout").checked = !!store.layoutMode;
  $("#set-poster-reset").hidden = !store.posterImage;
  applyModeUI();
  renderQuoteSections();
  renderAccList(1); renderAccList(2);
}

/* 重建串行化：快速连点设置时多个 rebuild 会并发，导致小人残留/重复。
   用 promise 链保证同一时刻只有一个重建在跑。 */
let rebuildChain = Promise.resolve();
function rebuildPets() {
  rebuildChain = rebuildChain.then(() => doRebuildPets()).catch((e) => { console.error(e); });
  return rebuildChain;
}

async function doRebuildPets() {
  destroyPet(1); destroyPet(2);
  if (store.c2 && store.c2.id) {
    if (store.c1.fx === 0.5) store.c1.fx = 0.32;
    if (store.c2.fx === 0.5 || !store.c2.fx) store.c2.fx = 0.68;
  } else {
    store.c1.fx = store.c1.fx === 0.32 ? 0.5 : store.c1.fx;
  }
  await spawnPet(1);
  if (store.c2 && store.c2.id) await spawnPet(2);
  buildPanels();
}

/* ---------- 启动 ---------- */
async function boot() {
  // 离线（file://）时先加载内嵌资源包
  await ensureEmbed();
  // 尽早检测 WebGL：不支持就直接告诉用户原因与解决办法，而不是黑屏没小人
  if (!hasWebGL()) {
    showFatal("当前浏览器无法启动 WebGL 渲染，小人动画无法显示。请尝试：① 用 Chrome / Edge / Via / Firefox 打开本页；② 在系统浏览器的设置里找到「硬件加速 / 加速渲染 / 启用 JavaScript」并开启；③ 清理后台后重启浏览器再试。");
  }
  // 加载共享骨骼
  $("#sel-status").textContent = "正在下载小人模型（sd_main.skel）…";
  skelBuf = getEmbed() ? b64ToBytes(getEmbed().skel) : await (await fetch(SKEL_URL)).arrayBuffer();
  applyTheme();
  applyTableDeco();
  initSettings();
  initChat();
  document.querySelectorAll('input[name="target"]').forEach((r) => {
    r.addEventListener("change", (e) => {
      selectState.target = +e.target.value;
      refreshCardSelection();
    });
  });
  $("#btn-start").addEventListener("click", () => { if (!store.c1.id) return; enterMain(); });
  $("#btn-photo").addEventListener("click", () => photo(1));
  document.querySelectorAll(".modal-close").forEach((b) => b.addEventListener("click", closeModal));
  document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModal(); }));
  if (store.c1.id) {
    // 有存档，直接进入主界面
    $("#sel-status").textContent = "检测到存档，正在恢复…";
    await enterMain();
    if (!(store.c2 && store.c2.id)) { /* 单人 */ }
  } else {
    await initSelectScreen();
  }
}

boot().catch((e) => {
  console.error(e);
  $("#sel-status").textContent = "加载出错：" + (e && e.message || e);
  showFatal("加载出错：" + (e && e.message || e));
});

/* 致命错误横幅：任何未捕获错误都在页面上直接可见，便于用户反馈 */
let fatalShown = false;
function showFatal(msg) {
  if (fatalShown) return;
  fatalShown = true;
  const bar = document.createElement("div");
  bar.id = "fatal-banner";
  bar.innerHTML = `
    <div class="fatal-text">⚠️ ${String(msg).slice(0, 220)}</div>
    <button class="fatal-close">知道了</button>`;
  bar.querySelector(".fatal-close").addEventListener("click", () => { bar.remove(); fatalShown = false; });
  document.body.appendChild(bar);
}
window.addEventListener("error", (e) => {
  if (e && e.message && !/renderer/i.test(e.message)) showFatal(e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e && e.reason;
  const m = r && (r.message || String(r));
  if (m) showFatal(m);
});
