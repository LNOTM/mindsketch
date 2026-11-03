/* MindSketch 应用主控：工具栏 / 菜单 / 模态框 / 文档管理 / 搜索 / 导入导出调度 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;
var view = MS.view;

var app = MS.app = {
  hits: [], hitIdx: -1,
  layouts: [['map','思维导图 · 平衡'], ['right','逻辑图 · 向右'], ['left','逻辑图 · 向左'], ['org','组织结构图']],

  init: function(){
    MS.store.load();

    window.__errors = [];
    window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); });

    var entry = MS.store.currentDoc();
    var doc = (entry && entry.data) ? MS.model.Doc.fromJSON(entry.data) : null;
    if(!doc){
      doc = this.sampleDoc();
      MS.store.createDoc(doc.name, doc.serialize());
    }

    this._saveSoon = util.debounce(function(){ app.saveNow(); }, 700);
    util.bus.on('doc:mutated', function(){ app._saveSoon(); app.updateStatus(); });
    util.bus.on('zoom', function(s){
      document.getElementById('zoom-level').textContent = Math.round(s*100) + '%';
    });
    window.addEventListener('beforeunload', function(){ app.saveNow(); });

    this.bindToolbar();
    MS.view.init(doc);
    MS.outline.init();
    MS.editor.init();
    this.bindDocTitle();
    this.bindFileInput();
    this.bindSearch();
    this.setDocTitle(doc.name);
    this.updateStatus();
    document.getElementById('status-right').textContent = '已保存 ' + util.timeStr();
  },

  /* ═══════════ 状态栏 ═══════════ */
  updateStatus: function(){
    var doc = view.doc;
    document.getElementById('status-left').textContent = doc.name + ' · ' + doc.count() + ' 个节点';
  },
  saveNow: function(){
    MS.store.persistDoc(view.doc);
    document.getElementById('status-right').textContent = '已保存 ' + util.timeStr();
  },
  setDocTitle: function(name){
    document.getElementById('doc-title').textContent = name;
  },

  /* ═══════════ 菜单组件 ═══════════ */
  showMenu: function(x, y, items){
    var menu = document.getElementById('ctx-menu');
    this._lastItems = items;
    if(this._menuClose) document.removeEventListener('pointerdown', this._menuClose, true);
    menu.classList.remove('hidden');
    menu.innerHTML = this.renderItems(items);
    this.positionMenu(menu, x, y);
    var self = this;
    menu.onclick = function(e){
      var it = e.target.closest('[data-mi]');
      if(!it) return;
      var item = items[+it.dataset.mi];
      if(item && item.children === 'color'){ self.showColorMenu(x, y); return; }
      self.closeMenus();
      if(item && item.action) item.action();
    };
    setTimeout(function(){
      document.addEventListener('pointerdown', self._menuClose = function(e){
        var m = document.getElementById('ctx-menu');
        if(!m.contains(e.target) && !e.target.closest('#toolbar')) app.closeMenus();
      }, true);
    }, 0);
  },
  renderItems: function(items){
    return items.map(function(it, i){
      if(it.sep) return '<div class="menu-sep"></div>';
      var check = it.check ? '<span class="check">✓</span>' : '';
      return '<div class="menu-item'+(it.danger?' danger':'')+(it.disabled?' disabled':'')+'" data-mi="'+i+'">'
        + '<span>'+check+util.esc(it.label)+'</span>'
        + (it.kbd ? '<span class="kbd">'+util.esc(it.kbd)+'</span>' : '')
        + '</div>';
    }).join('');
  },
  showColorMenu: function(x, y){
    var menu = document.getElementById('ctx-menu');
    var swatches = MS.themes.NODE_COLORS.map(function(c){
      return '<div class="swatch" data-color="'+c+'" style="background:'+c+'" title="'+c+'"></div>';
    }).join('');
    menu.innerHTML = '<div class="menu-title">节点颜色</div>'
      + '<div class="swatches">'+swatches+'</div>'
      + '<div class="menu-sep"></div>'
      + '<div class="menu-item" data-clear="1"><span>清除颜色</span></div>'
      + '<div class="menu-item" data-back="1"><span>‹ 返回菜单</span></div>';
    this.positionMenu(menu, x, y);
    var self = this;
    menu.onclick = function(e){
      var sw = e.target.closest('[data-color]');
      if(sw){ self.closeMenus(); MS.editor.setColor(sw.getAttribute('data-color')); return; }
      if(e.target.closest('[data-clear]')){ self.closeMenus(); MS.editor.setColor(null); return; }
      if(e.target.closest('[data-back]')){ self.showMenu(x, y, self._lastItems || []); }
    };
  },
  showColorPickerAt: function(){
    var id = view.sel || view.doc.root.id;
    view.select(id);
    var el = view.nodeEl(id);
    var r = el ? el.getBoundingClientRect() : { left: 200, bottom: 200 };
    this._lastItems = this.menuDefs.insert();
    this.showColorMenu(r.left, r.bottom + 8);
  },
  positionMenu: function(menu, x, y){
    menu.style.left = '0px'; menu.style.top = '0px';
    var w = menu.offsetWidth, h = menu.offsetHeight;
    if(x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
    if(y + h > window.innerHeight - 8) y = Math.max(8, y - h - 8);
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
  },
  closeMenus: function(){
    document.getElementById('ctx-menu').classList.add('hidden');
    if(this._menuClose) document.removeEventListener('pointerdown', this._menuClose, true);
  },

  /* ═══════════ 下拉菜单定义 ═══════════ */
  menuDefs: {
    file: function(){ return [
      { label:'新建导图…', action: function(){ app.newDocModal(); } },
      { label:'文档管理…', action: function(){ app.docManagerModal(); } },
      { sep:true },
      { label:'打开 / 导入文件…', kbd:'支持拖入', action: function(){ document.getElementById('file-input').click(); } },
      { label:'保存为 JSON', kbd:'Ctrl+S', action: function(){ app.saveJSON(); } },
      { sep:true },
      { label:'全部展开', action: function(){ MS.editor.expandAll(true); } },
      { label:'全部折叠', action: function(){ MS.editor.expandAll(false); } }
    ]; },
    edit: function(){ return [
      { label:'撤销', kbd:'Ctrl+Z', action: function(){ MS.editor.undo(); } },
      { label:'重做', kbd:'Ctrl+Y', action: function(){ MS.editor.redo(); } },
      { sep:true },
      { label:'剪切', kbd:'Ctrl+X', action: function(){ MS.editor.cut(); } },
      { label:'复制', kbd:'Ctrl+C', action: function(){ MS.editor.copy(); } },
      { label:'粘贴', kbd:'Ctrl+V', action: function(){ MS.editor.paste(); } },
      { sep:true },
      { label:'适应画布', kbd:'Ctrl+Shift+F', action: function(){ view.fit(); } },
      { label:'重置缩放', kbd:'Ctrl+0', action: function(){ view.zoomTo(1, true); } }
    ]; },
    insert: function(){ return [
      { label:'添加子主题', kbd:'Tab', action: function(){ MS.editor.addChild(); } },
      { label:'添加同级主题', kbd:'Enter', action: function(){ MS.editor.addSibling(); } },
      { sep:true },
      { label:'添加备注…', action: function(){ app.editNote(view.sel || view.doc.root.id); } },
      { label:'节点颜色…', action: function(){ app.showColorPickerAt(); } }
    ]; },
    structure: function(){
      return app.layouts.map(function(s){
        return { label:s[1], check:s[0]===view.structure,
                 action: function(){ view.setStructure(s[0]); app.toast('已切换为「'+s[1]+'」'); } };
      });
    },
    theme: function(){
      return MS.themes.list.map(function(t){
        return { label:t.name, check:t.id===view.theme.id,
                 action: function(){ view.setTheme(t.id); app.toast('已切换主题「'+t.name+'」'); } };
      });
    },
    export: function(){ return [
      { label:'PNG 图片', action: function(){ app.doExport('png'); } },
      { label:'JPG 图片', action: function(){ app.doExport('jpg'); } },
      { label:'SVG 矢量图', action: function(){ app.doExport('svg'); } },
      { label:'PDF 文档', action: function(){ app.doExport('pdf'); } },
      { sep:true },
      { label:'Markdown (.md)', action: function(){ app.doExport('md'); } },
      { label:'OPML (.opml)', action: function(){ app.doExport('opml'); } },
      { label:'FreeMind (.mm)', action: function(){ app.doExport('mm'); } },
      { label:'JSON 数据 (.json)', action: function(){ app.doExport('json'); } },
      { label:'交互网页 (.html)', action: function(){ app.doExport('html'); } }
    ]; },
    help: function(){ return [
      { label:'快捷键与操作', action: function(){ app.helpModal(); } },
      { label:'关于 MindSketch', action: function(){ app.aboutModal(); } }
    ]; }
  },

  bindToolbar: function(){
    var self = this;
    document.querySelectorAll('#toolbar [data-dd]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var name = btn.getAttribute('data-dd');
        var r = btn.getBoundingClientRect();
        self.showMenu(r.left, r.bottom + 6, self.menuDefs[name]());
      });
    });
    document.getElementById('btn-undo').addEventListener('click', function(){ MS.editor.undo(); });
    document.getElementById('btn-redo').addEventListener('click', function(){ MS.editor.redo(); });
    document.getElementById('zoom-ctrl').addEventListener('click', function(e){
      var b = e.target.closest('[data-zoom]');
      if(!b) return;
      var z = b.getAttribute('data-zoom');
      if(z === 'in') view.zoomTo(view.scale*1.2, true);
      else if(z === 'out') view.zoomTo(view.scale/1.2, true);
      else if(z === 'reset') view.zoomTo(1, true);
      else if(z === 'fit') view.fit();
    });
  },

  /* ═══════════ 导出 ═══════════ */
  doExport: function(kind){
    var doc = view.doc;
    var name = util.safeName(doc.name);
    var opts = { structure: view.structure, theme: view.theme };
    var self = this;
    Promise.resolve().then(function(){
      if(kind === 'png')  return MS.io.exportPNG(doc, opts).then(function(b){ util.download(b, name+'.png', 'image/png'); });
      if(kind === 'jpg')  return MS.io.exportJPG(doc, opts).then(function(b){ util.download(b, name+'.jpg', 'image/jpeg'); });
      if(kind === 'svg')  { util.download(MS.io.exportSVGParts(doc, opts).svg, name+'.svg', 'image/svg+xml'); return; }
      if(kind === 'pdf')  return MS.io.exportPDF(doc, opts).then(function(pdf){ pdf.save(name+'.pdf'); });
      if(kind === 'md')   { util.download(MS.io.exportMarkdown(doc), name+'.md', 'text/markdown'); return; }
      if(kind === 'opml') { util.download(MS.io.exportOPML(doc), name+'.opml', 'text/xml'); return; }
      if(kind === 'mm')   { util.download(MS.io.exportFreeMind(doc), name+'.mm', 'text/xml'); return; }
      if(kind === 'json') { util.download(MS.io.exportJSON(doc), name+'.json', 'application/json'); return; }
      if(kind === 'html') { util.download(MS.io.exportInteractiveHTML(doc, opts), name+'.html', 'text/html'); return; }
    }).then(function(){
      var names = { png:'PNG', jpg:'JPG', svg:'SVG', pdf:'PDF', md:'Markdown',
                    opml:'OPML', mm:'FreeMind', json:'JSON', html:'交互网页' };
      self.toast('已导出 ' + (names[kind] || kind));
    }).catch(function(e){
      console.error(e);
      if(kind === 'pdf'){
        self.toast(e.message + '，已改导出 PNG', true);
        MS.io.exportPNG(doc, opts).then(function(b){ util.download(b, name+'.png', 'image/png'); }).catch(function(){});
      } else self.toast('导出失败：' + e.message, true);
    });
  },
  saveJSON: function(){
    var doc = view.doc;
    util.download(MS.io.exportJSON(doc), util.safeName(doc.name)+'.json', 'application/json');
    this.toast('已保存 JSON 文件');
  },

  /* ═══════════ 导入 ═══════════ */
  bindFileInput: function(){
    var input = document.getElementById('file-input');
    var self = this;
    input.addEventListener('change', function(){
      if(input.files && input.files[0]) self.importFile(input.files[0]);
      input.value = '';
    });
    window.addEventListener('dragover', function(e){ e.preventDefault(); });
    window.addEventListener('drop', function(e){
      e.preventDefault();
      if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0])
        self.importFile(e.dataTransfer.files[0]);
    });
  },
  importFile: function(file){
    var self = this;
    this.toast('正在导入 ' + file.name + ' …');
    var isX = /\.xmind$/i.test(file.name);
    var p = isX ? file.arrayBuffer() : file.text();
    Promise.resolve(p).then(function(content){
      return MS.io.importAuto(file.name, content);
    }).then(function(doc){
      app.replaceDoc(doc);
      self.toast('导入成功：' + doc.name);
    }).catch(function(e){
      console.error(e);
      self.toast('导入失败：' + e.message, true);
    });
  },
  replaceDoc: function(doc){
    MS.editor.editingId = null;
    MS.editor.inputEl = null;
    view.doc = doc;
    view.sel = doc.root.id;
    MS.store.createDoc(doc.name, doc.serialize());
    view.relayout(true);
    this.setDocTitle(doc.name);
    this.resetHistory();
    this.updateStatus();
  },
  loadCurrent: function(){
    var entry = MS.store.currentDoc();
    if(!entry) return;
    var doc = MS.model.Doc.fromJSON(entry.data);
    if(!doc) return;
    MS.editor.editingId = null;
    MS.editor.inputEl = null;
    view.doc = doc;
    view.sel = doc.root.id;
    view.relayout(true);
    this.setDocTitle(doc.name);
    this.resetHistory();
    this.updateStatus();
  },
  resetHistory: function(){
    MS.editor.hist.stack = [];
    MS.editor.hist.ptr = -1;
    MS.editor.pushHistory(null);
  },

  /* ═══════════ 文档标题重命名 ═══════════ */
  bindDocTitle: function(){
    var el = document.getElementById('doc-title');
    el.addEventListener('click', function(){
      if(el.querySelector('input')) return;
      var input = document.createElement('input');
      input.value = view.doc.name;
      el.textContent = '';
      el.appendChild(input);
      input.focus(); input.select();
      var done = false;
      function commit(){
        if(done) return; done = true;
        var name = input.value.trim() || '未命名导图';
        view.doc.name = name;
        el.textContent = name;
        app.saveNow();
        app.updateStatus();
      }
      input.addEventListener('keydown', function(e){
        e.stopPropagation();
        if(e.key === 'Enter') commit();
        else if(e.key === 'Escape'){ done = true; el.textContent = view.doc.name; }
      });
      input.addEventListener('blur', commit);
    });
  },

  /* ═══════════ 搜索 ═══════════ */
  bindSearch: function(){
    var self = this;
    document.getElementById('btn-search').addEventListener('click', function(){ self.openSearch(); });
    document.getElementById('search-close').addEventListener('click', function(){ self.closeSearch(); });
    var input = document.getElementById('search-input');
    input.addEventListener('input', function(){ self.runSearch(); });
    input.addEventListener('keydown', function(e){
      e.stopPropagation();
      if(e.key === 'Enter'){ e.preventDefault(); self.nextHit(); }
      else if(e.key === 'Escape'){ self.closeSearch(); }
    });
  },
  openSearch: function(){
    document.getElementById('search-pop').classList.remove('hidden');
    var i = document.getElementById('search-input');
    i.focus(); i.select();
  },
  closeSearch: function(){
    document.getElementById('search-pop').classList.add('hidden');
    this.hits = []; this.hitIdx = -1;
    document.getElementById('search-count').textContent = '';
    view.el.node.querySelectorAll('.node.hit').forEach(function(el){ el.classList.remove('hit'); });
  },
  runSearch: function(){
    var q = document.getElementById('search-input').value.trim().toLowerCase();
    var self = this;
    view.el.node.querySelectorAll('.node.hit').forEach(function(el){ el.classList.remove('hit'); });
    this.hits = []; this.hitIdx = -1;
    document.getElementById('search-count').textContent = '';
    if(!q) return;
    view.doc.walk(function(n){
      if(n.text.toLowerCase().indexOf(q) >= 0) self.hits.push(n.id);
    });
    view.el.node.querySelectorAll('.node').forEach(function(el){
      if(self.hits.indexOf(el.dataset.id) >= 0) el.classList.add('hit');
    });
    if(this.hits.length){
      this.hitIdx = 0;
      document.getElementById('search-count').textContent = '1/'+this.hits.length;
      this.revealNode(this.hits[0]);
      this._paintHits();
      view.select(this.hits[0]);
      view.ensureVisible(this.hits[0]);
    } else {
      document.getElementById('search-count').textContent = '0';
    }
  },
  /* 重绘后重新贴搜索高亮 */
  _paintHits: function(){
    var self = this;
    view.el.node.querySelectorAll('.node.hit').forEach(function(el){ el.classList.remove('hit'); });
    view.el.node.querySelectorAll('.node').forEach(function(el){
      if(self.hits.indexOf(el.dataset.id) >= 0) el.classList.add('hit');
    });
  },
  /* 搜索命中折叠分支内的节点时，展开其全部祖先 */
  revealNode: function(id){
    var doc = view.doc;
    var changed = false;
    var p = doc.findParent(id);
    while(p){
      if(p.collapsed){ p.collapsed = false; changed = true; }
      if(p.id === doc.root.id) break;
      p = doc.findParent(p.id);
    }
    if(changed){
      MS.editor.pushHistory('search-reveal');
      view.relayout();
    }
  },
  nextHit: function(){
    if(!this.hits.length) return;
    this.hitIdx = (this.hitIdx + 1) % this.hits.length;
    document.getElementById('search-count').textContent = (this.hitIdx+1)+'/'+this.hits.length;
    this.revealNode(this.hits[this.hitIdx]);
    this._paintHits();
    view.select(this.hits[this.hitIdx]);
    view.ensureVisible(this.hits[this.hitIdx]);
  },

  /* ═══════════ 模态框 ═══════════ */
  modal: function(html, opts){
    var root = document.getElementById('modal-root');
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal">'+html+'</div>';
    root.appendChild(mask);
    var self = this;
    mask.addEventListener('pointerdown', function(e){
      if(e.target === mask && !(opts && opts.sticky)) self.closeModal();
    });
    mask.querySelectorAll('[data-close]').forEach(function(b){
      b.addEventListener('click', function(){ self.closeModal(); });
    });
    return mask;
  },
  closeModal: function(){
    document.getElementById('modal-root').innerHTML = '';
  },
  toast: function(msg, isErr){
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' error' : '');
    t.textContent = msg;
    document.getElementById('toast-root').appendChild(t);
    setTimeout(function(){
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(function(){ t.remove(); }, 320);
    }, 2200);
  },

  editNote: function(id){
    var doc = view.doc;
    var n = doc.find(id || doc.root.id);
    if(!n) return;
    var mask = this.modal(
      '<div class="modal-head"><span>备注</span><button data-close>×</button></div>'
      +'<div class="modal-body"><div class="field">'
      +'<textarea id="note-ta" placeholder="输入备注内容…">'+util.esc(n.note)+'</textarea>'
      +'</div></div>'
      +'<div class="modal-foot"><button class="btn" data-close>取消</button>'
      +'<button class="btn primary" id="note-save">保存</button></div>');
    var ta = mask.querySelector('#note-ta');
    ta.focus();
    mask.querySelector('#note-save').addEventListener('click', function(){
      MS.editor.setNote(ta.value.trim());
      app.closeModal();
      app.toast('备注已保存');
    });
  },

  newDocModal: function(){
    var mask = this.modal(
      '<div class="modal-head"><span>新建导图</span><button data-close>×</button></div>'
      +'<div class="modal-body">'
      +'<div class="field"><label>导图名称</label><input type="text" id="nd-name" value="未命名导图"></div>'
      +'<div class="tpl-grid">'
      + this.templates.map(function(t, i){
          return '<div class="tpl-card" data-tpl="'+i+'"><b>'+t.name+'</b><span>'+t.desc+'</span></div>';
        }).join('')
      +'</div></div>');
    mask.addEventListener('click', function(e){
      var card = e.target.closest('[data-tpl]');
      if(!card) return;
      var t = app.templates[+card.getAttribute('data-tpl')];
      var name = mask.querySelector('#nd-name').value.trim() || t.name;
      var doc = MS.model.Doc.fromTree(app.treeFromSpec(t.spec), name);
      app.closeModal();
      app.replaceDoc(doc);
      app.toast('已新建：' + name);
    });
  },

  docManagerModal: function(){
    var rows = MS.store.listDocs().map(function(d){
      var cur = d.id === MS.store.currentId();
      return '<div class="doc-row'+(cur?' current':'')+'" data-id="'+d.id+'">'
        +'<div class="doc-meta"><div class="doc-name">'+util.esc(d.name)+'</div>'
        +'<div class="doc-sub">'+util.dateStr(d.updatedAt)+'</div></div>'
        +'<div class="doc-ops">'
        +(cur ? '' : '<button data-op="open">打开</button>')
        +'<button data-op="rename">重命名</button>'
        +'<button data-op="dup">复制</button>'
        +'<button data-op="del" class="del">删除</button>'
        +'</div></div>';
    }).join('');
    var mask = this.modal(
      '<div class="modal-head"><span>文档管理</span><button data-close>×</button></div>'
      +'<div class="modal-body">'+(rows || '<p style="color:#7a8699">暂无文档</p>')+'</div>'
      +'<div class="modal-foot"><button class="btn primary" id="dm-new">＋ 新建导图</button></div>');
    mask.querySelector('#dm-new').addEventListener('click', function(){
      app.closeModal();
      app.newDocModal();
    });
    mask.addEventListener('click', function(e){
      var op = e.target.closest('[data-op]');
      if(!op) return;
      var id = op.closest('.doc-row').getAttribute('data-id');
      var action = op.getAttribute('data-op');
      if(action === 'open'){
        MS.store.setCurrent(id);
        app.loadCurrent();
        app.closeModal();
      } else if(action === 'rename'){
        var d = MS.store.data.docs[id];
        var name = prompt('重命名导图', d.name);
        if(name && name.trim()){
          MS.store.renameDoc(id, name.trim());
          if(id === MS.store.currentId()){
            view.doc.name = name.trim();
            app.setDocTitle(name.trim());
            app.updateStatus();
          }
          app.docManagerModal();
        }
      } else if(action === 'dup'){
        MS.store.duplicateDoc(id);
        app.docManagerModal();
      } else if(action === 'del'){
        if(!confirm('确定删除「'+MS.store.data.docs[id].name+'」？此操作不可恢复。')) return;
        MS.store.deleteDoc(id);
        if(!MS.store.currentId()){
          var nd = MS.model.Doc.fromTree({ text:'中心主题' }, '未命名导图');
          MS.store.createDoc(nd.name, nd.serialize());
        }
        app.loadCurrent();
        app.docManagerModal();
      }
    });
  },

  helpModal: function(){
    var rows = [
      ['Tab / Insert','添加子主题'], ['Enter','添加同级主题'], ['F2 / 双击','编辑文字'],
      ['Space','折叠 / 展开分支'], ['Delete / Backspace','删除节点'], ['方向键','在节点间移动'],
      ['Ctrl+Z / Ctrl+Y','撤销 / 重做'], ['Ctrl+C / X / V','复制 / 剪切 / 粘贴'], ['Ctrl+B','节点加粗'],
      ['Ctrl+F','搜索节点'], ['Ctrl+S','保存 JSON'], ['Ctrl+Shift+F','适应画布'],
      ['Ctrl+0 / Ctrl+= / Ctrl+-','缩放 100% / 放大 / 缩小'], ['拖拽节点','调整层级与顺序'],
      ['滚轮 / 双指捏合','缩放画布'], ['拖动空白处','平移画布']
    ];
    this.modal(
      '<div class="modal-head"><span>快捷键与操作</span><button data-close>×</button></div>'
      +'<div class="modal-body"><table class="kbd-table">'
      + rows.map(function(r){ return '<tr><td><kbd>'+r[0]+'</kbd></td><td>'+r[1]+'</td></tr>'; }).join('')
      +'</table>'
      +'<p style="color:#7a8699;margin-top:12px">提示：粘贴外部 Markdown / 缩进文本时会自动转换为节点子树；也可以把文件直接拖进页面导入。</p></div>'
      +'<div class="modal-foot"><button class="btn primary" data-close>知道了</button></div>');
  },

  aboutModal: function(){
    this.modal(
      '<div class="modal-head"><span>关于 MindSketch 思维画板</span><button data-close>×</button></div>'
      +'<div class="modal-body">'
      +'<p><b>MindSketch 思维画板</b>是一款免费、免注册、纯前端的在线思维导图工具。</p>'
      +'<p>· 数据全部保存在你自己的浏览器本地（localStorage），不上传任何服务器</p>'
      +'<p>· 4 种结构 · 8 套主题 · 大纲模式 · 9 种导出格式 · 6 种导入格式</p>'
      +'<p>· 设计上吸收了 XMind（结构 / 主题 / 快捷键）、幕布（大纲模式）、markmap（Markdown 与交互网页）、GitMind（模板）、Whimsical（现代交互）的优点</p>'
      +'<p>· 开源地址：<a href="https://github.com/LNOTM/mindsketch" target="_blank" rel="noopener">github.com/LNOTM/mindsketch</a></p>'
      +'</div><div class="modal-foot"><button class="btn primary" data-close>关闭</button></div>');
  },

  /* ═══════════ 模板与示例 ═══════════ */
  templates: [
    { name:'空白导图', desc:'从中心主题开始自由发散', spec:['中心主题'] },
    { name:'每周计划', desc:'工作 / 学习 / 生活 / 复盘', spec:['本周计划',
      '工作重点：任务一、任务二、任务三',
      '学习成长：课程 / 书籍',
      '生活安排：运动、休息',
      '本周复盘'] },
    { name:'读书笔记', desc:'观点 / 摘录 / 行动启发', spec:['《书名》读书笔记',
      '核心观点',
      '精彩摘录',
      '行动启发',
      '疑问与思考'] },
    { name:'产品发布', desc:'市场 / 研发 / 运营清单', spec:['产品发布清单',
      '市场',
      '研发',
      '运营',
      '风险预案'] }
  ],
  treeFromSpec: function(spec){
    var text = Array.isArray(spec) ? spec[0] : spec;
    var t = { text:text, note:'', children:[] };
    if(Array.isArray(spec)){
      for(var i=1;i<spec.length;i++){
        var c = spec[i];
        if(typeof c === 'string') t.children.push({ text:c, note:'', children:[] });
        else if(Array.isArray(c)) t.children.push(this.treeFromSpec(c));
      }
    }
    return t;
  },
  sampleDoc: function(){
    return MS.model.Doc.fromTree(this.treeFromSpec([
      '欢迎使用 MindSketch 思维画板',
      ['🚀 快速上手',
        ['Tab 新增子主题'], ['Enter 新增同级主题'], ['双击或 F2 编辑文字'], ['拖拽节点调整结构']],
      ['🎨 百变样式',
        ['顶部「结构」切换 4 种布局'], ['顶部「主题」切换 8 套配色'], ['右键节点：颜色 / 加粗 / 备注'], ['大纲模式适合纯文字梳理']],
      ['📤 多格式导入导出',
        ['导出：PNG / JPG / SVG / PDF'], ['导出：Markdown / OPML / FreeMind'], ['导出：JSON / 交互网页'], ['导入：XMind / FreeMind / OPML / MD / TXT']],
      ['🔒 数据安全',
        ['全部数据保存在本地浏览器'], ['无需注册，完全免费'], ['多文档管理：文件 → 文档管理']],
      ['⌨️ 更多快捷键',
        ['点顶部「帮助」查看全部快捷键'], ['Ctrl+F 搜索节点'], ['Ctrl+Shift+F 适应画布']]
    ]), '欢迎使用 MindSketch');
  }
};

document.addEventListener('DOMContentLoaded', function(){ MS.app.init(); });
})();
