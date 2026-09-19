/* kb-toolkit 前奏：命名空间 + 注册器。
 * 构建方式 = 按文件名序拼接（scripts/build.js），无外部依赖。
 * 每个源文件用 KB.define(id, factory) 注册，entry 在最后实例化。 */
var obsidian = require("obsidian");
var KB = { reg: [], services: {}, modules: {} };
KB.define = function (id, factory) { KB.reg.push({ id: id, factory: factory }); };
KB.service = function (id, obj) { KB.services[id] = obj; };
KB.get = function (id) {
  for (var i = 0; i < KB.reg.length; i++) if (KB.reg[i].id === id) return KB.reg[i].factory;
  throw new Error("kb-toolkit: 未注册的模块 " + id);
};
/* 供离线断言直接访问内部服务（真机无副作用） */
if (typeof globalThis !== "undefined") globalThis.KB = KB;
