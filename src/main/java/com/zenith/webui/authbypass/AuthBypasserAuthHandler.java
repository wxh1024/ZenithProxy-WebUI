package com.zenith.webui.authbypass;

import com.zenith.feature.api.sessionserver.SessionServerApi;
import com.zenith.network.client.ClientSession;
import com.zenith.network.codec.PacketHandler;
import org.geysermc.mcprotocollib.protocol.packet.login.clientbound.ClientboundHelloPacket;
import org.geysermc.mcprotocollib.protocol.packet.login.serverbound.ServerboundKeyPacket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.crypto.SecretKey;

/**
 * Intercepts the server's ClientboundHelloPacket when {@code shouldAuthenticate=true}.
 * For offline-mode accounts, this handler generates a shared secret locally and
 * completes the encryption handshake without contacting Mojang's session servers.
 * This allows offline accounts to join hybrid-auth servers that still set
 * authenticate=true in their hello packet.
 * <p>
 * Original author: CandyMagicShow (3CNewAuthBypasser plugin)
 */
public class AuthBypasserAuthHandler implements PacketHandler<ClientboundHelloPacket, ClientSession> {

    private static final Logger LOG = LoggerFactory.getLogger(AuthBypasserAuthHandler.class);

    @Override
    public ClientboundHelloPacket apply(ClientboundHelloPacket packet, ClientSession session) {
        var config = AuthBypasserState.getConfig();
        if (config == null || !config.bypassAuthenticateHello) return packet;
        if (!packet.isShouldAuthenticate()) return packet;

        try {
            SecretKey secretKey = SessionServerApi.INSTANCE.generateClientKey();
            session.send(new ServerboundKeyPacket(
                    packet.getPublicKey(), secretKey, packet.getChallenge()));
            session.enableEncryption(secretKey);
        } catch (Exception e) {
            LOG.error("AuthBypasser: failed to complete offline auth handshake", e);
            session.disconnect("Failed to complete login [AuthBypasser]");
        }
        return null;
    }
}
