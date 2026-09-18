# Agent Note: 新右栏停靠面打开时聚焦引导页 tab

Status: implemented

[English](2026-09-18-guide-focused-fresh-surface.md) | 中文

## Problem

声明式 tab 可见性阶段把每个 `default-on` 类型种入新停靠面之后，停靠面聚焦的是 `order` 最小的那个类型——在随包默认集合里就是任务观测 tab。栏的介绍页被压在一次点击之外，而一个类型的 `order`（座位选择）悄悄决定了用户最先看到什么。

## Decision

**`createSurface` 聚焦引导页 tab，而非第一个 default-on 类型。** 开 tab 的计划不再捕获第一个计划的 tab id；种入完成后，停靠面通过与 settle 路径相同的 `paneGuide` 查找聚焦本格的引导页。`order` 决定每个类型坐哪，不决定栏打开时显示什么——介绍页凭角色胜出，不凭排序位置。

仅当某格 settle 后不存在引导页时才没有引导页可聚焦；该分支维持原行为（完全不记焦点）。

## Alternatives considered

- 继续聚焦第一个 default-on 类型：否决——它把打开视图耦合到座位编号上，重排产品面板就会改变新会话第一眼看到的内容。
- 聚焦最新打开的 tab（`seed.tabs()` 的遍历顺序）：以更差的确定性否决，理由同上，且跨注册顺序不稳定。

## Consequences

- 新停靠面立即显示引导页的入口盒；default-on tab 种在旁边，只有被选中时才取得焦点。
- 焦点属于初始布局、不属于记录的历史条目，因此回退仍止步于会话诞生时的样子。
- store 规格、两份 README、lifecycle e2e 的引导页助手注释都陈述新行为。
- 随包默认可见集合（任务观测、智能体派生）的座位不受影响；只有打开视图变化。
