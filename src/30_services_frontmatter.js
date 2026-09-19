/* frontmatter 服务：processFrontMatter 原子读写封装（内部走 vault 队列，双同步库安全）。 */
KB.define("services/frontmatter", function () {
  function FmService(app) { this.app = app; }
  FmService.prototype.read = function (file) {
    if (!file || file.extension !== "md") return {};
    var cache = this.app.metadataCache.getFileCache(file);
    return (cache && cache.frontmatter) || {};
  };
  /** 原子改写 frontmatter；fn(fm) 就地改键。文件不存在/非 md 静默跳过。 */
  FmService.prototype.update = async function (file, fn) {
    if (!file || file.extension !== "md") return false;
    if (typeof this.app.fileManager.processFrontMatter !== "function") {
      console.warn("[kb-toolkit] 当前版本没有 fileManager.processFrontMatter");
      return false;
    }
    await this.app.fileManager.processFrontMatter(file, fn);
    return true;
  };
  KB.service("fm", FmService);
  return FmService;
});
