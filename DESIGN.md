---
name: PanleMEI
description: 以线路照片为中心的个人攀岩记录工具
colors:
  primary: "#2c5946"
  primary-dark: "#204332"
  background: "#f7f8f5"
  surface: "#ffffff"
  ink: "#243c33"
  muted: "#68746c"
  line: "#e0e5de"
  sidebar: "#eef1e9"
  selected: "#dce6d7"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
rounded:
  control: "8px"
  photo: "12px"
  dialog: "16px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
---

# PanleMEI 设计系统

## Overview

本次实现采用安静的攀岩手记风格，照片是线路的主体。绿色代表主要操作与通关状态，文字同时表达状态，不单靠颜色区分。此为实现记录，并非用户确认的长期品牌约束。

## Colors

浅灰绿色页面与侧栏，深绿色正文和主按钮。橙褐色只用于必要提示及岩点插画。线路图片保留自己的颜色。

## Typography

中文系统字体，界面文字保持清晰。标题 32px、手机 25px；正文 14px，辅助文字 12px。统计数字使用等宽数字特性。

## Layout

桌面侧栏 244px，内容左右留白 48px；1150px 以下侧栏 215px、留白 30px。760px 以下切换为顶部可横向滚动的岩馆导航、20px 内容留白、两列照片。桌面通常三列，1500px 以上四列。

## Elevation & Depth

常规区域依靠边线与背景区分。仅对话框及操作反馈使用柔和阴影。

## Shapes

控件 8px 圆角，照片 12px 圆角，对话框 16px 圆角。照片默认 4:5 裁切，详情保留完整图片。

## Components

主要操作使用绿色按钮。通关按钮带勾选图标、状态文本和 aria-pressed。导入表单支持逐图编辑，键盘焦点由原生 dialog 管理。空状态说明如何添加第一条线路，无匹配结果提供清除筛选。

### PanleMEI 品牌标识

品牌名固定拼写为 **PanleMEI**。标识由手工编写的 SVG 路径构成：P 形攀爬环线包围向上的线路，终点以强调色圆点标记；右侧为定制混合大小写字标，MEI 笔画稍重，不依赖字体文件。页面内联 SVG 使用 `currentColor` 继承森林／樱粉主题的正文色；终点通过 `--brand-accent: var(--orange)` 使用既有橙褐色，在两个主题中保持一致。锁定组合的 `viewBox` 为 `0 0 234 50`，桌面宽 184px，760px 及以下宽 174px，保持比例；下方保留「把每一次向上，留下来。」。

可复用矢量资产为 `public/brand/panlemei-logo.svg`（森林组合）、`public/brand/panlemei-logo-pink.svg`（樱粉组合）、`public/brand/panlemei-mark.svg`（独立图标）；浏览器图标位于 `public/favicon.svg`。独立文件固定对应配色；樱粉导出文件的终点采用樱粉主操作色，页面内联标识则保留上述橙褐色终点。源资产均为手工编写 SVG，本次品牌交付不包含栅格图像。

## Do's and Don'ts

- 保留用户照片本身；缩略图允许裁切，详情必须完整显示。
- 岩馆、难度和通关状态在照片列表中可直接查看。
- 未提供用户数据时使用真实空状态，不填充虚构的攀爬统计。
- 保留可见键盘焦点及减少动画偏好支持。

## 可选樱粉主题

右上角「森林 / 樱粉」切换主题，按浏览器保存在 localStorage，首次绘制前恢复，并同步同源其他标签页。樱粉使用 #fff7f9 页面、#f8e7ee 侧栏、#a33665 主操作、#4c2939 正文及 #805967 辅助文字。上传、详情、空状态和焦点一起切换；用户照片保持原色，成功及错误保留语义色。首次访问默认樱粉主题；保留用户主动选择的森林主题，未能读取本机偏好时也使用樱粉。

## 视频上传

沿用添加线路窗口，选择压缩档位后选择文件；进度可取消，预览展示实际文件大小和原速时长。默认更省空间（480p / 24fps），照片与视频按同一线路卡片布局，视频显示封面和时长标记。详情使用原生 video 控件，不自动播放，关闭时停止播放。森林与樱粉主题均适用。

### 标题下的账号区（2026-10-27）

登录入口、当前账号和同步状态集中在主内容标题下方，刷新云端、导入本机记录和退出账号位于同一区域。移动端自动换行，长邮箱省略显示并通过按钮提示保留完整内容。岩馆侧栏保留搜索和已有名录，移除补全名录按钮及来源入口；默认名录加载逻辑不变。

### 按需播放云端视频

腾讯云线路列表只呈现保存的封面和时长。未加载的视频详情显示封面、明确的「播放视频」按钮和「点击后边加载边播放」说明，知道大小时同时标出体积；不会因查看备注而读取视频。播放或下载触发加载状态和可重试错误提示；成功后使用已有原生视频控件。无封面时显示「攀爬视频」占位。手机和电脑沿用现有详情布局。

云端播放使用原生控件和按位置读取，播放状态提示边加载边播放、缓冲或可重试错误；关闭详情停止后续读取。快速压缩视频使用索引按片段播放，下载与备份仍保存完整原文件。

### 手机端与快速压缩（2026-10-28）

手机端保留樱粉／森林主题，岩馆搜索、横向列表和备份入口收在「选择岩馆」展开区；账号继续位于线路标题下方。详情和上传表单采用单列，长岩馆名称不再与难度挤在同一行。输入文字为 16px，主要触控区域至少 44px；详情关闭按钮滚动时保持可见，预览封面最高 24dvh。上传的详细画质说明使用可展开的「画质与上传限制」。桌面布局保留。

腾讯云版默认快速压缩，继续优先硬件编码 H.264，最高 1080p / 30fps，视频目标码率由 5 Mbps 改为最高 3 Mbps；低分辨率和低帧率按比例减少码率，不放大原视频。声音保留 AAC 128kbps，原速、暂停／继续／取消和 1GB / 20 分钟输入限制保持。以上配置只作用于之后新处理的视频，不重新压缩云端已有文件。实际输出大小、编码器选择和处理速度取决于浏览器、设备与素材。
