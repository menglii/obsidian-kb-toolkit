/* 双链服务：「所属中心」跟随目录（原样移植 note-locator.fixCenter）+ 尾部双链解析基础。 */
KB.define("services/links", function () {
  /** 正文里「所属中心」那一行的正则（中英文冒号都认，只改这一行） */
  var CENTER_LINE = /^(-[ \t]*所属中心[ \t]*[：:][ \t]*)\[\[([^\[\]]*)\]\]/m;

  function LinksService(app) { this.app = app; }
  /**
   * 更正「- 所属中心：[[…]]」。返回是否改动。
   * 目录认不出区域 / 没有这一行 / 已经对了 → 不动（不擅自加行）。
   * 短名写法维持短名，全路径写法维持全路径。
   */
  LinksService.prototype.fixCenter = async function (file, exclRegexes, root) {
    var util = KB.services["router.util"];
    var live = this.app.vault.getAbstractFileByPath(file.path) || file;
    var parent = live.parent;
    if (!parent) return false;
    var parentPath = parent.path;
    if (exclRegexes) for (var i = 0; i < exclRegexes.length; i++) if (exclRegexes[i].test(parentPath)) return false;
    var want = util.centerFor(parentPath);
    if (!want) return false;
    var changed = false;
    await this.app.vault.process(live, function (data) {
      var m = CENTER_LINE.exec(data);
      if (!m) return data;
      if (util.linkName(m[2]) === util.linkName(want)) return data;
      var shortStyle = String(m[2]).indexOf("/") < 0;
      var target = shortStyle ? util.linkName(want) : want;
      changed = true;
      return data.slice(0, m.index) + m[1] + "[[" + target + "]]" + data.slice(m.index + m[0].length);
    });
    return changed;
  };
  /** 尾部双链行扫描（供 R2 创建补全 / R4 重建使用）：返回正文里所有 [[…]] 目标名 */
  LinksService.prototype.extractTargets = function (body) {
    var out = [], re = /\[\[([^\[\]]+)\]\]/g, m;
    while ((m = re.exec(body))) out.push(m[1].split("|")[0]);
    return out;
  };
  KB.service("links", LinksService);
  return LinksService;
});
