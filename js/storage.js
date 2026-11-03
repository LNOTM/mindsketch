/* MindSketch 本地存储（localStorage 多文档） */
(function(){
'use strict';
var MS = window.MS = window.MS || {};
var KEY = 'mindsketch.store.v1';

var store = MS.store = {
  data: null,
  prefs: {},

  load: function(){
    try{ this.data = JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch(e){ this.data = null; }
    if(!this.data || typeof this.data !== 'object') this.data = {};
    if(!this.data.docs || typeof this.data.docs !== 'object') this.data.docs = {};
    if(!Array.isArray(this.data.order)) this.data.order = [];
    if(!('current' in this.data)) this.data.current = null;
    this.prefs = this.data.prefs || {};
  },
  save: function(){
    this.data.prefs = this.prefs;
    try{ localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch(e){ console.warn('本地存储写入失败（可能空间不足）', e); }
  },
  getPref: function(k, d){ return (k in this.prefs) ? this.prefs[k] : d; },
  setPref: function(k, v){ this.prefs[k] = v; this.save(); },

  listDocs: function(){
    var self = this;
    return this.data.order.map(function(id){ return self.data.docs[id]; }).filter(Boolean);
  },
  currentId: function(){ return this.data.current; },
  currentDoc: function(){ return this.data.docs[this.data.current] || null; },

  createDoc: function(name, data){
    var id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    this.data.docs[id] = { id:id, name:name||'未命名导图', createdAt:Date.now(), updatedAt:Date.now(), data:data||null };
    this.data.order.push(id);
    this.data.current = id;
    this.save();
    return id;
  },
  setCurrent: function(id){ if(this.data.docs[id]){ this.data.current = id; this.save(); } },
  renameDoc: function(id, name){
    var d = this.data.docs[id];
    if(d){ d.name = name; this.save(); }
  },
  deleteDoc: function(id){
    if(!this.data.docs[id]) return;
    delete this.data.docs[id];
    this.data.order = this.data.order.filter(function(x){ return x !== id; });
    if(this.data.current === id) this.data.current = this.data.order[0] || null;
    this.save();
  },
  duplicateDoc: function(id){
    var d = this.data.docs[id];
    if(!d) return null;
    var nd = JSON.parse(JSON.stringify(d));
    nd.id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    nd.name = d.name + ' 副本';
    nd.createdAt = nd.updatedAt = Date.now();
    this.data.docs[nd.id] = nd;
    this.data.order.push(nd.id);
    this.save();
    return nd.id;
  },
  persistDoc: function(doc){
    var d = this.data.docs[this.data.current];
    if(!d) return;
    d.data = doc.serialize();
    d.name = doc.name;
    d.updatedAt = Date.now();
    this.save();
  }
};
})();
