/* 移动引擎：renameFile + 撞名 uniquePath + 属性回填。
 * R3 起成为全插件唯一搬家入口（看板拖动 / 标签路由 / 知识库重建共用）。 */
KB.define("services/mover", function () {
  function MoverService(app) { this.app = app; }
  /** 目标撞名时生成不冲突路径：name.md → name 1.md → name 2.md … */
  MoverService.prototype.uniquePath = function (folder, name, app) {
    var dot = name.lastIndexOf(".");
    var base = dot < 0 ? name : name.slice(0, dot);
    var ext = dot < 0 ? "" : name.slice(dot);
    var cand = folder + "/" + name;
    var n = 1;
    while (app.vault.getAbstractFileByPath(cand)) {
      cand = folder + "/" + base + " " + n + ext;
      n++;
    }
    return cand;
  };
  /**
   * 搬一篇笔记。返回 {ok, file, blocked}：
   * blocked=true 表示目标已有同名文件（与 note-locator 行为一致：跳过 + 上报，不覆盖）。
   * overwrite 语义：只有 "unique" 走改名避让；其余任何值（含调用方传的 "skip"）
   * 都是「撞名即 blocked、不覆盖」—— R15 起在注释里写明，"skip" 是合法别名。
   */
  MoverService.prototype.move = async function (file, destFolder, opts) {
    opts = opts || {};
    var app = this.app;
    var destPath = opts.overwrite === "unique"
      ? this.uniquePath(destFolder, file.name, app)
      : (destFolder + "/" + file.name);
    if (destPath === file.path) return { ok: true, file: file, blocked: false, unchanged: true };
    var blocker = app.vault.getAbstractFileByPath(destPath);
    if (blocker) return { ok: false, file: file, blocked: true, dest: destPath };
    var newFile = await app.fileManager.renameFile(file, destPath);
    return { ok: true, file: newFile || file, blocked: false, dest: destPath };
  };
  KB.service("mover", MoverService);
  return MoverService;
});
