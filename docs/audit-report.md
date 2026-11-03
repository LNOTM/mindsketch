# MindSketch 静态代码审查报告（mindsketch/ 纯前端思维导图）

- 审查日期：2026-11-03　审查方式：全量通读 10 个 js + index.html + tests，Node 实跑测试与临时验证脚本
- **快照说明**：审查期间文件被并行更新（layout.js 193→199 行、editor.js pushHistory 合并策略与按键守卫、index.html 版本号 1.0.1→1.0.2）。本报告基于最终快照：git diff 相对 v1.0 提交 +88/−24，editor.js sha256 `B806E0C2…F4427A45`；`node mindsketch/tests/run.js` 在该快照上实跑两轮，45/45 通过。
- 验证脚本：`tmp_audit/verify.js`（vm 沙盒加载 util/model/themes/layout/io，结论标注「实测」；用后可删）。

## 1. 结论

无 P0（未发现崩溃或数据丢失路径）。发现 P1 三条（一条 XSS、两条功能错误，其中一条是本轮新修复未生效）、P2 两条，其余为仅记录项。整体结构清晰、守卫意识好（move 守卫、根折叠守卫、esc 覆盖面广），P1-1/P1-2 建议修复后再交付。

## 2. 必须修（P1 × 3，按影响排序）

### P1-1【安全】导入 JSON 的 id / style.bg 未净化，构成 HTML 注入面（无 CSP 兜底）
- **位置**：model.js:43（`n.id = n.id ? String(n.id) : …` 任意字符串照收）、model.js:46（style 对象原样保留）→ render.js:79（`data-id="'+info.id+'"`）、render.js:81（`background:'+st.bg`）、render.js:135（`querySelector('.node[data-id="'+id+'"]')`，含引号的 id 直接抛 SyntaxError）；outline.js:34/38-40（data-id/data-tw 同样拼接）；io.js:53（导出 SVG `fill="'+st.bg`，XML 注入）。
- **复现**：文件 → 打开/导入（或拖入）`{"version":1,"meta":{},"root":{"id":"\"><img src=x onerror=alert(1)>","text":"r","children":[{"id":"c1","text":"c","style":{"bg":"red\" onmouseover=\"alert(2)"}}]}}`。实测（tmp_audit/verify.js [1]）：恶意 id 成为布局 key，render.js:79/81 拼接结果含未转义的 `onerror`/`onmouseover`；outline 渲染同样命中。index.html 无 CSP，注入即可执行。
- **影响**：导入他人分享的 .json/.mm 文件是本应用主打功能，恶意文件可在用户机器上执行任意脚本（localStorage 数据可被读取）。
- **修复方向**：Doc.fromJSON 对 id 做白名单校验（如 `/^[A-Za-z0-9_-]{1,64}$/`，不合法一律用 nextId 重新分配）；style.bg 校验为 `^#[0-9a-fA-F]{3,8}$` 否则丢弃。修好后 render/outline/io 的拼接点无需逐个转义；可再补一条 CSP meta 纵深防御。

### P1-2 折叠节点上按 Tab 新增子主题：节点静默写入但不可见
- **位置**：editor.js:64-74（addChild 不检查祖先折叠链；layout 只对未折叠子树布局）。
- **复现（实测，verify.js [2]，map/right/left/org 四结构均复现）**：选中含子节点的分支 → Space 折叠 → Tab：画面无任何变化、行内编辑未启动（startEdit 因布局中无该节点而静默返回，editor.js:201），但节点已写入文档并成为当前选中项；连按 Tab 会持续产生隐形节点（仅撤销/展开后可见）。
- **影响**：用户认为 Tab 失效；后续 Enter/Delete 实际作用于隐形节点，操作与所见不一致，属功能错误。
- **修复方向**：addChild/addSibling 前沿父链清除 collapsed（展开动作与新增合并进同一次 pushHistory），或检测到折叠父级时 toast 提示先展开。

### P1-3 本轮新增的按键守卫是死代码：`key` 在赋值前被使用
- **位置**：editor.js:287（`if((key === ' ' || key === 'Enter') && … ) return;`）在 editor.js:289（`var key = e.key;`）之前；`var` 提升使 guard 处 `key === undefined`，条件恒 false。
- **影响**：意图修复的「焦点在按钮/链接上时 Space/Enter 交给原生激活」未生效：点击工具栏按钮后焦点留在按钮上，再按 Enter/Space 仍会触发画布操作（如 addSibling、toggleCollapse），与按钮原生激活叠加成双重动作。
- **修复方向**：把 `var ctrl = …; var key = e.key;` 两行上移到 guard 之前，或 guard 内改用 `e.key`。

## 3. 值得考虑（P2 × 2）

- **拖拽放入折叠节点会藏进隐藏子树**（editor.js:424 `mode='child'` 对折叠目标同样成立、finishDrag editor.js:441-463）。复现：把节点拖到折叠节点中部松手 → 移入其隐藏 children，拖拽物视觉消失且不可展开察觉。建议：目标折叠时只允许 before/after，或移入后自动展开目标（pushHistory 已能覆盖该展开）。
- **ctx 菜单 document 级 pointerdown 监听器累积泄漏**（app.js:73-75 每次 showMenu 都新增，closeMenus app.js:127 只移除最新一次注册的 `_menuClose`）。触发路径：连续打开两个下拉菜单（点文件→再点编辑），或右键菜单→节点颜色→「‹ 返回菜单」——旧监听器永久残留，此后每次文档级 pointerdown 都执行 DOM 查询。建议 showMenu 开头先 `if(this._menuClose) document.removeEventListener(…)` 再注册，或 init 时只绑一次常驻监听。

## 4. 仅记录

- model.js:152-157 `maxDepth` 从未被调用，且函数内第一段 `walk` 为空跑死代码。
- io.js:411 非法 .json 文本不会报「无法识别」，而是退化为 Markdown/缩进解析，导入一棵乱码树。
- index.html:79-80 两个 CDN 脚本无 `integrity`（SRI）；全站无 CSP（与 P1-1 修复互补）。
- 搜索高亮丢失：runSearch 给节点加 `.hit` 后，revealNode→relayout→drawNodes 重建节点层，高亮不复贴（app.js:365-382）。
- 触屏场景：第一指按在节点上（编辑器进入拖拽状态）+ 第二指捏合（render.js bindCanvas 进入缩放），两套 pointer 状态互不感知，可同时拖拽+缩放；静态推断，未实测。
- 导出交互网页：初始折叠态下折叠按钮/子树坐标按全展开布局计算（io.js exportSVGParts），观感不对应但功能可用。

## 5. 审阅范围与未覆盖

**按任务五个角度核对，以下方面确认无问题（附依据）**：
- 边界条件：根折叠不崩溃（layout.js:127 `expanded(root)` 守卫，tests 回归覆盖）；深树坐标有限——tests 覆盖 17 层，verify.js 实测 40 层四结构全有限；空树/超长文本换行（themes.js maxW 220/300，wrapText 逐字断行）；地图结构左右分配、org 层高计算均由 tests 几何不变量覆盖（不重叠、父子方位、bounds 包含、连线数）。
- 事件时序与竞态：导入替换文档/文档管理切换前清 `editingId/inputEl`（app.js:278/293，本轮新增，封住了旧输入框 blur 把脏文本写进新文档的路径）；编辑中 Ctrl+Z 走 contenteditable 原生撤销，不污染历史；blur 与 pointerdown 双路径 commit 幂等（editingId 先置空）。
- 内存泄漏：svgToCanvas 成功/失败两分支均 revokeObjectURL（io.js）；util.download 4s 后 revoke；toast/模态定时器自清理；util.bus 监听仅在 init 注册一次。遗留问题只有 §3 的菜单监听器一条。
- XSS 与转义：用户文本进入 innerHTML/SVG 的主路径均经 util.esc（覆盖 & < > " '）：render.js:77/84（节点行/备注 title）、app.js renderItems（菜单 label/kbd）、io.js（SVG tspan/title、OPML/FreeMind 属性、交互 HTML 标题均 esc）；粘贴树经 pasteTree 重建新 id（verify.js [5] 实测无环）。遗留注入面即 P1-1 的 id/style.bg。
- 撤销重做语义：快照式、栈顶即当前态、redo 栈正确截断（editor.js:24-45）；合并已收敛为「仅同节点文本编辑且 1.2s 内」（本轮修复）；replaceDoc/loadCurrent 后 resetHistory；历史 120 条上限带 shift 时 ptr 重算正确。
- 其他实核：model.move 守卫（根/自身/自身后代/失败回滚，tests 覆盖）；缩放 clamp 0.1–3、fit 0.1–1.2、docCoords 无除零、捏合 d=0 保护；storage 坏数据容错、写满仅警告、删除当前文档后兜底新建；`node mindsketch/tests/run.js` 45/45。

**未覆盖及原因**：
- 真实浏览器交互无法静态验证：pointer capture 对 click/dblclick 目标的重定向（编辑器在 pointerdown 即对 wrap setPointerCapture）、触屏双指手势、IME 在 contenteditable 中的组合输入。建议浏览器手工回归这三点。
- XMind(.xmind/zip) 导入依赖浏览器端 JSZip，仅静态审查了解析逻辑，未构造样例文件实测。
- css/style.css 为纯样式，超出本次「逻辑 bug」范围未审。
- 建议父 agent 复跑：`node mindsketch/tests/run.js`；修复 P1-1 后用 report §2 的恶意 JSON 样例做一次导入回归。
