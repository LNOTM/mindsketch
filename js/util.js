/* MindSketch 工具库 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util = {};

util.esc = function(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};

util.clamp = function(v,a,b){ return v<a?a:(v>b?b:v); };

util.debounce = function(fn, ms){
  var t=null, args=null, self=null;
  return function(){ args=arguments; self=this;
    clearTimeout(t); t=setTimeout(function(){ fn.apply(self,args); }, ms); };
};

/* 事件总线 */
var bus = util.bus = { m:{} };
bus.on = function(e,f){ (bus.m[e]=bus.m[e]||[]).push(f); };
bus.emit = function(e){ var a=Array.prototype.slice.call(arguments,1), list=bus.m[e]||[];
  list.forEach(function(f){ try{ f.apply(null,a); }catch(err){ console.error('[bus]',e,err); } }); };

/* 字体栈：Canvas 测量与 DOM/SVG 渲染必须使用同一份 */
util.fontStack = "'Segoe UI','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif";

/* 文本测量（可注入替换，供 Node 单元测试使用） */
var _ctx = null;
function getCtx(){
  if(!_ctx){ var c=document.createElement('canvas'); _ctx=c.getContext('2d'); }
  return _ctx;
}
var measCache = {};
util.measureLine = function(text, font){
  var key = font + '|' + text, w = measCache[key];
  if(w == null){
    var c = getCtx(); c.font = font;
    w = c.measureText(text || '').width;
    if(!isFinite(w)) w = 0;
    measCache[key] = w;
  }
  return w;
};
util.setMeasurer = function(fn){
  util.measureLine = function(text, font){
    var key = font + '|' + text;
    if(!(key in measCache)) measCache[key] = fn(text, font);
    return measCache[key];
  };
};
util.clearMeasureCache = function(){ measCache = {}; };

/* 智能换行：优先按词断行（拉丁文），超长词按字符断行（中文天然逐字） */
util.wrapText = function(text, font, maxW){
  var src = String(text == null ? '' : text);
  var out = [];
  src.split('\n').forEach(function(para){
    if(para === ''){ out.push(''); return; }
    var tokens = para.split(/(\s+)/), line = '';
    tokens.forEach(function(tok){
      if(tok === '') return;
      if(/^\s+$/.test(tok)){ if(line) line += tok; return; }
      if(util.measureLine(tok, font) > maxW){
        if(line){ out.push(line.replace(/\s+$/,'')); line=''; }
        var cur = '';
        for(var i=0;i<tok.length;i++){
          var ch = tok[i];
          if(cur && util.measureLine(cur+ch, font) > maxW){ out.push(cur); cur = ch; }
          else cur += ch;
        }
        line = cur;
      } else {
        var cand = line ? line + tok : tok;
        if(line && util.measureLine(cand, font) > maxW){ out.push(line.replace(/\s+$/,'')); line = tok; }
        else line = cand;
      }
    });
    out.push(line.replace(/\s+$/,''));
  });
  return out.length ? out : [''];
};

/* 颜色工具 */
util.hexToRgb = function(h){
  h = String(h||'#000').replace('#','');
  if(h.length===3) h = h.split('').map(function(c){return c+c;}).join('');
  var n = parseInt(h,16)||0;
  return [(n>>16)&255,(n>>8)&255,n&255];
};
util.rgbToHex = function(r,g,b){
  return '#' + [r,g,b].map(function(v){
    return Math.round(util.clamp(v,0,255)).toString(16).padStart(2,'0');
  }).join('');
};
util.hexMix = function(c, base, t){
  var a = util.hexToRgb(c), b = util.hexToRgb(base);
  return util.rgbToHex(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t);
};
util.readable = function(bg){
  var rgb = util.hexToRgb(bg);
  var L = (0.299*rgb[0] + 0.587*rgb[1] + 0.114*rgb[2]) / 255;
  return L > 0.62 ? '#2b3a4a' : '#ffffff';
};

/* 下载 */
util.download = function(data, filename, mime){
  var blob = data instanceof Blob ? data : new Blob([data], {type: mime || 'text/plain;charset=utf-8'});
  var a = document.createElement('a');
  var url = URL.createObjectURL(blob);
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
};

/* 日期时间 */
util.timeStr = function(ts){
  var d = ts ? new Date(ts) : new Date();
  var p = function(n){ return String(n).padStart(2,'0'); };
  return p(d.getHours()) + ':' + p(d.getMinutes());
};
util.dateStr = function(ts){
  var d = ts ? new Date(ts) : new Date();
  var p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
};
util.safeName = function(s){
  return String(s||'未命名导图').replace(/[\\/:*?"<>|]/g,'_').slice(0,60) || '未命名导图';
};
})();
