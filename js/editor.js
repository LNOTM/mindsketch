/* MindSketch 编辑器 | Editor
 * 快照式撤销/重做（栈顶=当前态，仅同节点文本编辑合并）、快捷键、行内编辑、
 * 拖拽（单/多选、落点指示、幽灵预览、边缘自动平移）、多选批量操作、剪贴板。
 * Snapshot undo/redo (top=current; coalesce only same-node text edits), shortcuts,
 * inline editing, single/multi drag with ghost & auto-pan, batch ops, clipboard. */
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
  linkingFrom: null,   /* 关系线创建模式：源节点 | pending rel source */
  selectedRel: null,   /* 选中的关系线 | selected relationship id */
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
    // 仅连续同节点的文本编辑合并为一步；结构操作每次独立入栈
    var coalesce = label && label.indexOf('text:') === 0 && label === h.label && now - h.time < 1200 && h.ptr >= 0;
    if(coalesce){
      h.stack[h.ptr] = { json:json, label:label };
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
  /* 展开节点到根的父链，返回是否有变更（避免新/移入节点隐身） */
  ensureAncestorsVisible: function(pid){
    var doc = view.doc;
    var changed = false;
    var p = doc.find(pid);
    while(p){
      if(p.collapsed){ p.collapsed = false; changed = true; }
      if(p.id === doc.root.id) break;
      p = doc.findParent(p.id);
    }
    return changed;
  },
  /* ── 关系线交互 | relationship interactions ── */
  startRelLink: function(){
    var id = view.sel || view.doc.root.id;
    this.linkingFrom = id;
    view.el.wrap.classList.add('linking');
    MS.app.toast('请点击目标节点建立关系线（Esc 取消）');
  },
  cancelRelLink: function(){
    this.linkingFrom = null;
    view.el.wrap.classList.remove('linking');
  },
  selectRel: function(id){
    this.selectedRel = id;
    view.drawRels();
  },
  clearRelSelection: function(){
    if(this.selectedRel){ this.selectedRel = null; view.drawRels(); }
  },
  deleteSelectedRel: function(){
    if(!this.selectedRel) return;
    view.doc.removeRel(this.selectedRel);
    this.pushHistory('rel-del');
    this.selectedRel = null;
    this.afterMutation();
    MS.app.toast('已删除关系线');
  },
  labelRel: function(relId){
    var rel = view.doc.findRel(relId);
    if(!rel) return;
    var label = prompt('关系线标注（留空清除）', rel.label || '');
    if(label === null) return;
    rel.label = label.trim();
    this.pushHistory('rel-label');
    this.afterMutation();
  },

  /* ── 节点操作 | node ops ─────────────── */
  /* 当前选中集（多选感知，排除根）| current selection ids (multi-aware, root excluded) */
  selectionIds: function(){
    var doc = view.doc;
    var ids = (view.multi && view.multi.size > 1) ? Array.from(view.multi) : (view.sel ? [view.sel] : []);
    return ids.filter(function(id){ return id && id !== doc.root.id && doc.find(id); });
  },
  addChild: function(){
    var doc = view.doc;
    var pid = view.sel || doc.root.id;
    if(!doc.find(pid)) return;
    this.ensureAncestorsVisible(pid);
    var n = doc.addChild(pid, doc.createNode(''));
    this.pushHistory('add');
    view.multi = null;
    view.sel = n.id;
    this.afterMutation();
    view.centerOn(n.id);
    var self = this;
    setTimeout(function(){
      if(view.sel === n.id && !self.editingId) self.startEdit(n.id, true);
    }, 30);
  },
  addSibling: function(){
    var doc = view.doc;
    var id = view.sel || doc.root.id;
    if(!doc.find(id)) return;
    var n;
    if(id === doc.root.id){ n = doc.addChild(id, doc.createNode('')); }
    else{
      var p = doc.findParent(id);
      this.ensureAncestorsVisible(p.id);
      var idx = doc.indexOf(id) + 1;
      n = doc.addChild(p.id, doc.createNode(''), idx);
    }
    this.pushHistory('add');
    view.multi = null;
    view.sel = n.id;
    this.afterMutation();
    var self = this;
    setTimeout(function(){
      if(view.sel === n.id && !self.editingId) self.startEdit(n.id, true);
    }, 30);
  },
  deleteNode: function(){ this.deleteSelection(); },
  /* 批量删除（多选感知）| delete selection, multi-aware */
  deleteSelection: function(){
    var doc = view.doc;
    var ids = this.selectionIds();
    if(!ids.length){ MS.app.toast('中心主题不能删除'); return; }
    this.pushHistory('del');
    var n = doc.removeMany(ids);
    doc.pruneRels();   /* 清理悬空关系线 | prune dangling rels */
    view.multi = null;
    view.sel = doc.root.id;
    this.afterMutation();
    MS.app.toast('已删除 ' + n + ' 个节点');
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

  /* ── 复制 / 剪切 / 粘贴（多选感知）| clipboard, multi-aware ── */
  copy: function(){
    var doc = view.doc;
    var ids = (view.multi && view.multi.size > 1) ? Array.from(view.multi) : [view.sel || doc.root.id];
    var set = new Set(ids);
    var items = [];
    /* 跳过祖先已在集合中的成员（随祖先整树复制）| skip members shadowed by an ancestor in set */
    doc.walk(function(n){
      if(!set.has(n.id)) return;
      var p = doc.findParent(n.id);
      while(p){ if(set.has(p.id)) return; if(p.id === doc.root.id) break; p = doc.findParent(p.id); }
      items.push(JSON.parse(JSON.stringify(n)));
    });
    this.clip = JSON.stringify({ items: items });
    try{ if(navigator.clipboard) navigator.clipboard.writeText(this.clip); }catch(e){}
    MS.app.toast('已复制 ' + items.length + ' 个节点（含子树）');
  },
  cut: function(){
    if(!this.selectionIds().length){ MS.app.toast('中心主题不能剪切'); return; }
    var n = this.selectionIds().length;
    this.copy();
    this.deleteSelection();
    MS.app.toast('已剪切 ' + n + ' 个节点（含子树）');
  },
  paste: function(){
    var self = this, doc = view.doc;
    var target = view.sel || doc.root.id;
    function doPaste(items){
      self.pushHistory('paste');
      var last = null;
      items.forEach(function(t){ last = self.pasteTree(t, target); });
      if(last){
        view.multi = null;
        view.sel = last.id;
        self.afterMutation();
        view.ensureVisible(last.id);
      }
      MS.app.toast('已粘贴 ' + items.length + ' 个节点');
    }
    if(this.clip){
      try{
        /* 兼容旧版单节点剪贴与新版 {items:[…]} | compat: legacy single-node clip */
        var parsed = JSON.parse(this.clip);
        var items = Array.isArray(parsed) ? parsed : (parsed && parsed.items) ? parsed.items : [parsed];
        doPaste(items);
        return;
      }catch(e){}
    }
    if(navigator.clipboard && navigator.clipboard.readText){
      navigator.clipboard.readText().then(function(t){
        var tree = MS.io.guessTree(t);
        if(tree) doPaste([tree]);
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
    view.multi = null;
    this.clearRelSelection();
    view.applySelection();
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
      var menuEl = document.getElementById('ctx-menu');
      if(menuEl && !menuEl.classList.contains('hidden')){
        if(e.key === 'Escape') MS.app.closeMenus();
        return;
      }
      /* 关系线创建模式：Esc 取消 | Esc cancels rel linking */
      if(self.linkingFrom && e.key === 'Escape'){ self.cancelRelLink(); return; }
      var ctrl = e.ctrlKey || e.metaKey;
      var key = e.key;
      // 焦点在按钮/链接上时，Space 与 Enter 交给原生激活，不触发画布操作
      if((key === ' ' || key === 'Enter') && t && t.closest && t.closest('button, a')) return;
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
        if(k === 'a'){ e.preventDefault(); view.selectAllVisible(); return; }
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
        case 'Delete': case 'Backspace':
          e.preventDefault();
          if(self.selectedRel){ self.deleteSelectedRel(); } else { self.deleteNode(); }
          return;
        case 'F9': e.preventDefault(); MS.app.toggleZen(); return;
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
    if(view.multi && view.multi.size > 1){ view.multi = null; view.applySelection(); } // 多选时方向键转单选导航
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
  /* 触屏捏合开始时取消进行中的拖拽（两套 pointer 状态互斥） */
  cancelDrag: function(){
    if(this._drag){ this.endDragUI(this._drag); this._drag = null; }
    this._down = null;
  },
  bindPointer: function(){
    var self = this, wrap = view.el.wrap;
    var lastTap = { id:null, t:0 };

    wrap.addEventListener('pointerdown', function(e){
      if(e.button !== 0) return;
      /* 关系线创建模式：点击目标节点完成 | linking mode: click target node */
      if(self.linkingFrom){
        e.preventDefault();
        var targetEl = e.target.closest('.node');
        if(targetEl && targetEl.dataset.id !== self.linkingFrom){
          var rel = view.doc.addRel(self.linkingFrom, targetEl.dataset.id, '');
          if(rel){
            self.pushHistory('rel');
            view.sel = self.linkingFrom;
            self.afterMutation();
            MS.app.toast('已创建关系线');
          }
        }
        self.cancelRelLink();
        return;
      }
      var tog = e.target.closest('[data-toggle]');
      if(tog){
        e.preventDefault();
        self.toggleCollapse(tog.getAttribute('data-toggle'));
        return;
      }
      var nodeEl = e.target.closest('.node');
      if(!nodeEl) return;
      if(self.editingId && self.editingId !== nodeEl.dataset.id) self.commitEdit();
      self._down = { id:nodeEl.dataset.id, x:e.clientX, y:e.clientY, moved:false };
      try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
    });
    wrap.addEventListener('pointermove', function(e){
      var down = self._down;
      if(!down) return;
      if(!down.moved){
        if(Math.hypot(e.clientX-down.x, e.clientY-down.y) < 5) return;
        if(down.id === view.doc.root.id) return;
        down.moved = true;
        self._drag = self.startDrag(down.id);
        wrap.classList.add('dragging');
      }
      if(self._drag) self.updateDrag(self._drag, e);
    });
    wrap.addEventListener('pointerup', function(e){
      var down = self._down;
      if(!down) return;
      self._down = null;
      wrap.classList.remove('dragging');
      if(self._drag){ var drag = self._drag; self._drag = null; self.finishDrag(drag); return; }
      var now = Date.now();
      if(e.pointerType === 'touch'){
        if(lastTap.id === down.id && now - lastTap.t < 320){
          self.startEdit(down.id);
          lastTap = { id:null, t:0 };
          return;
        }
        lastTap = { id:down.id, t:now };
      }
      /* Ctrl+点击：切换选中；Shift+点击：范围选 | modifier clicks for multi-select */
      if(e.ctrlKey || e.metaKey){ view.toggleSelection(down.id); return; }
      if(e.shiftKey){ view.rangeSelectTo(down.id, true); return; }
      if(view.multi && view.multi.size > 1){
        if(view.multi.has(down.id)) return;      // 已在多选中：保持
        view.select(down.id);                    // 点其它节点：转单选
        return;
      }
      view.select(down.id);
    });
    wrap.addEventListener('pointercancel', function(){ self.cancelDrag(); });
    /* 点击/双击关系线 | click / dblclick on a relationship line */
    wrap.addEventListener('click', function(e){
      var relEl = e.target.closest('[data-rel]');
      if(!relEl) { self.clearRelSelection(); return; }
      e.stopPropagation();
      self.selectRel(relEl.getAttribute('data-rel'));
    }, true);
    wrap.addEventListener('dblclick', function(e){
      var relEl = e.target.closest('[data-rel]');
      if(relEl){ e.preventDefault(); self.labelRel(relEl.getAttribute('data-rel')); return; }
      var nodeEl = e.target.closest('.node');
      if(nodeEl){ e.preventDefault(); self.startEdit(nodeEl.dataset.id); }
    });
  },
  startDrag: function(id){
    var doc = view.doc;
    var self = this;
    /* 多选拖拽集合：跳过祖先在集合中的成员 | drag set: skip members shadowed by ancestors */
    var ids = [id];
    if(view.multi && view.multi.size > 1 && view.multi.has(id)){
      var sel2 = new Set(view.multi);
      ids = [];
      view.multi.forEach(function(mid){
        if(mid === doc.root.id) return;
        var p = doc.findParent(mid), shadowed = false;
        while(p){ if(sel2.has(p.id)){ shadowed = true; break; } if(p.id === doc.root.id) break; p = doc.findParent(p.id); }
        if(!shadowed) ids.push(mid);
      });
    }
    var desc = new Set();
    ids.forEach(function(i){
      var n = doc.find(i);
      if(n) (function rec(x){ desc.add(x.id); x.children.forEach(rec); })(n);
    });
    var line = document.createElement('div');
    line.className = 'drop-line';
    line.style.display = 'none';
    view.el.overlay.appendChild(line);
    var el = view.nodeEl(id);
    if(el) el.classList.add('dragging');
    /* 拖拽幽灵预览 | drag ghost preview */
    var ghost = document.createElement('div');
    ghost.className = 'ms-ghost';
    var info = view.layout.nodes.get(id);
    if(info){
      var st = MS.themes.styleFor(view.doc.find(id), info, view.theme);
      ghost.style.background = st.bg;
      ghost.style.color = st.color;
      ghost.style.borderRadius = st.radius + 'px';
    }
    var node = view.doc.find(id);
    ghost.textContent = (node && node.text) ? node.text : '（空）';
    if(ids.length > 1){
      var badge = document.createElement('span');
      badge.className = 'ms-ghost-badge';
      badge.textContent = '×' + ids.length;
      ghost.appendChild(badge);
    }
    document.getElementById('workspace').appendChild(ghost);
    /* 拖到画布边缘自动平移 | auto-pan when dragging near viewport edges */
    view._autoPan = { dx:0, dy:0 };
    self._panRaf = requestAnimationFrame(function loop(){
      if(!self._drag){ return; }
      var ap = view._autoPan;
      if(ap && (ap.dx || ap.dy)){
        view.vx -= ap.dx;
        view.vy -= ap.dy;
        view.applyView();
      }
      self._panRaf = requestAnimationFrame(loop);
    });
    return { id:id, ids:ids, desc:desc, line:line, ghost:ghost, target:null };
  },
  updateDrag: function(drag, e){
    if(drag.ghost){
      drag.ghost.style.left = (e.clientX + 14) + 'px';
      drag.ghost.style.top = (e.clientY + 12) + 'px';
    }
    /* 指针接近画布边缘时设置自动平移强度（无论是否命中目标）| auto-pan near edges regardless of hit */
    var rr = view.el.wrap.getBoundingClientRect(), m = 48, sp = 15;
    var dx = 0, dy = 0;
    if(e.clientX - rr.left < m) dx = -sp * (1 - (e.clientX - rr.left)/m);
    if(rr.right - e.clientX < m) dx = sp * (1 - (rr.right - e.clientX)/m);
    if(e.clientY - rr.top < m) dy = -sp * (1 - (e.clientY - rr.top)/m);
    if(rr.bottom - e.clientY < m) dy = sp * (1 - (rr.bottom - e.clientY)/m);
    view._autoPan = { dx:dx, dy:dy };
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
    if(drag.ghost){
      drag.ghost.style.left = (e.clientX + 14) + 'px';
      drag.ghost.style.top = (e.clientY + 12) + 'px';
    }
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
    /* 多选守卫：目标不得在拖拽集合或其后代中 | guard: target not inside drag set */
    if(drag.desc.has(t.info.id)) return;
    this.pushHistory('move');
    if(t.mode === 'child'){
      /* 摘下集合依序追加为目标子节点 | detach set, append under target */
      var removed = drag.ids.map(function(i){ return doc.remove(i); });
      var p = doc.find(t.info.id);
      removed.forEach(function(rm){ if(rm) p.children.push(rm.node); });
      if(p.collapsed) p.collapsed = false;
    } else {
      /* 摘下集合依序插入目标前/后 | detach set, insert before/after target */
      var pid = t.info.parentId || doc.root.id;
      var parent = doc.find(pid);
      var removed2 = drag.ids.map(function(i){ return doc.remove(i); });
      var at = parent.children.findIndex(function(c){ return c.id === t.info.id; }) + 1;
      if(t.mode === 'before') at--;
      removed2.forEach(function(rm, k){ if(rm) parent.children.splice(Math.max(0, at) + k, 0, rm.node); });
    }
    view.multi = null;
    view.sel = drag.id;
    this.afterMutation();
  },
  endDragUI: function(drag){
    if(drag.line && drag.line.parentNode) drag.line.remove();
    if(drag.ghost && drag.ghost.parentNode) drag.ghost.remove();
    if(this._panRaf){ cancelAnimationFrame(this._panRaf); this._panRaf = null; }
    view._autoPan = null;
    view.el.node.querySelectorAll('.node.drop-into').forEach(function(el){ el.classList.remove('drop-into'); });
    (drag.ids || [drag.id]).forEach(function(i){
      var el2 = view.nodeEl(i);
      if(el2) el2.classList.remove('dragging');
    });
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
      { label:'添加关系线', action: function(){ editor.startRelLink(); } },
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
