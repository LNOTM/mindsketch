/* MindSketch 编辑器：历史记录、快捷键、行内编辑、拖拽、复制粘贴 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;
var view = MS.view;

var editor = MS.editor = {
  clip: null,
  editingId: null,
  inputEl: null,
  editNew: false,
  editOrig: '',
  hist: { stack:[], ptr:-1, label:'', time:0 },

  init: function(){
    this.bindKeys();
    this.bindPointer();
    this.bindContext();
    this.pushHistory(null);
  },

  /* ── 历史（快照式撤销/重做：每次变更后压入新状态，栈顶始终是当前状态）── */
  pushHistory: function(label){
    var json = JSON.stringify(view.doc.data);
    var h = this.hist, now = Date.now();
    if(label && label === h.label && now - h.time < 1200 && h.ptr >= 0){
      h.stack[h.ptr] = { json:json, label:label };  // 连续同类编辑合并为一步
      h.time = now;
      return;
    }
    h.stack = h.stack.slice(0, h.ptr+1);
    h.stack.push({ json:json, label:label||'' });
    if(h.stack.length > 120) h.stack.shift();
    h.ptr = h.stack.length - 1;
    h.label = label||''; h.time = now;
  },
  undo: function(){
    var h = this.hist;
    if(h.ptr <= 0){ MS.app.toast('没有可撤销的操作'); return; }
    h.ptr--; h.label = ''; this.applyHist();
  },
  redo: function(){
    var h = this.hist;
    if(h.ptr >= h.stack.length - 1){ MS.app.toast('没有可重做的操作'); return; }
    h.ptr++; h.label = ''; this.applyHist();
  },
  applyHist: function(){
    var entry = this.hist.stack[this.hist.ptr];
    var doc = MS.model.Doc.fromJSON(JSON.parse(entry.json));
    if(!doc) return;
    view.doc = doc;
    if(!doc.find(view.sel)) view.sel = doc.root.id;
    this.afterMutation();
  },
  afterMutation: function(){
    view.relayout();
    util.bus.emit('doc:mutated');
  },

  /* ── 节点操作 ─────────────────────────── */
  addChild: function(){
    var doc = view.doc;
    var pid = view.sel || doc.root.id;
    if(!doc.find(pid)) return;
    var n = doc.addChild(pid, doc.createNode(''));
    this.pushHistory('add');
    view.sel = n.id;
    this.afterMutation();
    view.centerOn(n.id);
    var self = this;
    setTimeout(function(){ self.startEdit(n.id, true); }, 30);
  },
  addSibling: function(){
    var doc = view.doc;
    var id = view.sel || doc.root.id;
    if(!doc.find(id)) return;
    var n;
    if(id === doc.root.id){ n = doc.addChild(id, doc.createNode('')); }
    else{
      var p = doc.findParent(id);
      var idx = doc.indexOf(id) + 1;
      n = doc.addChild(p.id, doc.createNode(''), idx);
    }
    this.pushHistory('add');
    view.sel = n.id;
    this.afterMutation();
    var self = this;
    setTimeout(function(){ self.startEdit(n.id, true); }, 30);
  },
  deleteNode: function(){
    var doc = view.doc;
    var id = view.sel;
    if(!id || id === doc.root.id){ MS.app.toast('中心主题不能删除'); return; }
    var p = doc.findParent(id);
    var idx = doc.indexOf(id);
    doc.remove(id);
    this.pushHistory('del');
    view.sel = p.id;
    if(idx > 0 && p.children[idx-1]) view.sel = p.children[idx-1].id;
    this.afterMutation();
  },
  toggleCollapse: function(id){
    id = id || view.sel;
    if(!id) return;
    if(!view.doc.toggleCollapse(id)) return;
    this.pushHistory('collapse');
    this.afterMutation();
  },
  expandAll: function(expand){
    view.doc.walk(function(n){ if(n.children.length) n.collapsed = !expand; });
    this.pushHistory('expand');
    this.afterMutation();
  },
  setNote: function(text){
    var n = view.doc.find(view.sel || view.doc.root.id);
    if(!n) return;
    n.note = text;
    this.pushHistory('note');
    this.afterMutation();
  },
  setColor: function(hex){
    var n = view.doc.find(view.sel || view.doc.root.id);
    if(!n) return;
    if(hex) n.style.bg = hex; else delete n.style.bg;
    this.pushHistory('color');
    this.afterMutation();
  },
  toggleBold: function(){
    var n = view.doc.find(view.sel || view.doc.root.id);
    if(!n) return;
    n.style.bold = !n.style.bold;
    this.pushHistory('bold');
    this.afterMutation();
  },

  /* ── 复制 / 剪切 / 粘贴 ────────────────── */
  copy: function(){
    var doc = view.doc;
    var n = doc.find(view.sel || doc.root.id);
    if(!n) return;
    this.clip = JSON.stringify(n);
    try{ if(navigator.clipboard) navigator.clipboard.writeText(this.clip); }catch(e){}
    MS.app.toast('已复制节点（含子树）');
  },
  cut: function(){
    var doc = view.doc, id = view.sel;
    if(!id || id === doc.root.id){ MS.app.toast('中心主题不能剪切'); return; }
    this.clip = JSON.stringify(doc.find(id));
    try{ if(navigator.clipboard) navigator.clipboard.writeText(this.clip); }catch(e){}
    var p = doc.findParent(id);
    var idx = doc.indexOf(id);
    doc.remove(id);
    this.pushHistory('cut');
    view.sel = p.id;
    if(idx > 0 && p.children[idx-1]) view.sel = p.children[idx-1].id;
    this.afterMutation();
    MS.app.toast('已剪切节点（含子树）');
  },
  paste: function(){
    var self = this, doc = view.doc;
    var target = view.sel || doc.root.id;
    function doPaste(tree){
      var n = self.pasteTree(tree, target);
      self.pushHistory('paste');
      if(n){ view.sel = n.id; self.afterMutation(); view.ensureVisible(n.id); }
    }
    if(this.clip){
      try{ doPaste(JSON.parse(this.clip)); return; }catch(e){}
    }
    if(navigator.clipboard && navigator.clipboard.readText){
      navigator.clipboard.readText().then(function(t){
        var tree = MS.io.guessTree(t);
        if(tree) doPaste(tree);
        else MS.app.toast('粘贴板中没有可用的内容');
      }).catch(function(){ MS.app.toast('粘贴板中没有可用的内容'); });
    }
    else MS.app.toast('粘贴板中没有可用的内容');
  },
  pasteTree: function(tree, parentId){
    var doc = view.doc;
    var p = doc.find(parentId);
    if(!p) return null;
    function cp(t){
      var n = doc.createNode(String(t.text||''));
      if(t.note) n.note = String(t.note);
      if(t.style && t.style.bg) n.style.bg = t.style.bg;
      (t.children||[]).forEach(function(c){ n.children.push(cp(c)); });
      return n;
    }
    var node = cp(tree);
    p.children.push(node);
    return node;
  },

  /* ── 行内编辑 ─────────────────────────── */
  startEdit: function(id, isNew){
    if(this.editingId) this.commitEdit();
    var node = view.doc.find(id);
    var info = view.layout && view.layout.nodes.get(id);
    var el = view.nodeEl(id);
    if(!node || !el || !info) return;
    var self = this;
    this.editingId = id;
    this.editNew = !!isNew;
    this.editOrig = node.text;
    el.classList.add('editing');
    el.style.width = 'auto';
    el.style.height = 'auto';
    el.style.minWidth = info.w + 'px';
    var input = document.createElement('div');
    input.className = 'node-input';
    input.contentEditable = 'true';
    input.innerText = node.text;
    el.appendChild(input);
    this.inputEl = input;
    input.focus();
    var range = document.createRange();
    range.selectNodeContents(input);
    var s = window.getSelection();
    s.removeAllRanges(); s.addRange(range);
    input.addEventListener('keydown', function(e){
      e.stopPropagation();
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); self.commitEdit(); }
      else if(e.key === 'Escape'){ e.preventDefault(); self.cancelEdit(); }
    });
    input.addEventListener('blur', function(){ self.commitEdit(); });
  },
  commitEdit: function(){
    if(!this.editingId) return;
    var id = this.editingId;
    var input = this.inputEl;
    var orig = this.editOrig, isNew = this.editNew;
    this.editingId = null; this.inputEl = null;
    var node = view.doc.find(id);
    if(input && node){
      var text = (input.innerText||'').replace(/\u00a0/g,' ').replace(/\r/g,'');
      text = text.split('\n').map(function(l){ return l.trim(); }).join('\n').replace(/^\n+|\n+$/g,'');
      if(!text && isNew){
        var p = view.doc.findParent(id);
        view.doc.remove(id);
        view.sel = p ? p.id : view.doc.root.id;
        this.pushHistory('cancel-new');
        this.afterMutation();
      } else if(text !== orig){
        node.text = text;
        this.pushHistory('text:'+id);
        this.afterMutation();
      } else {
        this.afterMutation();
      }
    }
  },
  cancelEdit: function(){
    if(!this.editingId) return;
    var id = this.editingId;
    var isNew = this.editNew;
    this.editingId = null; this.inputEl = null;
    var node = view.doc.find(id);
    if(node && isNew && !node.text){
      var p = view.doc.findParent(id);
      view.doc.remove(id);
      view.sel = p ? p.id : view.doc.root.id;
      this.pushHistory('cancel-new');
    }
    this.afterMutation();
  },

  /* ── 键盘 ─────────────────────────────── */
  bindKeys: function(){
    var self = this;
    document.addEventListener('keydown', function(e){
      var t = e.target;
      if(t && t.closest && t.closest('.node-input, input, textarea, [contenteditable="true"]')) return;
      if(document.querySelector('.modal-mask')){
        if(e.key === 'Escape') MS.app.closeModal();
        return;
      }
      var ctrl = e.ctrlKey || e.metaKey;
      var key = e.key;
      if(ctrl){
        var k = key.toLowerCase();
        if(k === 'z'){ e.preventDefault(); if(e.shiftKey) self.redo(); else self.undo(); return; }
        if(k === 'y'){ e.preventDefault(); self.redo(); return; }
        if(k === 'c'){ e.preventDefault(); self.copy(); return; }
        if(k === 'x'){ e.preventDefault(); self.cut(); return; }
        if(k === 'v'){ e.preventDefault(); self.paste(); return; }
        if(k === 'f'){ e.preventDefault(); MS.app.openSearch(); return; }
        if(k === 's'){ e.preventDefault(); MS.app.saveJSON(); return; }
        if(k === 'b'){ e.preventDefault(); self.toggleBold(); return; }
        if(key === '='){ e.preventDefault(); view.zoomTo(view.scale*1.2, true); return; }
        if(key === '-'){ e.preventDefault(); view.zoomTo(view.scale/1.2, true); return; }
        if(key === '0'){ e.preventDefault(); view.zoomTo(1, true); return; }
        if(e.shiftKey && k === 'f'){ e.preventDefault(); view.fit(); return; }
        return;
      }
      switch(key){
        case 'Tab': e.preventDefault(); self.addChild(); return;
        case 'Enter': e.preventDefault(); self.addSibling(); return;
        case 'F2': e.preventDefault(); if(view.sel) self.startEdit(view.sel); return;
        case ' ': e.preventDefault(); self.toggleCollapse(); return;
        case 'Delete': case 'Backspace': e.preventDefault(); self.deleteNode(); return;
        case 'ArrowLeft': e.preventDefault(); self.nav('left'); return;
        case 'ArrowRight': e.preventDefault(); self.nav('right'); return;
        case 'ArrowUp': e.preventDefault(); self.nav('up'); return;
        case 'ArrowDown': e.preventDefault(); self.nav('down'); return;
        case 'Escape': view.select(null); MS.app.closeMenus(); return;
      }
    });
  },
  nav: function(dir){
    if(!view.layout) return;
    var cur = view.layout.nodes.get(view.sel || view.doc.root.id);
    if(!cur) return;
    var best = null, bd = Infinity;
    view.layout.nodes.forEach(function(i){
      if(i.id === cur.id) return;
      var cx = i.x + i.w/2, cy = i.y + i.h/2;
      var mx = cur.x + cur.w/2, my = cur.y + cur.h/2;
      var primary, secondary, ok;
      if(dir === 'right'){ ok = cx > mx + 8; primary = cx - mx; secondary = Math.abs(cy - my); }
      else if(dir === 'left'){ ok = cx < mx - 8; primary = mx - cx; secondary = Math.abs(cy - my); }
      else if(dir === 'up'){ ok = cy < my - 8; primary = my - cy; secondary = Math.abs(cx - mx); }
      else { ok = cy > my + 8; primary = cy - my; secondary = Math.abs(cx - mx); }
      if(ok){
        var score = primary + secondary*3;
        if(score < bd){ bd = score; best = i; }
      }
    });
    if(best){ view.select(best.id); view.ensureVisible(best.id); }
  },

  /* ── 指针：选择 / 拖拽 ─────────────────── */
  bindPointer: function(){
    var self = this, wrap = view.el.wrap;
    var down = null, drag = null, lastTap = { id:null, t:0 };

    wrap.addEventListener('pointerdown', function(e){
      if(e.button !== 0) return;
      var tog = e.target.closest('[data-toggle]');
      if(tog){
        e.preventDefault();
        self.toggleCollapse(tog.getAttribute('data-toggle'));
        return;
      }
      var nodeEl = e.target.closest('.node');
      if(!nodeEl) return;
      if(self.editingId && self.editingId !== nodeEl.dataset.id) self.commitEdit();
      down = { id:nodeEl.dataset.id, x:e.clientX, y:e.clientY, moved:false };
      try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
    });
    wrap.addEventListener('pointermove', function(e){
      if(!down) return;
      if(!down.moved){
        if(Math.hypot(e.clientX-down.x, e.clientY-down.y) < 5) return;
        if(down.id === view.doc.root.id) return;
        down.moved = true;
        drag = self.startDrag(down.id);
        wrap.classList.add('dragging');
      }
      if(drag) self.updateDrag(drag, e);
    });
    wrap.addEventListener('pointerup', function(e){
      if(!down) return;
      var d = down; down = null;
      wrap.classList.remove('dragging');
      if(drag){ self.finishDrag(drag); drag = null; return; }
      var now = Date.now();
      if(e.pointerType === 'touch'){
        if(lastTap.id === d.id && now - lastTap.t < 320){
          self.startEdit(d.id);
          lastTap = { id:null, t:0 };
          return;
        }
        lastTap = { id:d.id, t:now };
      }
      view.select(d.id);
    });
    wrap.addEventListener('pointercancel', function(){
      if(drag){ self.endDragUI(drag); drag = null; }
      down = null;
    });
    wrap.addEventListener('dblclick', function(e){
      var nodeEl = e.target.closest('.node');
      if(nodeEl){ e.preventDefault(); self.startEdit(nodeEl.dataset.id); }
    });
  },
  startDrag: function(id){
    var desc = new Set();
    var node = view.doc.find(id);
    if(node) (function rec(n){ desc.add(n.id); n.children.forEach(rec); })(node);
    var line = document.createElement('div');
    line.className = 'drop-line';
    line.style.display = 'none';
    view.el.overlay.appendChild(line);
    var el = view.nodeEl(id);
    if(el) el.classList.add('dragging');
    return { id:id, desc:desc, line:line, target:null };
  },
  updateDrag: function(drag, e){
    var p = view.docCoords(e.clientX, e.clientY);
    var target = null, bd = Infinity;
    view.layout.nodes.forEach(function(i){
      if(i.id === drag.id || drag.desc.has(i.id)) return;
      if(p.x >= i.x-12 && p.x <= i.x+i.w+12 && p.y >= i.y-10 && p.y <= i.y+i.h+10){
        var dist = Math.abs(p.y - (i.y + i.h/2));
        if(dist < bd){ bd = dist; target = i; }
      }
    });
    drag.target = null;
    drag.line.style.display = 'none';
    view.el.node.querySelectorAll('.node.drop-into').forEach(function(el){ el.classList.remove('drop-into'); });
    if(!target) return;
    var mode;
    if(target.id === view.doc.root.id) mode = 'child';
    else {
      var rel = (p.y - target.y) / target.h;
      mode = rel < 0.3 ? 'before' : (rel > 0.7 ? 'after' : 'child');
    }
    drag.target = { info:target, mode:mode };
    if(mode === 'child'){
      var el = view.nodeEl(target.id);
      if(el) el.classList.add('drop-into');
    } else {
      var y = mode === 'before' ? target.y - 3 : target.y + target.h + 3;
      drag.line.style.display = 'block';
      drag.line.style.left = target.x + 'px';
      drag.line.style.top = y + 'px';
      drag.line.style.width = target.w + 'px';
    }
  },
  finishDrag: function(drag){
    this.endDragUI(drag);
    var t = drag.target;
    if(!t) return;
    var doc = view.doc;
    var ok;
    if(t.mode === 'child'){
      ok = doc.move(drag.id, t.info.id, t.info.node.children.length);
    } else {
      var pid = t.info.parentId || doc.root.id;
      var idx = doc.indexOf(t.info.id);
      if(t.mode === 'after') idx++;
      ok = doc.move(drag.id, pid, idx);
    }
    if(ok){
      this.pushHistory('move');
      view.sel = drag.id;
      this.afterMutation();
    }
  },
  endDragUI: function(drag){
    if(drag.line && drag.line.parentNode) drag.line.remove();
    view.el.node.querySelectorAll('.node.drop-into').forEach(function(el){ el.classList.remove('drop-into'); });
    var el = view.nodeEl(drag.id);
    if(el) el.classList.remove('dragging');
  },

  /* ── 右键菜单 ─────────────────────────── */
  bindContext: function(){
    var self = this;
    view.el.wrap.addEventListener('contextmenu', function(e){
      var nodeEl = e.target.closest('.node');
      if(!nodeEl) return;
      e.preventDefault();
      var id = nodeEl.dataset.id;
      view.select(id);
      self.showNodeMenu(e.clientX, e.clientY, id);
    });
  },
  showNodeMenu: function(x, y, id){
    var doc = view.doc, n = doc.find(id);
    var isRoot = id === doc.root.id;
    var items = [
      { label:'添加子主题', kbd:'Tab', action: function(){ editor.addChild(); } }
    ];
    if(!isRoot) items.push({ label:'添加同级主题', kbd:'Enter', action: function(){ editor.addSibling(); } });
    items.push(
      { label:'编辑文字', kbd:'F2', action: function(){ editor.startEdit(id); } },
      { label:(n && n.note) ? '编辑备注' : '添加备注', action: function(){ MS.app.editNote(id); } },
      { sep:true },
      { label:'节点颜色', children:'color' },
      { label:(n && n.style && n.style.bold) ? '取消加粗' : '加粗', kbd:'Ctrl+B', action: function(){ editor.toggleBold(); } },
      { sep:true },
      { label:(n && n.collapsed) ? '展开分支' : '折叠分支', kbd:'Space', action: function(){ editor.toggleCollapse(id); } }
    );
    if(!isRoot) items.push(
      { sep:true },
      { label:'复制', kbd:'Ctrl+C', action: function(){ editor.copy(); } },
      { label:'剪切', kbd:'Ctrl+X', action: function(){ editor.cut(); } },
      { label:'删除', kbd:'Delete', danger:true, action: function(){ editor.deleteNode(); } }
    );
    MS.app.showMenu(x, y, items);
  }
};
})();
