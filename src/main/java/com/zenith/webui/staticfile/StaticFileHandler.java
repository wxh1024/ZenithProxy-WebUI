package com.zenith.webui.staticfile;

import com.zenith.webui.auth.AuthHandler;
import com.zenith.webui.http.HttpHelper;
import io.netty.channel.ChannelHandlerContext;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Serves static files from classpath and plugin directory with caching.
 * Both classpath resources and filesystem files share the same cache
 * to avoid repeated reads.
 */
public class StaticFileHandler {
    private static final int FILE_CACHE_MAX_SIZE = 128;
    /**
     * LRU file cache: access-order LinkedHashMap wrapped in synchronizedMap for thread safety.
     */
    private static final Map<Path, byte[]> fileCache = Collections.synchronizedMap(
            new LinkedHashMap<>(FILE_CACHE_MAX_SIZE, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<Path, byte[]> eldest) {
                    return size() > FILE_CACHE_MAX_SIZE;
                }
            });
    /**
     * Cache classpath resources keyed by path (e.g. "index.html").
     */
    private static final Map<String, byte[]> resourceCache = Collections.synchronizedMap(
            new LinkedHashMap<>(FILE_CACHE_MAX_SIZE, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
                    return size() > FILE_CACHE_MAX_SIZE;
                }
            });
    /**
     * Sentinel for files that don't exist, to avoid repeated I/O.
     */
    private static final byte[] NOT_FOUND = new byte[0];

    private final Path webDir;

    public StaticFileHandler(Path configDir) {
        this.webDir = configDir.resolve("web").toAbsolutePath().normalize();
    }

    /**
     * True for extension-bearing paths, i.e. real files rather than SPA routes.
     */
    private static boolean looksLikeAsset(String path) {
        int slash = path.lastIndexOf('/');
        int dot = path.lastIndexOf('.');
        return dot > slash && dot > 0;
    }

    public void handleStaticFile(ChannelHandlerContext ctx, String path) {
        if ("/".equals(path)) path = "/index.html";

        if (!AuthHandler.isSafePath(path)) {
            HttpHelper.sendNotFound(ctx);
            return;
        }

        byte[] content = loadResourceCached(path);
        if (content == null) {
            content = loadWebDirFile(path);
        }

        if (content != null) {
            // no-cache (revalidate) — these are the SPA's JS/CSS/HTML and they
            // change on every deploy; without this header the browser would keep
            // serving a stale module long after the backend has been replaced.
            HttpHelper.sendBytes(ctx, content, HttpHelper.getContentType(path), "no-cache");
        } else if (looksLikeAsset(path)) {
            // A missing .js/.css/.png must 404 rather than silently return the
            // SPA HTML — the browser would fail on the MIME type with a far
            // more confusing error.
            HttpHelper.sendNotFound(ctx);
        } else {
            // SPA fallback
            content = loadResourceCached("/index.html");
            if (content == null) {
                content = loadWebDirFile("/index.html");
            }
            if (content != null) {
                HttpHelper.sendBytes(ctx, content, "text/html; charset=utf-8", "no-cache");
            } else {
                HttpHelper.sendNotFound(ctx);
            }
        }
    }

    /**
     * Resolve a URL path inside the plugin's web directory.
     * {@code isSafePath} already rejects {@code ..}, but an absolute Windows path
     * such as {@code /C:/Windows/win.ini} would still escape through
     * {@link Path#resolve}; the containment check below closes that hole.
     */
    private byte[] loadWebDirFile(String urlPath) {
        Path candidate;
        try {
            candidate = webDir.resolve(urlPath.substring(1)).normalize();
        } catch (InvalidPathException e) {
            // Windows rejects characters such as * ? " < > | outright, so no file can
            // match. Report a miss (the caller answers 404) rather than letting the
            // exception escape to the channel handler, which would surface as a 500
            // for what is really a bad URL.
            return null;
        }
        if (!candidate.startsWith(webDir)) {
            return null;
        }
        return loadFile(candidate);
    }

    /**
     * Cached wrapper around classpath resource loading.
     */
    private byte[] loadResourceCached(String path) {
        String cacheKey = path.startsWith("/") ? path.substring(1) : path;
        byte[] cached = resourceCache.get(cacheKey);
        if (cached != null) {
            return cached == NOT_FOUND ? null : cached;
        }
        byte[] content = loadResource(cacheKey);
        resourceCache.put(cacheKey, content != null ? content : NOT_FOUND);
        return content;
    }

    private byte[] loadResource(String path) {
        // path already normalized (no leading /) by loadResourceCached
        try (InputStream is = getClass().getResourceAsStream("/web/" + path)) {
            if (is == null) return null;
            return is.readAllBytes();
        } catch (IOException e) {
            return null;
        }
    }

    byte[] loadFile(Path path) {
        byte[] cached = fileCache.get(path);
        if (cached != null) {
            return cached == NOT_FOUND ? null : cached; // sentinel: file doesn't exist
        }
        try {
            byte[] content = null;
            if (Files.exists(path) && !Files.isDirectory(path)) {
                content = Files.readAllBytes(path);
            }
            // Use sentinel to cache the "not found" result, avoiding repeated I/O
            fileCache.put(path, content != null ? content : NOT_FOUND);
            return content;
        } catch (IOException e) {
            fileCache.put(path, NOT_FOUND);
            return null;
        }
    }
}
