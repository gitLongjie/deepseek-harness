# Agent Note: 桌面端 userData 目录使用 ASCII 可执行文件 id

Status: implemented

[English](2026-09-18-desktop-userdata-ascii-id.md) | 中文

## 问题

桌面壳调用 `app.setName(<本地化显示名>)` 来设定窗口和任务栏身份,而 Electron 用同一个名字推导默认的 `%APPDATA%` userData 目录——于是 OEM 版把会话、设置和 desktop.log 放在了本地化目录(`%APPDATA%\民大工作台`)下。用户和支持脚本按产品的文件系统 id 在 `%APPDATA%` 里找目录,插件加载问题排查的第一轮就因为这个错位浪费了时间。

## 决策

`main` 在 `setName` 之后显式把 userData 路径固定为 ASCII 可执行文件 id(`%APPDATA%\MindaWork`);显示名继续只负责窗口标题、托盘和 AppUserModelId。smoke 的 `DSH_PACKAGED_SMOKE_USER_DATA` 覆盖仍然后到并生效,其隔离不变。

## 已考虑的替代方案

**只用 `setName` 改名(放弃那里的本地化名)。** 否决:该名字还进入通知和托盘身份等希望使用显示名的路径;把磁盘 id 与显示名分离让两者各自正确。

**改读打包 `package.json` 的 `name` 字段而不是字面量。** 暂时否决:OEM 构建就是这个字面量的属主,字面量与其他 OEM id 一样可直接检索;经由打包元数据的间接会让磁盘布局依赖打包字段顺序。

## 后果

运行过早期安装包的机器,其既有状态留在旧本地化目录,并在 `MindaWork` 下从零开始——发布前接受每台机器一次性重置本地会话与设置。单实例锁以 userData 为作用域,过渡期内新旧版本实例可以并存。

## 验证

`apps/desktop/src/main/index.ts` 在单实例锁与任何日志写入之前设置路径,smoke 覆盖在其后应用;打包运行的桌面日志落在 `%APPDATA%\MindaWork\desktop.log`。
