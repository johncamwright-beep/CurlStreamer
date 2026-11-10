# IP cameras in Studio

Each camera slot can use a phone or a local RTSP camera, including one of each. Settings are saved for this Windows account.

1. Connect the camera and Studio PC to the same local network. For a Tapo C120, finish setup in the Tapo app and create a **Camera Account** in Advanced Settings. Use this local login, not your Tapo email/password.
2. Find the camera's private IPv4 address in Device Info. A router DHCP reservation keeps it stable.
3. Open the game and select **Settings** on the camera tile. The camera settings panel opens inside Studio and can be used before the camera connects.
4. Choose **Tapo IP camera**. Enter the private IP and local username and password. Studio defaults to port 554 and the higher-quality stream. Rotation is optional.
5. For another camera, choose **Other RTSP camera** and paste its RTSP address or enter its private IP. The panel extracts pasted login details and shows the private IP after you leave the address field. Anonymous access can leave both login fields empty. Use **Advanced settings** for the port and path.
6. Choose **Save settings**, then **Connect** on the camera tile. New sessions keep saved IP cameras off until you connect them. **Receiving video** confirms delivery. Editing an enabled source of the same type keeps it enabled. **Cancel** closes the panel and discards unsaved changes.

Advanced settings also offer Tapo quality (higher quality stream1 or lower bandwidth stream2) and optional 0°, 90°, 180° or 270° rotation. Studio preserves the complete frame without cropping or stretching. Generic RTSP cameras require a literal private IPv4 address; public addresses and hostnames are unsupported. Port must be 1–65535; the path must start with / and cannot contain whitespace, control characters, # or backslashes. Compatibility depends on the camera's actual RTSP media.

After connecting, use **Hide from broadcast** / **Show in broadcast** to control its picture while keeping its connection warm. Use **Reconnect camera** if fresh video stops. Check the local address, login and network if recovery fails. Mic and volume controls use the camera microphone when available. USB commentary remains available. IP slots use Studio digital zoom. Choose **Phone (QR code)** to use a phone temporarily. Studio keeps that slot’s last IP settings for when you switch back.

Credentials and RTSP paths remain in native Studio and its local controller. Studio encrypts camera settings for the current Windows account with DPAPI and saves them in `%USERPROFILE%\.curlstreamer\Studio\CameraInputs.dat`. It imports existing settings from the legacy Studio profile the first time it finds them. The new location is shared by Studio launches under the same Windows account, including launches from apps with their own AppData folders. A different Windows account uses a separate profile.

Automated checks cover validation, pasted addresses, anonymous access, legacy settings and encrypted persistence. Physical camera video/audio, network recovery and rotation require a hardware rehearsal on the intended network.
