package com.zenith.webui.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonSyntaxException;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.SecureRandom;

public class ConfigManager {
    private static final ComponentLogger LOG = ComponentLogger.logger("WebUI");
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private final Path configDir;
    private final Path configFile;
    private WebUIConfig config;

    public ConfigManager(Path configDir) {
        this.configDir = configDir;
        this.configFile = configDir.resolve("config.json");
    }

    private static boolean isValid(WebUIConfig c) {
        if (c == null) return false;
        if (c.port < 1 || c.port > 65535) return false;
        if (c.auth == null) return false;
        if (c.auth.username == null || c.auth.username.isBlank()) return false;
        if (c.auth.password == null || c.auth.password.isBlank()) return false;
        return true;
    }

    private static WebUIConfig freshConfig() {
        WebUIConfig c = new WebUIConfig();
        c.auth.password = generateRandomPassword();
        return c;
    }

    private static void mkdirs(Path dir) {
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to create directory: " + dir, e);
        }
    }

    private static String generateRandomPassword() {
        byte[] bytes = new byte[8];
        new SecureRandom().nextBytes(bytes);
        char[] chars = new char[16];
        for (int i = 0; i < 8; i++) {
            int b = bytes[i] & 0xFF;
            chars[i * 2] = HEX[b >>> 4];
            chars[i * 2 + 1] = HEX[b & 0x0F];
        }
        return new String(chars);
    }

    public void loadOrCreate() {
        mkdirs(configDir);

        if (Files.exists(configFile)) {
            WebUIConfig parsed = parseConfig(configFile);
            if (parsed == null || !isValid(parsed)) {
                // Corrupted (bad JSON or invalid fields) — backup and regenerate
                backupAndRegenerate(parsed == null ? "malformed JSON" : "invalid fields");
            } else {
                config = parsed;
                LOG.info("Loaded WebUI config: port={}", config.port);
            }
        } else {
            config = freshConfig();
            save();
            LOG.info("Created WebUI config: username={}, password={}",
                    config.auth.username, config.auth.password);
        }
    }

    private WebUIConfig parseConfig(Path file) {
        try {
            String content = Files.readString(file);
            return GSON.fromJson(content, WebUIConfig.class);
        } catch (JsonSyntaxException e) {
            LOG.warn("Config JSON is malformed: {}", e.getMessage());
            return null;
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read config file: " + file, e);
        }
    }

    /**
     * Backup corrupted file as .bak, then regenerate from scratch.
     */
    private void backupAndRegenerate(String reason) {
        Path bakFile = configDir.resolve("config.json.bak");
        try {
            Files.move(configFile, bakFile, StandardCopyOption.REPLACE_EXISTING);
            LOG.warn("Config {} — backed up to {}", reason, bakFile.getFileName());
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to backup corrupted config", e);
        }
        config = freshConfig();
        save();
        LOG.info("Regenerated WebUI config with random password");
    }

    public void save() {
        try {
            mkdirs(configDir);
            Files.writeString(configFile, GSON.toJson(config));
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to save config: " + configFile, e);
        }
    }

    public WebUIConfig getConfig() {
        return config;
    }

    public Path getConfigDir() {
        return configDir;
    }

    public Path getConfigFile() {
        return configFile;
    }
}
