package com.zenith.webui.queue;

import com.zenith.network.client.ClientSession;
import com.zenith.network.codec.ClientEventLoopPacketHandler;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.title.ClientboundSetSubtitleTextPacket;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.title.ClientboundClearTitlesPacket;

import static com.zenith.Globals.*;

/**
 * 3c3u.org 服务器队列解析器
 * 拦截 Subtitle 包，解析格式: &lt;onlinePlayers&gt; | Position in queue: &lt;position&gt;
 * <p>
 * 队列完成检测：排队完成时服务器发送 ClearTitles 包清除字幕。
 */
public class QueueParser implements ClientEventLoopPacketHandler<ClientboundSetSubtitleTextPacket, ClientSession> {

    private static final String TARGET_SERVER = "3c3u.org";

    public static volatile String queuePos = "";
    public static volatile int onlinePlayers = 0;
    public static volatile int positionInQueue = -1;

    public static boolean is3cQueue() {
        return positionInQueue > 0;
    }

    public static void reset() {
        queuePos = "";
        onlinePlayers = 0;
        positionInQueue = -1;
    }

    @Override
    public boolean applyAsync(ClientboundSetSubtitleTextPacket packet, ClientSession session) {
        String serverAddress = CONFIG.client.server.address;
        if (serverAddress == null || !serverAddress.toLowerCase().contains(TARGET_SERVER)) {
            return true;
        }

        try {
            parse3cQueuePos(packet);
        } catch (Exception ignored) {
        }
        return true;
    }

    private void parse3cQueuePos(ClientboundSetSubtitleTextPacket packet) {
        if (packet == null) {
            positionInQueue = -1;
            return;
        }
        String text = com.zenith.util.ComponentSerializer.serializePlain(packet.getText());
        if (text == null || text.isEmpty()) {
            positionInQueue = -1;
            return;
        }

        // Format: "<onlinePlayers> | Position in queue: <position>"
        try {
            String[] parts = text.split("\\|");
            if (parts.length < 2) {
                positionInQueue = -1;
                return;
            }

            String onlinePart = parts[0].trim();
            try {
                onlinePlayers = Integer.parseInt(onlinePart.split("\\s+")[0]);
            } catch (NumberFormatException e) {
                onlinePlayers = 0;
            }

            String positionPart = parts[1].trim();
            String[] positionSplit = positionPart.split(":");
            if (positionSplit.length >= 2) {
                positionInQueue = Integer.parseInt(positionSplit[1].trim());
            } else {
                positionInQueue = -1;
            }
        } catch (Exception e) {
            CLIENT_LOG.warn("Error parsing queue info from text: {}", text, e);
            positionInQueue = -1;
        }
    }

    /**
     * 监听 ClearTitles 包作为队列完成信号。
     * 排队完成时服务器会清除排队字幕，此时重置队列状态。
     */
    public static class ClearHandler implements ClientEventLoopPacketHandler<ClientboundClearTitlesPacket, ClientSession> {
        @Override
        public boolean applyAsync(ClientboundClearTitlesPacket packet, ClientSession session) {
            String serverAddress = CONFIG.client.server.address;
            if (serverAddress == null || !serverAddress.toLowerCase().contains(TARGET_SERVER)) {
                return true;
            }
            if (positionInQueue > 0) {
                reset();
            }
            return true;
        }
    }
}
