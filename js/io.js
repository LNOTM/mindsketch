/* MindSketch 导入 / 导出 | Import / Export
 * 导出 Export：PNG JPG SVG PDF Markdown OPML FreeMind JSON 交互网页 interactive-HTML
 * 导入 Import：XMind(.xmind zip) FreeMind OPML Markdown TXT JSON
 * SVG 嵌套分组支撑交互网页的分支折叠；位图经 SVG→Image→Canvas 光栅化。
 * Nested <g> groups power branch collapse in exported HTML; bitmaps rasterized via canvas.
 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;
var SVG_FONT = "'Segoe UI','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif";

function r(v){ return Math.round(v*10)/10; }
function cleanName(fileName){
  var n = String(fileName||'').replace(/\.[^.]+$/,'').trim();
  return n || '导入的导图';
}

/* ═══════════ SVG 导出（静态导出与交互网页共用） ═══════════ */

function buttonPos(info, structure){
  if(structure === 'org')
    return { x: info.x + info.w/2, y: info.y + info.h + 14 };
  var x;
  if(info.depth === 0) x = structure === 'left' ? info.x - 14 : info.x + info.w + 14;
  else x = info.side === 1 ? info.x + info.w + 14 : info.x - 14;
  return { x:x, y:info.y + info.h/2 };
}

function exportSVGParts(doc, opts){
  var structure = opts.structure, theme = opts.theme, interactive = !!opts.interactive;
  var collapsedMap = new Map();
  doc.walk(function(n){ collapsedMap.set(n.id, !!n.collapsed); });

  var data = doc.serialize();
  (function clear(n){ n.collapsed = false; n.children.forEach(clear); })(data.root);
  var full = MS.model.Doc.fromJSON(data);
  var layout = MS.layout(full, {
    structure: structure,
    measure: function(n,d){ return MS.themes.measureNode(n,d); }
  });
  var b = layout.bounds;
  var parts = [];

  var attrs = 'width="'+r(b.w)+'" height="'+r(b.h)+'" viewBox="'+r(b.x)+' '+r(b.y)+' '+r(b.w)+' '+r(b.h)+'"';
  if(interactive) attrs += ' preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%"';
  parts.push('<svg id="ms-svg" xmlns="http://www.w3.org/2000/svg" font-family="'+SVG_FONT+'" '+attrs+'>');
  parts.push('<rect x="'+r(b.x)+'" y="'+r(b.y)+'" width="'+r(b.w)+'" height="'+r(b.h)+'" fill="'+theme.bg+'"/>');

  function nodeG(info){
    var n = info.node;
    var st = MS.themes.styleFor(n, info, theme);
    var m = info.m;
    var g = ['<g id="ms-'+util.esc(info.id)+'">'];
    g.push('<rect x="'+r(info.x)+'" y="'+r(info.y)+'" width="'+r(info.w)+'" height="'+r(info.h)+'" rx="'+st.radius+'" fill="'+st.bg+'"'+(st.bw?' stroke="'+st.border+'" stroke-width="'+st.bw+'"':'')+'/>');
    var cx = r(info.x + info.w/2);
    var y0 = info.y + m.padY + m.lineH/2 + m.fs*0.35;
    var tspans = m.lines.map(function(l,i){
      return '<tspan x="'+cx+'" y="'+r(y0 + i*m.lineH)+'">'+util.esc(l || '\u00A0')+'</tspan>';
    }).join('');
    g.push('<text text-anchor="middle" font-size="'+m.fs+'" font-weight="'+st.fw+'" fill="'+st.color+'">'+tspans+'</text>');
    if(n.note){
      g.push('<circle cx="'+r(info.x+info.w-9)+'" cy="'+r(info.y+9)+'" r="5" fill="'+theme.accent+'" opacity="0.85"><title>'+util.esc(n.note)+'</title></circle>');
    }
    if(info.hasChildren){
      var disp = (interactive && collapsedMap.get(info.id)) ? 'none' : 'inline';
      g.push('<g class="ms-kids" data-p="'+util.esc(info.id)+'" style="display:'+disp+'">');
      layout.links.forEach(function(l){
        if(l.from !== info.id) return;
        var col = MS.themes.branchColor(theme, l.branch);
        g.push('<path d="'+l.d+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linecap="round"/>');
      });
      info.node.children.forEach(function(c){ g.push(nodeG(layout.nodes.get(c.id))); });
      g.push('</g>');
    }
    if(interactive && info.hasChildren){
      var bp = buttonPos(info, structure);
      var col2 = info.depth === 0 ? theme.accent : MS.themes.branchColor(theme, info.branch);
      var btnBg = theme.id === 'night' ? '#2a3242' : '#ffffff';
      g.push('<g class="ms-toggle" data-toggle="'+util.esc(info.id)+'" style="cursor:pointer">');
      g.push('<circle cx="'+r(bp.x)+'" cy="'+r(bp.y)+'" r="10" fill="'+btnBg+'" stroke="'+col2+'" stroke-width="1.5"/>');
      g.push('<path d="M '+(bp.x-4)+' '+bp.y+' H '+(bp.x+4)+'" stroke="'+col2+'" stroke-width="1.8" fill="none"/>');
      g.push('<g class="ms-plus" style="display:'+(collapsedMap.get(info.id)?'inline':'none')+'"><path d="M '+bp.x+' '+(bp.y-4)+' V '+(bp.y+4)+'" stroke="'+col2+'" stroke-width="1.8" fill="none"/></g>');
      g.push('</g>');
    }
    g.push('</g>');
    return g.join('');
  }

  parts.push(nodeG(layout.nodes.get(doc.root.id)));
  parts.push('</svg>');
  return { svg:parts.join(''), bounds:b, layout:layout, theme:theme };
}

/* ═══════════ 位图 / PDF ═══════════ */

function svgToCanvas(svgStr, bw, bh){
  return new Promise(function(res, rej){
    var url = URL.createObjectURL(new Blob([svgStr], {type:'image/svg+xml;charset=utf-8'}));
    var img = new Image();
    img.onload = function(){
      try{
        var scale = Math.max(1, Math.min(3, 1600/bw));
        var c = document.createElement('canvas');
        c.width = Math.round(bw*scale);
        c.height = Math.round(bh*scale);
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res({ canvas:c, scale:scale });
      }catch(err){ URL.revokeObjectURL(url); rej(err); }
    };
    img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('SVG 渲染失败')); };
    img.src = url;
  });
}

function exportPNG(doc, opts){
  var p = exportSVGParts(doc, opts);
  return svgToCanvas(p.svg, p.bounds.w, p.bounds.h).then(function(rst){
    return new Promise(function(res, rej){
      rst.canvas.toBlob(function(b){ b ? res(b) : rej(new Error('PNG 编码失败')); }, 'image/png');
    });
  });
}

function exportJPG(doc, opts){
  var p = exportSVGParts(doc, opts);
  return svgToCanvas(p.svg, p.bounds.w, p.bounds.h).then(function(rst){
    return new Promise(function(res, rej){
      rst.canvas.toBlob(function(b){ b ? res(b) : rej(new Error('JPG 编码失败')); }, 'image/jpeg', 0.92);
    });
  });
}

function exportPDF(doc, opts){
  var p = exportSVGParts(doc, opts);
  if(!(window.jspdf && window.jspdf.jsPDF)){
    return Promise.reject(new Error('PDF 组件未能加载（导出 PDF 需要联网加载资源）'));
  }
  return svgToCanvas(p.svg, p.bounds.w, p.bounds.h).then(function(rst){
    var b = p.bounds;
    var pdf = new window.jspdf.jsPDF({
      orientation: b.w >= b.h ? 'landscape' : 'portrait',
      unit: 'px',
      format: [b.w, b.h]
    });
    pdf.addImage(rst.canvas.toDataURL('image/png'), 'PNG', 0, 0, b.w, b.h);
    return pdf;
  });
}

/* ═══════════ 交互网页导出 ═══════════ */

function exportInteractiveHTML(doc, opts){
  var p = exportSVGParts(doc, { structure:opts.structure, theme:opts.theme, interactive:true });
  var viewer = [
    "var svg=document.getElementById('ms-svg');",
    "var vb=(svg.getAttribute('viewBox')||'0 0 1000 700').split(/[\\s,]+/).map(Number);",
    "var base=vb.slice();",
    "function apply(){svg.setAttribute('viewBox',vb.join(' '));}",
    "function fit(){vb=base.slice();apply();}",
    "svg.addEventListener('wheel',function(e){e.preventDefault();var f=Math.exp(e.deltaY*0.0012);var cx=vb[0]+vb[2]/2,cy=vb[1]+vb[3]/2;var nw=vb[2]*f,nh=vb[3]*f;vb=[cx-nw/2,cy-nh/2,nw,nh];apply();},{passive:false});",
    "var drag=null;",
    "svg.addEventListener('pointerdown',function(e){if(e.target.closest('[data-toggle]'))return;drag={x:e.clientX,y:e.clientY,vb:vb.slice()};svg.setPointerCapture(e.pointerId);svg.style.cursor='grabbing';});",
    "svg.addEventListener('pointermove',function(e){if(!drag)return;var rect=svg.getBoundingClientRect();var kx=vb[2]/rect.width,ky=vb[3]/rect.height;vb[0]=drag.vb[0]-(e.clientX-drag.x)*kx;vb[1]=drag.vb[1]-(e.clientY-drag.y)*ky;apply();});",
    "svg.addEventListener('pointerup',function(){drag=null;svg.style.cursor='grab';});",
    "svg.addEventListener('click',function(e){var t=e.target.closest('[data-toggle]');if(!t)return;var id=t.getAttribute('data-toggle');var kids=svg.querySelector('g.ms-kids[data-p=\"'+id+'\"]');var plus=t.querySelector('.ms-plus');if(kids){var show=kids.style.display==='none';kids.style.display=show?'inline':'none';if(plus)plus.style.display=show?'none':'inline';}});",
    "document.getElementById('ms-fit').addEventListener('click',fit);",
    "document.getElementById('ms-print').addEventListener('click',function(){window.print();});",
    "apply();"
  ].join('\n');
  var html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>'+util.esc(doc.name)+' \u00b7 MindSketch 交互导图</title>\n'
    + '<style>\nhtml,body{height:100%;margin:0}\nbody{background:'+p.theme.bg+';overflow:hidden}\n#ms-svg{cursor:grab;touch-action:none}\n#ms-bar{position:fixed;top:14px;right:14px;display:flex;gap:8px;z-index:9}\n#ms-bar button{border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12);font-family:system-ui,sans-serif}\n#ms-hint{position:fixed;left:14px;bottom:12px;font-size:12px;color:#8a94a6;font-family:system-ui,sans-serif}\n@media print{#ms-bar,#ms-hint{display:none}}\n</style>\n</head>\n<body>\n'
    + p.svg + '\n'
    + '<div id="ms-bar"><button id="ms-fit">\u9002\u5e94\u7a97\u53e3</button><button id="ms-print">\u6253\u5370 / \u5b58\u4e3a PDF</button></div>\n'
    + '<div id="ms-hint">MindSketch \u5bfc\u51fa \u00b7 \u6eda\u8f6e\u7f29\u653e \u00b7 \u62d6\u52a8\u5e73\u79fb \u00b7 \u70b9\u51fb\u6298\u53e0\u6309\u94ae\u5c55\u5f00/\u6536\u8d77</div>\n'
    + '<script>\n' + viewer + '\n<\/script>\n</body>\n</html>\n';
  return html;
}

/* ═══════════ 文本格式导出 ═══════════ */

function exportJSON(doc){
  return JSON.stringify(doc.serialize(), null, 2);
}

function exportMarkdown(doc){
  var out = [];
  (function rec(n, d){
    var text = String(n.text||'').replace(/\n/g, ' ');
    if(d === 0) out.push('# ' + text);
    else if(d <= 5) out.push('#'.repeat(d+1) + ' ' + text);
    else out.push('  '.repeat(d-6) + '- ' + text);
    n.children.forEach(function(c){ rec(c, d+1); });
  })(doc.root, 0);
  return out.join('\n\n') + '\n';
}

function exportOPML(doc){
  var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">',
             '<head><title>'+util.esc(doc.name)+'</title></head>', '<body>'];
  (function rec(n, d){
    var ind = '  '.repeat(d+1);
    var attrs = ' text="'+util.esc(String(n.text||'').replace(/\n/g,' '))+'"';
    if(n.note) attrs += ' _note="'+util.esc(n.note)+'"';
    if(n.children.length){
      out.push(ind+'<outline'+attrs+'>');
      n.children.forEach(function(c){ rec(c, d+1); });
      out.push(ind+'</outline>');
    } else out.push(ind+'<outline'+attrs+'/>');
  })(doc.root, 0);
  out.push('</body>', '</opml>');
  return out.join('\n');
}

function exportFreeMind(doc){
  var out = ['<map version="1.0.1">'];
  (function rec(n, d){
    var ind = '  '.repeat(d+1);
    var attrs = ' TEXT="'+util.esc(String(n.text||'').replace(/\n/g,' '))+'"';
    if(n.children.length){
      out.push(ind+'<node'+attrs+'>');
      if(n.note) out.push(ind+'  <richcontent TYPE="NOTE"><html><body><p>'+util.esc(n.note)+'</p></body></html></richcontent>');
      n.children.forEach(function(c){ rec(c, d+1); });
      out.push(ind+'</node>');
    } else {
      out.push(ind+'<node'+attrs+'/>');
      if(n.note) out.push(ind+'  <richcontent TYPE="NOTE"><html><body><p>'+util.esc(n.note)+'</p></body></html></richcontent>');
    }
  })(doc.root, 0);
  out.push('</map>');
  return out.join('\n');
}

/* ═══════════ 解析导入 ═══════════ */

function stripMd(s){ return String(s||'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').trim(); }

function buildFromTokens(toks){
  if(!toks.length) return null;
  var rootT = { text:toks[0].text, note:'', children:[] };
  var stack = [{ d:toks[0].depth, t:rootT }];
  for(var i=1;i<toks.length;i++){
    var tk = toks[i];
    while(stack.length > 1 && stack[stack.length-1].d >= tk.depth) stack.pop();
    var node = { text:tk.text, note:'', children:[] };
    stack[stack.length-1].t.children.push(node);
    stack.push({ d:tk.depth, t:node });
  }
  return rootT;
}

function parseMarkdown(text){
  var lines = String(text||'').replace(/\r/g,'').split('\n');
  var toks = [], lastH = -1;
  lines.forEach(function(line){
    if(!line.trim()) return;
    var mh = line.match(/^(#{1,6})\s+(.*)$/);
    if(mh){ lastH = mh[1].length - 1; toks.push({ depth:lastH, text:stripMd(mh[2]) }); return; }
    var m = line.match(/^(\s*)(?:[-*+]|\d+[.、)]|\[[ xX]\])\s+(.*)$/);
    var indent, txt;
    if(m){ indent = m[1].replace(/\t/g,'  ').length; txt = m[2]; }
    else { var m3 = line.match(/^(\s*)(.*)$/); indent = m3[1].replace(/\t/g,'  ').length; txt = m3[2]; }
    if(!txt.trim()) return;
    var base = lastH >= 0 ? lastH + 1 : 0;
    toks.push({ depth: base + Math.floor(indent/2), text:stripMd(txt) });
  });
  return buildFromTokens(toks);
}

function parseIndentText(text){
  var lines = String(text||'').replace(/\r/g,'').split('\n');
  var toks = [];
  lines.forEach(function(line){
    if(!line.trim()) return;
    var m = line.match(/^(\s*)(.*)$/);
    var indent = m[1].replace(/\t/g,'  ').length;
    var txt = m[2].replace(/^\s*(?:[-*+]|\d+[.、)]|#)\s+/,'');
    if(!txt) return;
    toks.push({ depth: Math.floor(indent/2), text: stripMd(txt) });
  });
  return buildFromTokens(toks);
}

function parseOPML(text){
  var xml;
  try{ xml = new DOMParser().parseFromString(text, 'text/xml'); }catch(e){ return null; }
  if(xml.querySelector('parsererror')) return null;
  var body = xml.querySelector('body');
  if(!body) return null;
  function conv(el){
    var t = { text: el.getAttribute('text') || el.getAttribute('title') || '',
              note: el.getAttribute('_note') || '', children: [] };
    Array.prototype.forEach.call(el.children, function(c){
      if(c.tagName && c.tagName.toLowerCase() === 'outline') t.children.push(conv(c));
    });
    return t;
  }
  var tops = Array.prototype.filter.call(body.children, function(e){ return e.tagName && e.tagName.toLowerCase()==='outline'; });
  if(!tops.length) return null;
  if(tops.length === 1) return conv(tops[0]);
  return { text:'导入的导图', note:'', children: tops.map(conv) };
}

function parseFreeMind(text){
  var xml;
  try{ xml = new DOMParser().parseFromString(text, 'text/xml'); }catch(e){ return null; }
  if(xml.querySelector('parsererror')) return null;
  var rootEl = xml.querySelector('map > node') || xml.querySelector('node');
  if(!rootEl) return null;
  function conv(n){
    var t = { text: n.getAttribute('TEXT') || '', note:'', children:[] };
    Array.prototype.forEach.call(n.children, function(c){
      var tag = c.tagName ? c.tagName.toLowerCase() : '';
      if(tag === 'node') t.children.push(conv(c));
      else if(tag === 'richcontent'){
        var type = (c.getAttribute('type')||'').toUpperCase();
        var content = (c.textContent||'').trim();
        if(type === 'NOTE' && content) t.note = content;
        else if(!t.text && content) t.text = content;
      }
    });
    return t;
  }
  return conv(rootEl);
}

function parseJSONDoc(str){
  var obj;
  try{ obj = JSON.parse(str); }catch(e){ return null; }
  if(!obj || typeof obj !== 'object') return null;
  if(obj.root){ return MS.model.Doc.fromJSON(obj); }
  if(typeof obj.text === 'string'){ return MS.model.Doc.fromTree(obj); }
  return null;
}

/* XMind (.xmind = zip) */
function topicToTree(t){
  var note = '';
  if(t.notes && t.notes.plain && t.notes.plain.content) note = t.notes.plain.content;
  var kids = (t.children && (t.children.attached || [])) || [];
  return { text:String(t.title||''), note:note, children:kids.map(topicToTree) };
}
function xmlTopicToTree(el){
  function direct(name){
    var els = el.children || [];
    for(var i=0;i<els.length;i++){
      if(els[i].tagName && els[i].tagName.toLowerCase() === name) return els[i];
    }
    return null;
  }
  var titleEl = direct('title');
  var t = { text: titleEl ? (titleEl.textContent||'').trim() : '', note:'', children:[] };
  var ch = direct('children');
  if(ch){
    Array.prototype.forEach.call(ch.children, function(topics){
      Array.prototype.forEach.call(topics.children || [], function(tp){
        if(tp.tagName && tp.tagName.toLowerCase() === 'topic') t.children.push(xmlTopicToTree(tp));
      });
    });
  }
  return t;
}
async function parseXMind(buf){
  if(!window.JSZip) throw new Error('XMind 解压组件未加载（导入 .xmind 需要联网加载资源）');
  var zip = await JSZip.loadAsync(buf);
  var zf = zip.file('content.json');
  if(zf){
    var sheets = JSON.parse(await zf.async('string'));
    var rt = sheets && sheets[0] && sheets[0].rootTopic;
    if(rt) return topicToTree(rt);
  }
  var zx = zip.file('content.xml');
  if(zx){
    var xml = new DOMParser().parseFromString(await zx.async('string'), 'text/xml');
    var rootTopic = xml.querySelector('sheet > topic') || xml.querySelector('topic');
    if(rootTopic) return xmlTopicToTree(rootTopic);
  }
  throw new Error('XMind 文件中没有可识别的内容');
}

/* 粘贴板文本 → 树 */
function guessTree(text){
  var s = String(text||'').trim();
  if(!s) return null;
  if(s[0] === '{'){
    var d = parseJSONDoc(s);
    if(d) return d.root;
  }
  var lines = s.split(/\r?\n/);
  if(lines.length > 1 || /^#{1,6}\s|^\s*[-*+]\s/.test(s)){
    var t = parseMarkdown(s) || parseIndentText(s);
    if(t) return t;
  }
  return { text:s.replace(/\s+/g,' '), note:'', children:[] };
}

/* 自动识别并导入 */
async function importAuto(fileName, content){
  var ext = String(fileName||'').split('.').pop().toLowerCase();
  if(ext === 'xmind'){
    return MS.model.Doc.fromTree(await parseXMind(content), cleanName(fileName));
  }
  if(ext === 'json'){
    var d = parseJSONDoc(content);
    if(d){ if(!d.data.meta.importedName) d.name = d.name === '未命名导图' ? cleanName(fileName) : d.name; return d; }
    throw new Error('JSON 文件格式无法识别（需要 MindSketch 导出格式或通用树形结构）');
  }
  if(/^\s*\{/.test(content)){
    var d2 = parseJSONDoc(content);
    if(d2){ if(!d2.data.meta.importedName) d2.name = d2.name === '未命名导图' ? cleanName(fileName) : d2.name; return d2; }
  }
  var tree = null;
  if(ext === 'opml' || /^\s*(<\?xml|<opml)/i.test(content)) tree = parseOPML(content);
  if(!tree && (ext === 'mm' || /<map[\s>]/i.test(content))) tree = parseFreeMind(content);
  if(!tree && ext === 'txt') tree = parseIndentText(content);
  if(!tree) tree = parseMarkdown(content);
  if(!tree) throw new Error('无法识别的文件内容');
  return MS.model.Doc.fromTree(tree, cleanName(fileName));
}

MS.io = {
  exportJSON: exportJSON,
  exportMarkdown: exportMarkdown,
  exportOPML: exportOPML,
  exportFreeMind: exportFreeMind,
  exportSVGParts: exportSVGParts,
  exportInteractiveHTML: exportInteractiveHTML,
  exportPNG: exportPNG,
  exportJPG: exportJPG,
  exportPDF: exportPDF,
  parseMarkdown: parseMarkdown,
  parseIndentText: parseIndentText,
  parseOPML: parseOPML,
  parseFreeMind: parseFreeMind,
  parseJSONDoc: parseJSONDoc,
  parseXMind: parseXMind,
  guessTree: guessTree,
  importAuto: importAuto
};
})();
