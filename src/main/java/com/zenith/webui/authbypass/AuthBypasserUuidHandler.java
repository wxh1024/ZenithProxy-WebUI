package com.zenith.webui.authbypass;

import com.zenith.network.client.ClientSession;
import com.zenith.network.codec.PacketHandler;
import org.geysermc.mcprotocollib.auth.GameProfile;
import org.geysermc.mcprotocollib.protocol.packet.login.serverbound.ServerboundHelloPacket;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Rewrites the UUID in ServerboundHelloPacket for offline-mode accounts
 * to the standard Mojang offline format (UUID.nameUUIDFromBytes("OfflinePlayer:<username>")).
 * This fixes conflicts on hybrid-auth servers like the 3C network where the
 * server expects the standard offline UUID format.
 * <p>
 * Original author: CandyMagicShow (3CNewAuthBypasser plugin)
 */
public class AuthBypasserUuidHandler implements PacketHandler<ServerboundHelloPacket, ClientSession> {

    @Override
    public ServerboundHelloPacket apply(ServerboundHelloPacket packet, ClientSession session) {
        var config = AuthBypasserState.getConfig();
        if (config == null || !config.rewriteOfflineUuid) return packet;

        String username = packet.getUsername();
        UUID computedUuid = UUID.nameUUIDFromBytes(
                ("OfflinePlayer:" + username).getBytes(StandardCharsets.UTF_8));

        if (packet.getProfileId().equals(computedUuid)) return packet;

        return new ServerboundHelloPacket(username, computedUuid);
    }
}
