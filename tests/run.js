/* MindSketch 单元测试（Node 运行，无 DOM 依赖的部分）
 * 覆盖：模型操作 / 布局几何不变量 / Markdown 与 JSON 往返 / SVG 与交互 HTML 生成
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ── 沙盒加载（模拟浏览器 window）───────────── */
const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON, Map, Set, Promise, isNaN, parseInt, parseFloat, isFinite };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['util.js', 'model.js', 'themes.js', 'layout.js', 'io.js'];
for(const f of files){
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(src, sandbox, { filename: f });
}

const MS = sandbox.window.MS;
/* 注入确定性文本测量：每字符 0.62 × 字号 */
MS.util.setMeasurer((text, font) => {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  const size = m ? parseFloat(m[1]) : 14;
  return String(text || '').length * 0.62 * size;
});

let passed = 0, failed = 0;
function ok(cond, name){
  if(cond){ passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function section(name){ console.log('\n[' + name + ']'); }

/* ── 测试数据 ──────────────────────────────── */
function makeDoc(){
  return MS.model.Doc.fromTree({ text:'中心主题', children:[
    { text:'分支一', children:[
      { text:'子节点 A1', children:[ { text:'深层节点', children:[] } ] },
      { text:'子节点 A2 这是一段比较长的文本用来测试自动换行是否正常工作', children:[] },
    ]},
    { text:'分支二', children:[
      { text:'B1', children:[] }, { text:'B2', children:[] }, { text:'B3', children:[] },
    ]},
    { text:'分支三', children:[] },
  ]});
}

function boxesOverlap(a, b){
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* ═══════════ 1. 模型 ═══════════ */
section('模型操作');
{
  const doc = makeDoc();
  ok(doc.count() === 10, '节点计数 = 10（实际 ' + doc.count() + '）');
  ok(doc.root.id === 'n1', '根节点 id');

  const added = doc.addChild('n1', doc.createNode('新增'));
  ok(!!added && doc.find(added.id) === added, '添加子节点');

  const rm = doc.remove(added.id);
  ok(rm && rm.parentId === 'n1' && doc.find(added.id) === null, '删除节点并返回位置');

  // 移动守卫：不能移入自己的后代
  const branch1 = doc.root.children[0];
  const deep = branch1.children[0].children[0];
  ok(doc.isDescendant(branch1.id, deep.id) === true, 'isDescendant 正向判定');
  ok(doc.move(branch1.id, deep.id, 0) === false, '禁止移入自身后代');
  ok(doc.find(branch1.id) !== null, '非法移动后树未被破坏');

  // 合法移动
  const b1 = doc.root.children[0];
  ok(doc.move(b1.id, doc.root.id, 3) === true, '合法移动（分支重排序）');
  ok(doc.root.children[2].id === b1.id, '移动后位置正确');

  // clone 生成新 id
  const cp = doc.cloneSubtree(doc.root.children[0].id);
  const ids = new Set();
  (function rec(n){ ids.add(n.id); n.children.forEach(rec); })(cp);
  ok(ids.size === 4, '克隆子树节点数 = 4');
  let allUnique = true;
  doc.walk(n => { if(ids.has(n.id)) allUnique = false; });
  ok(allUnique, '克隆 id 与原树不冲突');

  // fromJSON 往返
  const json = JSON.stringify(doc.serialize());
  const doc2 = MS.model.Doc.fromJSON(JSON.parse(json));
  ok(JSON.stringify(doc2.serialize()) === json, 'JSON 序列化往返一致');

  ok(doc2.toggleCollapse(doc2.root.children[0].id) === true, '折叠切换');
  ok(doc2.root.children[0].collapsed === true, '折叠状态生效');
}

/* ═══════════ 2. 布局几何不变量 ═══════════ */
section('布局（4 种结构）');
{
  const theme = MS.themes.get('classic');
  const measure = (n, d) => MS.themes.measureNode(n, d);
  for(const structure of ['map', 'right', 'left', 'org']){
    const doc = makeDoc();
    const lay = MS.layout(doc, { structure, measure });
    let fail = null;

    // 所有可见节点都有盒型
    const vis = doc.visibleNodes();
    for(const v of vis){
      if(!lay.nodes.has(v.node.id)){ fail = '缺少盒型: ' + v.node.id; break; }
    }
    // 盒型互不重叠
    if(!fail){
      const arr = [...lay.nodes.values()];
      for(let i = 0; i < arr.length && !fail; i++)
        for(let j = i + 1; j < arr.length && !fail; j++)
          if(boxesOverlap(arr[i], arr[j])) fail = '重叠: ' + arr[i].id + ' × ' + arr[j].id + ' @' + structure;
    }
    // 父子几何关系
    if(!fail){
      lay.nodes.forEach(info => {
        if(!info.parentId) return;
        const p = lay.nodes.get(info.parentId);
        if(structure === 'org'){
          if(info.y < p.y + p.h) fail = 'org 子节点未在父节点下方: ' + info.id;
        } else if(info.side === 1){
          if(info.x < p.x + p.w) fail = '右侧子节点未在父节点右方: ' + info.id;
        } else if(info.side === -1){
          if(info.x + info.w > p.x) fail = '左侧子节点未在父节点左方: ' + info.id;
        }
      });
    }
    // bounds 包含全部
    if(!fail){
      lay.nodes.forEach(info => {
        const b = lay.bounds;
        if(info.x < b.x || info.y < b.y || info.x + info.w > b.x + b.w || info.y + info.h > b.y + b.h)
          fail = '越界: ' + info.id + ' @' + structure;
      });
    }
    // 连线数量 = 非根可见节点数
    if(!fail) ok(lay.links.length === vis.length - 1, structure + ' 连线数 = ' + (vis.length - 1));
    ok(!fail, structure + ' 几何不变量' + (fail ? ' — ' + fail : ''));
  }

  // 折叠：后代不参与布局
  const doc3 = makeDoc();
  doc3.root.children[0].collapsed = true;
  const lay3 = MS.layout(doc3, { structure:'right', measure });
  ok(!lay3.nodes.has(doc3.root.children[0].children[0].id), '折叠后后代不布局');
  ok(lay3.links.length === doc3.visibleNodes().length - 1, '折叠后连线数一致');

  // 根节点折叠：布局不崩溃，仅剩根盒型（回归：曾 TypeError）
  for(const s of ['map','right','left']){
    const docR = makeDoc();
    docR.root.collapsed = true;
    let noThrow = true, size = 0;
    try{
      const layR = MS.layout(docR, { structure:s, measure });
      size = layR.nodes.size;
    }catch(e){ noThrow = false; console.error('   ', e.message); }
    ok(noThrow && size === 1, s + ' 根节点折叠仅剩 1 盒型不崩溃');
  }

  // 超深树（17 层）：无 NaN/undefined 坐标（回归：列/行数组曾固定 14 层）
  let deepN = { text:'L0', children:[] };
  let curN = deepN;
  for(let i = 1; i <= 17; i++){ const nx = { text:'L'+i, children:[] }; curN.children.push(nx); curN = nx; }
  const deepDoc = MS.model.Doc.fromTree(deepN);
  let deepOk = true;
  for(const s of ['map','right','left','org']){
    const layD = MS.layout(deepDoc, { structure:s, measure });
    layD.nodes.forEach(info => { if(!isFinite(info.x) || !isFinite(info.y)) deepOk = false; });
  }
  ok(deepOk, '17 层深树四种结构坐标全部有限');
}

/* ═══════════ 2b. 安全与折叠回归 ═══════════ */
section('安全净化与折叠回归');
{
  // P1-1：恶意 JSON 导入净化（id/style.bg 注入面）
  const evil = { version:1, meta:{}, nextId:2,
    root:{ id:'"><img src=x onerror=alert(1)>', text:'r',
      children:[{ id:'ok-1', text:'c', style:{ bg:'red\" onmouseover=\"alert(2)', bold:'yes' }, children:[] }] } };
  const sd = MS.model.Doc.fromJSON(evil);
  ok(/^[A-Za-z0-9_-]{1,64}$/.test(sd.root.id), '恶意 id 被重分配: ' + sd.root.id);
  ok(sd.root.children[0].id === 'ok-1', '合法 id 保留');
  ok(!('bg' in sd.root.children[0].style), '非法 style.bg 被丢弃');
  ok(sd.root.children[0].style.bold === true, 'bold 强转布尔');
  const svParts = MS.io.exportSVGParts(sd, { structure:'right', theme: MS.themes.get('classic') });
  ok(svParts.svg.indexOf('onerror') < 0 && svParts.svg.indexOf('onmouseover') < 0, 'SVG 导出无事件注入残留');

  // P1-2：折叠父链上新增节点前应展开（ensureAncestorsVisible）
  const cd = makeDoc();
  cd.root.children[0].collapsed = true;
  sandbox.MS.view = { doc: cd };   // editor 模块需要 view stub
  const src2 = fs.readFileSync(path.join(__dirname, '..', 'js', 'editor.js'), 'utf8');
  vm.runInContext(src2, sandbox, { filename: 'editor.js' });
  const changed = MS.editor.ensureAncestorsVisible(cd.root.children[0].id);
  ok(changed === true && cd.root.children[0].collapsed === false, 'ensureAncestorsVisible 展开折叠父链');
  const changed2 = MS.editor.ensureAncestorsVisible(cd.root.children[1].id);
  ok(changed2 === false, '已可见链返回 false');
  delete sandbox.MS.view;
}

/* ═══════════ 3. Markdown 往返 ═══════════ */
section('Markdown 导入导出往返');
{
  const doc = makeDoc();
  const md = MS.io.exportMarkdown(doc);
  ok(md.startsWith('# 中心主题'), 'MD 以一级标题开头');
  const tree = MS.io.parseMarkdown(md);

  const seq = t => { const out = []; (function rec(n, d){ out.push(d + ':' + n.text); n.children.forEach(c => rec(c, d+1)); })(t, 0); return out.join('|'); };
  ok(seq(tree) === seq(doc.root), 'MD 往返结构与文本一致');

  // 深层（>6 级）往返
  let deep = { text:'L0', children:[] };
  let cur = deep;
  for(let i = 1; i <= 8; i++){ const nx = { text:'L' + i, children:[] }; cur.children.push(nx); cur = nx; }
  const deepDoc = MS.model.Doc.fromTree(deep);
  const deepTree = MS.io.parseMarkdown(MS.io.exportMarkdown(deepDoc));
  ok(seq(deepTree) === seq(deep), '8 层深度 MD 往返一致');

  // 缩进文本导入
  const indented = '根\n  一级A\n    二级A1\n  一级B\n';
  const it = MS.io.parseIndentText(indented);
  ok(it && it.text === '根' && it.children.length === 2 && it.children[0].children[0].text === '二级A1', '缩进文本解析');

  // 带列表符的 Markdown
  const mdList = '# 主题\n- 要点一\n  - 细节\n- 要点二\n';
  const lt = MS.io.parseMarkdown(mdList);
  ok(lt && lt.text === '主题' && lt.children.length === 2 && lt.children[0].children[0].text === '细节', '列表 Markdown 解析');
}

/* ═══════════ 4. JSON / 纯树导入 ═══════════ */
section('JSON 导入');
{
  const doc = makeDoc();
  const doc2 = MS.io.parseJSONDoc(MS.io.exportJSON(doc));
  ok(doc2 && JSON.stringify(doc2.serialize()) === JSON.stringify(doc.serialize()), 'parseJSONDoc 完整往返');

  const generic = JSON.stringify({ text:'通用', children:[{ text:'子' }] });
  const doc3 = MS.io.parseJSONDoc(generic);
  ok(doc3 && doc3.root.text === '通用' && doc3.count() === 2, '通用树形 JSON 导入');
}

/* ═══════════ 5. SVG / 交互 HTML 导出 ═══════════ */
section('SVG 与交互 HTML');
{
  const doc = makeDoc();
  const theme = MS.themes.get('classic');
  const parts = MS.io.exportSVGParts(doc, { structure:'right', theme });
  ok(parts.svg.startsWith('<svg') && parts.svg.trim().endsWith('</svg>'), 'SVG 结构完整');
  ok(parts.svg.includes('中心主题'), 'SVG 包含根文本');
  ok(!parts.svg.includes('undefined') && !parts.svg.includes('NaN'), 'SVG 无未定义值');
  const gOpen = (parts.svg.match(/<g[ >]/g) || []).length;
  const gClose = (parts.svg.match(/<\/g>/g) || []).length;
  ok(gOpen === gClose, 'SVG <g> 配对（' + gOpen + '/' + gClose + '）');

  const html = MS.io.exportInteractiveHTML(doc, { structure:'map', theme });
  ok(html.startsWith('<!DOCTYPE html>') && html.includes('ms-svg'), '交互 HTML 结构');
  ok(html.includes('data-toggle'), '交互 HTML 包含折叠控件');
  ok(!html.includes('undefined'), '交互 HTML 无未定义值');

  // 全部主题 × 全部结构生成无异常
  let allOk = true;
  for(const t of MS.themes.list)
    for(const s of ['map','right','left','org']){
      try{ MS.io.exportSVGParts(makeDoc(), { structure:s, theme:t }); }
      catch(e){ allOk = false; console.error('   失败:', t.id, s, e.message); }
    }
  ok(allOk, '8 主题 × 4 结构全部可导出');
}

/* ═══════════ 6. 大文档性能 ═══════════ */
section('较大文档布局');
{
  const kids = [];
  for(let i = 0; i < 12; i++){
    kids.push({ text:'分支 ' + i, children: Array.from({ length:6 }, (_, j) => ({ text:'子项 ' + i + '-' + j + ' 一些文字', children:[] })) });
  }
  const big = MS.model.Doc.fromTree({ text:'大导图', children:kids });
  const t0 = Date.now();
  const lay = MS.layout(big, { structure:'map', measure:(n,d) => MS.themes.measureNode(n,d) });
  const dt = Date.now() - t0;
  ok(lay.nodes.size === 85, '85 节点全部布局（实际 ' + lay.nodes.size + '）');
  ok(dt < 500, '布局耗时 ' + dt + 'ms < 500ms');
}

console.log('\n════════════════════════════');
console.log('通过 ' + passed + '，失败 ' + failed);
process.exit(failed ? 1 : 0);
