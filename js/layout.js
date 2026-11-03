/* MindSketch 布局引擎
 * 支持结构：map（平衡导图）| right（逻辑图·右）| left（逻辑图·左）| org（组织结构图）
 * 输出所有可见节点盒型 + 连线，供 HTML 渲染与 SVG 导出共用。
 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;

MS.layout = function(doc, opts){
  var structure = opts.structure || 'map';
  var measure = opts.measure;
  var gapX = 84, gapY = 16, orgHGap = 36, orgVGap = 60;
  var root = doc.root;
  var nodes = new Map();   // id -> info
  var links = [];          // {from,to,side,branch}
  var bounds = null;

  function expanded(n){ return !n.collapsed && n.children.length > 0; }

  /* 预测全部可见节点尺寸 */
  var sizes = new Map(), depthMap = new Map();
  (function walk(n, d){
    sizes.set(n.id, measure(n, d));
    depthMap.set(n.id, d);
    if(expanded(n)) n.children.forEach(function(c){ walk(c, d+1); });
  })(root, 0);

  function grow(x, y, w, h){
    if(!bounds) bounds = { minX:x, minY:y, maxX:x+w, maxY:y+h };
    else {
      if(x < bounds.minX) bounds.minX = x;
      if(y < bounds.minY) bounds.minY = y;
      if(x+w > bounds.maxX) bounds.maxX = x+w;
      if(y+h > bounds.maxY) bounds.maxY = y+h;
    }
  }

  function addInfo(n, depth, x, y, w, h, side, branch, parentId){
    var info = { id:n.id, node:n, depth:depth, x:x, y:y, w:w, h:h,
                 side:side, branch:branch, parentId:parentId || null,
                 m:sizes.get(n.id), collapsed:!!n.collapsed, hasChildren:n.children.length > 0 };
    nodes.set(n.id, info);
    grow(x, y, w, h);
    if(parentId) links.push({ from:parentId, to:n.id, side:side, branch:branch });
    return info;
  }

  /* ── 横向树（map / right / left）────────────── */
  function layoutTree(){
    var rm = sizes.get(root.id);
    var kids = root.children;
    var rightKids = [], leftKids = [];
    if(structure === 'map'){
      var k = Math.ceil(kids.length / 2);
      rightKids = kids.slice(0, k);
      leftKids = kids.slice(k);
    } else if(structure === 'left'){ leftKids = kids.slice(); }
    else { rightKids = kids.slice(); }

    var sideOf = new Map(), branchOf = new Map();
    function markSide(n, s, b){
      sideOf.set(n.id, s);
      branchOf.set(n.id, b);
      if(expanded(n)) n.children.forEach(function(c){ markSide(c, s, b); });
    }
    kids.forEach(function(c, i){
      var s = rightKids.indexOf(c) >= 0 ? 1 : -1;
      markSide(c, s, i);
    });

    /* 每层最大宽度（按侧）→ 列对齐 */
    var maxW = { 1:{}, '-1':{} };
    depthMap.forEach(function(d, id){
      if(d === 0) return;
      var s = sideOf.get(id);
      if(!s) return;
      maxW[s][d] = Math.max(maxW[s][d] || 0, sizes.get(id).w);
    });

    var colX = { 1:{}, '-1':{} };
    colX[1][1] = rm.w + gapX;
    colX['-1'][1] = -gapX;
    for(var d=2; d<=14; d++){
      colX[1][d] = colX[1][d-1] + (maxW[1][d-1] || 0) + gapX;
      colX['-1'][d] = colX['-1'][d-1] - (maxW['-1'][d-1] || 0) - gapX;
    }

    var spanCache = new Map();
    function spanOf(n){
      if(spanCache.has(n.id)) return spanCache.get(n.id);
      var m = sizes.get(n.id), s;
      if(!expanded(n)) s = m.h;
      else {
        var sum = 0;
        n.children.forEach(function(c){ sum += spanOf(c); });
        s = Math.max(m.h, sum + gapY * (n.children.length - 1));
      }
      spanCache.set(n.id, s);
      return s;
    }

    function place(n, depth, side, top, parentId){
      var m = sizes.get(n.id);
      var x = side === 1 ? colX[1][depth] : colX['-1'][depth] - m.w;
      var y;
      if(!expanded(n)) y = top;
      else {
        var cy = top, first = null, last = null;
        n.children.forEach(function(c){
          var b = place(c, depth+1, side, cy, n.id);
          if(!first) first = b;
          last = b;
          cy += spanOf(c) + gapY;
        });
        var span = spanOf(n);
        var center = (first.y + last.y + last.h) / 2;
        y = util.clamp(center - m.h/2, top, top + span - m.h);
      }
      return addInfo(n, depth, x, y, m.w, m.h, side, branchOf.get(n.id), parentId);
    }

    var cy = 0;
    rightKids.forEach(function(c){ place(c, 1, 1, cy, root.id); cy += spanOf(c) + gapY; });
    cy = 0;
    leftKids.forEach(function(c){ place(c, 1, -1, cy, root.id); cy += spanOf(c) + gapY; });

    /* 根节点垂直居中于所有一级分支 */
    var minY = Infinity, maxY = -Infinity;
    root.children.forEach(function(c){
      var b = nodes.get(c.id);
      if(b){ if(b.y < minY) minY = b.y; if(b.y + b.h > maxY) maxY = b.y + b.h; }
    });
    if(minY === Infinity){ minY = 0; maxY = rm.h; }
    addInfo(root, 0, 0, (minY + maxY)/2 - rm.h/2, rm.w, rm.h, 0, -1, null);
  }

  /* ── 组织结构图（纵向）───────────────────────── */
  function layoutOrg(){
    var rm = sizes.get(root.id);
    var maxH = { 0: rm.h };
    depthMap.forEach(function(d, id){
      if(d === 0) return;
      maxH[d] = Math.max(maxH[d] || 0, sizes.get(id).h);
    });
    var rowY = { 0: 0 };
    for(var d=1; d<=14; d++) rowY[d] = rowY[d-1] + (maxH[d-1] || 0) + orgVGap;

    var wCache = new Map();
    function subtreeW(n){
      if(wCache.has(n.id)) return wCache.get(n.id);
      var m = sizes.get(n.id), w;
      if(!expanded(n)) w = m.w;
      else {
        var sum = 0;
        n.children.forEach(function(c){ sum += subtreeW(c); });
        w = Math.max(m.w, sum + orgHGap * (n.children.length - 1));
      }
      wCache.set(n.id, w);
      return w;
    }

    function place(n, depth, left, branch, parentId){
      var m = sizes.get(n.id);
      var sw = subtreeW(n);
      var x = left + (sw - m.w)/2, y = rowY[depth];
      addInfo(n, depth, x, y, m.w, m.h, 0, branch, parentId);
      if(expanded(n)){
        var total = 0;
        n.children.forEach(function(c){ total += subtreeW(c); });
        total += orgHGap * (n.children.length - 1);
        var cx = left + (sw - total)/2;
        n.children.forEach(function(c, i){
          place(c, depth+1, cx, depth === 0 ? i : branch, n.id);
          cx += subtreeW(c) + orgHGap;
        });
      }
    }
    place(root, 0, 0, -1, null);
  }

  if(structure === 'org') layoutOrg();
  else layoutTree();

  /* ── 连线路径 ───────────────────────────────── */
  function linkPath(a, b, side){
    function f(v){ return Math.round(v*10)/10; }
    if(structure === 'org'){
      var x1 = f(a.x + a.w/2), y1 = f(a.y + a.h);
      var x2 = f(b.x + b.w/2), y2 = f(b.y);
      var my = f((y1 + y2)/2);
      return 'M '+x1+' '+y1+' L '+x1+' '+my+' L '+x2+' '+my+' L '+x2+' '+y2;
    }
    var ya = f(a.y + a.h/2), yb = f(b.y + b.h/2);
    if(side === 1){
      var xa = f(a.x + a.w), xb = f(b.x), mx = f((xa + xb)/2);
      return 'M '+xa+' '+ya+' C '+mx+' '+ya+', '+mx+' '+yb+', '+xb+' '+yb;
    }
    var xa2 = f(a.x), xb2 = f(b.x + b.w), mx2 = f((xa2 + xb2)/2);
    return 'M '+xa2+' '+ya+' C '+mx2+' '+ya+', '+mx2+' '+yb+', '+xb2+' '+yb;
  }

  var linkPaths = links.map(function(l){
    var a = nodes.get(l.from), b = nodes.get(l.to);
    return { from:l.from, to:l.to, branch:l.branch, side:l.side, d:linkPath(a, b, l.side) };
  });

  var pad = 80;
  var b = bounds
    ? { x:bounds.minX - pad, y:bounds.minY - pad,
        w:(bounds.maxX - bounds.minX) + pad*2, h:(bounds.maxY - bounds.minY) + pad*2 }
    : { x:-pad, y:-pad, w:pad*2 + 240, h:pad*2 + 120 };

  return { structure:structure, nodes:nodes, links:linkPaths, bounds:b };
};
})();
