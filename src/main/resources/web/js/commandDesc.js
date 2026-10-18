/**
 * Chinese descriptions for terminal autocomplete entries.
 *
 * The description text is owned by the ZenithProxy core jar, so it always
 * arrives in English and cannot be localized server-side. Keying the table by
 * command name (which the core does guarantee) sidesteps that: English mode
 * shows the core's own description verbatim, Chinese mode substitutes this
 * table and falls back to the core text for anything unmapped.
 */

const ZH_DESCRIPTIONS = {
    'help': '显示可用命令列表',
    'connect': '连接到服务器',
    'disconnect': '断开与服务器的连接',
    'reconnect': '重新连接服务器',
    'cancel': '取消当前操作',
    'auth': '查看或设置认证账户',
    'whitelist': '管理白名单',
    'friend': '管理好友',
    'ignore': '管理忽略名单',
    'kick': '踢出玩家',
    'server': '服务器相关设置',
    'server switch': '切换目标服务器',
    'transfer': '将玩家转移到另一服务器',
    'status': '查看代理运行状态',
    'debug': '调试与诊断选项',
    'plugins': '管理已加载的插件',
    'update': '检查并安装更新',
    'webui': '控制 WebUI 服务器',

    'autoReconnect': '断线后自动重连',
    'autoDisconnect': '空闲后自动断开',
    'autoReply': '自动回复私聊消息',
    'autoRespawn': '死亡后自动重生',
    'autoEat': '饥饿时自动进食',
    'autoFish': '自动钓鱼',
    'autoMend': '自动修复装备',
    'autoTotem': '自动使用图腾',
    'autoDrop': '自动丢弃无用物品',
    'autoArmor': '自动穿戴装备',
    'autoOmen': '自动使用不祥预兆',

    'antiAFK': '反挂机检测',
    'antiKick': '反踢出保护',
    'antiLeak': '反信息泄露',

    'chatRelay': '聊天转发设置',
    'chatHistory': '聊天历史记录',
    'extraChat': '额外聊天模块',
    'chatSchema': '聊天消息格式',
    'chatColor': '聊天颜色设置',
    'chatFormat': '聊天格式模板',

    'commandConfig': '命令执行设置',
    'database': '数据库设置',
    'theme': '主题外观设置',

    'inventory': '查看背包',
    'click': '模拟点击',
    'respawn': '执行重生',
    'killAura': '自动攻击设置',
    'raycast': '射线检测',

    'pathfinder': '寻路设置',
    'tasks': '任务队列',
    'waypoints': '路径点管理',

    'map': '显示网络地图',
    'displayCoords': '显示坐标',
    'coordinateObfuscation': '坐标混淆',

    'queueStatus': '查看队列状态',
    'queueWarning': '队列等待提醒',
    'prio': '队列优先级',
    'activeHours': '在线时段设置',

    'connectionTest': '测试连接',
    'clientConnection': '客户端连接设置',
    'serverConnection': '服务器连接设置',

    'packetLog': '数据包日志',
    'schematic': '建筑蓝图工具',
    'replay': '回放录制',

    'stats': '查看统计信息',
    'playtime': '游戏时长统计',
    'sessionTimeLimit': '单次时长限制',
    'seen': '查看上线记录',

    'skin': '皮肤管理',
    'tablist': '玩家列表显示',
    'spectator': '旁观模式设置',
    'spook': 'Spook 模式',
    'stalk': '跟踪玩家',
    'spawnPatrol': '出生点巡逻',
    'visualRange': '可见距离设置',

    'spammer': '刷屏功能',
    'sendMessage': '发送消息',
    'rateLimiter': '发送频率限制',

    'tickRate': '刻速率设置',
    'releaseChannel': '更新发布通道',
    'viaVersion': 'Via 版本设置',

    'multi': '多账号相关设置',
    'terminal': '终端设置',
    'shutdown': '关闭代理',

    'jvmArgs': 'JVM 参数设置',
    'unsupported': '查看不支持的功能',

    'modulePriority': '模块优先级',
    'actionLimiter': '动作频率限制',

    'discordManage': '管理 Discord 集成',
    'discordNotifications': 'Discord 通知设置',

    'license': '查看许可证状态',
};

/**
 * Returns the Chinese description for a command, or null when the command
 * has no mapping (caller then falls back to the core's English text).
 */
export function zhCommandDescription(name) {
    if (!name) return null;
    return ZH_DESCRIPTIONS[name] || ZH_DESCRIPTIONS[name.toLowerCase()] || null;
}