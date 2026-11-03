/* MindSketch 主题系统 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;

/* 分支彩虹色板（借鉴 XMind 的分支着色思路） */
var PALETTE = ['#4285f4','#22b07d','#f39c2d','#e85a8a','#8f6ed5','#00b8c4','#5f7a95','#d97706'];

var list = [
  { id:'classic', name:'经典蓝', accent:'#3f7ef7', bg:'#f6f8fb', grid:'#dde4ee',
    deepBg:'#ffffff', deepBorder:'#d5dde8', text:'#2b3a4a',
    tintBase:'#ffffff', tintAmount:0.84, palette:PALETTE },
  { id:'forest', name:'森林绿', accent:'#1f9d61', bg:'#f4faf6', grid:'#d8e9df',
    deepBg:'#ffffff', deepBorder:'#cfe3d7', text:'#243b31',
    tintBase:'#ffffff', tintAmount:0.85,
    palette:['#1f9d61','#3f7ef7','#f39c2d','#e85a8a','#8f6ed5','#00b8c4','#7a8c99','#c05621'] },
  { id:'sunset', name:'暖阳橙', accent:'#f08c1f', bg:'#fdf8f2', grid:'#eee3d4',
    deepBg:'#ffffff', deepBorder:'#e8dcc9', text:'#4a3826',
    tintBase:'#ffffff', tintAmount:0.85,
    palette:['#f08c1f','#e85a8a','#3f7ef7','#22b07d','#8f6ed5','#00b8c4','#d97706','#5f7a95'] },
  { id:'violet', name:'紫罗兰', accent:'#7b5ce0', bg:'#f8f6fd', grid:'#e4def2',
    deepBg:'#ffffff', deepBorder:'#ddd4ef', text:'#352b52',
    tintBase:'#ffffff', tintAmount:0.85,
    palette:['#7b5ce0','#e85a8a','#00b8c4','#f39c2d','#22b07d','#4285f4','#d97706','#5f7a95'] },
  { id:'sakura', name:'樱花粉', accent:'#ef6a9a', bg:'#fdf6f8', grid:'#f1dde5',
    deepBg:'#ffffff', deepBorder:'#f0dbe4', text:'#4d3040',
    tintBase:'#ffffff', tintAmount:0.86,
    palette:['#ef6a9a','#8f6ed5','#f39c2d','#00b8c4','#3f7ef7','#22b07d','#d97706','#5f7a95'] },
  { id:'ocean', name:'海洋青', accent:'#0aa2c0', bg:'#f3fafb', grid:'#d7e9ee',
    deepBg:'#ffffff', deepBorder:'#cfe5ea', text:'#1f3d47',
    tintBase:'#ffffff', tintAmount:0.85,
    palette:['#0aa2c0','#3f7ef7','#22b07d','#f39c2d','#8f6ed5','#e85a8a','#5f7a95','#d97706'] },
  { id:'mono', name:'极简黑白', accent:'#2b3240', bg:'#fafafa', grid:'#e8e8e8',
    deepBg:'#ffffff', deepBorder:'#d9d9d9', text:'#222222',
    tintBase:'#ffffff', tintAmount:0.88,
    palette:['#2b3240','#4a5568','#718096','#5d6a7a','#8792a1','#3a4556','#6b7686','#4f5a6a'] },
  { id:'night', name:'夜幕深色', accent:'#4c8dff', bg:'#161c26', grid:'#232c3b',
    deepBg:'#1e2532', deepBorder:'#333e52', text:'#d9e2f0',
    tintBase:'#161c26', tintAmount:0.74,
    palette:['#4c8dff','#2fbf8f','#f2a33c','#ef6a9a','#9d84ec','#26c3d9','#8a97ab','#e08833'] }
];

function get(id){
  for(var i=0;i<list.length;i++) if(list[i].id===id) return list[i];
  return list[0];
}

/* 测量节点尺寸（渲染与导出共用，保证一致） */
function measureNode(node, depth){
  var isRoot = depth===0, isL1 = depth===1;
  var fs = isRoot?18:(isL1?15:14);
  var fw = (isRoot||isL1)?600:400;
  var font = fw+' '+fs+'px '+util.fontStack;
  var padX = isRoot?18:(isL1?13:11), padY = isRoot?12:(isL1?8:7);
  var maxW = isRoot?300:220;
  var lines = util.wrapText(node.text, font, maxW-padX*2);
  var tw = 0;
  lines.forEach(function(l){ tw = Math.max(tw, util.measureLine(l, font)); });
  var minW = isRoot?80:(isL1?46:34);
  var w = Math.max(tw, minW) + padX*2 + (node.note?14:0);
  var lineH = Math.round(fs*1.5);
  var h = lines.length*lineH + padY*2;
  return { w:Math.ceil(w), h:Math.ceil(h), lines:lines, fs:fs, lineH:lineH, padX:padX, padY:padY, fw:fw };
}

/* 节点视觉样式 */
function styleFor(node, info, theme){
  var d = info.depth, st = node.style || {};
  var fs = d===0?18:(d===1?15:14);
  var lineH = Math.round(fs*1.5);
  var fw = d<=1?600:400;
  if(st.bold) fw = 700;
  var radius = d===0?12:(d===1?9:7);
  if(st.bg){
    return { bg:st.bg, color:util.readable(st.bg), border:st.bg, bw:0, radius:radius, fs:fs, fw:fw, lineH:lineH };
  }
  if(d===0){
    return { bg:theme.accent, color:'#ffffff', border:theme.accent, bw:0, radius:12, fs:fs, fw:fw, lineH:lineH };
  }
  if(d===1){
    var pal = theme.palette;
    var c = pal[((info.branch % pal.length) + pal.length) % pal.length];
    return { bg:util.hexMix(c, theme.tintBase, theme.tintAmount), color:theme.text,
             border:c, bw:1.5, radius:9, fs:fs, fw:fw, lineH:lineH };
  }
  return { bg:theme.deepBg, color:theme.text, border:theme.deepBorder, bw:1, radius:7, fs:fs, fw:fw, lineH:lineH };
}

/* 分支色 */
function branchColor(theme, branch){
  var pal = theme.palette;
  return pal[((branch % pal.length) + pal.length) % pal.length];
}

/* 右键菜单的节点配色 */
var NODE_COLORS = ['#e5484d','#f08c1f','#eab308','#22b07d','#00b8c4','#3f7ef7','#8f6ed5','#e85a8a','#64748b'];

MS.themes = { list:list, get:get, measureNode:measureNode, styleFor:styleFor, branchColor:branchColor, NODE_COLORS:NODE_COLORS };
})();
