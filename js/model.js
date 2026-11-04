/* MindSketch 数据模型 | Data model
 * 树节点增删改查、移动守卫（根/自身/后代）、id 白名单净化、序列化、关系线。
 * Tree CRUD, move guards (root/self/descendant), id-sanitizing on import, serialization, relationship lines. */
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
    nextRelId: 1,
    rels: [],   /* 关系线 | relationship lines: {id, from, to, label} */
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
  if(typeof data.nextRelId !== 'number' || !isFinite(data.nextRelId)) data.nextRelId = 1;
  if(!Array.isArray(data.rels)) data.rels = [];
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
  /* 关系线净化：id 白名单、端点必须存在且不相同 | sanitize rels: valid ids, both endpoints exist */
  var ID_RE2 = /^[A-Za-z0-9_-]{1,64}$/;
  var rels = [];
  var maxRel = 0;
  (data.rels || []).forEach(function(rl){
    if(!rl || typeof rl !== 'object') return;
    var f = String(rl.from || ''), t = String(rl.to || '');
    var nf = doc0Find(data.root, f), nt = doc0Find(data.root, t);
    if(!nf || !nt || f === t) return;
    var rid = ID_RE2.test(String(rl.id || '')) ? String(rl.id) : ('r' + (data.nextRelId++));
    var m = /^r(\d+)$/.exec(rid);
    if(m) maxRel = Math.max(maxRel, parseInt(m[1], 10));
    rels.push({ id:rid, from:nf.id, to:nt.id, label:String(rl.label || '').slice(0, 200) });
  });
  if(data.nextRelId <= maxRel) data.nextRelId = maxRel + 1;
  data.rels = rels;
  return new Doc(data);
};
/* fromJSON 内部查找（在净化完成前使用）| internal lookup used before sanitize */
function doc0Find(root, id){
  var found = null;
  (function w(n){ if(found) return; if(n.id === id){ found = n; return; } n.children.forEach(w); })(root);
  return found;
}

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
  /* 批量删除：先收集先序再逐个删，避免边遍历边改数组漏删 | batch remove: collect first, then delete */
  removeMany: function(ids){
    var self = this;
    var set = new Set(ids || []);
    var order = [];
    this.walk(function(n){ if(set.has(n.id) && n.id !== self.root.id) order.push(n.id); });
    var removed = 0;
    order.forEach(function(id){
      if(self.find(id)){ self.remove(id); removed++; }
    });
    return removed;
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

  /* ── 关系线 | relationship lines ─────────────── */
  addRel: function(fromId, toId, label){
    if(fromId === toId) return null;
    if(!this.find(fromId) || !this.find(toId)) return null;
    if(!this.data.rels) this.data.rels = [];
    if(!this.data.nextRelId) this.data.nextRelId = 1;
    var rel = { id:'r' + (this.data.nextRelId++), from:fromId, to:toId, label:String(label || '') };
    this.data.rels.push(rel);
    return rel;
  },
  removeRel: function(relId){
    var rels = this.data.rels || [];
    var i = rels.findIndex(function(r){ return r.id === relId; });
    if(i < 0) return false;
    rels.splice(i, 1);
    return true;
  },
  findRel: function(relId){
    return (this.data.rels || []).find(function(r){ return r.id === relId; }) || null;
  },
  /* 删除节点后清理悬空关系线 | prune rels with missing endpoints */
  pruneRels: function(){
    var rels = this.data.rels || [];
    var keep = rels.filter(function(r){ return this.find(r.from) && this.find(r.to); }, this);
    if(keep.length !== rels.length){ this.data.rels = keep; return true; }
    return false;
  },

  serialize: function(){ return JSON.parse(JSON.stringify(this.data)); }
};

MS.model = { Doc: Doc };
})();
