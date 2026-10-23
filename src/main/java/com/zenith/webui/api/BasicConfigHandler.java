package com.zenith.webui.api;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.zenith.webui.http.HttpHelper;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.util.CharsetUtil;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.zenith.Globals.CONFIG;

/**
 * Handles {@code /api/basic} — the bot's core connection settings, kept fully
 * separate from the feature toggles handled by {@link FeatureHandler}.
 *
 * <p>Where {@code FeatureHandler} anchors every path under
 * {@code CONFIG.client.extra.*}, this handler anchors under the CONFIG root
 * itself. That is the whole point: connection fundamentals (target server,
 * authentication account, heartbeat, proxy bind port) live at the top level of
 * the config, not inside {@code client.extra}. Paths are therefore full
 * dot-separated paths from CONFIG, e.g. {@code client.server.address} or
 * {@code server.bind.port}.
 *
 * <p>The schema is declarative ({@link BasicDef}), so adding a field only needs
 * a new entry. Reads and writes are reflective and coercion honours the real
 * field type (int / long / String / enum), mirroring {@code FeatureHandler}.
 *
 * <p>Persistence is delegated to ZenithProxy, which owns CONFIG serialization.
 */
public class BasicConfigHandler {

    /** A single editable connection field: full CONFIG path + label + bounds/options. */
    private record BasicDef(String path, String type, String labelKey,
                            Double min, Double max, List<String> options) {
        static BasicDef bool(String path, String labelKey) {
            return new BasicDef(path, "boolean", labelKey, null, null, null);
        }

        static BasicDef integer(String path, String labelKey, double min, double max) {
            return new BasicDef(path, "int", labelKey, min, max, null);
        }

        static BasicDef text(String path, String labelKey) {
            return new BasicDef(path, "string", labelKey, null, null, null);
        }

        static BasicDef enums(String path, String labelKey, List<String> options) {
            return new BasicDef(path, "enum", labelKey, null, null, options);
        }
    }

    /** A labelled, collapsible group of related connection settings. */
    private record BasicGroup(String id, String labelKey, List<BasicDef> items) {
    }

    /** The complete connection-config schema, grouped by concern. */
    private static final List<BasicGroup> GROUPS = List.of(
            new BasicGroup("server", "basic.group.server", List.of(
                    BasicDef.text("client.server.address", "basic.server.address"),
                    BasicDef.integer("client.server.port", "basic.server.port", 1, 65535)
            )),
            new BasicGroup("authentication", "basic.group.authentication", List.of(
                    BasicDef.enums("authentication.accountType", "basic.auth.accountType",
                            List.of("MSA", "DEVICE_CODE", "DEVICE_CODE_WITHOUT_DEVICE_TOKEN", "PRISM", "OFFLINE")),
                    BasicDef.text("authentication.username", "basic.auth.username"),
                    BasicDef.text("authentication.offlineUUID", "basic.auth.offlineUUID")
            )),
            new BasicGroup("connection", "basic.group.connection", List.of(
                    BasicDef.bool("client.autoConnect", "basic.connection.autoConnect"),
                    BasicDef.integer("client.ping.pingIntervalSeconds", "basic.connection.pingInterval", 1, 3600),
                    BasicDef.integer("client.ping.pingQueueTimeoutMs", "basic.connection.pingTimeoutMs", 100, 60000),
                    BasicDef.enums("client.keepAliveHandling.keepAliveMode", "basic.connection.keepAliveMode",
                            List.of("PASSTHROUGH", "INDEPENDENT")),
                    BasicDef.integer("client.keepAliveHandling.keepAliveQueueTimeoutMs",
                            "basic.connection.keepAliveTimeoutMs", 100, 60000),
                    BasicDef.integer("client.timeout.seconds", "basic.connection.timeoutSeconds", 1, 3600)
            )),
            new BasicGroup("proxy", "basic.group.proxy", List.of(
                    BasicDef.text("server.bind.address", "basic.proxy.bindAddress"),
                    BasicDef.integer("server.bind.port", "basic.proxy.bindPort", 1, 65535)
            ))
    );

    /** Flattens every declared path for validation and serialization. */
    private static Map<String, BasicDef> allFields() {
        Map<String, BasicDef> byPath = new LinkedHashMap<>();
        for (BasicGroup group : GROUPS) {
            for (BasicDef def : group.items()) {
                byPath.put(def.path(), def);
            }
        }
        return byPath;
    }

    /** Loads the full grouped schema with current values. */
    public void handleBasicConfig(ChannelHandlerContext ctx) {
        JsonObject root = new JsonObject();
        JsonArray groups = new JsonArray();
        for (BasicGroup group : GROUPS) {
            JsonObject g = new JsonObject();
            g.addProperty("id", group.id());
            g.addProperty("labelKey", group.labelKey());
            JsonArray items = new JsonArray();
            for (BasicDef def : group.items()) {
                items.add(serializeField(def));
            }
            g.add("items", items);
            groups.add(g);
        }
        root.add("groups", groups);
        // GSON_NULLS: a field whose current value is null (e.g. authentication.offlineUUID)
        // must still carry an explicit "value": null. serializeField writes JsonNull, and the
        // default Gson silently drops null members, so the key vanished from the payload and
        // the contract "every item has a value" only held by accident on the frontend.
        HttpHelper.sendJson(ctx, root, HttpHelper.GSON_NULLS);
    }

    /** Serializes one field definition plus its current value. */
    private JsonObject serializeField(BasicDef def) {
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

    /** Accepts a flat map of path → value and applies each (whitelist-checked). */
    public void handleBasicConfigUpdate(ChannelHandlerContext ctx, FullHttpRequest req) {
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

            Map<String, BasicDef> byPath = allFields();
            List<String> applied = new ArrayList<>();
            List<String> rejected = new ArrayList<>();
            for (Map.Entry<String, JsonElement> entry : values.entrySet()) {
                BasicDef def = byPath.get(entry.getKey());
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
            HttpHelper.sendJson(ctx, Map.of("success", false, "error", "Basic config update failed"));
        }
    }

    // ── Reflective CONFIG access (anchored at CONFIG root) ─────────

    /** Resolves a full {@code "a.b.c"} path against CONFIG, returning the leaf or null. */
    private static Object readPath(String path) {
        try {
            Object current = CONFIG;
            for (String part : path.split("\\.")) {
                current = field(current, part).get(current);
                if (current == null) return null;
            }
            return current;
        } catch (Exception e) {
            return null;
        }
    }

    /** Writes a JSON value into the leaf field at {@code path}, coercing to field type. */
    private static void writePath(BasicDef def, JsonElement raw) throws Exception {
        Object target = CONFIG;
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

    private static Object coerce(BasicDef def, Field leaf, JsonElement raw) {
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
        if (type == java.util.UUID.class) {
            String s = raw.getAsString();
            return (s == null || s.isEmpty()) ? null : java.util.UUID.fromString(s);
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
     * Rejects numeric values outside the bounds declared in {@link BasicDef}.
     * The bounds were previously advertised to the browser but never enforced on
     * the server, so a direct POST could write an out-of-range port or timeout.
     *
     * @return the same value, so the call sites stay single expressions
     */
    private static <T extends Number> T inRange(BasicDef def, T value) {
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

    /** Convenience for method-not-allowed responses. */
    public static void sendMethodNotAllowed(ChannelHandlerContext ctx) {
        HttpHelper.sendError(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, "Method Not Allowed");
    }
}
