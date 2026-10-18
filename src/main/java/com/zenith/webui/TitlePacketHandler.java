package com.zenith.webui;

import com.zenith.network.client.ClientSession;
import com.zenith.network.codec.ClientEventLoopPacketHandler;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.title.ClientboundSetTitleTextPacket;

public class TitlePacketHandler implements ClientEventLoopPacketHandler<ClientboundSetTitleTextPacket, ClientSession> {
    private static final LegacyComponentSerializer SERIALIZER = LegacyComponentSerializer.legacySection();

    @Override
    public boolean applyAsync(ClientboundSetTitleTextPacket packet, ClientSession session) {
        try {
            String text = SERIALIZER.serialize(packet.getText());
            if (text != null && !text.isEmpty()) {
                WebUIPlugin.pushTitle(text);
            }
        } catch (Exception ignored) {
        }
        return true;
    }
}
