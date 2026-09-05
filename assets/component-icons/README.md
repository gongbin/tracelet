# Tracelet Component Icons

42 个元器件分类，每类提供 linear（线性）和 solid-45（45° 方位立体面性）两版，共 84 枚 SVG。

- `preview.html`：可离线打开的深浅主题预览，支持中英文搜索和逐个下载。
- `manifest.json`：分类名称、分组和文件路径映射。
- `linear/`：64 × 64 viewBox，2 单位圆端点描边，建议显示 24–32 px。
- `solid-45/`：统一斜轴投影和厚度，使用单色透明度表示顶面、侧面和引脚，建议显示 32–48 px。

## 使用

所有图标都是矢量，无字体、位图或外部资源依赖。内联 SVG 时通过 CSS `color` 设置颜色。使用 `<img>` 加载时，外部 CSS 的 color 不会传入 SVG；可用 CSS mask（线性版）或在构建时设置 SVG 的 color。预览页用 CSS filter 演示深浅配色。

立体版使用局部 mask。多个 SVG 内联到同一文档时，请为 `title`、`depth`、`face` 的 id 及引用添加实例唯一前缀；作为独立 img 文件使用时不冲突。

线性版适合列表和树形导航；面性版适合分类卡片。16 px 只用于预览极限尺寸，复杂类别建议不低于 24 px，并搭配文字标签。
