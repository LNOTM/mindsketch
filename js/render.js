/* MindSketch 画布渲染：节点层 + SVG 连线层 + 缩放平移 */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var util = MS.util;

var view = MS.view = {
  doc:null, theme:null, structure:'map', layout:null,
  sel:null, vx:0, vy:0, scale:1,
  el:{},

  init: function(doc){
    this.el = {
      wrap:   document.getElementById('canvas-wrap'),
      area:   document.getElementById('canvas-area'),
      link:   document.getElementById('link-layer'),
      node:   document.getElementById('node-layer'),
      overlay:document.getElementById('overlay-layer')
    };
    this.doc = doc;
    this.sel = doc.root.id;
    this.theme = MS.themes.get(MS.store.getPref('theme','classic'));
    this.structure = MS.store.getPref('structure','map');
    this.applyCanvasBg();
    this.bindCanvas();
    this.relayout(true);
  },

  applyCanvasBg: function(){
    var w = this.el.wrap;
    w.style.backgroundColor = this.theme.bg;
    w.style.backgroundImage = 'radial-gradient(' + this.theme.grid + ' 1px, transparent 1px)';
    w.style.backgroundSize = '22px 22px';
  },

  setTheme: function(id){
    this.theme = MS.themes.get(id);
    MS.store.setPref('theme', id);
    this.applyCanvasBg();
    this.relayout();
  },
  setStructure: function(s){
    this.structure = s;
    MS.store.setPref('structure', s);
    this.relayout();
  },

  relayout: function(fit){
    var self = this;
    this.layout = MS.layout(this.doc, {
      structure: this.structure,
      theme: this.theme,
      measure: function(n,d){ return MS.themes.measureNode(n,d); }
    });
    this.drawLinks();
    this.drawNodes();
    this.updateSvg();
    if(fit) this.fit();
    util.bus.emit('layout');
  },

  drawLinks: function(){
    var self = this;
    var html = this.layout.links.map(function(l){
      return '<path d="'+l.d+'" fill="none" stroke="'+self.branchColor(l.branch)+'" stroke-width="2" stroke-linecap="round"/>';
    }).join('');
    this.el.link.innerHTML = html;
  },
  branchColor: function(branch){ return MS.themes.branchColor(this.theme, branch); },

  drawNodes: function(){
    var self = this, theme = this.theme;
    var frag = [];
    this.layout.nodes.forEach(function(info){
      var st = MS.themes.styleFor(info.node, info, theme);
      var lines = info.m.lines.map(function(l){
        return '<div class="node-line" style="height:'+info.m.lineH+'px">'+(l ? util.esc(l) : '&nbsp;')+'</div>';
      }).join('');
      frag.push('<div class="node'+(info.depth===0?' root':'')+'" data-id="'+info.id+'"'
        +' style="left:'+info.x+'px;top:'+info.y+'px;width:'+info.w+'px;height:'+info.h+'px;'
        +'background:'+st.bg+';color:'+st.color+';border:'+st.bw+'px solid '+st.border+';'
        +'border-radius:'+st.radius+'px;font-size:'+st.fs+'px;font-weight:'+st.fw+';line-height:'+info.m.lineH+'px">'
        + lines
        + (info.node.note ? '<span class="note-flag" title="'+util.esc(info.node.note)+'">✎</span>' : '')
        + '</div>');
      if(info.hasChildren){
        var bp = self.buttonPos(info);
        var col = info.depth === 0 ? theme.accent : self.branchColor(info.branch);
        frag.push('<div class="collapse-btn" data-toggle="'+info.id+'"'
          +' style="left:'+bp.x+'px;top:'+bp.y+'px;border-color:'+col+';color:'+col+'"'
          +' title="'+info.node.children.length+' 个子主题">'+(info.collapsed?'+':'−')+'</div>');
      }
    });
    this.el.node.innerHTML = frag.join('');
    this.applySelection();
  },

  buttonPos: function(info){
    var x;
    if(info.depth === 0) x = this.structure === 'left' ? info.x - 14 : info.x + info.w + 14;
    else x = info.side === 1 ? info.x + info.w + 14 : info.x - 14;
    return { x:x, y: info.y + info.h/2 };
  },

  updateSvg: function(){
    var b = this.layout.bounds, s = this.el.link;
    s.setAttribute('viewBox', b.x+' '+b.y+' '+b.w+' '+b.h);
    s.setAttribute('preserveAspectRatio', 'none');
    s.style.left = b.x+'px';
    s.style.top = b.y+'px';
    s.style.width = b.w+'px';
    s.style.height = b.h+'px';
  },

  applyView: function(animate){
    var a = this.el.area;
    if(animate){
      a.classList.add('animating');
      setTimeout(function(){ a.classList.remove('animating'); }, 280);
    }
    a.style.transform = 'translate('+this.vx+'px,'+this.vy+'px) scale('+this.scale+')';
    util.bus.emit('zoom', this.scale);
  },

  applySelection: function(){
    var sel = this.sel;
    this.el.node.querySelectorAll('.node').forEach(function(el){
      el.classList.toggle('selected', el.dataset.id === sel);
    });
  },
  select: function(id){ this.sel = id; this.applySelection(); util.bus.emit('select', id); },

  nodeEl: function(id){ return this.el.node.querySelector('.node[data-id="'+id+'"]'); },
  info: function(id){ return this.layout ? this.layout.nodes.get(id) : null; },

  docCoords: function(cx, cy){
    var r = this.el.wrap.getBoundingClientRect();
    return { x:(cx - r.left - this.vx)/this.scale, y:(cy - r.top - this.vy)/this.scale };
  },

  fit: function(pad){
    pad = (pad == null) ? 60 : pad;
    var b = this.layout.bounds, w = this.el.wrap.clientWidth, h = this.el.wrap.clientHeight;
    var s = Math.min((w - pad*2)/b.w, (h - pad*2)/b.h, 1.2);
    s = util.clamp(s, 0.1, 1.2);
    this.scale = s;
    this.vx = (w - b.w*s)/2 - b.x*s;
    this.vy = (h - b.h*s)/2 - b.y*s;
    this.applyView(true);
  },
  zoomTo: function(s, animate){ this.scale = util.clamp(s, 0.1, 3); this.applyView(animate); },
  zoomAt: function(px, py, f){
    var ns = util.clamp(this.scale*f, 0.1, 3), k = ns/this.scale;
    this.vx = px - (px - this.vx)*k;
    this.vy = py - (py - this.vy)*k;
    this.scale = ns;
    this.applyView();
  },
  centerOn: function(id){
    var info = this.layout && this.layout.nodes.get(id);
    if(!info) return;
    var w = this.el.wrap.clientWidth, h = this.el.wrap.clientHeight;
    this.vx = w/2 - (info.x + info.w/2)*this.scale;
    this.vy = h/2 - (info.y + info.h/2)*this.scale;
    this.applyView(true);
  },
  ensureVisible: function(id){
    var info = this.layout && this.layout.nodes.get(id);
    if(!info) return;
    var r = this.el.wrap.getBoundingClientRect();
    var x1 = info.x*this.scale + this.vx, y1 = info.y*this.scale + this.vy;
    var x2 = x1 + info.w*this.scale, y2 = y1 + info.h*this.scale;
    if(x1 < 70 || y1 < 70 || x2 > r.width - 70 || y2 > r.height - 70) this.centerOn(id);
  },

  bindCanvas: function(){
    var self = this, wrap = this.el.wrap;
    var pointers = new Map();
    var pan = null, pinch = null, lastPanEnd = 0;

    wrap.addEventListener('pointerdown', function(e){
      pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(pointers.size === 2){
        var ps = Array.from(pointers.values());
        pinch = { d: Math.hypot(ps[0].x-ps[1].x, ps[0].y-ps[1].y) };
        pan = null;
        return;
      }
      if(e.target.closest('.node') || e.target.closest('[data-toggle]')) return;
      if(e.button !== 0 && e.button !== 1) return;
      pan = { x:e.clientX, y:e.clientY, vx:self.vx, vy:self.vy, moved:false };
      wrap.classList.add('panning');
      try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
    });
    wrap.addEventListener('pointermove', function(e){
      if(pointers.has(e.pointerId)) pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(pinch && pointers.size >= 2){
        var ps = Array.from(pointers.values());
        var d = Math.hypot(ps[0].x-ps[1].x, ps[0].y-ps[1].y);
        var cx = (ps[0].x+ps[1].x)/2, cy = (ps[0].y+ps[1].y)/2;
        if(pinch.d > 0){
          var r = wrap.getBoundingClientRect();
          self.zoomAt(cx - r.left, cy - r.top, d/pinch.d);
        }
        pinch.d = d;
        return;
      }
      if(pan){
        if(Math.abs(e.clientX-pan.x) + Math.abs(e.clientY-pan.y) > 3) pan.moved = true;
        self.vx = pan.vx + (e.clientX - pan.x);
        self.vy = pan.vy + (e.clientY - pan.y);
        self.applyView();
      }
    });
    function endPointer(e){
      pointers.delete(e.pointerId);
      if(pointers.size < 2) pinch = null;
      if(pan){
        if(pan.moved) lastPanEnd = Date.now();
        pan = null;
        wrap.classList.remove('panning');
      }
    }
    wrap.addEventListener('pointerup', endPointer);
    wrap.addEventListener('pointercancel', endPointer);
    wrap.addEventListener('wheel', function(e){
      e.preventDefault();
      var r = wrap.getBoundingClientRect();
      self.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY*0.0016));
    }, { passive:false });

    wrap.addEventListener('click', function(e){
      if(Date.now() - lastPanEnd < 150) return;
      if(e.target.closest('.node') || e.target.closest('[data-toggle]')) return;
      view.select(null);
    });
  },

  setDoc: function(doc){
    this.doc = doc;
    this.sel = doc.root.id;
    this.relayout(true);
  }
};
})();
