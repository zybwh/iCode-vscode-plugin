# Third-party software notices

The universal VSIX bundles the following components into its webview. Their
licenses remain applicable independently of the extension's Apache-2.0 license.

| Component | Version | License used | Complete notice |
| --- | --- | --- | --- |
| [Marked](https://github.com/markedjs/marked) | 15.0.12 | MIT; includes the upstream Markdown notice | [Marked license](licenses/marked-LICENSE.txt) |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.5 | Apache-2.0 (selected from Apache-2.0 OR MPL-2.0) | [DOMPurify license](licenses/dompurify-LICENSE.txt) |

DOMPurify copyright: Cure53 and other contributors. Its embedded attribution is
retained in the bundle. Marked's complete upstream license file is retained,
including the MarkedJS, Christopher Jeffrey and John Gruber notices.

`licenses/components.json` records exact versions and license-file hashes.
Packaging checks the lockfile and build dependency inventories against this list.
When changing bundled dependencies, update these notices and license files.

Platform VSIX packages additionally carry iCode and its dependencies. Their
upstream LICENSE and NOTICE must accompany the runtime; these frontend notices
do not replace them. Prepared runtimes retain their full dependency license tree.

## 中文说明

通用 VSIX 的 webview 包含 Marked 和 DOMPurify。Marked 的完整许可文件包含
MarkedJS、Christopher Jeffrey 和 John Gruber 的声明，随包保留。DOMPurify
采用其双许可证选项中的 Apache-2.0，原始代码署名和许可文本一并保留。

平台包还包含 iCode 及其依赖，必须保留后端自己的 LICENSE、NOTICE 和依赖
许可目录。本文件仅覆盖前端内置依赖，不能替代后端声明。

## Terminal diagram renderer / 字符图渲染器

The webview also bundles beautiful-mermaid's ASCII/Unicode renderer (MIT), with its complete [license](licenses/beautiful-mermaid-LICENSE.txt). The SVG/ELK renderer is excluded from the build. The upstream ASCII engine credits Alexander Grooff's mermaid-ascii; see https://github.com/lukilabs/beautiful-mermaid for source and attribution.

webview 还包含 beautiful-mermaid 的 ASCII/Unicode 字符图渲染器（MIT），完整许可随包保留。构建不包含 SVG/ELK 引擎；上游字符图引擎注明基于 Alexander Grooff 的 mermaid-ascii。
