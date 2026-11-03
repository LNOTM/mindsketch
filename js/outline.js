/* MindSketch 大纲模式（借鉴幕布） */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;

var outline = MS.outline = {
  el: {},
  open: false,

  init: function(){
    this.el.panel = document.getElementById('outline-panel');
    this.el.body = document.getElementById('outline-body');
    var self = this;
    document.getElementById('btn-outline').addEventListener('click', function(){ self.toggle(); });
    document.getElementById('outline-close').addEventListener('click', function(){ self.toggle(false); });
    util.bus.on('layout', function(){ if(self.open) self.render(); });
    util.bus.on('select', function(id){ if(self.open) self.highlight(id); });
    this.el.body.addEventListener('click', function(e){ self.onClick(e); });
    this.el.body.addEventListener('dblclick', function(e){ self.onDblClick(e); });
  },

  toggle: function(v){
    this.open = (v == null) ? !this.open : !!v;
    this.el.panel.classList.toggle('hidden', !this.open);
    document.getElementById('btn-outline').classList.toggle('active', this.open);
    if(this.open) this.render();
  },

  render: function(){
    var rows = [];
    (function rec(n, d){
      var has = n.children.length > 0;
      rows.push('<div class="ol-row" data-id="'+n.id+'" style="padding-left:'+(d*16+6)+'px">'
        +'<span class="ol-tw'+(has?'':' leaf')+'" data-tw="'+n.id+'">'+(has?(n.collapsed?'▸':'▾'):'')+'</span>'
        +'<span class="ol-text'+(d===0?' root-text':'')+'">'+(n.text ? util.esc(n.text) : '<i style="color:#b3bccb">（空）</i>')+'</span>'
        +(d===0 ? '' :
          '<button class="ol-act" data-act="child" data-id="'+n.id+'" title="添加子主题">＋子</button>'
        + '<button class="ol-act" data-act="sib" data-id="'+n.id+'" title="添加同级主题">＋同</button>'
        + '<button class="ol-act del" data-act="del" data-id="'+n.id+'" title="删除">✕</button>')
        +'</div>');
      if(has && !n.collapsed) n.children.forEach(function(c){ rec(c, d+1); });
    })(MS.view.doc.root, 0);
    this.el.body.innerHTML = rows.join('');
    this.highlight(MS.view.sel);
  },

  highlight: function(id){
    this.el.body.querySelectorAll('.ol-row').forEach(function(r){
      r.classList.toggle('selected', r.dataset.id === id);
    });
    var cur = this.el.body.querySelector('.ol-row.selected');
    if(cur) cur.scrollIntoView({ block:'nearest' });
  },

  onClick: function(e){
    var tw = e.target.closest('[data-tw]');
    if(tw){ MS.editor.toggleCollapse(tw.getAttribute('data-tw')); return; }
    var act = e.target.closest('[data-act]');
    if(act){
      var id = act.getAttribute('data-id');
      var a = act.getAttribute('data-act');
      if(a === 'child'){ MS.view.select(id); MS.editor.addChild(); }
      else if(a === 'sib'){ MS.view.select(id); MS.editor.addSibling(); }
      else if(a === 'del'){ MS.view.select(id); MS.editor.deleteNode(); }
      return;
    }
    var row = e.target.closest('.ol-row');
    if(row){
      MS.view.select(row.dataset.id);
      MS.view.ensureVisible(row.dataset.id);
    }
  },

  onDblClick: function(e){
    var row = e.target.closest('.ol-row');
    if(row) this.editRow(row);
  },

  editRow: function(row){
    var id = row.dataset.id;
    var node = MS.view.doc.find(id);
    if(!node || row.querySelector('.ol-input')) return;
    var span = row.querySelector('.ol-text');
    var input = document.createElement('input');
    input.className = 'ol-input';
    input.value = node.text;
    span.style.display = 'none';
    row.insertBefore(input, span);
    input.focus(); input.select();
    var self = this, done = false;
    function commit(){
      if(done) return; done = true;
      var text = input.value.trim();
      if(text !== node.text){
        node.text = text;
        MS.editor.pushHistory('text:'+id);
        MS.editor.afterMutation();
      } else {
        input.remove();
        span.style.display = '';
      }
    }
    input.addEventListener('keydown', function(e){
      e.stopPropagation();
      if(e.key === 'Enter'){ e.preventDefault(); commit(); }
      else if(e.key === 'Escape'){ e.preventDefault(); done = true; input.remove(); span.style.display=''; }
    });
    input.addEventListener('blur', commit);
  }
};
})();
