# IP cameras in Studio

Each camera slot can use a phone or a local RTSP camera, including one of each. Settings are saved for this Windows account.

1. Connect the camera and Studio PC to the same local network. For a Tapo C120, finish setup in the Tapo app and create a **Camera Account** in Advanced Settings. Use this local login, not your Tapo email/password.
2. Find the camera's private IPv4 address in Device Info. A router DHCP reservation keeps it stable.
3. Open **Camera sources → Camera 1 settings** or **Camera 2 settings**, or use that camera's scoring-tile **Settings** button.
4. Choose **IP camera**, then **Tapo**. Enter the private IP and local username/password. Port 554 and higher-quality stream1 are selected automatically. Leave an upright camera upright; rotation is optional.
5. For another camera, choose **Other RTSP camera** and paste its RTSP address or enter its private IP. The native dialog extracts pasted login details and shows only the private IP after you leave the address field. Anonymous access can leave both login fields empty. Use **Advanced settings** for its port and path.
6. Choose **Save and test connection**. Only **Receiving fresh camera video** confirms delivery. If no game is connected, settings apply when you connect the game's cameras. **Cancel** closes an unsaved edit without changing the saved source.

Advanced settings also offer Tapo quality (higher quality stream1 or lower bandwidth stream2) and optional 0°, 90°, 180° or 270° rotation. Studio preserves the complete frame without cropping or stretching. Generic RTSP cameras require a literal private IPv4 address; public addresses and hostnames are unsupported. Port must be 1–65535; the path must start with / and cannot contain whitespace, control characters, # or backslashes. Compatibility depends on the camera's actual RTSP media.

Use **Reconnect camera** if fresh video stops. Check the local address, login and network if recovery fails. Mic and volume controls use the camera microphone when available; USB commentary remains available. IP slots have no phone QR invitation or phone zoom controls. Choose **Phone** to return that slot to the phone workflow.

Credentials and RTSP paths remain in native Studio and its local controller. Studio stores settings encrypted with Windows DPAPI CurrentUser in %LOCALAPPDATA%\CurlStreamer\Studio\CameraInputs.dat. Credentials, full RTSP addresses and paths never enter WebView messages, website state or logs. Existing saved Tapo settings remain supported. A different Windows account cannot decrypt them.

Automated checks cover validation, pasted addresses, anonymous access, legacy settings and encrypted persistence. Physical camera video/audio, network recovery and rotation require a hardware rehearsal on the intended network.
