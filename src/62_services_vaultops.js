/* 库操作服务（R4b）：带「可逆条目 + sha256 守卫」的原子文件操作。
 * 执行与回滚共用同一套原语，保证「每个正向操作都有一条对应的逆操作记录」。
 * 对外契约：所有方法失败不抛（除 rename/create 的底层异常由调用方 catch），返回 {ok, blocked?, dest?}。 */
KB.define("services/vaultops", function () {
  var crypto = null;
  try { crypto = require("crypto"); } catch (e) { crypto = null; }

  function sha256(text) {
    try {
      if (crypto) return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
    } catch (e) { /* 落到退化分支 */ }
    var s = String(text);
    return "len" + s.length + ":" + s.slice(0, 8) + s.slice(-8);
  }

  function VaultOps(app) { this.app = app; }

  VaultOps.prototype.sha256 = function (text) { return sha256(text); };
  VaultOps.prototype.isFolder = function (f) { return !!(f && f.children !== undefined); };
  VaultOps.prototype.exists = function (path) {
    return !!this.app.vault.getAbstractFileByPath(path);
  };
  VaultOps.prototype.isEmptyFolder = function (f) {
    return this.isFolder(f) && (!f.children || f.children.length === 0);
  };
  VaultOps.prototype.readText = async function (file) {
    var v = this.app.vault;
    if (v.cachedRead) return await v.cachedRead(file);
    return file.content;
  };
  VaultOps.prototype.shaOf = async function (file) {
    if (this.isFolder(file)) return null;
    try { return sha256(await this.readText(file)); } catch (e) { return null; }
  };
  /**
   * 逐级建目录（存在即跳过）。返回**本次新建**的路径数组（升序），
   * 回滚时按倒序删除即可保证先删子后删父。
   */
  VaultOps.prototype.ensureFolder = async function (path) {
    var app = this.app;
    var segs = String(path).split("/").filter(function (s) { return s.length > 0; });
    var created = [], cur = "";
    for (var i = 0; i < segs.length; i++) {
      cur = cur ? cur + "/" + segs[i] : segs[i];
      if (app.vault.getAbstractFileByPath(cur)) continue;
      await app.vault.createFolder(cur);
      created.push(cur);
    }
    return created;
  };
  /** 建文本文件；目标已存在 → blocked（绝不覆盖）。返回 {ok, file, sha256, bytes} 或 {ok:false, blocked, reason} */
  VaultOps.prototype.createText = async function (path, content) {
    var app = this.app;
    if (app.vault.getAbstractFileByPath(path))
      return { ok: false, blocked: true, dest: path, reason: "目标已存在" };
    var f = await app.vault.create(path, content);
    return { ok: true, file: f, dest: path, sha256: sha256(content), bytes: String(content).length };
  };
  /** 改路径/移动；目标已存在 → blocked（绝不覆盖）；原地不动 → unchanged */
  VaultOps.prototype.rename = async function (file, newPath) {
    var app = this.app;
    if (!file) return { ok: false, blocked: true, dest: newPath, reason: "源不存在" };
    if (file.path === newPath) return { ok: true, unchanged: true, file: file, dest: newPath };
    if (app.vault.getAbstractFileByPath(newPath))
      return { ok: false, blocked: true, dest: newPath, reason: "目标已存在" };
    var nf = await app.fileManager.renameFile(file, newPath);
    return { ok: true, file: nf || file, dest: newPath };
  };
  /** 删除（仅用于回滚删掉本轮自己建的目录/文件，调用方必须先做 sha256 守卫）。
   * 优先走 fileManager.trashFile：1.13.7 实现体读 vault.getConfig("trashOption") 分流到
   * 系统回收站 / 本地 .trash / 永久删除，且不弹确认框（obsidian.asar 取证）。
   * 无该 API 的老版本退回 vault.delete。 */
  VaultOps.prototype.remove = async function (file, force) {
    if (!file) return { ok: true, skipped: true };
    if (this.isFolder(file) && !this.isEmptyFolder(file))
      return { ok: false, blocked: true, reason: "目录非空，拒绝删除" };
    var fm = this.app.fileManager;
    if (fm && typeof fm.trashFile === "function") {
      await fm.trashFile(file);
      return { ok: true, via: "trashFile" };
    }
    await this.app.vault.delete(file, true);
    return { ok: true, via: "vault.delete" };
  };
  VaultOps.sha256 = sha256;          /* 静态：供其他服务直接复用（原型上也有一份） */
  KB.service("vaultops", VaultOps);
  return VaultOps;
});
