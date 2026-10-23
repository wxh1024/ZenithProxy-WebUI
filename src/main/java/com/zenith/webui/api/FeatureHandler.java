package com.zenith.webui.api;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.zenith.webui.http.HttpHelper;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.util.CharsetUtil;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.zenith.Globals.CONFIG;

/**
 * Handles /api/features — grouped read/write of the bot's feature toggles and
 * parameters under {@code CONFIG.client.extra.*}.
 *
 * <p>The schema is declared declaratively and rendered as a two-level tree:
 * <em>groups</em> (broad categories like "Combat") contain <em>features</em>
 * (individual collapsible modules like "KillAura"), each of which owns a flat
 * list of {@link FeatureDef} fields. Every field binds an i18n label key to a
 * dot-separated path into the CONFIG object, read and written reflectively so
 * a new field only needs a new {@code FeatureDef} entry.
 *
 * <p>Persistence is delegated to ZenithProxy itself (it owns {@code CONFIG}
 * serialization), matching the existing whitelist handler.
 */
public class FeatureHandler {

    /**
     * A single editable field: a path into CONFIG plus a label key and, where
     * relevant, numeric bounds or enum options.
     */
    private record FeatureDef(String path, String type, String labelKey,
                              Double min, Double max, List<String> options) {
        static FeatureDef bool(String path, String labelKey) {
            return new FeatureDef(path, "boolean", labelKey, null, null, null);
        }

        static FeatureDef integer(String path, String labelKey, double min, double max) {
            return new FeatureDef(path, "int", labelKey, min, max, null);
        }

        static FeatureDef number(String path, String labelKey, double min, double max) {
            return new FeatureDef(path, "float", labelKey, min, max, null);
        }

        static FeatureDef text(String path, String labelKey) {
            return new FeatureDef(path, "string", labelKey, null, null, null);
        }

        static FeatureDef enums(String path, String labelKey, List<String> options) {
            return new FeatureDef(path, "enum", labelKey, null, null, options);
        }
    }

    /** A collapsible feature module: a title plus its toggle/parameter fields. */
    private record Feature(String id, String labelKey, List<FeatureDef> items) {
    }

    /** A broad category of related features. */
    private record FeatureGroup(String id, String labelKey, List<Feature> features) {
    }

    /** The complete, ordered feature schema (two-level: group → feature → field). */
    private static final List<FeatureGroup> GROUPS = List.of(
            new FeatureGroup("combat", "feat.group.combat", List.of(
                    new Feature("killAura", "feat.killAura.title", List.of(
                            FeatureDef.bool("killAura.enabled", "feat.killAura.enabled"),
                            FeatureDef.bool("killAura.targetPlayers", "feat.killAura.targetPlayers"),
                            FeatureDef.bool("killAura.targetHostileMobs", "feat.killAura.targetHostileMobs"),
                            FeatureDef.bool("killAura.targetNeutralMobs", "feat.killAura.targetNeutralMobs"),
                            FeatureDef.bool("killAura.onlyNeutralAggressive", "feat.killAura.onlyNeutralAggressive"),
                            FeatureDef.bool("killAura.ignoreNamedMobs", "feat.killAura.ignoreNamedMobs"),
                            FeatureDef.bool("killAura.switchWeapon", "feat.killAura.switchWeapon"),
                            FeatureDef.integer("killAura.attackDelayTicks", "feat.killAura.attackDelayTicks", 1, 1000),
                            FeatureDef.bool("killAura.tpsSync", "feat.killAura.tpsSync"),
                            FeatureDef.bool("killAura.raycast", "feat.killAura.raycast"),
                            FeatureDef.enums("killAura.priority", "feat.killAura.priority", List.of("NONE", "NEAREST"))
                    )),
                    new Feature("autoTotem", "feat.autoTotem.title", List.of(
                            FeatureDef.bool("autoTotem.enabled", "feat.autoTotem.enabled"),
                            FeatureDef.integer("autoTotem.healthThreshold", "feat.autoTotem.healthThreshold", 1, 20),
                            FeatureDef.bool("autoTotem.inGame", "feat.autoTotem.inGame"),
                            FeatureDef.bool("autoTotem.totemPopAlert", "feat.autoTotem.totemPopAlert"),
                            FeatureDef.bool("autoTotem.totemPopAlertMention", "feat.autoTotem.totemPopAlertMention"),
                            FeatureDef.bool("autoTotem.noTotemsAlert", "feat.autoTotem.noTotemsAlert"),
                            FeatureDef.bool("autoTotem.noTotemsAlertMention", "feat.autoTotem.noTotemsAlertMention")
                    )),
                    new Feature("autoArmor", "feat.autoArmor.title", List.of(
                            FeatureDef.bool("autoArmor.enabled", "feat.autoArmor.enabled")
                    )),
                    new Feature("autoMend", "feat.autoMend.title", List.of(
                            FeatureDef.bool("autoMend.enabled", "feat.autoMend.enabled")
                    ))
            )),
            new FeatureGroup("survival", "feat.group.survival", List.of(
                    new Feature("autoEat", "feat.autoEat.title", List.of(
                            FeatureDef.bool("autoEat.enabled", "feat.autoEat.enabled"),
                            FeatureDef.integer("autoEat.healthThreshold", "feat.autoEat.healthThreshold", 1, 20),
                            FeatureDef.integer("autoEat.hungerThreshold", "feat.autoEat.hungerThreshold", 1, 20),
                            FeatureDef.bool("autoEat.allowUnsafeFood", "feat.autoEat.allowUnsafeFood"),
                            FeatureDef.bool("autoEat.warning", "feat.autoEat.warning"),
                            FeatureDef.bool("autoEat.warningMention", "feat.autoEat.warningMention"),
                            FeatureDef.enums("autoEat.mode", "feat.autoEat.mode", List.of("ALL", "BLACKLIST", "WHITELIST"))
                    )),
                    new Feature("autoRespawn", "feat.autoRespawn.title", List.of(
                            FeatureDef.bool("autoRespawn.enabled", "feat.autoRespawn.enabled"),
                            FeatureDef.integer("autoRespawn.delayMillis", "feat.autoRespawn.delayMillis", 0, 60000)
                    )),
                    new Feature("autoFish", "feat.autoFish.title", List.of(
                            FeatureDef.bool("autoFish.enabled", "feat.autoFish.enabled"),
                            FeatureDef.number("autoFish.yaw", "feat.autoFish.yaw", -180, 180),
                            FeatureDef.number("autoFish.pitch", "feat.autoFish.pitch", -90, 90)
                    )),
                    new Feature("autoOmen", "feat.autoOmen.title", List.of(
                            FeatureDef.bool("autoOmen.enabled", "feat.autoOmen.enabled"),
                            FeatureDef.bool("autoOmen.consumeFullOmenStack", "feat.autoOmen.consumeFullOmenStack"),
                            FeatureDef.enums("autoOmen.mode", "feat.autoOmen.mode",
                                    List.of("EFFECT_AND_RAID_INACTIVE", "EFFECT_INACTIVE", "CONSTANT")),
                            FeatureDef.integer("autoOmen.constantTicks", "feat.autoOmen.constantTicks", 1, 100000)
                    )),
                    new Feature("autoDrop", "feat.autoDrop.title", List.of(
                            FeatureDef.bool("autoDrop.enabled", "feat.autoDrop.enabled"),
                            FeatureDef.enums("autoDrop.mode", "feat.autoDrop.mode", List.of("ALL", "BLACKLIST", "WHITELIST")),
                            FeatureDef.integer("autoDrop.delayTicks", "feat.autoDrop.delayTicks", 1, 100000),
                            FeatureDef.bool("autoDrop.dropStack", "feat.autoDrop.dropStack")
                    )),
                    new Feature("antiKick", "feat.antiKick.title", List.of(
                            FeatureDef.bool("antiKick.enabled", "feat.antiKick.enabled"),
                            FeatureDef.integer("antiKick.playerInactivityKickMins", "feat.antiKick.playerInactivityKickMins", 1, 1440),
                            FeatureDef.integer("antiKick.minWalkDistance", "feat.antiKick.minWalkDistance", 1, 100)
                    ))
            )),
            new FeatureGroup("movement", "feat.group.movement", List.of(
                    new Feature("antiafk", "feat.antiafk.title", List.of(
                            FeatureDef.bool("antiafk.enabled", "feat.antiafk.enabled"),
                            FeatureDef.bool("antiafk.actions.walk", "feat.antiafk.walk"),
                            FeatureDef.integer("antiafk.actions.walkDistance", "feat.antiafk.walkDistance", 1, 64),
                            FeatureDef.integer("antiafk.actions.walkDelayTicks", "feat.antiafk.walkDelayTicks", 1, 100000),
                            FeatureDef.bool("antiafk.actions.safeWalk", "feat.antiafk.safeWalk"),
                            FeatureDef.bool("antiafk.actions.swingHand", "feat.antiafk.swingHand"),
                            FeatureDef.integer("antiafk.actions.swingDelayTicks", "feat.antiafk.swingDelayTicks", 1, 100000),
                            FeatureDef.bool("antiafk.actions.rotate", "feat.antiafk.rotate"),
                            FeatureDef.integer("antiafk.actions.rotateDelayTicks", "feat.antiafk.rotateDelayTicks", 1, 100000),
                            FeatureDef.bool("antiafk.actions.jump", "feat.antiafk.jump"),
                            FeatureDef.bool("antiafk.actions.jumpOnlyInLiquid", "feat.antiafk.jumpOnlyInLiquid"),
                            FeatureDef.bool("antiafk.actions.sneak", "feat.antiafk.sneak")
                    )),
                    new Feature("spook", "feat.spook.title", List.of(
                            FeatureDef.bool("spook.enabled", "feat.spook.enabled"),
                            FeatureDef.enums("spook.spookTargetingMode", "feat.spook.targetingMode",
                                    List.of("NEAREST", "VISUAL_RANGE"))
                    )),
                    new Feature("stalk", "feat.stalk.title", List.of(
                            FeatureDef.bool("stalk.enabled", "feat.stalk.enabled")
                    )),
                    new Feature("click", "feat.click.title", List.of(
                            FeatureDef.bool("click.holdLeftClick", "feat.click.holdLeftClick"),
                            FeatureDef.bool("click.holdRightClick", "feat.click.holdRightClick"),
                            FeatureDef.bool("click.holdSneak", "feat.click.holdSneak"),
                            FeatureDef.bool("click.hasRotation", "feat.click.hasRotation"),
                            FeatureDef.integer("click.holdRightClickInterval", "feat.click.holdRightClickInterval", 1, 1000),
                            FeatureDef.integer("click.holdLeftClickInterval", "feat.click.holdLeftClickInterval", 0, 1000),
                            FeatureDef.number("click.additionalBlockReach", "feat.click.additionalBlockReach", 0, 10),
                            FeatureDef.number("click.additionalEntityReach", "feat.click.additionalEntityReach", 0, 10),
                            FeatureDef.enums("click.holdRightClickMode", "feat.click.holdRightClickMode",
                                    List.of("MAIN_HAND", "OFF_HAND", "ALTERNATE_HANDS"))
                    ))
            )),
            new FeatureGroup("connection", "feat.group.connection", List.of(
                    new Feature("autoReconnect", "feat.autoReconnect.title", List.of(
                            FeatureDef.bool("autoReconnect.enabled", "feat.autoReconnect.enabled"),
                            FeatureDef.integer("autoReconnect.delaySeconds", "feat.autoReconnect.delaySeconds", 0, 3600),
                            FeatureDef.integer("autoReconnect.maxAttempts", "feat.autoReconnect.maxAttempts", 0, 100000)
                    )),
                    new Feature("autoDisconnect", "feat.autoDisconnect.title", List.of(
                            FeatureDef.bool("utility.actions.autoDisconnect.enabled", "feat.autoDisconnect.enabled"),
                            FeatureDef.bool("utility.actions.autoDisconnect.healthDisconnect", "feat.autoDisconnect.healthDisconnect"),
                            FeatureDef.integer("utility.actions.autoDisconnect.health", "feat.autoDisconnect.health", 1, 20),
                            FeatureDef.bool("utility.actions.autoDisconnect.thunder", "feat.autoDisconnect.thunder"),
                            FeatureDef.bool("utility.actions.autoDisconnect.onTotemPop", "feat.autoDisconnect.onTotemPop"),
                            FeatureDef.integer("utility.actions.autoDisconnect.minTotemsRemaining", "feat.autoDisconnect.minTotemsRemaining", 0, 1000),
                            FeatureDef.bool("utility.actions.autoDisconnect.onUnknownPlayerInVisualRange", "feat.autoDisconnect.onUnknownPlayerInVisualRange"),
                            FeatureDef.bool("utility.actions.autoDisconnect.whilePlayerConnected", "feat.autoDisconnect.whilePlayerConnected"),
                            FeatureDef.bool("utility.actions.autoDisconnect.autoClientDisconnect", "feat.autoDisconnect.autoClientDisconnect"),
                            FeatureDef.bool("utility.actions.autoDisconnect.cancelAutoReconnect", "feat.autoDisconnect.cancelAutoReconnect")
                    )),
                    new Feature("activeHours", "feat.activeHours.title", List.of(
                            FeatureDef.bool("utility.actions.activeHours.enabled", "feat.activeHours.enabled"),
                            FeatureDef.bool("utility.actions.activeHours.forceReconnect", "feat.activeHours.forceReconnect"),
                            FeatureDef.bool("utility.actions.activeHours.queueEtaCalc", "feat.activeHours.queueEtaCalc"),
                            FeatureDef.bool("utility.actions.activeHours.fullSessionUntilNextDisconnect", "feat.activeHours.fullSessionUntilNextDisconnect")
                    )),
                    new Feature("sessionTimeLimit", "feat.sessionTimeLimit.title", List.of(
                            FeatureDef.bool("sessionTimeLimit.enabled", "feat.sessionTimeLimit.enabled"),
                            FeatureDef.bool("sessionTimeLimit.dynamic2b2tSessionTimeLimit", "feat.sessionTimeLimit.dynamic2b2tSessionTimeLimit")
                    ))
            )),
            new FeatureGroup("chat", "feat.group.chat", List.of(
                    new Feature("chat", "feat.chat.title", List.of(
                            FeatureDef.bool("chat.enabled", "feat.chat.enabled"),
                            FeatureDef.bool("chat.hideChat", "feat.chat.hideChat"),
                            FeatureDef.bool("chat.hideWhispers", "feat.chat.hideWhispers"),
                            FeatureDef.bool("chat.hideDeathMessages", "feat.chat.hideDeathMessages"),
                            FeatureDef.bool("chat.showConnectionMessages", "feat.chat.showConnectionMessages"),
                            FeatureDef.bool("chat.insertClickableLinks", "feat.chat.insertClickableLinks"),
                            FeatureDef.bool("chat.prefixChats", "feat.chat.prefixChats"),
                            FeatureDef.text("chat.prefix", "feat.chat.prefix"),
                            FeatureDef.bool("chat.suffixChats", "feat.chat.suffixChats"),
                            FeatureDef.text("chat.suffix", "feat.chat.suffix")
                    )),
                    new Feature("autoReply", "feat.autoReply.title", List.of(
                            FeatureDef.bool("autoReply.enabled", "feat.autoReply.enabled"),
                            FeatureDef.integer("autoReply.cooldownSeconds", "feat.autoReply.cooldownSeconds", 0, 86400),
                            FeatureDef.text("autoReply.message", "feat.autoReply.message")
                    )),
                    new Feature("spammer", "feat.spammer.title", List.of(
                            FeatureDef.bool("spammer.enabled", "feat.spammer.enabled"),
                            FeatureDef.bool("spammer.whisper", "feat.spammer.whisper"),
                            FeatureDef.bool("spammer.whilePlayerConnected", "feat.spammer.whilePlayerConnected"),
                            FeatureDef.integer("spammer.delayTicks", "feat.spammer.delayTicks", 1, 100000),
                            FeatureDef.bool("spammer.randomOrder", "feat.spammer.randomOrder"),
                            FeatureDef.bool("spammer.appendRandom", "feat.spammer.appendRandom")
                    ))
            )),
            new FeatureGroup("alerts", "feat.group.alerts", List.of(
                    new Feature("visualRange", "feat.visualRange.title", List.of(
                            FeatureDef.bool("visualRange.enabled", "feat.visualRange.enabled"),
                            FeatureDef.bool("visualRange.ignoreFriends", "feat.visualRange.ignoreFriends"),
                            FeatureDef.bool("visualRange.enterAlert", "feat.visualRange.enterAlert"),
                            FeatureDef.bool("visualRange.enterAlertMention", "feat.visualRange.enterAlertMention"),
                            FeatureDef.bool("visualRange.leaveAlert", "feat.visualRange.leaveAlert"),
                            FeatureDef.bool("visualRange.logoutAlert", "feat.visualRange.logoutAlert"),
                            FeatureDef.bool("visualRange.enterWhisper", "feat.visualRange.enterWhisper"),
                            FeatureDef.text("visualRange.enterWhisperMessage", "feat.visualRange.enterWhisperMessage"),
                            FeatureDef.integer("visualRange.enterWhisperCooldownSeconds", "feat.visualRange.enterWhisperCooldownSeconds", 0, 86400)
                    )),
                    new Feature("queueWarning", "feat.queueWarning.title", List.of(
                            FeatureDef.bool("queueWarning.enabled", "feat.queueWarning.enabled")
                    ))
            )),
            new FeatureGroup("protection", "feat.group.protection", List.of(
                    new Feature("antiLeak", "feat.antiLeak.title", List.of(
                            FeatureDef.bool("antiLeak.enabled", "feat.antiLeak.enabled"),
                            FeatureDef.bool("antiLeak.rangeCheck", "feat.antiLeak.rangeCheck"),
                            FeatureDef.number("antiLeak.rangeFactor", "feat.antiLeak.rangeFactor", 1, 1000)
                    )),
                    new Feature("actionLimiter", "feat.actionLimiter.title", List.of(
                            FeatureDef.bool("actionLimiter.enabled", "feat.actionLimiter.enabled"),
                            FeatureDef.bool("actionLimiter.allowRespawn", "feat.actionLimiter.allowRespawn"),
                            FeatureDef.bool("actionLimiter.allowMovement", "feat.actionLimiter.allowMovement"),
                            FeatureDef.integer("actionLimiter.movementDistance", "feat.actionLimiter.movementDistance", 1, 100000),
                            FeatureDef.bool("actionLimiter.allowEnderChest", "feat.actionLimiter.allowEnderChest"),
                            FeatureDef.bool("actionLimiter.allowBlockBreaking", "feat.actionLimiter.allowBlockBreaking"),
                            FeatureDef.bool("actionLimiter.allowInventory", "feat.actionLimiter.allowInventory"),
                            FeatureDef.bool("actionLimiter.allowUseItem", "feat.actionLimiter.allowUseItem"),
                            FeatureDef.bool("actionLimiter.allowChat", "feat.actionLimiter.allowChat"),
                            FeatureDef.bool("actionLimiter.allowServerCommands", "feat.actionLimiter.allowServerCommands")
                    )),
                    new Feature("coordObfuscation", "feat.coordObfuscation.title", List.of(
                            FeatureDef.bool("coordObfuscation.enabled", "feat.coordObfuscation.enabled"),
                            FeatureDef.bool("coordObfuscation.validateSetup", "feat.coordObfuscation.validateSetup"),
                            FeatureDef.enums("coordObfuscation.mode", "feat.coordObfuscation.mode",
                                    List.of("RANDOM_OFFSET", "CONSTANT_OFFSET", "AT_LOCATION"))
                    ))
            )),
            new FeatureGroup("automation", "feat.group.automation", List.of(
                    new Feature("pathfinder", "feat.pathfinder.title", List.of(
                            FeatureDef.bool("pathfinder.allowBreak", "feat.pathfinder.allowBreak"),
                            FeatureDef.bool("pathfinder.allowPlace", "feat.pathfinder.allowPlace"),
                            FeatureDef.bool("pathfinder.allowSprint", "feat.pathfinder.allowSprint"),
                            FeatureDef.bool("pathfinder.allowInventory", "feat.pathfinder.allowInventory"),
                            FeatureDef.bool("pathfinder.allowDownward", "feat.pathfinder.allowDownward"),
                            FeatureDef.bool("pathfinder.allowParkour", "feat.pathfinder.allowParkour"),
                            FeatureDef.bool("pathfinder.allowLongFall", "feat.pathfinder.allowLongFall"),
                            FeatureDef.bool("pathfinder.autoTool", "feat.pathfinder.autoTool"),
                            FeatureDef.bool("pathfinder.itemSaver", "feat.pathfinder.itemSaver"),
                            FeatureDef.integer("pathfinder.itemSaverThreshold", "feat.pathfinder.itemSaverThreshold", 1, 100),
                            FeatureDef.bool("pathfinder.preferSilkTouch", "feat.pathfinder.preferSilkTouch"),
                            FeatureDef.bool("pathfinder.renderPath", "feat.pathfinder.renderPath"),
                            FeatureDef.integer("pathfinder.followRadius", "feat.pathfinder.followRadius", 1, 100),
                            FeatureDef.integer("pathfinder.maxFallHeightNoWater", "feat.pathfinder.maxFallHeightNoWater", 1, 100)
                    )),
                    new Feature("spawnPatrol", "feat.spawnPatrol.title", List.of(
                            FeatureDef.bool("spawnPatrol.enabled", "feat.spawnPatrol.enabled"),
                            FeatureDef.bool("spawnPatrol.ignoreFriends", "feat.spawnPatrol.ignoreFriends"),
                            FeatureDef.bool("spawnPatrol.targetOnlyNakeds", "feat.spawnPatrol.targetOnlyNakeds"),
                            FeatureDef.bool("spawnPatrol.targetAttackers", "feat.spawnPatrol.targetAttackers"),
                            FeatureDef.bool("spawnPatrol.stickyTargeting", "feat.spawnPatrol.stickyTargeting"),
                            FeatureDef.bool("spawnPatrol.nether", "feat.spawnPatrol.nether"),
                            FeatureDef.bool("spawnPatrol.stuckKill", "feat.spawnPatrol.stuckKill"),
                            FeatureDef.integer("spawnPatrol.maxPatrolRange", "feat.spawnPatrol.maxPatrolRange", 10, 100000)
                    )),
                    new Feature("pearlLoader", "feat.pearlLoader.title", List.of(
                            FeatureDef.bool("pearlLoader.returnToStartPos", "feat.pearlLoader.returnToStartPos")
                    )),
                    new Feature("tasks", "feat.tasks.title", List.of(
                            FeatureDef.bool("tasks.enabled", "feat.tasks.enabled"),
                            FeatureDef.bool("tasks.logCommandActionOutput", "feat.tasks.logCommandActionOutput"),
                            FeatureDef.bool("tasks.taskCommandExecutedNotification", "feat.tasks.taskCommandExecutedNotification")
                    ))
            )),
            new FeatureGroup("misc", "feat.group.misc", List.of(
                    new Feature("replayMod", "feat.replayMod.title", List.of(
                            FeatureDef.bool("replayMod.sendRecordingsToDiscord", "feat.replayMod.sendRecordingsToDiscord"),
                            FeatureDef.integer("replayMod.maxRecordingTimeMins", "feat.replayMod.maxRecordingTimeMins", 0, 1440),
                            FeatureDef.enums("replayMod.autoRecordMode", "feat.replayMod.autoRecordMode",
                                    List.of("NONE", "PROXY_CONNECTED", "ONLINE", "PLAYER_CONNECTED", "HEALTH")),
                            FeatureDef.integer("replayMod.replayRecordingHealthThreshold", "feat.replayMod.replayRecordingHealthThreshold", 1, 20),
                            FeatureDef.bool("replayMod.fileIOUploadIfTooLarge", "feat.replayMod.fileIOUploadIfTooLarge")
                    ))
            ))
    );

    /** Flattens every declared field path for validation and serialization. */
    private static Map<String, FeatureDef> allFields() {
        Map<String, FeatureDef> byPath = new LinkedHashMap<>();
        for (FeatureGroup group : GROUPS) {
            for (Feature feature : group.features()) {
                for (FeatureDef def : feature.items()) {
                    byPath.put(def.path(), def);
                }
            }
        }
        return byPath;
    }

    /** Loads the full grouped schema with current values. */
    public void handleFeatures(ChannelHandlerContext ctx) {
        JsonObject root = new JsonObject();
        JsonArray groups = new JsonArray();
        for (FeatureGroup group : GROUPS) {
            JsonObject g = new JsonObject();
            g.addProperty("id", group.id());
            g.addProperty("labelKey", group.labelKey());
            JsonArray features = new JsonArray();
            for (Feature feature : group.features()) {
                JsonObject f = new JsonObject();
                f.addProperty("id", feature.id());
                f.addProperty("labelKey", feature.labelKey());
                JsonArray items = new JsonArray();
                for (FeatureDef def : feature.items()) {
                    items.add(serializeField(def));
                }
                f.add("items", items);
                features.add(f);
            }
            g.add("features", features);
            groups.add(g);
        }
        root.add("groups", groups);
        HttpHelper.sendJson(ctx, root);
    }

    /** Serializes one field definition plus its current value. */
    private JsonObject serializeField(FeatureDef def) {
        JsonObject it = new JsonObject();
        it.addProperty("key", def.path());
        it.addProperty("type", def.type());
        it.addProperty("labelKey", def.labelKey());
        if (def.min() != null) it.addProperty("min", def.min());
        if (def.max() != null) it.addProperty("max", def.max());
        if (def.options() != null) {
            JsonArray opts = new JsonArray();
            def.options().forEach(opts::add);
            it.add("options", opts);
        }
        // Current value — reflectively read, null → null.
        Object value = readPath(def.path());
        if (value == null) {
            it.add("value", null);
        } else if (value instanceof Number num) {
            it.addProperty("value", num);
        } else if (value instanceof Boolean b) {
            it.addProperty("value", b);
        } else if (value instanceof Enum<?> e) {
            it.addProperty("value", e.name());
        } else {
            it.addProperty("value", String.valueOf(value));
        }
        return it;
    }

    /** Accepts a flat map of path → value and applies each. */
    public void handleFeatureUpdate(ChannelHandlerContext ctx, FullHttpRequest req) {
        try {
            String body = req.content().toString(CharsetUtil.UTF_8);
            if (body == null || body.isEmpty()) {
                HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Empty request body"));
                return;
            }
            JsonObject json = HttpHelper.GSON.fromJson(body, JsonObject.class);
            JsonObject values = json != null ? json.getAsJsonObject("values") : null;
            if (values == null || values.size() == 0) {
                HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Missing values"));
                return;
            }

            // Validate against the declared schema first so no path can be written
            // that is not explicitly whitelisted.
            Map<String, FeatureDef> byPath = allFields();

            List<String> applied = new ArrayList<>();
            List<String> rejected = new ArrayList<>();
            for (Map.Entry<String, JsonElement> entry : values.entrySet()) {
                FeatureDef def = byPath.get(entry.getKey());
                if (def == null) {
                    rejected.add(entry.getKey());
                    continue;
                }
                try {
                    writePath(def, entry.getValue());
                    applied.add(entry.getKey());
                } catch (Exception e) {
                    rejected.add(entry.getKey());
                }
            }

            JsonObject result = new JsonObject();
            result.addProperty("success", true);
            result.addProperty("applied", applied.size());
            JsonArray appliedArr = new JsonArray();
            applied.forEach(appliedArr::add);
            result.add("appliedKeys", appliedArr);
            JsonArray rejectedArr = new JsonArray();
            rejected.forEach(rejectedArr::add);
            result.add("rejectedKeys", rejectedArr);
            HttpHelper.sendJson(ctx, result);
        } catch (Exception e) {
            HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Feature update failed"));
        }
    }

    // ── Reflective CONFIG access ─────────────────────────────────────────

    /**
     * Every feature path is relative to {@code CONFIG.client.extra} — the object
     * that holds all bot feature toggles and parameters.
     * <p>
     * Resolved per access instead of being cached in a {@code static final}: a
     * static field is bound at class-initialisation time, so any reload that swaps
     * {@code CONFIG.client.extra} would leave every read and write pointing at the
     * detached old instance — silently, because {@link #readPath} maps failures to
     * {@code null}.
     */
    private static Object extraRoot() {
        return CONFIG.client.extra;
    }

    /** Resolves {@code "a.b.c"} against CONFIG.client.extra, returning the leaf value or null. */
    private static Object readPath(String path) {
        try {
            Object current = extraRoot();
            for (String part : path.split("\\.")) {
                current = field(current, part).get(current);
                if (current == null) return null;
            }
            return current;
        } catch (Exception e) {
            return null;
        }
    }

    /** Writes a JSON value into the leaf field at {@code path}, coercing to the field type. */
    private static void writePath(FeatureDef def, JsonElement raw) throws Exception {
        Object target = extraRoot();
        String[] parts = def.path().split("\\.");
        for (int i = 0; i < parts.length - 1; i++) {
            Field f = field(target, parts[i]);
            Object next = f.get(target);
            if (next == null) throw new IllegalStateException("null intermediate: " + parts[i]);
            target = next;
        }
        Field leaf = field(target, parts[parts.length - 1]);
        leaf.set(target, coerce(def, leaf, raw));
    }

    private static Object coerce(FeatureDef def, Field leaf, JsonElement raw) {
        Class<?> type = leaf.getType();
        if (raw == null || raw.isJsonNull()) return null;
        if (type == boolean.class || type == Boolean.class) {
            return raw.getAsBoolean();
        }
        if (type == int.class || type == Integer.class) {
            return inRange(def, raw.getAsInt());
        }
        if (type == long.class || type == Long.class) {
            return inRange(def, raw.getAsLong());
        }
        if (type == float.class || type == Float.class) {
            return inRange(def, raw.getAsFloat());
        }
        if (type == double.class || type == Double.class) {
            return inRange(def, raw.getAsDouble());
        }
        if (type == String.class) {
            return raw.getAsString();
        }
        if (type.isEnum()) {
            String name = raw.getAsString();
            for (Object constant : type.getEnumConstants()) {
                if (((Enum<?>) constant).name().equals(name)) {
                    return constant;
                }
            }
            throw new IllegalArgumentException("unknown enum value: " + name + " for " + type.getName());
        }
        throw new IllegalArgumentException("unsupported field type: " + type.getName());
    }

    /**
     * Rejects numeric values outside the bounds declared in {@link FeatureDef}.
     * <p>
     * Those bounds were previously enforced only by the {@code min}/{@code max}
     * HTML attributes, which any direct POST bypasses — nothing stopped a request
     * from writing {@code attackDelayTicks = -1} or a value past the ceiling.
     *
     * @return the same value, so the call sites stay single expressions
     * @throws IllegalArgumentException when out of range; the caller records the
     *                                  path in {@code rejectedKeys}
     */
    private static <T extends Number> T inRange(FeatureDef def, T value) {
        if (def.min() != null && value.doubleValue() < def.min()) {
            throw new IllegalArgumentException(
                    def.path() + " below minimum " + def.min() + ": " + value);
        }
        if (def.max() != null && value.doubleValue() > def.max()) {
            throw new IllegalArgumentException(
                    def.path() + " above maximum " + def.max() + ": " + value);
        }
        return value;
    }

    private static Field field(Object target, String name) throws NoSuchFieldException {
        Field f = target.getClass().getField(name);
        f.setAccessible(true);
        return f;
    }

    /** Convenience for method-not-allowed and other plain responses. */
    public static void sendMethodNotAllowed(ChannelHandlerContext ctx) {
        HttpHelper.sendError(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, "Method Not Allowed");
    }
}
