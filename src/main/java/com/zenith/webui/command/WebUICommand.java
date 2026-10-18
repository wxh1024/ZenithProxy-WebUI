package com.zenith.webui.command;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.zenith.command.api.Command;
import com.zenith.command.api.CommandCategory;
import com.zenith.command.api.CommandContext;
import com.zenith.command.api.CommandUsage;

import java.util.function.BooleanSupplier;

/**
 * /webui command — control the WebUI server (enable/disable/status).
 */
public class WebUICommand extends Command {
    private final BooleanSupplier startAction;
    private final Runnable stopAction;
    private final BooleanSupplier isRunning;
    private final int port;

    public WebUICommand(BooleanSupplier startAction, Runnable stopAction,
                        BooleanSupplier isRunning, int port) {
        this.startAction = startAction;
        this.stopAction = stopAction;
        this.isRunning = isRunning;
        this.port = port;
    }

    @Override
    public CommandUsage commandUsage() {
        return CommandUsage.builder().name("webui").category(CommandCategory.MANAGE)
                .description("控制WebUI服务器").usageLines("enable", "disable", "status").build();
    }

    @Override
    public LiteralArgumentBuilder<CommandContext> register() {
        return literal("webui")
                .then(literal("enable").executes(ctx -> {
                    boolean ok = startAction.getAsBoolean();
                    ctx.getSource().getEmbed()
                            .title(ok ? "WebUI Enabled" : "WebUI Start Failed")
                            .description(ok ? "http://localhost:" + port : "检查日志了解详情 / Check logs for details");
                    return ok ? 1 : 0;
                }))
                .then(literal("disable").executes(ctx -> {
                    stopAction.run();
                    ctx.getSource().getEmbed().title("WebUI Disabled");
                    return 1;
                }))
                .then(literal("status").executes(ctx -> {
                    String status = isRunning.getAsBoolean() ? "Running" : "Stopped";
                    ctx.getSource().getEmbed().title("WebUI Status")
                            .description("状态: " + status + "\nHTTP: http://localhost:" + port);
                    return 1;
                }))
                .executes(ctx -> {
                    ctx.getSource().getEmbed().title("WebUI")
                            .description("用法: webui enable/disable/status");
                    return 1;
                });
    }
}
