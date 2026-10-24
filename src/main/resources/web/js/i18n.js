/**
 * i18n — translation core.
 *
 * Resolution order for the active language:
 *   1. `?lang=` query parameter (highest priority, shareable links)
 *   2. `localStorage.webui_lang` (the in-app switcher's choice)
 *   3. `defaultLanguage` from `GET /api/i18n` (config.json `language`)
 *   4. `navigator.languages` (browser auto-detection)
 *   5. `zh` fallback
 *
 * All UI strings live in TRANSLATIONS below. HTML is bound through
 * `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` attributes,
 * so `applyTranslations()` re-renders the whole page on language change.
 */

const STORAGE_KEY = 'webui_lang';

/** Runtime state, populated by `init()`. */
let currentLang = 'zh';
let serverDefault = 'auto';
/** English -> Chinese log phrase table fetched from the server. */
let logPhrases = {};
let logPhraseKeys = [];
let logPattern = null;
let bootstrapped = false;

export const TRANSLATIONS = {
    zh: {
        'app.title': 'ZenithProxy WebUI',
        'app.plugin': 'ZenithProxy WebUI 插件',

        'nav.dashboard': '仪表板',
        'nav.map': '地图',
        'nav.terminal': '终端日志',
        'nav.players': '白名单管理',
        'nav.features': '功能配置',
        'nav.basic': '基础配置',
        'nav.logout': '登出',
        'nav.language': '语言',

        'page.dashboard.title': '状态监控仪表板',
        'page.terminal.title': '终端日志',
        'page.players.title': '白名单管理',
        'page.features.title': '功能配置',
        'page.basic.title': '基础配置',

        'action.connect': '连接',
        'action.disconnect': '断开',
        'action.reconnect': '重连',
        'action.shutdown': '关闭',
        'action.export': '导出',
        'action.clear': '清空',
        'action.save': '保存',
        'action.add': '添加',
        'action.remove': '移除',

        'title.connect': '连接到服务器',
        'title.disconnect': '断开与服务器的连接',
        'title.reconnect': '重新连接服务器',
        'title.shutdown': '关闭代理',

        'card.proxyStatus': '代理状态',
        'card.botAccount': '机器人账号',
        'card.proxyAddress': '代理地址',
        'card.uptime': '运行时间',
        'card.players': '玩家连接',
        'card.queue': '队列',
        'card.health': '血量 / 饱食度',
        'card.version': 'Minecraft 版本',

        'chart.cpu': 'CPU 占用',
        'chart.memory': '内存占用',
        'chart.network': '网络流量',
        'chart.latency': '延迟波动',
        'chart.cpu.label': 'CPU',
        'chart.memory.label': '内存',
        'chart.network.in': '入站',
        'chart.network.out': '出站',
        'chart.latency.bot': '机器人→服务器',
        'chart.latency.player': '玩家→机器人',

        'status.connected': '已连接',
        'status.disconnected': '未连接',
        'status.noConnection': '无连接',

        'queue.loading': '正在加载...',
        'queue.position': '队列位置: {n}',
        'queue.online': '在线人数: {n}',
        'queue.entered': '已进入',

        'uptime.h': '{h}时 {m}分 {s}秒',
        'uptime.d': '{d}天 {h}时 {m}分',

        // Map page
        'page.map.title': '地图与寻路',
        'map.title': 'Map',
        'map.offline': '机器人未连接，地图暂无数据',
        'map.bot': '机器人坐标',
        'map.facing': '朝向',
        'map.target': '目标坐标',
        'map.distance': '直线距离',
        'map.remaining': '路径剩余',
        'map.state': '寻路状态',
        'map.stop': '停止寻路',
        'map.blocks': '{n} 格',
        'map.goto': '正在寻路到 {x}, {z}',
        'map.warn.unloaded': '目标区块尚未加载，寻路可能失败',
        'map.status.idle': '空闲',
        'map.status.calculating': '计算路径中',
        'map.status.pathing': '寻路中',
        'map.status.arrived': '已到达',
        'map.status.failed': '寻路失败',
        'map.status.offline': '未连接',
        'map.err.offline': '机器人未连接，无法寻路',
        'map.err.dead': '机器人已死亡，无法寻路',
        'map.err.range': '目标坐标超出世界边界',
        'map.err.badRequest': '请求参数有误',
        'map.err.failed': '寻路请求失败',
        'map.zoomIn': '放大',
        'map.zoomOut': '缩小',
        'map.recenter': '回到机器人',

        'term.welcome': 'Welcome to ZenithProxy Terminal',
        'term.lastLogin': '上次登录:',
        'term.hint': "输入 'help' 查看可用命令 | Tab: 补全 | ↑/↓: 历史 | Ctrl+L: 清空",
        'term.placeholder': '输入命令...',
        'term.counts': '命令: {c} · 日志: {l}',
        'term.export.title': 'ZenithProxy 终端导出',
        'term.export.history': '命令历史',
        'term.export.end': '结束',
        'term.exported': '已导出',
        'term.requestFailed': '请求失败',

        'wl.enable': '启用白名单',
        'wl.autoAdd': '自动添加机器人账户',
        'wl.kickmsg': '踢出消息',
        'wl.addPlaceholder': '输入玩家名称',
        'wl.empty': '白名单为空',
        'wl.enabled': '白名单已启用',
        'wl.disabled': '白名单已禁用',
        'wl.added': '已添加 {name}',
        'wl.removed': '已移除 {name}',
        'wl.addFailed': '添加失败: {err}',
        'wl.removeFailed': '移除失败: {err}',
        'wl.saved': '配置已保存',

        'feat.hint': '改动即时保存并生效',
        'feat.saved': '配置已保存',
        'feat.saveFailed': '保存失败: {err}',
        'feat.on': '已启用',
        'feat.off': '已关闭',
        'feat.filter.all': '全部',
        'feat.group.combat': '战斗',
        'feat.group.survival': '生存',
        'feat.group.movement': '移动 / 防挂机',
        'feat.group.connection': '连接',
        'feat.group.chat': '聊天',
        'feat.group.alerts': '告警',
        'feat.group.protection': '防护',
        'feat.group.misc': '其他',
        'feat.group.automation': '自动化',

        'feat.killAura.title': '杀戮光环',
        'feat.killAura.enabled': '启用杀戮光环 (KillAura)',
        'feat.killAura.targetPlayers': '攻击玩家',
        'feat.killAura.targetHostileMobs': '攻击敌对生物',
        'feat.killAura.targetNeutralMobs': '攻击中立生物',
        'feat.killAura.onlyNeutralAggressive': '仅攻击有敌意的中立生物',
        'feat.killAura.ignoreNamedMobs': '忽略已命名生物',
        'feat.killAura.switchWeapon': '自动切换武器',
        'feat.killAura.attackDelayTicks': '攻击间隔 (tick)',
        'feat.killAura.tpsSync': '按服务器 TPS 同步攻速',
        'feat.killAura.raycast': '射线检测 (视线判定)',
        'feat.killAura.priority': '目标优先级',
        'feat.autoTotem.title': '自动图腾',
        'feat.autoTotem.enabled': '自动装备不死图腾',
        'feat.autoTotem.healthThreshold': '装备血量阈值',
        'feat.autoTotem.inGame': '玩家在线时也生效',
        'feat.autoTotem.totemPopAlert': '图腾触发告警',
        'feat.autoTotem.totemPopAlertMention': '图腾告警 @提及',
        'feat.autoTotem.noTotemsAlert': '图腾耗尽告警',
        'feat.autoTotem.noTotemsAlertMention': '图腾耗尽 @提及',
        'feat.autoArmor.title': '自动穿装备',
        'feat.autoArmor.enabled': '自动穿装备',
        'feat.autoMend.title': '自动修复',
        'feat.autoMend.enabled': '自动修复装备 (经验修补)',
        'feat.autoEat.title': '自动进食',
        'feat.autoEat.enabled': '自动进食',
        'feat.autoEat.healthThreshold': '血量阈值',
        'feat.autoEat.hungerThreshold': '饥饿阈值',
        'feat.autoEat.allowUnsafeFood': '允许不安全食物',
        'feat.autoEat.warning': '食物耗尽告警',
        'feat.autoEat.warningMention': '食物耗尽 @提及',
        'feat.autoEat.mode': '食物选择模式',
        'feat.autoRespawn.title': '自动重生',
        'feat.autoRespawn.enabled': '自动重生',
        'feat.autoRespawn.delayMillis': '重生延迟 (毫秒)',
        'feat.autoFish.title': '自动钓鱼',
        'feat.autoFish.enabled': '自动钓鱼',
        'feat.autoFish.yaw': '抛竿偏航角 (yaw)',
        'feat.autoFish.pitch': '抛竿俯仰角 (pitch)',
        'feat.autoOmen.title': '自动不祥之兆',
        'feat.autoOmen.enabled': '自动饮用不祥之兆药水',
        'feat.autoOmen.consumeFullOmenStack': '饮尽整组药水',
        'feat.autoOmen.mode': '触发模式',
        'feat.autoOmen.constantTicks': '固定间隔 (tick)',
        'feat.autoDrop.title': '自动丢弃',
        'feat.autoDrop.enabled': '自动丢弃物品',
        'feat.autoDrop.mode': '丢弃模式',
        'feat.autoDrop.delayTicks': '丢弃间隔 (tick)',
        'feat.autoDrop.dropStack': '丢弃整组',
        'feat.antiKick.title': '防踢',
        'feat.antiKick.enabled': '启用防踢',
        'feat.antiKick.playerInactivityKickMins': '玩家闲置踢出 (分钟)',
        'feat.antiKick.minWalkDistance': '最小走动距离',
        'feat.antiafk.title': '防挂机',
        'feat.antiafk.enabled': '启用防挂机 (AntiAFK)',
        'feat.antiafk.walk': '走动',
        'feat.antiafk.swingHand': '挥手',
        'feat.antiafk.rotate': '转动视角',
        'feat.antiafk.jump': '跳跃',
        'feat.antiafk.jumpOnlyInLiquid': '仅在水中跳跃',
        'feat.antiafk.sneak': '潜行',
        'feat.antiafk.walkDistance': '走动距离',
        'feat.antiafk.walkDelayTicks': '走动间隔 (tick)',
        'feat.antiafk.rotateDelayTicks': '转视角间隔 (tick)',
        'feat.antiafk.swingDelayTicks': '挥手间隔 (tick)',
        'feat.antiafk.safeWalk': '安全走动 (不坠崖)',
        'feat.spook.title': '注视玩家',
        'feat.spook.enabled': '注视玩家 (Spook)',
        'feat.spook.targetingMode': '目标选择模式',
        'feat.stalk.title': '跟踪玩家',
        'feat.stalk.enabled': '跟踪玩家 (Stalk)',
        'feat.click.title': '自动点击',
        'feat.click.holdLeftClick': '持续左键',
        'feat.click.holdRightClick': '持续右键',
        'feat.click.holdSneak': '点击时潜行',
        'feat.click.holdRightClickInterval': '右键点击间隔 (tick)',
        'feat.click.holdLeftClickInterval': '左键点击间隔 (tick)',
        'feat.autoReconnect.title': '自动重连',
        'feat.autoReconnect.enabled': '自动重连',
        'feat.autoReconnect.delaySeconds': '重连延迟 (秒)',
        'feat.autoReconnect.maxAttempts': '最大重连次数',
        'feat.autoDisconnect.title': '自动断开',
        'feat.autoDisconnect.enabled': '自动断开',
        'feat.autoDisconnect.healthDisconnect': '低血量断开',
        'feat.autoDisconnect.health': '断开血量阈值',
        'feat.autoDisconnect.thunder': '雷暴时断开',
        'feat.autoDisconnect.onTotemPop': '图腾触发时断开',
        'feat.autoDisconnect.minTotemsRemaining': '最少图腾余量',
        'feat.autoDisconnect.onUnknownPlayerInVisualRange': '视野出现陌生玩家断开',
        'feat.autoDisconnect.whilePlayerConnected': '玩家在线时断开',
        'feat.autoDisconnect.autoClientDisconnect': '玩家断开时同步断开',
        'feat.autoDisconnect.cancelAutoReconnect': '取消自动重连',
        'feat.activeHours.title': '活跃时段',
        'feat.activeHours.enabled': '启用活跃时段',
        'feat.activeHours.forceReconnect': '强制重连',
        'feat.activeHours.queueEtaCalc': '队列 ETA 计算',
        'feat.activeHours.fullSessionUntilNextDisconnect': '整段会话直到断开',
        'feat.sessionTimeLimit.title': '会话时长限制',
        'feat.sessionTimeLimit.enabled': '启用会话时长限制',
        'feat.sessionTimeLimit.dynamic2b2tSessionTimeLimit': '2b2t 动态时长',
        'feat.chat.title': '聊天',
        'feat.chat.enabled': '启用聊天',
        'feat.chat.hideChat': '隐藏聊天消息',
        'feat.chat.hideWhispers': '隐藏私聊',
        'feat.chat.hideDeathMessages': '隐藏死亡消息',
        'feat.chat.showConnectionMessages': '显示连接消息',
        'feat.chat.insertClickableLinks': '插入可点击链接',
        'feat.chat.prefixChats': '聊天前缀',
        'feat.chat.prefix': '前缀内容',
        'feat.chat.suffixChats': '聊天后缀',
        'feat.chat.suffix': '后缀内容',
        'feat.autoReply.title': '自动回复',
        'feat.autoReply.enabled': '自动回复私聊',
        'feat.autoReply.cooldownSeconds': '回复冷却 (秒)',
        'feat.autoReply.message': '回复内容',
        'feat.spammer.title': '刷屏器',
        'feat.spammer.enabled': '刷屏器 (Spammer)',
        'feat.spammer.whisper': '私聊刷屏',
        'feat.spammer.whilePlayerConnected': '玩家在线时刷屏',
        'feat.spammer.delayTicks': '刷屏间隔 (tick)',
        'feat.spammer.randomOrder': '随机顺序',
        'feat.spammer.appendRandom': '追加随机字符',
        'feat.visualRange.title': '视野检测',
        'feat.visualRange.enabled': '视野范围检测',
        'feat.visualRange.ignoreFriends': '忽略好友',
        'feat.visualRange.enterAlert': '玩家进入告警',
        'feat.visualRange.enterAlertMention': '进入告警 @提及',
        'feat.visualRange.leaveAlert': '玩家离开告警',
        'feat.visualRange.logoutAlert': '玩家下线告警',
        'feat.visualRange.enterWhisper': '对进入者发送私聊',
        'feat.visualRange.enterWhisperMessage': '私聊内容',
        'feat.visualRange.enterWhisperCooldownSeconds': '私聊冷却 (秒)',
        'feat.queueWarning.title': '队列提醒',
        'feat.queueWarning.enabled': '队列位置提醒',
        'feat.antiLeak.title': '防坐标泄露',
        'feat.antiLeak.enabled': '防坐标泄露',
        'feat.antiLeak.rangeCheck': '坐标范围检测',
        'feat.antiLeak.rangeFactor': '范围系数',
        'feat.actionLimiter.title': '操作限制',
        'feat.actionLimiter.enabled': '启用操作限制',
        'feat.actionLimiter.allowRespawn': '允许重生',
        'feat.actionLimiter.allowMovement': '允许移动',
        'feat.actionLimiter.movementDistance': '移动距离上限',
        'feat.actionLimiter.allowEnderChest': '允许末影箱',
        'feat.actionLimiter.allowBlockBreaking': '允许破坏方块',
        'feat.actionLimiter.allowInventory': '允许物品栏操作',
        'feat.actionLimiter.allowUseItem': '允许使用物品',
        'feat.actionLimiter.allowChat': '允许聊天',
        'feat.actionLimiter.allowServerCommands': '允许服务器命令',
        'feat.coordObfuscation.title': '坐标混淆',
        'feat.coordObfuscation.enabled': '启用坐标混淆',
        'feat.coordObfuscation.validateSetup': '校验设置',
        'feat.coordObfuscation.mode': '混淆模式',
        'feat.replayMod.title': '录像 (ReplayMod)',
        'feat.replayMod.sendRecordingsToDiscord': '上传录像到 Discord',
        'feat.replayMod.maxRecordingTimeMins': '最大录像时长 (分钟)',
        'feat.replayMod.autoRecordMode': '自动录像模式',
        'feat.replayMod.replayRecordingHealthThreshold': '录像血量阈值',
        'feat.replayMod.fileIOUploadIfTooLarge': '过大时走文件上传',

        'feat.click.hasRotation': '锁定视角朝向',
        'feat.click.additionalBlockReach': '额外方块交互距离',
        'feat.click.additionalEntityReach': '额外实体交互距离',
        'feat.click.holdRightClickMode': '右键使用模式',

        'feat.pathfinder.title': '寻路',
        'feat.pathfinder.allowBreak': '允许破坏方块',
        'feat.pathfinder.allowPlace': '允许放置方块',
        'feat.pathfinder.allowSprint': '允许疾跑',
        'feat.pathfinder.allowInventory': '允许物品栏操作',
        'feat.pathfinder.allowDownward': '允许向下移动',
        'feat.pathfinder.allowParkour': '允许跑酷',
        'feat.pathfinder.allowLongFall': '允许长距离下落',
        'feat.pathfinder.autoTool': '自动切换工具',
        'feat.pathfinder.itemSaver': '节省工具耐久',
        'feat.pathfinder.itemSaverThreshold': '节省耐久阈值',
        'feat.pathfinder.preferSilkTouch': '优先精准采集',
        'feat.pathfinder.renderPath': '渲染路径',
        'feat.pathfinder.followRadius': '跟随半径',
        'feat.pathfinder.maxFallHeightNoWater': '无水最大下落高度',

        'feat.spawnPatrol.title': '出生点巡逻',
        'feat.spawnPatrol.enabled': '启用出生点巡逻',
        'feat.spawnPatrol.ignoreFriends': '忽略好友',
        'feat.spawnPatrol.targetOnlyNakeds': '仅攻击无装备目标',
        'feat.spawnPatrol.targetAttackers': '攻击攻击者',
        'feat.spawnPatrol.stickyTargeting': '粘滞锁定目标',
        'feat.spawnPatrol.nether': '下界巡逻',
        'feat.spawnPatrol.stuckKill': '卡住时击杀',
        'feat.spawnPatrol.maxPatrolRange': '最大巡逻范围',

        'feat.pearlLoader.title': '珍珠加载器',
        'feat.pearlLoader.returnToStartPos': '返回起始位置',

        'feat.tasks.title': '任务系统',
        'feat.tasks.enabled': '启用任务系统',
        'feat.tasks.logCommandActionOutput': '记录命令动作输出',
        'feat.tasks.taskCommandExecutedNotification': '任务命令执行通知',

        'basic.group.server': '目标服务器',
        'basic.group.authentication': '账号认证',
        'basic.group.connection': '连接与心跳',
        'basic.group.proxy': '代理监听',
        'basic.server.address': '服务器地址',
        'basic.server.port': '服务器端口',
        'basic.auth.accountType': '登录方式',
        'basic.auth.username': '账号用户名',
        'basic.auth.offlineUUID': '离线 UUID',
        'basic.connection.autoConnect': '启动时自动连接',
        'basic.connection.pingInterval': '心跳间隔（秒）',
        'basic.connection.pingTimeoutMs': '心跳超时（毫秒）',
        'basic.connection.keepAliveMode': 'KeepAlive 模式',
        'basic.connection.keepAliveTimeoutMs': 'KeepAlive 超时（毫秒）',
        'basic.connection.timeoutSeconds': '连接超时（秒）',
        'basic.proxy.bindAddress': '代理监听地址',
        'basic.proxy.bindPort': '代理监听端口',

        'notify.connecting': '正在连接服务器...',
        'notify.connectFailed': '连接失败: {err}',
        'notify.disconnected': '已断开连接',
        'notify.disconnectFailed': '断开失败: {err}',
        'notify.reconnecting': '正在重连...',
        'notify.reconnectFailed': '重连失败: {err}',
        'notify.shuttingDown': '正在关闭...',
        'notify.shutdownFailed': '关闭失败: {err}',
        'notify.shutdownConfirm': '确定要关闭代理吗?',
        'notify.error': '错误',

        'login.title': 'ZenithProxy WebUI 登录',
        'login.subtitle': '请登录以继续',
        'login.username': '用户名',
        'login.password': '密码',
        'login.usernamePlaceholder': '请输入用户名',
        'login.passwordPlaceholder': '请输入密码',
        'login.submit': '登 录',
        'login.submitting': '登录中...',
        'login.failed': '登录失败',
        'login.networkError': '网络错误，请重试',
        'login.footer': 'ZenithProxy WebUI 插件',
    },

    en: {
        'app.title': 'ZenithProxy WebUI',
        'app.plugin': 'ZenithProxy WebUI Plugin',

        'nav.dashboard': 'Dashboard',
        'nav.map': 'Map',
        'nav.terminal': 'Terminal',
        'nav.players': 'Whitelist',
        'nav.features': 'Features',
        'nav.basic': 'Basic Config',
        'nav.logout': 'Log out',
        'nav.language': 'Language',

        'page.dashboard.title': 'Status Dashboard',
        'page.terminal.title': 'Terminal Logs',
        'page.players.title': 'Whitelist Management',
        'page.features.title': 'Feature Configuration',
        'page.basic.title': 'Basic Configuration',

        'action.connect': 'Connect',
        'action.disconnect': 'Disconnect',
        'action.reconnect': 'Reconnect',
        'action.shutdown': 'Shutdown',
        'action.export': 'Export',
        'action.clear': 'Clear',
        'action.save': 'Save',
        'action.add': 'Add',
        'action.remove': 'Remove',

        'title.connect': 'Connect to the server',
        'title.disconnect': 'Disconnect from the server',
        'title.reconnect': 'Reconnect to the server',
        'title.shutdown': 'Shut down the proxy',

        'card.proxyStatus': 'Proxy Status',
        'card.botAccount': 'Bot Account',
        'card.proxyAddress': 'Proxy Address',
        'card.uptime': 'Uptime',
        'card.players': 'Players',
        'card.queue': 'Queue',
        'card.health': 'Health / Food',
        'card.version': 'Minecraft Version',

        'chart.cpu': 'CPU Usage',
        'chart.memory': 'Memory Usage',
        'chart.network': 'Network Traffic',
        'chart.latency': 'Latency',
        'chart.cpu.label': 'CPU',
        'chart.memory.label': 'Mem',
        'chart.network.in': 'In',
        'chart.network.out': 'Out',
        'chart.latency.bot': 'Bot→Server',
        'chart.latency.player': 'Player→Bot',

        'status.connected': 'Connected',
        'status.disconnected': 'Disconnected',
        'status.noConnection': 'No connection',

        'queue.loading': 'Loading...',
        'queue.position': 'Queue position: {n}',
        'queue.online': 'Online: {n}',
        'queue.entered': 'In server',

        'uptime.h': '{h}h {m}m {s}s',
        'uptime.d': '{d}d {h}h {m}m',

        // Map page
        'page.map.title': 'Map & Pathing',
        'map.title': 'Map',
        'map.offline': 'Bot is not connected — no map data',
        'map.bot': 'Bot position',
        'map.facing': 'Facing',
        'map.target': 'Target',
        'map.distance': 'Distance',
        'map.remaining': 'Path left',
        'map.state': 'Pathing status',
        'map.stop': 'Stop pathing',
        'map.blocks': '{n} blocks',
        'map.goto': 'Pathing to {x}, {z}',
        'map.warn.unloaded': 'Target chunk is not loaded yet — pathing may fail',
        'map.status.idle': 'Idle',
        'map.status.calculating': 'Calculating path',
        'map.status.pathing': 'Pathing',
        'map.status.arrived': 'Arrived',
        'map.status.failed': 'Path failed',
        'map.status.offline': 'Disconnected',
        'map.err.offline': 'Bot is not connected — cannot path',
        'map.err.dead': 'Bot is dead — cannot path',
        'map.err.range': 'Target is outside the world border',
        'map.err.badRequest': 'Invalid request',
        'map.err.failed': 'Path request failed',
        'map.zoomIn': 'Zoom in',
        'map.zoomOut': 'Zoom out',
        'map.recenter': 'Centre on bot',

        'term.welcome': 'Welcome to ZenithProxy Terminal',
        'term.lastLogin': 'Last login:',
        'term.hint': "Type 'help' for available commands | Tab: autocomplete | Up/Down: history | Ctrl+L: clear",
        'term.placeholder': 'Type a command...',
        'term.counts': 'Commands: {c} · Logs: {l}',
        'term.export.title': 'ZenithProxy Terminal Export',
        'term.export.history': 'Command History',
        'term.export.end': 'End',
        'term.exported': 'Exported',
        'term.requestFailed': 'Request failed',

        'wl.enable': 'Enable whitelist',
        'wl.autoAdd': 'Auto-add bot account',
        'wl.kickmsg': 'Kick message',
        'wl.addPlaceholder': 'Player name',
        'wl.empty': 'Whitelist is empty',
        'wl.enabled': 'Whitelist enabled',
        'wl.disabled': 'Whitelist disabled',
        'wl.added': 'Added {name}',
        'wl.removed': 'Removed {name}',
        'wl.addFailed': 'Add failed: {err}',
        'wl.removeFailed': 'Remove failed: {err}',
        'wl.saved': 'Config saved',

        'feat.hint': 'Changes are saved and applied instantly',
        'feat.saved': 'Config saved',
        'feat.saveFailed': 'Save failed: {err}',
        'feat.on': 'ON',
        'feat.off': 'OFF',
        'feat.filter.all': 'All',
        'feat.group.combat': 'Combat',
        'feat.group.survival': 'Survival',
        'feat.group.movement': 'Movement / Anti-AFK',
        'feat.group.connection': 'Connection',
        'feat.group.chat': 'Chat',
        'feat.group.alerts': 'Alerts',
        'feat.group.protection': 'Protection',
        'feat.group.misc': 'Misc',
        'feat.group.automation': 'Automation',

        'feat.killAura.title': 'KillAura',
        'feat.killAura.enabled': 'Enable KillAura',
        'feat.killAura.targetPlayers': 'Target players',
        'feat.killAura.targetHostileMobs': 'Target hostile mobs',
        'feat.killAura.targetNeutralMobs': 'Target neutral mobs',
        'feat.killAura.onlyNeutralAggressive': 'Only aggressive neutrals',
        'feat.killAura.ignoreNamedMobs': 'Ignore named mobs',
        'feat.killAura.switchWeapon': 'Auto-switch weapon',
        'feat.killAura.attackDelayTicks': 'Attack delay (ticks)',
        'feat.killAura.tpsSync': 'Sync attack rate to TPS',
        'feat.killAura.raycast': 'Raycast (line-of-sight)',
        'feat.killAura.priority': 'Target priority',
        'feat.autoTotem.title': 'Auto Totem',
        'feat.autoTotem.enabled': 'Auto-equip totem',
        'feat.autoTotem.healthThreshold': 'Equip health threshold',
        'feat.autoTotem.inGame': 'Also while player connected',
        'feat.autoTotem.totemPopAlert': 'Totem pop alert',
        'feat.autoTotem.totemPopAlertMention': 'Totem pop mention',
        'feat.autoTotem.noTotemsAlert': 'No totems alert',
        'feat.autoTotem.noTotemsAlertMention': 'No totems mention',
        'feat.autoArmor.title': 'Auto Armor',
        'feat.autoArmor.enabled': 'Auto-equip armor',
        'feat.autoMend.title': 'Auto Mend',
        'feat.autoMend.enabled': 'Auto-mend (Mending)',
        'feat.autoEat.title': 'Auto Eat',
        'feat.autoEat.enabled': 'Auto-eat',
        'feat.autoEat.healthThreshold': 'Health threshold',
        'feat.autoEat.hungerThreshold': 'Hunger threshold',
        'feat.autoEat.allowUnsafeFood': 'Allow unsafe food',
        'feat.autoEat.warning': 'Out-of-food alert',
        'feat.autoEat.warningMention': 'Out-of-food mention',
        'feat.autoEat.mode': 'Food selection mode',
        'feat.autoRespawn.title': 'Auto Respawn',
        'feat.autoRespawn.enabled': 'Auto-respawn',
        'feat.autoRespawn.delayMillis': 'Respawn delay (ms)',
        'feat.autoFish.title': 'Auto Fish',
        'feat.autoFish.enabled': 'Auto-fish',
        'feat.autoFish.yaw': 'Cast yaw',
        'feat.autoFish.pitch': 'Cast pitch',
        'feat.autoOmen.title': 'Auto Omen',
        'feat.autoOmen.enabled': 'Auto-drink Bad Omen',
        'feat.autoOmen.consumeFullOmenStack': 'Consume full omen stack',
        'feat.autoOmen.mode': 'Trigger mode',
        'feat.autoOmen.constantTicks': 'Constant interval (ticks)',
        'feat.autoDrop.title': 'Auto Drop',
        'feat.autoDrop.enabled': 'Auto-drop items',
        'feat.autoDrop.mode': 'Drop mode',
        'feat.autoDrop.delayTicks': 'Drop delay (ticks)',
        'feat.autoDrop.dropStack': 'Drop full stack',
        'feat.antiKick.title': 'Anti Kick',
        'feat.antiKick.enabled': 'Enable anti-kick',
        'feat.antiKick.playerInactivityKickMins': 'Player inactivity kick (mins)',
        'feat.antiKick.minWalkDistance': 'Min walk distance',
        'feat.antiafk.title': 'Anti-AFK',
        'feat.antiafk.enabled': 'Enable Anti-AFK',
        'feat.antiafk.walk': 'Walk',
        'feat.antiafk.swingHand': 'Swing hand',
        'feat.antiafk.rotate': 'Rotate camera',
        'feat.antiafk.jump': 'Jump',
        'feat.antiafk.jumpOnlyInLiquid': 'Jump only in liquid',
        'feat.antiafk.sneak': 'Sneak',
        'feat.antiafk.walkDistance': 'Walk distance',
        'feat.antiafk.walkDelayTicks': 'Walk delay (ticks)',
        'feat.antiafk.rotateDelayTicks': 'Rotate delay (ticks)',
        'feat.antiafk.swingDelayTicks': 'Swing delay (ticks)',
        'feat.antiafk.safeWalk': 'Safe walk (avoid ledges)',
        'feat.spook.title': 'Spook',
        'feat.spook.enabled': 'Stare at players (Spook)',
        'feat.spook.targetingMode': 'Targeting mode',
        'feat.stalk.title': 'Stalk',
        'feat.stalk.enabled': 'Stalk players',
        'feat.click.title': 'Auto Click',
        'feat.click.holdLeftClick': 'Hold left click',
        'feat.click.holdRightClick': 'Hold right click',
        'feat.click.holdSneak': 'Sneak while clicking',
        'feat.click.holdRightClickInterval': 'Right click interval (ticks)',
        'feat.click.holdLeftClickInterval': 'Left click interval (ticks)',
        'feat.autoReconnect.title': 'Auto Reconnect',
        'feat.autoReconnect.enabled': 'Auto-reconnect',
        'feat.autoReconnect.delaySeconds': 'Reconnect delay (seconds)',
        'feat.autoReconnect.maxAttempts': 'Max reconnect attempts',
        'feat.autoDisconnect.title': 'Auto Disconnect',
        'feat.autoDisconnect.enabled': 'Auto-disconnect',
        'feat.autoDisconnect.healthDisconnect': 'Disconnect on low health',
        'feat.autoDisconnect.health': 'Disconnect health threshold',
        'feat.autoDisconnect.thunder': 'Disconnect on thunder',
        'feat.autoDisconnect.onTotemPop': 'Disconnect on totem pop',
        'feat.autoDisconnect.minTotemsRemaining': 'Min totems remaining',
        'feat.autoDisconnect.onUnknownPlayerInVisualRange': 'Disconnect on unknown player',
        'feat.autoDisconnect.whilePlayerConnected': 'Disconnect while player connected',
        'feat.autoDisconnect.autoClientDisconnect': 'Disconnect with client',
        'feat.autoDisconnect.cancelAutoReconnect': 'Cancel auto-reconnect',
        'feat.activeHours.title': 'Active Hours',
        'feat.activeHours.enabled': 'Enable active hours',
        'feat.activeHours.forceReconnect': 'Force reconnect',
        'feat.activeHours.queueEtaCalc': 'Queue ETA calculation',
        'feat.activeHours.fullSessionUntilNextDisconnect': 'Full session until disconnect',
        'feat.sessionTimeLimit.title': 'Session Time Limit',
        'feat.sessionTimeLimit.enabled': 'Enable session time limit',
        'feat.sessionTimeLimit.dynamic2b2tSessionTimeLimit': '2b2t dynamic time limit',
        'feat.chat.title': 'Chat',
        'feat.chat.enabled': 'Enable chat',
        'feat.chat.hideChat': 'Hide chat messages',
        'feat.chat.hideWhispers': 'Hide whispers',
        'feat.chat.hideDeathMessages': 'Hide death messages',
        'feat.chat.showConnectionMessages': 'Show connection messages',
        'feat.chat.insertClickableLinks': 'Insert clickable links',
        'feat.chat.prefixChats': 'Prefix chats',
        'feat.chat.prefix': 'Prefix text',
        'feat.chat.suffixChats': 'Suffix chats',
        'feat.chat.suffix': 'Suffix text',
        'feat.autoReply.title': 'Auto Reply',
        'feat.autoReply.enabled': 'Auto-reply to whispers',
        'feat.autoReply.cooldownSeconds': 'Reply cooldown (seconds)',
        'feat.autoReply.message': 'Reply message',
        'feat.spammer.title': 'Spammer',
        'feat.spammer.enabled': 'Spammer',
        'feat.spammer.whisper': 'Spam via whisper',
        'feat.spammer.whilePlayerConnected': 'Spam while player connected',
        'feat.spammer.delayTicks': 'Spam delay (ticks)',
        'feat.spammer.randomOrder': 'Random order',
        'feat.spammer.appendRandom': 'Append random chars',
        'feat.visualRange.title': 'Visual Range',
        'feat.visualRange.enabled': 'Visual range detection',
        'feat.visualRange.ignoreFriends': 'Ignore friends',
        'feat.visualRange.enterAlert': 'Player enter alert',
        'feat.visualRange.enterAlertMention': 'Enter alert mention',
        'feat.visualRange.leaveAlert': 'Player leave alert',
        'feat.visualRange.logoutAlert': 'Player logout alert',
        'feat.visualRange.enterWhisper': 'Whisper on enter',
        'feat.visualRange.enterWhisperMessage': 'Whisper message',
        'feat.visualRange.enterWhisperCooldownSeconds': 'Whisper cooldown (seconds)',
        'feat.queueWarning.title': 'Queue Warning',
        'feat.queueWarning.enabled': 'Queue position alerts',
        'feat.antiLeak.title': 'Anti Leak',
        'feat.antiLeak.enabled': 'Anti coordinate leak',
        'feat.antiLeak.rangeCheck': 'Coordinate range check',
        'feat.antiLeak.rangeFactor': 'Range factor',
        'feat.actionLimiter.title': 'Action Limiter',
        'feat.actionLimiter.enabled': 'Enable action limiter',
        'feat.actionLimiter.allowRespawn': 'Allow respawn',
        'feat.actionLimiter.allowMovement': 'Allow movement',
        'feat.actionLimiter.movementDistance': 'Movement distance limit',
        'feat.actionLimiter.allowEnderChest': 'Allow ender chest',
        'feat.actionLimiter.allowBlockBreaking': 'Allow block breaking',
        'feat.actionLimiter.allowInventory': 'Allow inventory',
        'feat.actionLimiter.allowUseItem': 'Allow item use',
        'feat.actionLimiter.allowChat': 'Allow chat',
        'feat.actionLimiter.allowServerCommands': 'Allow server commands',
        'feat.coordObfuscation.title': 'Coord Obfuscation',
        'feat.coordObfuscation.enabled': 'Enable coord obfuscation',
        'feat.coordObfuscation.validateSetup': 'Validate setup',
        'feat.coordObfuscation.mode': 'Obfuscation mode',
        'feat.replayMod.title': 'ReplayMod',
        'feat.replayMod.sendRecordingsToDiscord': 'Upload recordings to Discord',
        'feat.replayMod.maxRecordingTimeMins': 'Max recording time (mins)',
        'feat.replayMod.autoRecordMode': 'Auto record mode',
        'feat.replayMod.replayRecordingHealthThreshold': 'Recording health threshold',
        'feat.replayMod.fileIOUploadIfTooLarge': 'File upload if too large',

        'feat.click.hasRotation': 'Lock view rotation',
        'feat.click.additionalBlockReach': 'Extra block reach',
        'feat.click.additionalEntityReach': 'Extra entity reach',
        'feat.click.holdRightClickMode': 'Right click mode',

        'feat.pathfinder.title': 'Pathfinder',
        'feat.pathfinder.allowBreak': 'Allow breaking',
        'feat.pathfinder.allowPlace': 'Allow placing',
        'feat.pathfinder.allowSprint': 'Allow sprinting',
        'feat.pathfinder.allowInventory': 'Allow inventory',
        'feat.pathfinder.allowDownward': 'Allow downward movement',
        'feat.pathfinder.allowParkour': 'Allow parkour',
        'feat.pathfinder.allowLongFall': 'Allow long falls',
        'feat.pathfinder.autoTool': 'Auto-switch tool',
        'feat.pathfinder.itemSaver': 'Item saver',
        'feat.pathfinder.itemSaverThreshold': 'Item saver threshold',
        'feat.pathfinder.preferSilkTouch': 'Prefer silk touch',
        'feat.pathfinder.renderPath': 'Render path',
        'feat.pathfinder.followRadius': 'Follow radius',
        'feat.pathfinder.maxFallHeightNoWater': 'Max fall height (no water)',

        'feat.spawnPatrol.title': 'Spawn Patrol',
        'feat.spawnPatrol.enabled': 'Enable spawn patrol',
        'feat.spawnPatrol.ignoreFriends': 'Ignore friends',
        'feat.spawnPatrol.targetOnlyNakeds': 'Target only nakeds',
        'feat.spawnPatrol.targetAttackers': 'Target attackers',
        'feat.spawnPatrol.stickyTargeting': 'Sticky targeting',
        'feat.spawnPatrol.nether': 'Patrol nether',
        'feat.spawnPatrol.stuckKill': 'Kill when stuck',
        'feat.spawnPatrol.maxPatrolRange': 'Max patrol range',

        'feat.pearlLoader.title': 'Pearl Loader',
        'feat.pearlLoader.returnToStartPos': 'Return to start position',

        'feat.tasks.title': 'Tasks',
        'feat.tasks.enabled': 'Enable tasks',
        'feat.tasks.logCommandActionOutput': 'Log command action output',
        'feat.tasks.taskCommandExecutedNotification': 'Task executed notification',

        'basic.group.server': 'Target Server',
        'basic.group.authentication': 'Authentication',
        'basic.group.connection': 'Connection & Heartbeat',
        'basic.group.proxy': 'Proxy Listener',
        'basic.server.address': 'Server address',
        'basic.server.port': 'Server port',
        'basic.auth.accountType': 'Login method',
        'basic.auth.username': 'Account username',
        'basic.auth.offlineUUID': 'Offline UUID',
        'basic.connection.autoConnect': 'Auto-connect on start',
        'basic.connection.pingInterval': 'Heartbeat interval (seconds)',
        'basic.connection.pingTimeoutMs': 'Heartbeat timeout (ms)',
        'basic.connection.keepAliveMode': 'KeepAlive mode',
        'basic.connection.keepAliveTimeoutMs': 'KeepAlive timeout (ms)',
        'basic.connection.timeoutSeconds': 'Connection timeout (seconds)',
        'basic.proxy.bindAddress': 'Proxy bind address',
        'basic.proxy.bindPort': 'Proxy bind port',

        'notify.connecting': 'Connecting to server...',
        'notify.connectFailed': 'Connect failed: {err}',
        'notify.disconnected': 'Disconnected',
        'notify.disconnectFailed': 'Disconnect failed: {err}',
        'notify.reconnecting': 'Reconnecting...',
        'notify.reconnectFailed': 'Reconnect failed: {err}',
        'notify.shuttingDown': 'Shutting down...',
        'notify.shutdownFailed': 'Shutdown failed: {err}',
        'notify.shutdownConfirm': 'Are you sure you want to shut down the proxy?',
        'notify.error': 'Error',

        'login.title': 'ZenithProxy WebUI Login',
        'login.subtitle': 'Please sign in to continue',
        'login.username': 'Username',
        'login.password': 'Password',
        'login.usernamePlaceholder': 'Enter your username',
        'login.passwordPlaceholder': 'Enter your password',
        'login.submit': 'Sign In',
        'login.submitting': 'Signing in...',
        'login.failed': 'Sign-in failed',
        'login.networkError': 'Network error, please retry',
        'login.footer': 'ZenithProxy WebUI Plugin',
    },
};

const SUPPORTED = ['zh', 'en'];

/** Normalizes any BCP-47 tag to a supported language code. */
function normalizeTag(tag) {
    if (!tag) return null;
    const lower = String(tag).toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('en')) return 'en';
    return null;
}

/** First supported language among the browser's preferred tags. */
function detectBrowserLanguage() {
    const tags = navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
    for (const tag of tags) {
        const lang = normalizeTag(tag);
        if (lang) return lang;
    }
    return null;
}

function readQueryLang() {
    try {
        return normalizeTag(new URLSearchParams(window.location.search).get('lang'));
    } catch {
        return null;
    }
}

function readStoredLang() {
    try {
        return normalizeTag(localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

/**
 * Resolves the language and loads the server-side log phrase table.
 * Safe to call more than once; subsequent calls are no-ops.
 */
export async function init() {
    if (bootstrapped) return currentLang;
    bootstrapped = true;

    try {
        const res = await fetch('/api/i18n', {credentials: 'include'});
        if (res.ok) {
            const data = await res.json();
            serverDefault = data.defaultLanguage || 'auto';
            setLogPhrases(data.logPhrases || {});
        }
    } catch {
        // Offline or endpoint unavailable — fall back to a built-in mini table.
        setLogPhrases(FALLBACK_LOG_PHRASES);
    }

    currentLang =
        readQueryLang()
        || readStoredLang()
        || normalizeTag(serverDefault)
        || detectBrowserLanguage()
        || 'zh';

    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
    return currentLang;
}

/** Persists an explicit choice and re-renders the page. */
export function setLanguage(lang) {
    const normalized = normalizeTag(lang);
    if (!normalized) return;
    currentLang = normalized;
    try {
        localStorage.setItem(STORAGE_KEY, normalized);
    } catch { /* private mode — ignore */
    }
    document.documentElement.lang = normalized === 'zh' ? 'zh-CN' : 'en';
    applyTranslations();
    window.dispatchEvent(new CustomEvent('webui:languagechange', {detail: {lang: normalized}}));
}

export function getLanguage() {
    return currentLang;
}

export function isZh() {
    return currentLang === 'zh';
}

/** Translate `key`, substituting `{name}` placeholders from `params`. */
export function t(key, params) {
    const table = TRANSLATIONS[currentLang] || TRANSLATIONS.zh;
    let value = table[key];
    if (value === undefined) value = TRANSLATIONS.zh[key];
    if (value === undefined) return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (m, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m);
}

/** BCP-47 tag for Intl formatting in the active language. */
export function localeTag() {
    return currentLang === 'zh' ? 'zh-CN' : 'en-US';
}

/**
 * Walks the DOM and fills every `data-i18n*` bound element.
 * Elements keep their original text as the zh fallback, so a missing
 * key degrades to readable Chinese instead of an empty label.
 */
export function applyTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = t(el.dataset.i18nHtml);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    const docTitle = document.querySelector('title[data-i18n-doc]');
    if (docTitle) docTitle.textContent = t(docTitle.dataset.i18nDoc);
}

/** Formats an uptime in ms using the locale-aware compact form. */
export function formatUptime(ms) {
    const total = Math.floor(ms / 1000);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600) % 24;
    const d = Math.floor(total / 86400);
    return d > 0
        ? t('uptime.d', {d, h, m})
        : t('uptime.h', {h, m, s});
}

/**
 * Translates a raw English log line into the active language.
 * Chinese output uses the server-provided phrase table; English passes through.
 */
export function translateLog(message) {
    if (!message || currentLang !== 'zh') return message;
    if (!logPattern) return message;
    return message.replace(logPattern, m => lookupPhrase(m) || m);
}

/**
 * Case-insensitive phrase lookup.
 *
 * The table is written in Title Case ("Entering server") but real log lines
 * lowercase it mid-sentence ("Queue complete, entering server"). A
 * case-sensitive alternation silently misses those, leaving stray English
 * inside an otherwise translated line.
 */
function lookupPhrase(matched) {
    if (logPhrases[matched]) return logPhrases[matched];
    const lower = matched.toLowerCase();
    for (const key of logPhraseKeys) {
        if (key.toLowerCase() === lower) return logPhrases[key];
    }
    return null;
}

function setLogPhrases(table) {
    logPhrases = table || {};
    // Longest phrase first so "Disconnected from server" wins over "Disconnected".
    logPhraseKeys = Object.keys(logPhrases).sort((a, b) => b.length - a.length);
    if (!logPhraseKeys.length) {
        logPattern = null;
        return;
    }
    const escaped = logPhraseKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // The 'i' flag handles casing; lookupPhrase resolves the original casing.
    logPattern = new RegExp(escaped.join('|'), 'gi');
}

/** Minimal table used when `GET /api/i18n` is unreachable. */
const FALLBACK_LOG_PHRASES = {
    'Connecting to server': '正在连接服务器',
    'Connected to server': '已连接服务器',
    'Disconnected from server': '已从服务器断开',
    'Connection lost': '连接已丢失',
    Reconnecting: '正在重连',
    Reconnected: '已重连',
    'Login failed': '登录失败',
    'Queue started': '已进入队列',
    'Queue complete': '队列完成',
    'Queue position': '队列位置',
    'Left queue': '已离开队列',
    'Now online': '已上线',
    'Now offline': '已离线',
    'Bot started': '机器人已启动',
    'Bot stopped': '机器人已停止',
    'Bot crashed': '机器人已崩溃',
    'Kicked by server': '被服务器踢出',
    'Banned by server': '被服务器封禁',
    'Entered queue': '已进入队列',
    'Config saved': '配置已保存',
    'Config loaded': '配置已加载',
    Error: '错误',
    Warning: '警告',
};