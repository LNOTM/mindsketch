/* MindSketch 数据模型 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;

function Doc(data){ this.data = data || Doc.newData(); }

Doc.newData = function(rootText, name){
  return {
    version: 1,
    meta: { name: name || '未命名导图' },
    nextId: 2,
    root: { id:'n1', text: rootText || '中心主题', note:'', style:{}, collapsed:false, children:[] }
  };
};

/* 由纯文本树（{text,note,children}）构建 Doc */
Doc.fromTree = function(tree, name){
  tree = tree || {};
  var d = new Doc(Doc.newData(tree.text || '中心主题', name));
  d.root.note = tree.note || '';
  var counter = { n: 1 };
  function attach(parent, kids){
    (kids || []).forEach(function(t){
      counter.n++;
      var node = { id:'n'+counter.n, text:String(t.text||''), note:t.note||'', style:{}, collapsed:false, children:[] };
      parent.children.push(node);
      attach(node, t.children);
    });
  }
  attach(d.root, tree.children);
  d.data.nextId = counter.n + 1;
  return d;
};

Doc.fromJSON = function(data){
  if(!data || typeof data !== 'object' || !data.root) return null;
  if(typeof data.nextId !== 'number' || !isFinite(data.nextId)) data.nextId = 1000;
  var meta = data.meta = data.meta || {};
  if(!meta.name) meta.name = '未命名导图';
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var maxNum = 0;
  (function scan(n){
    var s = String(n.id || '');
    if(ID_RE.test(s)){
      var m = /^n(\d+)$/.exec(s);
      if(m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    (Array.isArray(n.children) ? n.children : []).forEach(scan);
  })(data.root);
  if(data.nextId <= maxNum) data.nextId = maxNum + 1;
  function fix(n){
    // id 白名单：非法 id（可能来自恶意文件）一律重新分配，阻断 HTML 属性注入
    if(!ID_RE.test(String(n.id || ''))) n.id = 'n' + (data.nextId++);
    else n.id = String(n.id);
    n.text = n.text == null ? '' : String(n.text);
    n.note = n.note == null ? '' : String(n.note);
    n.style = (n.style && typeof n.style === 'object') ? n.style : {};
    // style.bg 仅接受 #hex，阻断 CSS/属性注入
    if(n.style.bg != null && !/^#[0-9a-fA-F]{3,8}$/.test(String(n.style.bg))) delete n.style.bg;
    if(n.style.bold) n.style.bold = true; else delete n.style.bold;
    n.collapsed = !!n.collapsed;
    n.children = Array.isArray(n.children) ? n.children.filter(Boolean).map(fix) : [];
    return n;
  }
  data.root = fix(data.root);
  return new Doc(data);
};

Doc.prototype = {
  get root(){ return this.data.root; },
  get name(){ return (this.data.meta && this.data.meta.name) || '未命名导图'; },
  set name(v){ if(this.data.meta) this.data.meta.name = v; },

  nextId: function(){ return 'n' + (this.data.nextId++); },

  find: function(id){
    var found = null;
    (function walk(n){ if(found) return; if(n.id === id){ found = n; return; } n.children.forEach(walk); })(this.root);
    return found;
  },
  findParent: function(id){
    var p = null;
    (function walk(n){ if(p) return; for(var i=0;i<n.children.length;i++){ var c=n.children[i]; if(c.id===id){ p=n; return; } walk(c); } })(this.root);
    return p;
  },
  indexOf: function(id){
    var p = this.findParent(id);
    if(!p) return -1;
    return p.children.findIndex(function(c){ return c.id === id; });
  },
  isDescendant: function(ancId, id){
    if(ancId === id) return false;
    var anc = this.find(ancId);
    if(!anc) return false;
    var f = false;
    (function walk(n){ if(n.id === id){ f = true; return; } if(!f) n.children.forEach(walk); })(anc);
    return f;
  },

  createNode: function(text){
    return { id:this.nextId(), text:text||'', note:'', style:{}, collapsed:false, children:[] };
  },
  addChild: function(parentId, node, index){
    var p = this.find(parentId);
    if(!p) return null;
    node = node || this.createNode('');
    if(!node.id) node.id = this.nextId();
    if(index == null || index < 0 || index > p.children.length) index = p.children.length;
    p.children.splice(index, 0, node);
    return node;
  },
  remove: function(id){
    if(id === this.root.id) return null;
    var p = this.findParent(id);
    if(!p) return null;
    var i = p.children.findIndex(function(c){ return c.id === id; });
    if(i < 0) return null;
    var node = p.children.splice(i,1)[0];
    return { node:node, parentId:p.id, index:i };
  },
  move: function(id, newParentId, index){
    if(id === this.root.id) return false;
    if(id === newParentId) return false;
    if(this.isDescendant(id, newParentId)) return false;
    var rm = this.remove(id);
    if(!rm) return false;
    var p = this.find(newParentId);
    if(!p){ // 回滚
      this.addChild(rm.parentId, rm.node, rm.index);
      return false;
    }
    var idx = index;
    if(idx == null) idx = p.children.length;
    if(rm.parentId === newParentId && rm.index < idx) idx = Math.max(0, idx - 1);
    idx = util.clamp(idx, 0, p.children.length);
    p.children.splice(idx, 0, rm.node);
    return true;
  },
  cloneSubtree: function(id){
    var self = this;
    var n = this.find(id);
    if(!n) return null;
    function cp(o){
      return { id:self.nextId(), text:o.text, note:o.note||'',
               style:JSON.parse(JSON.stringify(o.style||{})),
               collapsed:!!o.collapsed, children:o.children.map(cp) };
    }
    return cp(n);
  },
  toggleCollapse: function(id, v){
    var n = this.find(id);
    if(!n || !n.children.length) return false;
    n.collapsed = (v == null) ? !n.collapsed : !!v;
    return true;
  },

  walk: function(cb, node){
    (function rec(n){ cb(n); n.children.forEach(rec); })(node || this.root);
  },
  visibleNodes: function(){
    var out = [];
    (function rec(n, d){ out.push({node:n, depth:d}); if(!n.collapsed) n.children.forEach(function(c){ rec(c, d+1); }); })(this.root, 0);
    return out;
  },
  count: function(){ var c=0; this.walk(function(){ c++; }); return c; },
  maxDepth: function(){
    var m = 0;
    (function rec(n, d){ if(d > m) m = d; n.children.forEach(function(c){ rec(c, d+1); }); })(this.root, 0);
    return m + 1;
  },

  serialize: function(){ return JSON.parse(JSON.stringify(this.data)); }
};

MS.model = { Doc: Doc };
})();
