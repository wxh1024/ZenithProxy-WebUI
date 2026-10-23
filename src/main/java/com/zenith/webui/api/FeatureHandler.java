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
 * <p>The schema is declared declaratively as a list of {@link FeatureDef}s, each
 * binding an i18n label key to a dot-separated path into the CONFIG object.
 * Values are read and written reflectively so new fields only need a new
 * {@code FeatureDef} entry — no hand-written getter/setter boilerplate.
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

    /** A titled group of related features. */
    private record FeatureGroup(String id, String labelKey, List<FeatureDef> items) {
    }

    /** The complete, ordered feature schema. */
    private static final List<FeatureGroup> GROUPS = List.of(
            new FeatureGroup("combat", "feat.group.combat", List.of(
                    FeatureDef.bool("killAura.enabled", "feat.killAura.enabled"),
                    FeatureDef.bool("killAura.targetPlayers", "feat.killAura.targetPlayers"),
                    FeatureDef.bool("killAura.targetHostileMobs", "feat.killAura.targetHostileMobs"),
                    FeatureDef.bool("killAura.targetNeutralMobs", "feat.killAura.targetNeutralMobs"),
                    FeatureDef.bool("killAura.switchWeapon", "feat.killAura.switchWeapon"),
                    FeatureDef.integer("killAura.attackDelayTicks", "feat.killAura.attackDelayTicks", 1, 1000),
                    FeatureDef.enums("killAura.priority", "feat.killAura.priority", List.of("NONE", "NEAREST")),
                    FeatureDef.bool("autoTotem.enabled", "feat.autoTotem.enabled"),
                    FeatureDef.integer("autoTotem.healthThreshold", "feat.autoTotem.healthThreshold", 1, 20),
                    FeatureDef.bool("autoTotem.inGame", "feat.autoTotem.inGame"),
                    FeatureDef.bool("autoTotem.totemPopAlert", "feat.autoTotem.totemPopAlert"),
                    FeatureDef.bool("autoArmor.enabled", "feat.autoArmor.enabled"),
                    FeatureDef.bool("autoMend.enabled", "feat.autoMend.enabled")
            )),
            new FeatureGroup("survival", "feat.group.survival", List.of(
                    FeatureDef.bool("autoEat.enabled", "feat.autoEat.enabled"),
                    FeatureDef.integer("autoEat.healthThreshold", "feat.autoEat.healthThreshold", 1, 20),
                    FeatureDef.integer("autoEat.hungerThreshold", "feat.autoEat.hungerThreshold", 1, 20),
                    FeatureDef.bool("autoEat.allowUnsafeFood", "feat.autoEat.allowUnsafeFood"),
                    FeatureDef.bool("autoRespawn.enabled", "feat.autoRespawn.enabled"),
                    FeatureDef.integer("autoRespawn.delayMillis", "feat.autoRespawn.delayMillis", 0, 60000),
                    FeatureDef.bool("autoFish.enabled", "feat.autoFish.enabled"),
                    FeatureDef.bool("autoOmen.enabled", "feat.autoOmen.enabled"),
                    FeatureDef.bool("autoOmen.consumeFullOmenStack", "feat.autoOmen.consumeFullOmenStack")
            )),
            new FeatureGroup("movement", "feat.group.movement", List.of(
                    FeatureDef.bool("antiafk.enabled", "feat.antiafk.enabled"),
                    FeatureDef.bool("antiafk.actions.walk", "feat.antiafk.walk"),
                    FeatureDef.bool("antiafk.actions.swingHand", "feat.antiafk.swingHand"),
                    FeatureDef.bool("antiafk.actions.rotate", "feat.antiafk.rotate"),
                    FeatureDef.bool("antiafk.actions.jump", "feat.antiafk.jump"),
                    FeatureDef.bool("antiafk.actions.sneak", "feat.antiafk.sneak"),
                    FeatureDef.integer("antiafk.actions.walkDistance", "feat.antiafk.walkDistance", 1, 64),
                    FeatureDef.integer("antiafk.actions.walkDelayTicks", "feat.antiafk.walkDelayTicks", 1, 100000),
                    FeatureDef.integer("antiafk.actions.rotateDelayTicks", "feat.antiafk.rotateDelayTicks", 1, 100000),
                    FeatureDef.integer("antiafk.actions.swingDelayTicks", "feat.antiafk.swingDelayTicks", 1, 100000),
                    FeatureDef.bool("antiafk.actions.safeWalk", "feat.antiafk.safeWalk"),
                    FeatureDef.bool("spook.enabled", "feat.spook.enabled")
            )),
            new FeatureGroup("connection", "feat.group.connection", List.of(
                    FeatureDef.bool("autoReconnect.enabled", "feat.autoReconnect.enabled"),
                    FeatureDef.integer("autoReconnect.delaySeconds", "feat.autoReconnect.delaySeconds", 0, 3600),
                    FeatureDef.integer("autoReconnect.maxAttempts", "feat.autoReconnect.maxAttempts", 0, 100000),
                    FeatureDef.bool("utility.actions.autoDisconnect.enabled", "feat.autoDisconnect.enabled"),
                    FeatureDef.bool("utility.actions.autoDisconnect.healthDisconnect", "feat.autoDisconnect.healthDisconnect"),
                    FeatureDef.integer("utility.actions.autoDisconnect.health", "feat.autoDisconnect.health", 1, 20),
                    FeatureDef.bool("utility.actions.autoDisconnect.thunder", "feat.autoDisconnect.thunder")
            )),
            new FeatureGroup("chat", "feat.group.chat", List.of(
                    FeatureDef.bool("chat.enabled", "feat.chat.enabled"),
                    FeatureDef.bool("chat.hideChat", "feat.chat.hideChat"),
                    FeatureDef.bool("chat.hideWhispers", "feat.chat.hideWhispers"),
                    FeatureDef.bool("chat.hideDeathMessages", "feat.chat.hideDeathMessages"),
                    FeatureDef.bool("chat.showConnectionMessages", "feat.chat.showConnectionMessages"),
                    FeatureDef.bool("autoReply.enabled", "feat.autoReply.enabled"),
                    FeatureDef.integer("autoReply.cooldownSeconds", "feat.autoReply.cooldownSeconds", 0, 86400),
                    FeatureDef.text("autoReply.message", "feat.autoReply.message"),
                    FeatureDef.bool("spammer.enabled", "feat.spammer.enabled"),
                    FeatureDef.integer("spammer.delayTicks", "feat.spammer.delayTicks", 1, 100000)
            )),
            new FeatureGroup("alerts", "feat.group.alerts", List.of(
                    FeatureDef.bool("visualRange.enabled", "feat.visualRange.enabled"),
                    FeatureDef.bool("visualRange.enterAlert", "feat.visualRange.enterAlert"),
                    FeatureDef.bool("visualRange.leaveAlert", "feat.visualRange.leaveAlert"),
                    FeatureDef.bool("visualRange.logoutAlert", "feat.visualRange.logoutAlert"),
                    FeatureDef.bool("visualRange.enterWhisper", "feat.visualRange.enterWhisper"),
                    FeatureDef.text("visualRange.enterWhisperMessage", "feat.visualRange.enterWhisperMessage"),
                    FeatureDef.bool("queueWarning.enabled", "feat.queueWarning.enabled"),
                    FeatureDef.bool("antiLeak.enabled", "feat.antiLeak.enabled"),
                    FeatureDef.bool("antiLeak.rangeCheck", "feat.antiLeak.rangeCheck")
            ))
    );

    /** Loads the full grouped schema with current values. */
    public void handleFeatures(ChannelHandlerContext ctx) {
        JsonObject root = new JsonObject();
        JsonArray groups = new JsonArray();
        for (FeatureGroup group : GROUPS) {
            JsonObject g = new JsonObject();
            g.addProperty("id", group.id());
            g.addProperty("labelKey", group.labelKey());
            JsonArray items = new JsonArray();
            for (FeatureDef def : group.items()) {
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
                items.add(it);
            }
            g.add("items", items);
            groups.add(g);
        }
        root.add("groups", groups);
        HttpHelper.sendJson(ctx, root);
    }

    /** Accepts a flat map of path → value and applies each, then re-returns the schema. */
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
            Map<String, FeatureDef> byPath = new LinkedHashMap<>();
            for (FeatureGroup group : GROUPS) {
                for (FeatureDef def : group.items()) {
                    byPath.put(def.path(), def);
                }
            }

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
     */
    private static final Object EXTRA_ROOT = CONFIG.client.extra;

    /** Resolves {@code "a.b.c"} against CONFIG.client.extra, returning the leaf value or null. */
    private static Object readPath(String path) {
        try {
            Object current = EXTRA_ROOT;
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
        Object target = EXTRA_ROOT;
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
            return raw.getAsInt();
        }
        if (type == long.class || type == Long.class) {
            return raw.getAsLong();
        }
        if (type == float.class || type == Float.class) {
            return raw.getAsFloat();
        }
        if (type == double.class || type == Double.class) {
            return raw.getAsDouble();
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

    private static Field field(Object target, String name) throws NoSuchFieldException {
        Field f = target.getClass().getField(name);
        f.setAccessible(true);
        return f;
    }

    /** Convenience for method-not-allowed and other plain responses (unused now). */
    public static void sendMethodNotAllowed(ChannelHandlerContext ctx) {
        HttpHelper.sendError(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, "Method Not Allowed");
    }
}
